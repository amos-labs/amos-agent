#!/usr/bin/env python3
"""Train the AMOS Ministral student without dropping tool definitions.

mlx-vlm 0.6.12 preserves tool-call messages but its VisionDataset does not pass
the row-level ``tools`` value to the tokenizer chat template. This wrapper
installs a narrow dataset adapter that does so and fails closed if Ministral's
native tool markers are absent from the rendered prompt.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path
from threading import Lock
from typing import Any

SUPPORTED_MLX_VLM_VERSION = "0.6.12"
_TEMPLATE_LOCK = Lock()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Tool-aware QLoRA training for AMOS Operator Local on Ministral"
    )
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--dataset", required=True, help="Compiled local JSONL or Hugging Face dataset")
    parser.add_argument("--validation-dataset", default=None, help="Optional compiled validation JSONL")
    parser.add_argument("--split", default="train")
    parser.add_argument("--dataset-config", default=None)
    parser.add_argument("--image-resize-shape", type=int, nargs=2, default=None)
    parser.add_argument("--custom-prompt-format", default=None)

    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--iters", type=int, default=1000)
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--steps-per-report", type=int, default=10)
    parser.add_argument("--steps-per-eval", type=int, default=200)
    parser.add_argument("--steps-per-save", type=int, default=100)
    parser.add_argument("--val-batches", type=int, default=4)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--grad-checkpoint", action="store_true")
    parser.add_argument("--grad-clip", type=float, default=None)
    parser.add_argument("--train-on-completions", action="store_true", default=True)
    parser.add_argument("--train-on-all-tokens", action="store_false", dest="train_on_completions")
    parser.add_argument("--gradient-accumulation-steps", type=int, default=1)
    parser.add_argument("--assistant-id", type=int, default=77091)

    parser.add_argument("--lora-alpha", type=float, default=32)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-dropout", type=float, default=0.0)
    parser.add_argument("--full-finetune", action="store_true")
    parser.add_argument("--train-vision", action="store_true")
    parser.add_argument("--train-mode", choices=["sft"], default="sft")
    parser.add_argument("--beta", type=float, default=0.1)
    parser.add_argument("--eps", type=float, default=1e-8)

    parser.add_argument("--output-path", default="adapters.safetensors")
    parser.add_argument("--adapter-path", default=None)
    parser.add_argument("--audit-only", action="store_true")
    parser.add_argument("--allow-untested-mlx-vlm", action="store_true")
    return parser.parse_args()


def audit_local_jsonl(path: Path) -> dict[str, int]:
    if not path.is_file():
        return {"local_records": 0, "tool_records": 0, "tool_calls": 0, "tool_results": 0}

    records = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSONL at line {line_number}: {error}") from error

    tool_records = 0
    tool_calls = 0
    tool_results = 0
    for index, record in enumerate(records, start=1):
        messages = record.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError(f"Compiled record {index} has no messages")
        tools = record.get("tools") or []
        calls = sum(len(message.get("tool_calls") or []) for message in messages)
        results = sum(message.get("role") == "tool" for message in messages)
        if calls and not tools:
            raise ValueError(f"Compiled record {index} calls tools without definitions")
        if tools:
            tool_records += 1
            if calls == 0 or results == 0:
                raise ValueError(f"Compiled tool record {index} is not a complete trajectory")
        tool_calls += calls
        tool_results += results

    return {
        "local_records": len(records),
        "tool_records": tool_records,
        "tool_calls": tool_calls,
        "tool_results": tool_results,
    }


def install_tool_aware_dataset() -> None:
    from mlx_vlm import lora as mlx_lora
    from mlx_vlm.trainer import datasets as dataset_module
    import mlx.core as mx

    base_dataset = dataset_module.VisionDataset
    base_apply_chat_template = dataset_module.apply_chat_template

    class ToolAwareVisionDataset(base_dataset):
        def process(self, item: dict[str, Any]) -> dict[str, Any]:
            tools = item.get("tools") or []
            messages = item.get("messages", item.get("conversations")) or []
            expects_calls = any(message.get("tool_calls") for message in messages)
            expects_results = any(message.get("role") == "tool" for message in messages)

            def render_with_tools(*args: Any, **kwargs: Any) -> Any:
                kwargs["tools"] = tools
                rendered = base_apply_chat_template(*args, **kwargs)
                if isinstance(rendered, str):
                    required_markers = []
                    if tools:
                        required_markers.append("[AVAILABLE_TOOLS]")
                        if expects_calls:
                            required_markers.append("[TOOL_CALLS]")
                        if expects_results:
                            required_markers.append("[TOOL_RESULTS]")
                    missing = [marker for marker in required_markers if marker not in rendered]
                    if missing:
                        raise ValueError(
                            "Ministral tool template omitted required markers: " + ", ".join(missing)
                        )
                return rendered

            # mlx-vlm reads apply_chat_template from its dataset module. Keep the
            # compatibility shim local to one synchronous row render and restore
            # it even if tokenization fails.
            with _TEMPLATE_LOCK:
                prior = dataset_module.apply_chat_template
                dataset_module.apply_chat_template = render_with_tools
                try:
                    processed = super().process(item)
                finally:
                    dataset_module.apply_chat_template = prior

            if self.train_on_completions:
                processed["completion_mask"] = assistant_span_mask(
                    self,
                    messages,
                    tools,
                    processed["input_ids"],
                    base_apply_chat_template,
                    mx,
                )
            return processed

    dataset_module.VisionDataset = ToolAwareVisionDataset
    mlx_lora.VisionDataset = ToolAwareVisionDataset


def assistant_span_mask(
    dataset: Any,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    input_ids: Any,
    apply_chat_template: Any,
    mx: Any,
) -> Any:
    """Mask every assistant turn, including tool calls, for completion-only SFT."""
    image_token_index = dataset.config.get("image_token_index") or dataset.config.get("image_token_id")
    if not image_token_index:
        raise ValueError("Config must contain image_token_index or image_token_id")

    mask = mx.zeros_like(input_ids)
    positions = mx.arange(input_ids.shape[-1])
    assistant_turns = 0
    for index, message in enumerate(messages):
        if message.get("role") != "assistant":
            continue
        assistant_turns += 1
        before = apply_chat_template(
            dataset.processor,
            dataset.config,
            messages[:index],
            add_generation_prompt=True,
            num_images=0,
            num_audios=0,
            tools=tools,
        )
        through = apply_chat_template(
            dataset.processor,
            dataset.config,
            messages[: index + 1],
            add_generation_prompt=False,
            num_images=0,
            num_audios=0,
            tools=tools,
        )
        start = dataset._token_length(before, [], [], image_token_index)
        end = dataset._token_length(through, [], [], image_token_index)
        span = (positions >= start) & (positions < end)
        if len(input_ids.shape) > 1:
            span = mx.expand_dims(span, 0)
        mask = mx.where(span, mx.ones_like(mask), mask)

    if assistant_turns == 0:
        raise ValueError("Completion-only training record has no assistant turns")
    return mask


def install_local_jsonl_loader(dataset_path: Path) -> None:
    if not dataset_path.is_file():
        return

    from mlx_vlm import lora as mlx_lora

    base_load_dataset = mlx_lora.load_dataset

    def load_local_dataset(name: str, config: str | None = None, split: str = "train") -> Any:
        if Path(name).resolve() == dataset_path.resolve():
            return base_load_dataset(
                "json",
                data_files={split: str(dataset_path)},
                split=split,
            )
        return base_load_dataset(name, config if config else None, split=split)

    mlx_lora.load_dataset = load_local_dataset


def install_validation_dataset(validation_path: Path, train_on_completions: bool) -> None:
    if not validation_path.is_file():
        raise ValueError(f"Validation dataset does not exist: {validation_path}")

    from datasets import load_dataset
    from mlx_vlm import lora as mlx_lora

    base_train = mlx_lora.train
    dataset_class = mlx_lora.VisionDataset

    def train_with_validation(*args: Any, **kwargs: Any) -> Any:
        train_dataset = kwargs.get("train_dataset")
        if train_dataset is None:
            raise RuntimeError("mlx-vlm training API changed: train_dataset was not passed by name")
        validation_records = load_dataset(
            "json",
            data_files={"validation": str(validation_path)},
            split="validation",
        )
        kwargs["val_dataset"] = dataset_class(
            validation_records,
            train_dataset.config,
            train_dataset.processor,
            image_resize_shape=train_dataset.image_resize_shape,
            train_on_completions=train_on_completions,
        )
        return base_train(*args, **kwargs)

    mlx_lora.train = train_with_validation


def install_mistral_tokenizer_fix() -> None:
    """Enable Hugging Face's corrected Mistral pre-tokenizer regex."""
    from mlx_vlm import lora as mlx_lora

    base_load = mlx_lora.load

    def load_with_fixed_regex(*args: Any, **kwargs: Any) -> Any:
        processor_config = kwargs.pop("processor_config", {}) or {}
        kwargs.update(processor_config)
        kwargs["fix_mistral_regex"] = True
        return base_load(*args, **kwargs)

    mlx_lora.load = load_with_fixed_regex


def main() -> None:
    args = parse_args()
    installed_version = importlib.metadata.version("mlx-vlm")
    if installed_version != SUPPORTED_MLX_VLM_VERSION and not args.allow_untested_mlx_vlm:
        raise RuntimeError(
            f"Expected mlx-vlm {SUPPORTED_MLX_VLM_VERSION}, found {installed_version}. "
            "Requalify the adapter or pass --allow-untested-mlx-vlm explicitly."
        )

    dataset_path = Path(args.dataset).expanduser().resolve()
    audit = audit_local_jsonl(dataset_path)
    validation_path = (
        Path(args.validation_dataset).expanduser().resolve()
        if args.validation_dataset
        else None
    )
    validation_audit = audit_local_jsonl(validation_path) if validation_path else None
    print(json.dumps({
        "mlx_vlm": installed_version,
        "dataset": str(dataset_path),
        **audit,
        **(
            {"validation_dataset": str(validation_path), "validation": validation_audit}
            if validation_path
            else {}
        ),
    }, indent=2))
    if args.audit_only:
        return

    install_mistral_tokenizer_fix()
    install_tool_aware_dataset()
    install_local_jsonl_loader(dataset_path)
    if validation_path:
        install_validation_dataset(validation_path, args.train_on_completions)

    from mlx_vlm import lora as mlx_lora

    mlx_lora.main(args)


if __name__ == "__main__":
    main()
