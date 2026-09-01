import importlib.util
import tempfile
import unittest
from collections import UserDict
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("train_stage0.py")
SPEC = importlib.util.spec_from_file_location("amos_train_stage0", MODULE_PATH)
TRAINER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(TRAINER)


class FakeTokenizer:
    def apply_chat_template(self, messages, **kwargs):
        if len(messages) == 2 and kwargs.get("add_generation_prompt"):
            return [10, 11, 12]
        if len(messages) == 3 and not kwargs.get("add_generation_prompt"):
            return [10, 11, 12, 20, 21]
        raise AssertionError("unexpected chat-template call")


class DriftedTokenizer(FakeTokenizer):
    def apply_chat_template(self, messages, **kwargs):
        if len(messages) == 3:
            return [99, 20]
        return super().apply_chat_template(messages, **kwargs)


class BatchEncodingTokenizer(FakeTokenizer):
    def apply_chat_template(self, messages, **kwargs):
        input_ids = super().apply_chat_template(messages, **kwargs)
        return UserDict({"input_ids": input_ids, "attention_mask": [1] * len(input_ids)})


ROW = {
    "messages": [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "user"},
        {"role": "assistant", "content": "target"},
    ],
    "metadata": {"exampleId": "example-1"},
}


class StageZeroTrainerTests(unittest.TestCase):
    def test_digest_matches_javascript_canonical_research_digest(self):
        value = {"b": [True, 0.0002, "AMOS"], "a": {"z": None, "n": 64}}
        self.assertEqual(
            TRAINER.digest_value(value),
            "48eeb8f6293433064c45652db6614fdd74d793236181573568d75a598293bbf0",
        )

    def test_encode_masks_prompt_and_supervises_only_assistant_tokens(self):
        encoded = TRAINER.encode_example(FakeTokenizer(), ROW, 32)
        self.assertEqual(encoded["input_ids"], [10, 11, 12, 20, 21])
        self.assertEqual(
            encoded["labels"],
            [TRAINER.IGNORE_INDEX, TRAINER.IGNORE_INDEX, TRAINER.IGNORE_INDEX, 20, 21],
        )

    def test_encode_fails_closed_if_chat_template_boundary_drifts(self):
        with self.assertRaisesRegex(ValueError, "loss boundary"):
            TRAINER.encode_example(DriftedTokenizer(), ROW, 32)

    def test_encode_normalizes_transformers_five_batch_encoding_shape(self):
        encoded = TRAINER.encode_example(BatchEncodingTokenizer(), ROW, 32)
        self.assertEqual(encoded["input_ids"], [10, 11, 12, 20, 21])
        self.assertEqual(encoded["labels"][-2:], [20, 21])

    def test_file_receipt_checks_digest_rows_and_size(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.jsonl"
            path.write_text('{"a":1}\n{"a":2}\n', encoding="utf-8")
            digest = TRAINER.file_sha256(path)
            TRAINER.verify_file(path, digest, 2, path.stat().st_size)
            with self.assertRaisesRegex(ValueError, "row-count mismatch"):
                TRAINER.verify_file(path, digest, 3)


if __name__ == "__main__":
    unittest.main()
