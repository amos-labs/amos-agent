#!/usr/bin/env python3
"""Offline qualification for monotonic AMOS swarm candidate evolution."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any



def _evidence_vector(value: dict[str, Any]) -> tuple[int, ...]:
    return (
        int(value.get("candidateAllPass") is True),
        int(value.get("selfCheckAllPass") is True),
        int(value.get("candidateStatusPresent") is True),
        int(value.get("selfCheckPresent") is True),
        -int(value.get("failedCheckCount") or 0),
        int(value.get("solverSucceeded") is True),
        int(value.get("implementationSubstantive") is True),
        int(value.get("implementationContractPresent") is True),
        int(value.get("implementationSyntaxValid") is True),
    )


def _candidate_evidence_regressed(incumbent: dict[str, Any], candidate: dict[str, Any]) -> bool:
    milestones = (
        "implementationPresent",
        "implementationSyntaxValid",
        "implementationContractPresent",
        "implementationSubstantive",
        "solverExecutionPresent",
        "solverSucceeded",
        "selfCheckPresent",
        "selfCheckAllPass",
        "candidateStatusPresent",
        "candidateAllPass",
    )
    if any(incumbent.get(field) is True and candidate.get(field) is not True for field in milestones):
        return True
    return (
        incumbent.get("selfCheckPresent") is True
        and candidate.get("selfCheckPresent") is True
        and int(candidate.get("failedCheckCount") or 0) > int(incumbent.get("failedCheckCount") or 0)
    )


def _candidate_evidence_preferred(
    incumbent: dict[str, Any], candidate: dict[str, Any]
) -> tuple[bool, str]:
    if _candidate_evidence_regressed(incumbent, candidate):
        return False, "objective-evidence-regression"
    if _evidence_vector(candidate) > _evidence_vector(incumbent):
        return True, "objective-evidence-improved"
    if (
        candidate.get("implementationSha256")
        and candidate.get("implementationSha256") == incumbent.get("implementationSha256")
    ):
        return False, "no-implementation-change"
    return False, "no-objective-evidence-improvement"


def _challenger_evidence_vector(value: dict[str, Any]) -> tuple[int, ...]:
    failed_checks = (
        -int(value.get("failedCheckCount") or 0)
        if value.get("selfCheckPresent") is True
        else -1_000_000
    )
    return (
        int(value.get("candidateAllPass") is True),
        int(value.get("selfCheckAllPass") is True),
        int(value.get("solverSucceeded") is True),
        int(value.get("implementationSubstantive") is True),
        int(value.get("implementationContractPresent") is True),
        int(value.get("implementationSyntaxValid") is True),
        int(value.get("selfCheckPresent") is True),
        failed_checks,
        int(value.get("candidateStatusPresent") is True),
        min(max(0, int(value.get("implementationBytes") or 0)), 1_000_000),
    )


def _challenger_evidence_preferred(
    challenger: dict[str, Any], candidate: dict[str, Any]
) -> tuple[bool, str]:
    if (
        candidate.get("implementationPresent") is not True
        or candidate.get("implementationSyntaxValid") is not True
    ):
        return False, "unrepairable-candidate"
    if (
        candidate.get("implementationSha256")
        and candidate.get("implementationSha256") == challenger.get("implementationSha256")
    ):
        return False, "no-implementation-change"
    if _challenger_evidence_vector(candidate) > _challenger_evidence_vector(challenger):
        return True, "repair-evidence-improved"
    return False, "no-repair-evidence-improvement"


def qualify_fixture(path: Path) -> dict[str, Any]:
    source = json.loads(path.read_text(encoding="utf-8"))
    if source.get("schema") != "amos.swarm-candidate-counterfactual-fixture":
        raise ValueError(f"Unsupported counterfactual fixture: {path}")
    cases = []
    for case in source.get("cases", []):
        selected, reason = _candidate_evidence_preferred(
            case.get("incumbent") or {},
            case.get("mutation") or {},
        )
        expected = case.get("expected") or {}
        passed = selected is (expected.get("promoted") is True) and reason == expected.get("reason")
        cases.append({
            "id": case.get("id"),
            "passed": passed,
            "observed": {"promoted": selected, "reason": reason},
            "expected": expected,
        })
    return {
        "path": str(path),
        "kind": "historical-counterfactual",
        "passed": bool(cases) and all(case["passed"] for case in cases),
        "cases": cases,
    }


def qualify_evolution(path: Path) -> dict[str, Any]:
    source = json.loads(path.read_text(encoding="utf-8"))
    if source.get("schema") != "amos.swarm-candidate-evolution" or source.get("version") != 1:
        raise ValueError(f"Unsupported candidate evolution: {path}")
    failures = []
    bounded_transport = 0
    promoted = 0
    substantive_mutations = 0
    no_op_mutations = 0
    previous_after = None
    previous_challenger_after = None
    two_track = source.get("selection") == "monotonic-incumbent-with-repairable-challenger"
    for index, event in enumerate(source.get("events", [])):
        before = event.get("incumbentEvidenceBefore") or {}
        mutation = event.get("mutationEvidence") or {}
        after = event.get("incumbentEvidenceAfter") or {}
        source_digest = str((event.get("challengerEvidenceBefore") or {}).get("implementationSha256") or "")
        mutation_digest = str(mutation.get("implementationSha256") or "")
        implementation_changed = bool(
            len(source_digest) == 64
            and len(mutation_digest) == 64
            and source_digest != mutation_digest
        )
        substantive_mutation = bool(
            implementation_changed
            and mutation.get("implementationSyntaxValid") is True
            and mutation.get("implementationSubstantive") is True
        )
        if not implementation_changed:
            expected_promotion, expected_reason = False, "no-implementation-change"
            no_op_mutations += 1
        elif not substantive_mutation:
            expected_promotion, expected_reason = False, "non-substantive-implementation-change"
        else:
            expected_promotion, expected_reason = _candidate_evidence_preferred(before, mutation)
            substantive_mutations += 1
        if event.get("implementationChanged") is not implementation_changed:
            failures.append(f"event {index + 1}: implementation-change attestation is incorrect")
        if event.get("substantiveMutation") is not substantive_mutation:
            failures.append(f"event {index + 1}: substantive-mutation attestation is incorrect")
        if event.get("promoted") is not expected_promotion or event.get("reason") != expected_reason:
            failures.append(f"event {index + 1}: host selection does not match objective evidence")
        if _candidate_evidence_regressed(before, after) or event.get("monotonic") is not True:
            failures.append(f"event {index + 1}: incumbent regressed")
        if previous_after is not None and before != previous_after:
            failures.append(f"event {index + 1}: incumbent chain is discontinuous")
        if event.get("promoted") is True:
            promoted += 1
        if event.get("mutationReceiptValid") is True:
            bounded_transport += 1
        previous_after = after
        if two_track:
            challenger_before = event.get("challengerEvidenceBefore") or {}
            challenger_after = event.get("challengerEvidenceAfter") or {}
            expected_advance, expected_challenger_reason = _challenger_evidence_preferred(
                challenger_before,
                mutation,
            )
            if not implementation_changed:
                expected_advance = False
                expected_challenger_reason = "no-implementation-change"
            elif not substantive_mutation:
                expected_advance = False
                expected_challenger_reason = "non-substantive-implementation-change"
            elif event.get("promoted") is True:
                expected_advance = True
                expected_challenger_reason = "authoritative-promotion"
            if (
                event.get("challengerAdvanced") is not expected_advance
                or event.get("challengerReason") != expected_challenger_reason
            ):
                failures.append(
                    f"event {index + 1}: challenger selection does not match repair evidence"
                )
            expected_challenger_after = mutation if expected_advance else challenger_before
            if challenger_after != expected_challenger_after:
                failures.append(f"event {index + 1}: challenger state does not match selection")
            if previous_challenger_after is not None and challenger_before != previous_challenger_after:
                failures.append(f"event {index + 1}: challenger chain is discontinuous")
            if event.get("seedDigest") != challenger_before.get("implementationSha256"):
                failures.append(f"event {index + 1}: mutation seed is not the active challenger")
            previous_challenger_after = challenger_after
    events = source.get("events", [])
    return {
        "path": str(path),
        "kind": "candidate-evolution",
        "passed": bool(events) and not failures,
        "eventCount": len(events),
        "promotionCount": promoted,
        "boundedTransportCount": bounded_transport,
        "boundedTransportRate": round(bounded_transport / len(events), 6) if events else 0,
        "substantiveMutationCount": substantive_mutations,
        "noOpMutationCount": no_op_mutations,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", action="append", default=[])
    parser.add_argument("--evolution", action="append", default=[])
    parser.add_argument("--partition", choices=("training", "held-out"), default="training")
    parser.add_argument("--minimum-seeds", type=int, default=1)
    parser.add_argument("--minimum-substantive-mutations", type=int, default=0)
    parser.add_argument("--output")
    args = parser.parse_args()
    results = [qualify_fixture(Path(path)) for path in args.fixture]
    results.extend(qualify_evolution(Path(path)) for path in args.evolution)
    evolution_results = [result for result in results if result["kind"] == "candidate-evolution"]
    seed_gate = len(evolution_results) >= max(0, args.minimum_seeds)
    mutation_floor = max(0, args.minimum_substantive_mutations)
    mutation_gate = all(
        result.get("substantiveMutationCount", 0) >= mutation_floor
        for result in evolution_results
    )
    report = {
        "schema": "amos.swarm-candidate-evolution-qualification",
        "version": 1,
        "partition": args.partition,
        "passed": (
            bool(results)
            and all(result["passed"] for result in results)
            and seed_gate
            and mutation_gate
        ),
        "minimumSeeds": max(0, args.minimum_seeds),
        "observedSeeds": len(evolution_results),
        "minimumSubstantiveMutationsPerSeed": mutation_floor,
        "results": results,
        "safeguards": {
            "trainingFixtureIsNotHeldOutEvidence": args.partition == "training",
            "officialVerifierUnchanged": True,
            "frontierEscalationAllowed": False,
        },
    }
    encoded = json.dumps(report, sort_keys=True, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
