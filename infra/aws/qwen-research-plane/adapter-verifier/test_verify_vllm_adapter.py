import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import verify_vllm_adapter as verifier


class VerifyVllmAdapterTests(unittest.TestCase):
    def _fixture(self, root: Path):
        adapter = root / "adapter"
        adapter.mkdir()
        model_bytes = b"bounded-adapter-fixture"
        (adapter / "adapter_model.safetensors").write_bytes(model_bytes)
        (adapter / "adapter_config.json").write_text('{"r": 16}\n', encoding="utf-8")
        files = []
        for name in ("adapter_model.safetensors", "adapter_config.json"):
            value = (adapter / name).read_bytes()
            files.append({"path": name, "sha256": hashlib.sha256(value).hexdigest()})
        stage0 = {
            "schema": "amos.qwen-adapter-stage0-result",
            "status": "adapter-built-awaiting-vllm-load-proof",
            "promotionAllowed": False,
            "qualityClaimAllowed": False,
            "adapterFiles": files,
        }
        return adapter, stage0

    def test_validate_lineage_accepts_exact_non_promoting_adapter(self):
        with tempfile.TemporaryDirectory() as temporary:
            adapter, stage0 = self._fixture(Path(temporary))
            config, rank = verifier._validate_lineage(stage0, adapter)
            self.assertEqual(rank, 16)
            self.assertEqual(config, {"r": 16})

    def test_validate_lineage_rejects_adapter_digest_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            adapter, stage0 = self._fixture(Path(temporary))
            (adapter / "adapter_model.safetensors").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                verifier._validate_lineage(stage0, adapter)

    def test_receipt_digest_excludes_the_digest_field(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "receipt.json"
            receipt = {"schema": verifier.SCHEMA, "version": verifier.VERSION, "status": "failed"}
            verifier._write_receipt(path, receipt)
            saved = json.loads(path.read_text(encoding="utf-8"))
            digest = saved.pop("digest")
            canonical = json.dumps(saved, sort_keys=True, separators=(",", ":")).encode("utf-8")
            self.assertEqual(digest, hashlib.sha256(canonical).hexdigest())

    def test_vllm_027_command_uses_current_boolean_logging_flag(self):
        command = verifier._server_command(
            base_model_path=Path("/model"),
            adapter_path=Path("/adapter"),
            base_name="base",
            adapter_name="adapter",
            rank=16,
        )
        self.assertIn("--no-enable-log-requests", command)
        self.assertNotIn("--disable-log-requests", command)

    def test_runtime_caches_stay_on_ephemeral_writable_storage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            environment = verifier._server_environment(root)
            for name in ("HOME", "TRITON_CACHE_DIR", "XDG_CACHE_HOME", "HF_HOME"):
                location = Path(environment[name])
                self.assertTrue(location.is_dir())
                self.assertTrue(location.is_relative_to(root))
            self.assertEqual(environment["VLLM_USE_FLASHINFER_SAMPLER"], "0")


if __name__ == "__main__":
    unittest.main()
