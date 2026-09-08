"""Offline text-only, thinking-off tokenizer worker. No model weights or network."""
import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import copy
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition):
    if not condition:
        raise ValueError("tokenizer contract violation")


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def serving_tools(tools):
    # This explicit v2 profile matches the observed serving schema serializer.
    # Preserve parameter-schema key order and never modify the wire request.
    result = []
    for tool in tools:
        require(isinstance(tool, dict) and set(tool) == {"type", "function"})
        require(tool["type"] == "function")
        function = tool["function"]
        require(isinstance(function, dict) and set(function) == {"name", "description", "parameters"})
        require(isinstance(function["name"], str) and bool(function["name"]))
        require(isinstance(function["description"], str))
        require(isinstance(function["parameters"], dict))
        result.append({"type": "function", "function": {
            "name": function["name"], "description": function["description"],
            "parameters": function["parameters"]
        }})
    return result


def main():
    directory, manifest_path, maximum, expected_manifest_sha = sys.argv[1:]
    maximum = int(maximum)
    manifest_bytes = Path(manifest_path).read_bytes()
    require(sha(manifest_bytes) == expected_manifest_sha)
    manifest = json.loads(manifest_bytes)
    profile = manifest["profile"]
    require(profile in {"qwen-text-thinking-off-json-arguments-v1", "qwen-text-thinking-off-serving-tools-v2"})
    required = {"chat_template.jinja", "config.json", "merges.txt", "tokenizer.json", "tokenizer_config.json", "vocab.json"}
    require(set(manifest["files"]) == required)
    require(set(manifest["runtime"]) == {"transformers", "tokenizers", "jinja2", "huggingface-hub"})
    for name, expected in manifest["runtime"].items():
        require(importlib.metadata.version(name) == expected)
    root = Path(directory)
    for name, expected in manifest["files"].items():
        require(sha((root / name).read_bytes()) == expected)

    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(str(root), local_files_only=True, trust_remote_code=False)
    require(tokenizer.get_chat_template() == (root / "chat_template.jinja").read_text())
    emit({"type": "ready", "manifestSha256": sha(manifest_bytes), "workerSha256": sha(Path(__file__).read_bytes())})
    while True:
        line = sys.stdin.buffer.readline(maximum + 1)
        if not line:
            return
        if len(line) > maximum or not line.endswith(b"\n"):
            raise ValueError("input protocol limit")
        request = json.loads(line)
        request_id = request["id"]
        require(type(request_id) is int and 0 < request_id <= 9_007_199_254_740_991)
        body = request["body"]
        require(isinstance(body, dict))
        allowed = {"model", "messages", "max_completion_tokens", "tools", "stream", "enable_thinking",
                   "chat_template_kwargs", "stream_options", "tool_choice"}
        require(set(body) <= allowed)
        require(isinstance(body.get("model"), str) and bool(body["model"]))
        require(body.get("enable_thinking") is False)
        require(body.get("chat_template_kwargs") == {"enable_thinking": False})
        require(body.get("tool_choice", "auto") == "auto")
        messages = copy.deepcopy(body["messages"])
        require(isinstance(messages, list) and messages)
        tools = body.get("tools", [])
        require(isinstance(tools, list))
        if profile == "qwen-text-thinking-off-serving-tools-v2":
            tools = serving_tools(tools)
        for message in messages:
            require(message["role"] in {"system", "user", "assistant", "tool"})
            require(message.get("content") is None or isinstance(message["content"], str))
            for call in message.get("tool_calls", []):
                function = call["function"]
                arguments = function.get("arguments")
                if isinstance(arguments, str) and arguments != "":
                    decoded = json.loads(arguments)
                    require(isinstance(decoded, dict))
                    function["arguments"] = decoded
        ids = tokenizer.apply_chat_template(
            messages, tools=tools, tokenize=True, add_generation_prompt=True, enable_thinking=False
        )
        emit({"type": "count", "id": request_id, "inputTokens": len(ids)})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No prompt text, paths, credentials, or exception payloads over IPC.
        emit({"type": "error", "code": "tokenizer_worker_failed"})
        sys.exit(1)
