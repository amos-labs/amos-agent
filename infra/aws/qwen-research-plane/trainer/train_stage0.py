#!/usr/bin/env python3
"""Run the AMOS Qwen3.8-27B stage-zero QLoRA lineage proof.

This is deliberately not a quality-training program. It consumes one immutable
AMOS training contract, verifies every external input, trains only a LoRA
adapter on assistant tokens, and emits receipts needed for a later disposable
vLLM adapter-load proof.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import random
import sys
import traceback
import urllib.parse
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


CONTRACT_SCHEMA = "amos.qwen-adapter-training-contract"
DATASET_SCHEMA = "amos.native-qwen-dataset"
IGNORE_INDEX = -100


def main() -> int:
    args = parse_args()
    work = Path(args.work_dir).resolve()
    work.mkdir(parents=True, exist_ok=True)
    contract = load_json_uri(args.contract, work / "training-contract.json")
    validate_contract(contract)
    output_uri = contract["execution"]["outputUri"]
    try:
        result = run(contract, work, validate_only=args.validate_only)
        write_json(work / "stage0-result.json", result)
        upload_tree(work, output_uri)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        failure = {
            "schema": "amos.qwen-adapter-stage0-failure",
            "version": 1,
            "contractId": contract.get("id"),
            "status": "failed",
            "errorType": type(error).__name__,
            "error": str(error),
            "traceback": traceback.format_exc(),
        }
        write_json(work / "stage0-failure.json", failure)
        with contextlib.suppress(Exception):
            upload_tree(work, output_uri)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--contract",
        default=os.environ.get("AMOS_TRAINING_CONTRACT_URI", ""),
        required=not bool(os.environ.get("AMOS_TRAINING_CONTRACT_URI")),
    )
    parser.add_argument("--work-dir", default="/work/stage0")
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def run(contract: dict[str, Any], work: Path, *, validate_only: bool) -> dict[str, Any]:
    dataset_root = work / "dataset"
    dataset_root.mkdir(exist_ok=True)
    manifest = load_json_uri(
        join_uri(contract["dataset"]["uri"], "dataset-manifest.json"),
        dataset_root / "dataset-manifest.json",
    )
    validate_dataset(manifest, contract)
    split_rows: dict[str, list[dict[str, Any]]] = {}
    for split in ("training", "validation", "holdout"):
        expected = contract["dataset"][f"{split}File"]
        destination = dataset_root / expected["path"]
        download_uri(join_uri(contract["dataset"]["uri"], expected["path"]), destination)
        verify_file(destination, expected["sha256"], expected["rows"])
        split_rows[split] = read_json_lines(destination)

    lineage = verify_upstream_lineage(contract["base"])
    write_json(work / "upstream-lineage-receipt.json", lineage)
    preflight = {
        "schema": "amos.qwen-adapter-stage0-preflight",
        "version": 1,
        "contractId": contract["id"],
        "contractDigest": contract["digest"],
        "datasetDigest": manifest["digest"],
        "checkpointDigest": contract["base"]["checkpointDigest"],
        "rows": {name: len(rows) for name, rows in split_rows.items()},
        "lineageStatus": lineage["status"],
        "torchNativeJitDisabled": contract["execution"]["torchNativeJitDisabled"],
        "status": "passed",
    }
    write_json(work / "preflight-receipt.json", preflight)
    if validate_only:
        return {
            "schema": "amos.qwen-adapter-stage0-result",
            "version": 1,
            "contractId": contract["id"],
            "status": "preflight-passed",
            "qualityClaimAllowed": False,
            "promotionAllowed": False,
            "preflight": preflight,
        }
    return train(contract, split_rows, work, preflight)


def train(
    contract: dict[str, Any],
    split_rows: dict[str, list[dict[str, Any]]],
    work: Path,
    preflight: dict[str, Any],
) -> dict[str, Any]:
    if os.environ.get("TORCH_DISABLE_NATIVE_JIT") != "1":
        raise RuntimeError("stage-zero training requires TORCH_DISABLE_NATIVE_JIT=1")

    import torch
    from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training
    from torch.utils.data import DataLoader, Dataset
    from transformers import (
        AutoTokenizer,
        BitsAndBytesConfig,
        Qwen3_5ForConditionalGeneration,
    )

    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError("stage-zero training requires exactly one visible NVIDIA GPU")
    properties = torch.cuda.get_device_properties(0)
    total_gib = properties.total_memory / (1024**3)
    required_gib = contract["execution"]["requireSingleNvidiaGpuWithMinimumMemoryGib"]
    if total_gib < required_gib:
        raise RuntimeError(f"trainer GPU has {total_gib:.1f} GiB; {required_gib} GiB required")

    seed = contract["recipe"]["seed"]
    random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cuda.matmul.allow_tf32 = True

    model_root = work / "base-model"
    snapshot = download_and_verify_checkpoint(contract["base"], model_root)
    tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    maximum_tokens = contract["recipe"]["optimization"]["maximumSequenceTokens"]
    encoded = {
        split: [encode_example(tokenizer, row, maximum_tokens) for row in rows]
        for split, rows in split_rows.items()
    }
    tokenization = tokenization_receipt(encoded, contract)
    write_json(work / "tokenization-receipt.json", tokenization)

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    model = Qwen3_5ForConditionalGeneration.from_pretrained(
        snapshot,
        local_files_only=True,
        quantization_config=quantization,
        device_map={"": 0},
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    if type(model).__name__ != contract["base"]["architecture"]:
        raise RuntimeError("loaded model class does not match the pinned multimodal checkpoint")
    if not hasattr(model, "model") or not hasattr(model.model, "visual"):
        raise RuntimeError("the complete Qwen multimodal vision tower was not loaded")
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=contract["recipe"]["optimization"][
            "gradientCheckpointing"
        ],
    )
    probe = encoded["holdout"][0]
    base_probe_before = logits_digest(model, probe)

    adapter_recipe = contract["recipe"]["adapter"]
    lora = LoraConfig(
        r=adapter_recipe["rank"],
        lora_alpha=adapter_recipe["alpha"],
        lora_dropout=adapter_recipe["dropout"],
        bias=adapter_recipe["bias"],
        target_modules=adapter_recipe["targetModules"],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    assert_adapter_scope(model)
    parameter_receipt = parameter_receipt_for(model)
    write_json(work / "trainable-parameters-receipt.json", parameter_receipt)

    optimization = contract["recipe"]["optimization"]
    loader = DataLoader(
        EncodedDataset(encoded["training"], Dataset),
        batch_size=optimization["microBatchSize"],
        shuffle=True,
        generator=torch.Generator().manual_seed(seed),
        collate_fn=lambda batch: collate(batch, tokenizer.pad_token_id, torch),
    )
    optimizer = torch.optim.AdamW(
        (parameter for parameter in model.parameters() if parameter.requires_grad),
        lr=optimization["learningRate"],
        weight_decay=optimization["weightDecay"],
    )
    accumulation = optimization["gradientAccumulationSteps"]
    training_history: list[dict[str, Any]] = []
    optimizer.zero_grad(set_to_none=True)
    model.train()
    for epoch in range(optimization["epochs"]):
        total_loss = 0.0
        batches = 0
        for batch_index, batch in enumerate(loader, start=1):
            batch = {key: value.cuda(non_blocking=True) for key, value in batch.items()}
            output = model(**batch)
            loss = output.loss / accumulation
            loss.backward()
            total_loss += float(output.loss.detach().cpu())
            batches += 1
            if batch_index % accumulation == 0 or batch_index == len(loader):
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
        training_history.append({
            "epoch": epoch + 1,
            "meanLoss": total_loss / max(1, batches),
        })

    metrics = {
        split: evaluate(model, values, tokenizer.pad_token_id, torch)
        for split, values in encoded.items()
    }
    minimum_accuracy = contract["exitCriteria"]["minimumSupervisedTokenAccuracy"]
    if metrics["training"]["supervisedTokenAccuracy"] < minimum_accuracy:
        raise RuntimeError(
            "stage-zero micro-overfit did not meet supervised token accuracy: "
            f"{metrics['training']['supervisedTokenAccuracy']:.6f} < {minimum_accuracy:.6f}"
        )

    adapter_probe_before_save = logits_digest(model, probe)
    if adapter_probe_before_save == base_probe_before:
        raise RuntimeError("trained adapter did not change the fixed probe")
    adapter_root = work / "adapter"
    model.save_pretrained(adapter_root, safe_serialization=True)
    tokenizer.save_pretrained(adapter_root)
    adapter_files = digest_tree(adapter_root)

    base = model.unload()
    base_probe_after = logits_digest(base, probe)
    if base_probe_after != base_probe_before:
        raise RuntimeError("base probe changed after adapter training and unload")
    reloaded = PeftModel.from_pretrained(base, adapter_root, is_trainable=False)
    adapter_probe_after_reload = logits_digest(reloaded, probe)
    if adapter_probe_after_reload != adapter_probe_before_save:
        raise RuntimeError("reloaded adapter probe does not match the saved adapter")

    report = {
        "schema": "amos.qwen-adapter-stage0-result",
        "version": 1,
        "contractId": contract["id"],
        "contractDigest": contract["digest"],
        "status": "adapter-built-awaiting-vllm-load-proof",
        "qualityClaimAllowed": False,
        "promotionAllowed": False,
        "hardware": {
            "gpu": properties.name,
            "memoryGib": round(total_gib, 3),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
        },
        "preflight": preflight,
        "tokenization": tokenization,
        "parameters": parameter_receipt,
        "multimodalBase": {
            "architecture": type(base).__name__,
            "visionTowerPresent": hasattr(base, "model") and hasattr(base.model, "visual"),
            "visionAdapterParameters": parameter_receipt["visionAdapterParameters"],
            "status": "complete-base-preserved-frozen",
        },
        "trainingHistory": training_history,
        "metrics": metrics,
        "probes": {
            "baseBefore": base_probe_before,
            "baseAfterAdapterUnload": base_probe_after,
            "baseBitwiseUnchanged": base_probe_before == base_probe_after,
            "adapterBeforeSave": adapter_probe_before_save,
            "adapterAfterReload": adapter_probe_after_reload,
            "adapterReloadExact": adapter_probe_before_save == adapter_probe_after_reload,
        },
        "adapterFiles": adapter_files,
        "remainingExitCriteria": ["vllm-adapter-load-proof"],
    }
    report["digest"] = digest_value(report)
    return report


def encode_example(tokenizer: Any, row: dict[str, Any], maximum_tokens: int) -> dict[str, Any]:
    messages = row.get("messages")
    if not isinstance(messages, list) or [message.get("role") for message in messages] != [
        "system",
        "user",
        "assistant",
    ]:
        raise ValueError("each stage-zero SFT row must contain system, user, assistant messages")
    prompt_ids = _chat_template_input_ids(
        tokenizer,
        messages[:2],
        add_generation_prompt=True,
    )
    full_ids = _chat_template_input_ids(
        tokenizer,
        messages,
        add_generation_prompt=False,
    )
    if full_ids[: len(prompt_ids)] != prompt_ids:
        raise ValueError("assistant-token loss boundary is not a prefix of the full chat template")
    if len(full_ids) > maximum_tokens:
        raise ValueError(f"stage-zero example exceeds {maximum_tokens} tokens")
    if len(full_ids) == len(prompt_ids):
        raise ValueError("stage-zero example has no supervised assistant tokens")
    labels = [IGNORE_INDEX] * len(prompt_ids) + full_ids[len(prompt_ids) :]
    return {
        "input_ids": full_ids,
        "attention_mask": [1] * len(full_ids),
        "labels": labels,
        "metadata": row.get("metadata", {}),
    }


def _chat_template_input_ids(
    tokenizer: Any,
    messages: list[dict[str, Any]],
    *,
    add_generation_prompt: bool,
) -> list[int]:
    """Normalize Transformers 4.x lists and 5.x BatchEncoding results."""

    rendered = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=add_generation_prompt,
        enable_thinking=False,
        reasoning_effort="low",
    )
    if isinstance(rendered, Mapping):
        rendered = rendered.get("input_ids")
    if (
        not isinstance(rendered, (list, tuple))
        or not rendered
        or any(not isinstance(token, int) for token in rendered)
    ):
        raise ValueError("chat template did not return one flat input_ids sequence")
    return list(rendered)


def tokenization_receipt(
    encoded: dict[str, list[dict[str, Any]]], contract: dict[str, Any]
) -> dict[str, Any]:
    split_receipts = {}
    for split, rows in encoded.items():
        supervised = sum(
            1 for row in rows for token in row["labels"] if token != IGNORE_INDEX
        )
        masked = sum(1 for row in rows for token in row["labels"] if token == IGNORE_INDEX)
        if supervised <= 0 or masked <= 0:
            raise ValueError(f"{split} must contain masked prompts and supervised assistant tokens")
        split_receipts[split] = {
            "rows": len(rows),
            "maskedPromptTokens": masked,
            "supervisedAssistantTokens": supervised,
            "maximumTokens": max(len(row["input_ids"]) for row in rows),
        }
    receipt = {
        "schema": "amos.qwen-stage0-tokenization-receipt",
        "version": 1,
        "contractId": contract["id"],
        "loss": "assistant-tokens-only",
        "chatTemplateThinking": "disabled-empty-visible-think-block",
        "splits": split_receipts,
        "status": "passed",
    }
    receipt["digest"] = digest_value(receipt)
    return receipt


def collate(batch: list[dict[str, Any]], pad_token_id: int, torch: Any) -> dict[str, Any]:
    maximum = max(len(row["input_ids"]) for row in batch)
    output = {"input_ids": [], "attention_mask": [], "labels": []}
    for row in batch:
        padding = maximum - len(row["input_ids"])
        output["input_ids"].append(row["input_ids"] + [pad_token_id] * padding)
        output["attention_mask"].append(row["attention_mask"] + [0] * padding)
        output["labels"].append(row["labels"] + [IGNORE_INDEX] * padding)
    return {key: torch.tensor(value, dtype=torch.long) for key, value in output.items()}


def EncodedDataset(rows: list[dict[str, Any]], dataset_base: type) -> Any:
    class Values(dataset_base):
        def __len__(self) -> int:
            return len(rows)

        def __getitem__(self, index: int) -> dict[str, Any]:
            return rows[index]

    return Values()


def evaluate(model: Any, rows: list[dict[str, Any]], pad_token_id: int, torch: Any) -> dict[str, Any]:
    model.eval()
    loader = torch.utils.data.DataLoader(
        EncodedDataset(rows, torch.utils.data.Dataset),
        batch_size=1,
        shuffle=False,
        collate_fn=lambda batch: collate(batch, pad_token_id, torch),
    )
    correct = 0
    total = 0
    losses = []
    with torch.no_grad():
        for batch in loader:
            batch = {key: value.cuda(non_blocking=True) for key, value in batch.items()}
            output = model(**batch)
            losses.append(float(output.loss.detach().cpu()))
            shifted_logits = output.logits[:, :-1, :]
            shifted_labels = batch["labels"][:, 1:]
            mask = shifted_labels != IGNORE_INDEX
            predictions = shifted_logits.argmax(dim=-1)
            correct += int(((predictions == shifted_labels) & mask).sum().detach().cpu())
            total += int(mask.sum().detach().cpu())
    return {
        "meanLoss": sum(losses) / max(1, len(losses)),
        "supervisedTokens": total,
        "supervisedTokenAccuracy": correct / max(1, total),
    }


def logits_digest(model: Any, encoded: dict[str, Any]) -> str:
    import torch

    model.eval()
    device = next(model.parameters()).device
    input_ids = torch.tensor([encoded["input_ids"]], dtype=torch.long, device=device)
    attention_mask = torch.tensor(
        [encoded["attention_mask"]], dtype=torch.long, device=device
    )
    with torch.no_grad():
        logits = model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            logits_to_keep=1,
        ).logits.detach().contiguous().cpu()
    return hashlib.sha256(logits.view(torch.uint8).numpy().tobytes()).hexdigest()


def assert_adapter_scope(model: Any) -> None:
    names = [name for name, parameter in model.named_parameters() if parameter.requires_grad]
    if not names:
        raise RuntimeError("adapter created no trainable parameters")
    forbidden = [name for name in names if ".visual." in name or name.startswith("mtp.")]
    if forbidden:
        raise RuntimeError(f"stage-zero adapter targeted non-language weights: {forbidden[:5]}")
    if any("lora_" not in name for name in names):
        raise RuntimeError("stage-zero found trainable parameters outside LoRA adapters")


def parameter_receipt_for(model: Any) -> dict[str, Any]:
    total = sum(parameter.numel() for parameter in model.parameters())
    trainable = sum(
        parameter.numel() for parameter in model.parameters() if parameter.requires_grad
    )
    return {
        "schema": "amos.qwen-stage0-parameter-receipt",
        "version": 1,
        "totalParametersInTrainingView": total,
        "trainableAdapterParameters": trainable,
        "trainableRatio": trainable / total,
        "visionAdapterParameters": 0,
        "mtpAdapterParameters": 0,
        "status": "passed",
    }


def download_and_verify_checkpoint(base: dict[str, Any], destination: Path) -> str:
    from huggingface_hub import snapshot_download

    snapshot = snapshot_download(
        repo_id=base["repository"],
        revision=base["revision"],
        local_dir=str(destination),
    )
    for shard in base["expectedShardDigests"]:
        verify_file(destination / shard["path"], shard["sha256"], None, shard["bytes"])
    return snapshot


def verify_upstream_lineage(base: dict[str, Any]) -> dict[str, Any]:
    repository = urllib.parse.quote(base["repository"], safe="/")
    revision = urllib.parse.quote(base["revision"], safe="")
    url = (
        f"https://huggingface.co/api/models/{repository}/tree/{revision}"
        "?recursive=true&expand=true"
    )
    with urllib.request.urlopen(url, timeout=60) as response:
        tree = json.load(response)
    files = {item.get("path"): item for item in tree if item.get("type") == "file"}
    for shard in base["expectedShardDigests"]:
        remote = files.get(shard["path"])
        if not remote or remote.get("lfs", {}).get("oid") != shard["sha256"]:
            raise RuntimeError(f"upstream LFS digest drift for {shard['path']}")
        if remote.get("size") != shard["bytes"]:
            raise RuntimeError(f"upstream shard size drift for {shard['path']}")
    receipt = {
        "schema": "amos.qwen-upstream-lineage-receipt",
        "version": 1,
        "repository": base["repository"],
        "revision": base["revision"],
        "checkpointDigest": base["checkpointDigest"],
        "verifiedShards": len(base["expectedShardDigests"]),
        "status": "passed",
    }
    receipt["digest"] = digest_value(receipt)
    return receipt


def validate_contract(contract: dict[str, Any]) -> None:
    if contract.get("schema") != CONTRACT_SCHEMA or contract.get("version") != 1:
        raise ValueError("unsupported AMOS Qwen training contract")
    verify_embedded_digest(contract, "training contract")
    if contract.get("purpose") != "pipeline-and-lineage-proof":
        raise ValueError("trainer accepts only the stage-zero pipeline proof")
    if contract.get("qualityClaimAllowed") is not False or contract.get("promotionAllowed") is not False:
        raise ValueError("stage-zero contract cannot authorize quality or promotion claims")
    if contract.get("recipe", {}).get("stage") != 0:
        raise ValueError("trainer accepts only stage zero")
    if contract.get("recipe", {}).get("optimization", {}).get("loss") != "assistant-tokens-only":
        raise ValueError("trainer requires assistant-token-only loss")
    if contract.get("recipe", {}).get("includeVisionTowerInAdapter") is not False:
        raise ValueError("stage-zero adapter cannot target the vision tower")
    if contract.get("execution", {}).get("liveInferenceEndpointMutable") is not False:
        raise ValueError("training contract may not mutate live inference")
    if contract.get("execution", {}).get("torchNativeJitDisabled") is not True:
        raise ValueError("training contract must pin the compiler-free PyTorch eager path")


def validate_dataset(manifest: dict[str, Any], contract: dict[str, Any]) -> None:
    if manifest.get("schema") != DATASET_SCHEMA or manifest.get("status") != "qualified":
        raise ValueError("unsupported or unqualified AMOS-native dataset")
    verify_embedded_digest(manifest, "dataset manifest")
    if manifest["digest"] != contract["dataset"]["manifestDigest"]:
        raise ValueError("dataset manifest digest does not match the training contract")
    for safeguard, value in contract["dataset"]["safeguards"].items():
        if value is not True or manifest.get("safeguards", {}).get(safeguard) is not True:
            raise ValueError(f"required dataset safeguard is absent: {safeguard}")


def verify_embedded_digest(value: dict[str, Any], label: str) -> None:
    claimed = value.get("digest")
    without_digest = {key: item for key, item in value.items() if key != "digest"}
    if not isinstance(claimed, str) or digest_value(without_digest) != claimed:
        raise ValueError(f"{label} digest does not match its contents")


def digest_value(value: Any) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verify_file(
    path: Path,
    expected_sha256: str,
    expected_rows: int | None,
    expected_bytes: int | None = None,
) -> None:
    digest = hashlib.sha256()
    rows = 0
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
            if expected_rows is not None:
                rows += chunk.count(b"\n")
    if digest.hexdigest() != expected_sha256:
        raise ValueError(f"SHA-256 mismatch for {path.name}")
    if expected_rows is not None and rows != expected_rows:
        raise ValueError(f"row-count mismatch for {path.name}: {rows} != {expected_rows}")
    if expected_bytes is not None and size != expected_bytes:
        raise ValueError(f"byte-size mismatch for {path.name}: {size} != {expected_bytes}")


def digest_tree(root: Path) -> list[dict[str, Any]]:
    files = []
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        files.append({
            "path": str(path.relative_to(root)),
            "sha256": file_sha256(path),
            "bytes": path.stat().st_size,
        })
    return files


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json_lines(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_json_uri(uri: str, destination: Path) -> dict[str, Any]:
    download_uri(uri, destination)
    with destination.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def download_uri(uri: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    parsed = urllib.parse.urlparse(uri)
    if parsed.scheme == "s3":
        import boto3

        boto3.client("s3").download_file(parsed.netloc, parsed.path.lstrip("/"), str(destination))
    elif parsed.scheme in ("", "file"):
        source = Path(parsed.path).resolve()
        destination.write_bytes(source.read_bytes())
    else:
        raise ValueError(f"unsupported immutable input URI scheme: {parsed.scheme}")


def upload_tree(root: Path, output_uri: str) -> None:
    parsed = urllib.parse.urlparse(output_uri)
    if parsed.scheme != "s3":
        raise ValueError("stage-zero output URI must use s3://")
    import boto3

    client = boto3.client("s3")
    prefix = parsed.path.lstrip("/").rstrip("/")
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        if path.is_relative_to(root / "base-model"):
            continue
        relative = path.relative_to(root).as_posix()
        key = f"{prefix}/{relative}" if prefix else relative
        client.upload_file(str(path), parsed.netloc, key)


def join_uri(base: str, name: str) -> str:
    return f"{base.rstrip('/')}/{name.lstrip('/')}"


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
