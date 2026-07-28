#!/usr/bin/env python3
"""Derive exact stored expert and shared-weight bytes from a pinned checkpoint."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

from huggingface_hub import snapshot_download
from safetensors import safe_open

DEFAULT_MODEL = "openai/gpt-oss-120b"
DEFAULT_REVISION = "b5c939de8f754692c1647ca79fbf85e8c1e70f8a"
EXPERT_TENSOR = re.compile(r"^model\.layers\.(\d+)\.mlp\.experts\.")
DTYPE_BYTES = {
    "BOOL": 1,
    "U8": 1,
    "I8": 1,
    "F8_E4M3": 1,
    "F8_E5M2": 1,
    "U16": 2,
    "I16": 2,
    "F16": 2,
    "BF16": 2,
    "U32": 4,
    "I32": 4,
    "F32": 4,
    "U64": 8,
    "I64": 8,
    "F64": 8,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def tensor_bytes(shape: list[int], dtype: str) -> int:
    if dtype not in DTYPE_BYTES:
        raise ValueError(f"Unsupported safetensors dtype {dtype}")
    return math.prod(shape) * DTYPE_BYTES[dtype]


def inspect_checkpoint(args: argparse.Namespace) -> dict[str, Any]:
    snapshot = Path(
        snapshot_download(
            repo_id=args.model,
            revision=args.revision,
            cache_dir=str(args.cache_dir) if args.cache_dir else None,
            allow_patterns=["*.json", "*.safetensors", "*.model"],
        )
    )
    config = json.loads((snapshot / "config.json").read_text(encoding="utf-8"))
    expected_layers = int(config["num_hidden_layers"])
    expected_experts = int(config["num_local_experts"])
    layer_expert_bytes = {layer: 0 for layer in range(expected_layers)}
    layer_tensor_names = {layer: [] for layer in range(expected_layers)}
    total_tensor_bytes = 0
    expert_tensor_bytes = 0

    files = sorted(snapshot.glob("*.safetensors"))
    if not files:
        raise RuntimeError(f"No safetensors files found in {snapshot}")
    for file in files:
        with safe_open(file, framework="pt", device="cpu") as handle:
            for name in handle.keys():
                tensor = handle.get_slice(name)
                shape = list(tensor.get_shape())
                dtype = tensor.get_dtype()
                size = tensor_bytes(shape, dtype)
                total_tensor_bytes += size
                match = EXPERT_TENSOR.match(name)
                if not match:
                    continue
                layer = int(match.group(1))
                if not shape or shape[0] != expected_experts:
                    raise RuntimeError(
                        f"Expert tensor {name} has shape {shape}; expected leading "
                        f"expert dimension {expected_experts}"
                    )
                layer_expert_bytes[layer] += size
                layer_tensor_names[layer].append(name)
                expert_tensor_bytes += size

    missing = [
        layer
        for layer, size in layer_expert_bytes.items()
        if size == 0 or not layer_tensor_names[layer]
    ]
    if missing:
        raise RuntimeError(f"Checkpoint has no expert tensors for layers {missing}")
    per_expert = {
        layer: size // expected_experts
        for layer, size in layer_expert_bytes.items()
    }
    if any(
        layer_expert_bytes[layer] % expected_experts
        for layer in range(expected_layers)
    ):
        raise RuntimeError("Layer expert storage is not divisible by expert count")
    unique_sizes = sorted(set(per_expert.values()))
    if len(unique_sizes) != 1:
        raise RuntimeError(f"Per-expert storage varies by layer: {unique_sizes}")

    index_path = snapshot / "model.safetensors.index.json"
    indexed_total = None
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
        indexed_total = int(index.get("metadata", {}).get("total_size", 0)) or None
        if indexed_total is not None and indexed_total != total_tensor_bytes:
            raise RuntimeError(
                f"Safetensors total {total_tensor_bytes} does not match index "
                f"{indexed_total}"
            )

    return {
        "schema": "amos.expert-cache-checkpoint-inspection",
        "version": 1,
        "model": args.model,
        "revision": args.revision,
        "snapshot": str(snapshot),
        "safetensors_files": len(files),
        "layers": expected_layers,
        "experts_per_layer": expected_experts,
        "total_tensor_bytes": total_tensor_bytes,
        "indexed_total_bytes": indexed_total,
        "expert_tensor_bytes": expert_tensor_bytes,
        "shared_weight_bytes": total_tensor_bytes - expert_tensor_bytes,
        "expert_bytes_per_layer_expert": unique_sizes[0],
        "expert_tensor_names_per_layer": {
            str(layer): layer_tensor_names[layer]
            for layer in range(expected_layers)
        },
    }


def main() -> int:
    args = parse_args()
    report = inspect_checkpoint(args)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
