from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from benchmarks.harbor_agents.harbor_official_quality import qualify_official_quality


class HarborOfficialQualityTest(unittest.TestCase):
    def _trial(self, root: Path, name: str, *, reward: float, passed: int) -> Path:
        trial = root / name
        verifier = trial / "verifier"
        verifier.mkdir(parents=True)
        result = trial / "result.json"
        result.write_text(json.dumps({
            "id": name,
            "verifier_result": {"rewards": {"reward": reward}},
            "exception_info": None,
        }))
        (verifier / "ctrf.json").write_text(json.dumps({
            "results": {
                "summary": {
                    "tests": 20,
                    "passed": passed,
                    "failed": 20 - passed,
                }
            }
        }))
        return result

    def test_structural_success_cannot_mask_flat_official_quality(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [
                self._trial(root, f"seed-{seed}", reward=0, passed=11)
                for seed in (101, 202, 303)
            ]

            report = qualify_official_quality(
                paths,
                baseline_passed_tests=11,
                minimum_seeds=3,
            )

        self.assertFalse(report["passed"])
        self.assertEqual(report["reasons"], ["no-official-quality-improvement"])
        self.assertFalse(
            report["safeguards"]["structuralQualificationIsQualityEvidence"]
        )

    def test_non_regressing_official_test_gain_passes_development_quality_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [
                self._trial(root, "seed-101", reward=0, passed=12),
                self._trial(root, "seed-202", reward=0, passed=11),
                self._trial(root, "seed-303", reward=0, passed=11),
            ]

            report = qualify_official_quality(
                paths,
                baseline_passed_tests=11,
                minimum_seeds=3,
            )

        self.assertTrue(report["passed"])
        self.assertFalse(report["solved"])
        self.assertEqual(report["qualityStatus"], "improved")

    def test_any_seed_regression_fails_even_when_another_seed_improves(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [
                self._trial(root, "seed-101", reward=0, passed=12),
                self._trial(root, "seed-202", reward=0, passed=10),
                self._trial(root, "seed-303", reward=0, passed=11),
            ]

            report = qualify_official_quality(
                paths,
                baseline_passed_tests=11,
                minimum_seeds=3,
            )

        self.assertFalse(report["passed"])
        self.assertIn("official-test-regression", report["reasons"])

    def test_missing_official_artifact_fails_closed_with_a_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "seed-101" / "result.json"

            report = qualify_official_quality(
                [missing],
                baseline_passed_tests=11,
                minimum_seeds=1,
            )

        self.assertFalse(report["passed"])
        self.assertIn("official-verifier-coverage-incomplete", report["reasons"])
        self.assertIn("result-unreadable:FileNotFoundError", report["trials"][0]["artifactErrors"])
        self.assertIn("ctrf-missing", report["trials"][0]["artifactErrors"])


if __name__ == "__main__":
    unittest.main()
