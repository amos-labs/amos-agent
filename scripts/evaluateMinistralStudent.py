#!/usr/bin/env python3
"""Run exact, deterministic trajectory qualification for an MLX Ministral adapter.

This evaluator does not execute generated code and does not use a model judge.
It verifies native tool names/JSON arguments, supplies the registered synthetic
tool result only after a correct call, and requires the final assistant output
to match the verified canonical target after whitespace normalization. Code
rows are therefore syntax-exact checks here; executable qualification remains a
separate promotion gate.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate an AMOS Ministral student checkpoint")
    parser.add_argument("--dataset", required=True, help="Synthetic source dataset JSON")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--adapter-path", default=None)
    parser.add_argument("--split", default="validation")
    parser.add_argument("--per-workflow", type=int, default=4)
    parser.add_argument("--max-tokens", type=int, default=192)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def load_records(path: Path, split: str, per_workflow: int) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    records = value if isinstance(value, list) else value.get("records")
    if not isinstance(records, list):
        raise ValueError("Dataset JSON must be an array or contain records")

    selected = []
    counts: Counter[str] = Counter()
    for record in records:
        workflow = record.get("task", {}).get("workflow")
        if record.get("split") != split or not workflow or counts[workflow] >= per_workflow:
            continue
        selected.append(record)
        counts[workflow] += 1
    if not selected:
        raise ValueError(f"No records selected for split {split}")
    return selected


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def parse_tool_call(text: str) -> tuple[str, dict[str, Any]]:
    match = re.match(r"^\s*\[TOOL_CALLS\]([A-Za-z0-9_.-]+)\[ARGS\]", text)
    if not match:
        raise ValueError("missing native tool-call prefix")
    arguments, end = json.JSONDecoder().raw_decode(text[match.end() :].lstrip())
    if not isinstance(arguments, dict):
        raise ValueError("tool arguments are not an object")
    if text[match.end() :].lstrip()[end:].strip():
        raise ValueError("unexpected text after tool arguments")
    return match.group(1), arguments


def evaluate_record(
    record: dict[str, Any],
    model: Any,
    processor: Any,
    generate: Any,
    apply_chat_template: Any,
    max_tokens: int,
) -> dict[str, Any]:
    conversation = [dict(message) for message in record["input"]["messages"]]
    targets = record["target"]["messages"]
    tools = record["input"].get("tools") or []
    outputs = []
    errors = []
    prompt_tokens = 0
    generated_tokens = 0
    generation_seconds = 0.0
    target_index = 0

    while target_index < len(targets):
        target = targets[target_index]
        if target.get("role") != "assistant":
            errors.append(f"unexpected target role at {target_index}")
            break

        prompt = apply_chat_template(
            processor,
            model.config,
            conversation,
            add_generation_prompt=True,
            tools=tools,
        )
        if tools and "[AVAILABLE_TOOLS]" not in prompt:
            errors.append("rendered prompt omitted available tools")
            break

        started = time.perf_counter()
        response = generate(
            model,
            processor,
            prompt,
            max_tokens=max_tokens,
            temperature=0.0,
            verbose=False,
        )
        generation_seconds += time.perf_counter() - started
        prompt_tokens += response.prompt_tokens
        generated_tokens += response.generation_tokens
        outputs.append(response.text)

        expected_calls = target.get("tool_calls") or []
        if expected_calls:
            if len(expected_calls) != 1:
                errors.append("evaluator supports one expected call per assistant turn")
                break
            expected_call = expected_calls[0]
            try:
                name, arguments = parse_tool_call(response.text)
            except (ValueError, json.JSONDecodeError) as error:
                errors.append(str(error))
                break
            expected_name = expected_call["function"]["name"]
            expected_arguments = json.loads(expected_call["function"]["arguments"])
            if name != expected_name:
                errors.append(f"expected tool {expected_name}, got {name}")
                break
            if arguments != expected_arguments:
                errors.append(f"wrong arguments for {name}")
                break
            if target_index + 1 >= len(targets) or targets[target_index + 1].get("role") != "tool":
                errors.append("verified target is missing the tool result")
                break
            conversation.append(target)
            conversation.append(targets[target_index + 1])
            target_index += 2
            continue

        if normalized(response.text) != normalized(target.get("content", "")):
            errors.append("final output differs from canonical verified target")
            break
        conversation.append(target)
        target_index += 1

    return {
        "id": record["id"],
        "family_id": record["family_id"],
        "workflow": record["task"]["workflow"],
        "skill_group": record["task"].get("skill_group"),
        "passed": not errors and target_index == len(targets),
        "errors": errors,
        "outputs": outputs,
        "expected_final": targets[-1].get("content", ""),
        "prompt_tokens": prompt_tokens,
        "generated_tokens": generated_tokens,
        "generation_seconds": generation_seconds,
        "generation_tps": generated_tokens / generation_seconds if generation_seconds else 0.0,
    }


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    by_workflow: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in results:
        by_workflow[result["workflow"]].append(result)
    generated_tokens = sum(result["generated_tokens"] for result in results)
    generation_seconds = sum(result["generation_seconds"] for result in results)
    passed = sum(result["passed"] for result in results)
    return {
        "trajectories": len(results),
        "passed": passed,
        "pass_rate": passed / len(results),
        "prompt_tokens": sum(result["prompt_tokens"] for result in results),
        "generated_tokens": generated_tokens,
        "generation_seconds": generation_seconds,
        "generation_tps": generated_tokens / generation_seconds if generation_seconds else 0.0,
        "workflows": {
            workflow: {
                "trajectories": len(rows),
                "passed": sum(row["passed"] for row in rows),
            }
            for workflow, rows in sorted(by_workflow.items())
        },
    }


def main() -> None:
    args = parse_args()
    if args.per_workflow < 1 or args.max_tokens < 1:
        raise ValueError("per-workflow and max-tokens must be positive")

    from mlx_vlm.generate import generate
    from mlx_vlm.prompt_utils import apply_chat_template
    from mlx_vlm.utils import load

    records = load_records(Path(args.dataset).expanduser().resolve(), args.split, args.per_workflow)
    model, processor = load(
        args.model_path,
        adapter_path=args.adapter_path,
        trust_remote_code=True,
        fix_mistral_regex=True,
    )

    results = []
    for index, record in enumerate(records, start=1):
        result = evaluate_record(
            record,
            model,
            processor,
            generate,
            apply_chat_template,
            args.max_tokens,
        )
        results.append(result)
        print(json.dumps({
            "progress": f"{index}/{len(records)}",
            "id": result["id"],
            "workflow": result["workflow"],
            "passed": result["passed"],
            "generated_tokens": result["generated_tokens"],
        }), flush=True)

    artifact = {
        "schema": "amos.ministral-student-trajectory-evaluation",
        "version": 1,
        "model_path": args.model_path,
        "adapter_path": args.adapter_path,
        "dataset": str(Path(args.dataset).expanduser().resolve()),
        "split": args.split,
        "per_workflow": args.per_workflow,
        "scoring": "exact verified canonical trajectory; tool calls compare parsed JSON",
        "summary": summarize(results),
        "results": results,
    }
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **artifact["summary"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
