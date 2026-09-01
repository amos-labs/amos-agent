"""Independent official-quality qualification for Harbor training runs."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Iterable


def qualify_official_quality(
    trial_results: Iterable[Path],
    *,
    baseline_passed_tests: int,
    minimum_seeds: int,
) -> dict[str, Any]:
    """Separate official task quality from structural organism qualification.

    Harbor's reward remains unchanged and authoritative. CTRF pass counts are
    used only to detect development-run progress below the binary reward; they
    never grant task completion or support a held-out/frontier claim.
    """

    baseline = max(0, int(baseline_passed_tests))
    required = max(1, int(minimum_seeds))
    trials = [_read_trial_result(Path(path)) for path in trial_results]
    coverage_complete = len(trials) >= required and all(
        trial["officialVerifierScored"] and trial["ctrfValid"] for trial in trials
    )
    non_regressing = coverage_complete and all(
        trial["passedTests"] >= baseline for trial in trials
    )
    strict_improvement = coverage_complete and any(
        trial["passedTests"] > baseline or trial["reward"] > 0 for trial in trials
    )
    solved = coverage_complete and all(trial["reward"] > 0 for trial in trials)
    passed = coverage_complete and non_regressing and strict_improvement
    reasons: list[str] = []
    if len(trials) < required:
        reasons.append("insufficient-seeds")
    if not coverage_complete:
        reasons.append("official-verifier-coverage-incomplete")
    if coverage_complete and not non_regressing:
        reasons.append("official-test-regression")
    if coverage_complete and not strict_improvement:
        reasons.append("no-official-quality-improvement")
    return {
        "schema": "amos.harbor-official-quality-qualification",
        "version": 1,
        "passed": passed,
        "solved": solved,
        "qualityStatus": "solved" if solved else "improved" if passed else "not-improved",
        "baselinePassedTests": baseline,
        "minimumSeeds": required,
        "observedSeeds": len(trials),
        "coverageComplete": coverage_complete,
        "nonRegressing": non_regressing,
        "strictImprovement": strict_improvement,
        "reasons": reasons,
        "trials": trials,
        "safeguards": {
            "officialVerifierUnchanged": True,
            "structuralQualificationIsQualityEvidence": False,
            "partialCtrfCountsGrantCompletionCredit": False,
            "developmentFixtureSupportsFrontierClaim": False,
        },
    }


def _read_trial_result(path: Path) -> dict[str, Any]:
    errors: list[str] = []
    try:
        source = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        source = {}
        errors.append(f"result-unreadable:{type(exc).__name__}")
    reward_value = ((source.get("verifier_result") or {}).get("rewards") or {}).get("reward")
    reward = float(reward_value) if isinstance(reward_value, (int, float)) else math.nan
    ctrf_path = path.parent / "verifier" / "ctrf.json"
    summary: dict[str, Any] = {}
    if ctrf_path.is_file():
        try:
            ctrf = json.loads(ctrf_path.read_text(encoding="utf-8"))
            candidate = (ctrf.get("results") or {}).get("summary")
            if isinstance(candidate, dict):
                summary = candidate
            else:
                errors.append("ctrf-summary-missing")
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"ctrf-unreadable:{type(exc).__name__}")
    else:
        errors.append("ctrf-missing")
    tests = _bounded_count(summary.get("tests"))
    passed = _bounded_count(summary.get("passed"))
    failed = _bounded_count(summary.get("failed"))
    ctrf_valid = tests > 0 and passed + failed <= tests
    return {
        "id": str(source.get("id") or path.parent.name)[:300],
        "resultPath": str(path),
        "reward": reward if math.isfinite(reward) else None,
        "officialVerifierScored": math.isfinite(reward),
        "ctrfPath": str(ctrf_path),
        "ctrfValid": ctrf_valid,
        "totalTests": tests,
        "passedTests": passed,
        "failedTests": failed,
        "exception": source.get("exception_info"),
        "artifactErrors": errors,
    }


def _bounded_count(value: Any) -> int:
    try:
        return min(1_000_000, max(0, int(value)))
    except (TypeError, ValueError):
        return 0
