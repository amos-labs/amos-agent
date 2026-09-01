from __future__ import annotations

import base64
import hashlib
import inspect
import json
import shlex
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from dataclasses import dataclass

from benchmarks.harbor_agents.amos_task_swarm import (
    BOARD_PATH,
    CANDIDATE_EVOLUTION_PATH,
    CANDIDATE_STATUS_PATH,
    CHALLENGER_DIR,
    CHALLENGER_EVIDENCE_PATH,
    COMPILED_FEEDBACK_PATH,
    COMPILED_STATE_PATH,
    CONSTRUCTION_FEEDBACK_PATH,
    CONSTRUCTION_DIAGNOSIS_PATH,
    CONSTRUCTION_BRIEF_PATH,
    PREFLIGHT_VERDICT_PATH,
    INCUMBENT_EVIDENCE_PATH,
    MUTATION_RECEIPT_PATH,
    SOLVER_IMPLEMENTATION_PATH,
    SOLVER_PATH,
    VERIFIER_CONTRACT_FEEDBACK_PATH,
    VERIFIER_HANDOFF_PATH,
    _COMPACTION_PHASES,
    AmosTaskSwarm,
    _TMUX_REMOTE_PATH,
    _data_scanner_instruction,
    _builder_instruction,
    _bounded_diagnostic_tail,
    _bounded_transport_retry_snapshot,
    _construction_contract_failures,
    _construction_recovery_instruction,
    _construction_recovery_turn_budget,
    _diagnosis_earns_adaptive_repair,
    _construction_repair_principles,
    _construction_repair_signals,
    _repair_agenda,
    _construction_progress_receipts,
    _candidate_evidence_preferred,
    _candidate_evidence_regressed,
    _challenger_evidence_preferred,
    _construction_exhaustion_record,
    _extract_failed_self_checks,
    _harvest_candidate_if_ready,
    _harvest_compiled_state_if_ready,
    _is_host_artifact_receipt,
    _is_malformed_parser_feedback,
    _initialize_candidate_incumbent,
    _load_repairable_challenger,
    _mutation_receipt_matches,
    _normalize_work_nodes,
    _state_compiler_instruction,
    _settle_candidate_mutation,
    _solver_scaffold_source,
    _solver_implementation_scaffold_source,
    _summarize_construction_source,
    _transport_retry_instruction,
    _validate_model_provenance,
    _verifier_contract_error_kind,
    _verdict_criterion_diagnostics,
)


@dataclass
class _Result:
    return_code: int = 0
    stdout: str = ""
    stderr: str = ""


class _MemoryEnvironment:
    def __init__(self, files: dict[str, str]) -> None:
        self.files = files

    async def exec(self, command: str) -> _Result:
        arguments = shlex.split(command)
        if arguments[0] == "cat":
            value = self.files.get(arguments[1])
            return _Result(0, value, "") if value is not None else _Result(1, "", "missing")
        if arguments[:2] == ["sha256sum", "--"]:
            value = self.files.get(arguments[2])
            if value is None:
                return _Result(1, "", "missing")
            digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
            return _Result(0, f"{digest}  {arguments[2]}\n", "")
        if arguments[:2] == ["python3", "-c"] and len(arguments) == 5:
            self.files[arguments[3]] = base64.b64decode(arguments[4]).decode("utf-8")
            return _Result()
        if arguments[:3] == ["rm", "-f", "--"]:
            self.files.pop(arguments[3], None)
            return _Result()
        raise AssertionError(f"Unexpected test command: {command}")


class _BootstrapEnvironment:
    def __init__(self) -> None:
        self.uploads: list[tuple[object, str]] = []
        self.commands: list[tuple[str, object]] = []

    async def exec(self, command: str, user: object = None) -> _Result:
        self.commands.append((command, user))
        if command.startswith("command -v tmux"):
            return _Result(1)
        if command.startswith("chmod 0755"):
            return _Result(0, "tmux 3.5a\n")
        raise AssertionError(f"Unexpected bootstrap command: {command}")

    async def upload_file(self, source_path: object, target_path: str) -> None:
        self.uploads.append((source_path, target_path))


def _board() -> dict:
    return {
        "schema": "amos.swarm-task-board",
        "version": 1,
        "phase": "state-compilation-checkpoint-2",
        "taskDigest": "a" * 64,
        "taskObjective": "Build the plan.",
        "successCriteria": [{"id": "criterion-001", "statement": "Pass."}],
        "requirements": [],
        "facts": [],
        "sourceReferences": [],
        "gaps": [],
        "artifacts": [],
        "tests": [],
        "executionReceipts": [],
        "normalizations": [],
    }


class ConstructionProgressReceiptTest(unittest.TestCase):
    def test_runnable_scaffold_without_self_check_earns_no_partial_credit(self) -> None:
        before = {
            "solverPresent": False,
            "solverExecutionPresent": False,
            "solverSucceeded": False,
            "selfCheckPresent": False,
            "candidateStatusPresent": False,
            "candidateAllPass": False,
            "failedCheckCount": 0,
        }
        after = {
            **before,
            "solverPresent": True,
            "solverExecutionPresent": True,
            "solverSucceeded": True,
        }

        self.assertEqual(_construction_progress_receipts(before, after), [])

    def test_host_mints_partial_credit_for_closed_loop_self_check(self) -> None:
        before = {
            "solverPresent": True,
            "solverExecutionPresent": True,
            "solverSucceeded": True,
            "selfCheckPresent": False,
            "candidateStatusPresent": False,
            "candidateAllPass": False,
            "failedCheckCount": 0,
        }
        after = {
            **before,
            "selfCheckPresent": True,
            "failedCheckCount": 2,
        }

        receipts = _construction_progress_receipts(before, after)

        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["kind"], "construction-progress")
        self.assertEqual(receipts[0]["milestonesAdded"], ["selfCheckPresent"])
        self.assertEqual(receipts[0]["creditClass"], "epistemic")
        self.assertFalse(receipts[0]["solutionQualityImproved"])
        self.assertEqual(receipts[0]["verifiedBy"], "amos-host-construction-probe")
        self.assertFalse(receipts[0]["grantsCompletionCredit"])

    def test_failed_check_reduction_is_solution_progress(self) -> None:
        before = {
            "solverPresent": True,
            "solverExecutionPresent": True,
            "solverSucceeded": False,
            "selfCheckPresent": True,
            "selfCheckAllPass": False,
            "candidateStatusPresent": False,
            "candidateAllPass": False,
            "failedCheckCount": 3,
        }
        after = {**before, "failedCheckCount": 1}

        receipts = _construction_progress_receipts(before, after)

        self.assertEqual(receipts[0]["creditClass"], "solution")
        self.assertEqual(receipts[0]["failedChecksRemoved"], 2)

    def test_no_milestone_or_failure_reduction_mints_no_credit(self) -> None:
        evidence = {
            "solverPresent": True,
            "solverExecutionPresent": False,
            "solverSucceeded": False,
            "selfCheckPresent": False,
            "candidateStatusPresent": False,
            "candidateAllPass": False,
            "failedCheckCount": 0,
        }

        self.assertEqual(_construction_progress_receipts(evidence, evidence), [])


class TransactionalCandidateEvolutionTest(unittest.TestCase):
    def _evidence(self, **updates: object) -> dict:
        value = {
            "implementationPresent": True,
            "implementationSyntaxValid": True,
            "implementationContractPresent": True,
            "implementationSubstantive": False,
            "implementationSha256": "a" * 64,
            "solverExecutionPresent": True,
            "solverSucceeded": False,
            "selfCheckPresent": False,
            "selfCheckAllPass": False,
            "candidateStatusPresent": False,
            "candidateAllPass": False,
            "failedCheckCount": 2,
        }
        value.update(updates)
        return value

    def test_substantive_mutation_promotes_over_scaffold(self) -> None:
        incumbent = self._evidence()
        mutation = self._evidence(
            implementationSubstantive=True,
            implementationSha256="b" * 64,
        )

        self.assertEqual(
            _candidate_evidence_preferred(incumbent, mutation),
            (True, "objective-evidence-improved"),
        )

    def test_mutation_cannot_erase_an_incumbent_self_check(self) -> None:
        incumbent = self._evidence(
            implementationSubstantive=True,
            selfCheckPresent=True,
            failedCheckCount=1,
        )
        mutation = self._evidence(
            implementationSubstantive=True,
            implementationSha256="b" * 64,
        )

        self.assertTrue(_candidate_evidence_regressed(incumbent, mutation))
        self.assertEqual(
            _candidate_evidence_preferred(incumbent, mutation)[1],
            "objective-evidence-regression",
        )

    def test_repairable_partial_candidate_advances_challenger_not_incumbent(self) -> None:
        scaffold = self._evidence()
        partial = self._evidence(
            implementationContractPresent=False,
            implementationSubstantive=True,
            implementationSha256="b" * 64,
        )

        self.assertEqual(
            _candidate_evidence_preferred(scaffold, partial),
            (False, "objective-evidence-regression"),
        )
        self.assertEqual(
            _challenger_evidence_preferred(scaffold, partial),
            (True, "repair-evidence-improved"),
        )

    def test_invalid_or_unchanged_candidate_cannot_advance_challenger(self) -> None:
        challenger = self._evidence(
            implementationSubstantive=True,
            implementationSha256="b" * 64,
        )
        invalid = self._evidence(
            implementationSyntaxValid=False,
            implementationSubstantive=True,
            implementationSha256="c" * 64,
        )

        self.assertEqual(
            _challenger_evidence_preferred(challenger, invalid),
            (False, "unrepairable-candidate"),
        )
        self.assertEqual(
            _challenger_evidence_preferred(challenger, challenger),
            (False, "no-implementation-change"),
        )

    def test_construction_exhaustion_is_an_official_verifier_handoff(self) -> None:
        board = _board()
        challenger = self._evidence(
            implementationContractPresent=False,
            implementationSubstantive=True,
            implementationSha256="b" * 64,
        )

        record = _construction_exhaustion_record(
            board=board,
            cycle=3,
            incumbent=self._evidence(),
            challenger=challenger,
        )

        self.assertEqual(record["status"], "official-verifier-handoff")
        self.assertEqual(record["cycle"], 3)
        self.assertEqual(record["boardPhase"], board["phase"])
        self.assertEqual(record["challengerEvidence"], challenger)
        self.assertFalse(record["authority"]["grantsCompletionCredit"])
        self.assertFalse(record["authority"]["bypassesOfficialVerifier"])

    def test_atomic_mutation_receipt_is_bound_to_both_digests(self) -> None:
        receipt = {
            "schema": "amos.swarm-mutation-receipt",
            "version": 1,
            "sourceSha256": "a" * 64,
            "resultSha256": "b" * 64,
            "syntaxValid": True,
            "interfaceValid": True,
            "authority": {"hostObservedOnly": True, "grantsCompletionCredit": False},
        }

        self.assertTrue(_mutation_receipt_matches(
            receipt,
            source_digest="a" * 64,
            result_digest="b" * 64,
        ))
        self.assertFalse(_mutation_receipt_matches(
            receipt,
            source_digest="c" * 64,
            result_digest="b" * 64,
        ))

    def test_compiler_work_nodes_are_dynamic_and_edges_are_host_validated(self) -> None:
        nodes = _normalize_work_nodes([
            {
                "id": "derive-capacity",
                "objective": "Derive capacity from exact interval evidence.",
                "dependsOn": ["missing", "derive-capacity"],
                "requiredEvidence": ["capacity-check"],
                "tags": ["interval reasoning"],
            },
        ])

        self.assertEqual(nodes[0]["id"], "derive-capacity")
        self.assertEqual(nodes[0]["dependsOn"], [])
        self.assertIn("interval", nodes[0]["tags"])

    def test_research_provenance_forbids_frontier_escalation(self) -> None:
        with self.assertRaisesRegex(ValueError, "frontier escalation"):
            _validate_model_provenance(json.dumps({"frontierEscalationAllowed": True}))

    def test_research_provenance_accepts_harbor_preparsed_object(self) -> None:
        provenance = _validate_model_provenance({
            "provider": "amos-private-vllm",
            "model": "amos-qwen38-27b-fp8",
            "route": "direct-research",
            "frontierEscalationAllowed": False,
        })

        self.assertEqual(provenance["provider"], "amos-private-vllm")
        self.assertEqual(provenance["model"], "amos-qwen38-27b-fp8")
        self.assertEqual(provenance["route"], "direct-research")
        self.assertFalse(provenance["frontierEscalationAllowed"])


class TransactionalCandidateSettlementTest(unittest.IsolatedAsyncioTestCase):
    async def test_partial_work_persists_only_on_the_challenger_track(self) -> None:
        incumbent = {
            "implementationPresent": True,
            "implementationSyntaxValid": True,
            "implementationContractPresent": True,
            "implementationSubstantive": False,
            "implementationSha256": "a" * 64,
            "failedCheckCount": 2,
        }
        partial = {
            **incumbent,
            "implementationContractPresent": False,
            "implementationSubstantive": True,
            "implementationSha256": "b" * 64,
        }
        environment = object()

        async def read_json(_environment: object, path: str) -> dict | None:
            return {
                INCUMBENT_EVIDENCE_PATH: incumbent,
                CHALLENGER_EVIDENCE_PATH: incumbent,
                MUTATION_RECEIPT_PATH: None,
                CANDIDATE_EVOLUTION_PATH: {
                    "schema": "amos.swarm-candidate-evolution",
                    "version": 1,
                    "events": [],
                },
            }.get(path)

        with (
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._read_optional_host_json",
                side_effect=read_json,
            ),
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._copy_candidate_state",
                new_callable=mock.AsyncMock,
            ) as copy_state,
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._restore_candidate_state",
                new_callable=mock.AsyncMock,
            ) as restore_state,
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._write_host_json",
                new_callable=mock.AsyncMock,
            ) as write_json,
        ):
            event = await _settle_candidate_mutation(
                environment,
                cycle=1,
                candidate_evidence=partial,
            )

        self.assertFalse(event["promoted"])
        self.assertTrue(event["challengerAdvanced"])
        self.assertEqual(event["challengerEvidenceAfter"], partial)
        copy_state.assert_any_await(environment, CHALLENGER_DIR)
        restore_state.assert_awaited_once_with(environment, CHALLENGER_DIR)
        written_evidence = {
            call.args[1]: call.args[2]
            for call in write_json.await_args_list
            if len(call.args) >= 3
        }
        self.assertEqual(written_evidence[CHALLENGER_EVIDENCE_PATH], partial)
        self.assertNotIn(INCUMBENT_EVIDENCE_PATH, written_evidence)


class CrossRunCapsuleMemoryTest(unittest.TestCase):
    def _record_capsule(
        self,
        root: Path,
        *,
        instruction_digest: str,
        task_name: str,
        source: str,
        evidence: dict,
        finished_at: str,
        verifier_evidence: dict | None = None,
        failed_checks: list[dict] | None = None,
        repair_signals: list[str] | None = None,
    ) -> dict:
        source_bytes = source.encode("utf-8")
        source_digest = hashlib.sha256(source_bytes).hexdigest()
        source_path = root / "blobs" / source_digest[:2] / f"{source_digest}.blob"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_bytes(source_bytes)
        task = {
            "source": "terminal-bench/terminal-bench",
            "name": task_name,
            "ref": "3.0.0",
            "checksum": None,
            "instructionDigest": instruction_digest,
        }
        task["signature"] = hashlib.sha256(json.dumps(
            task,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()).hexdigest()
        capsule = {
            "schema": "amos.swarm-failure-capsule",
            "version": 1,
            "task": task,
            "execution": {"sourceRunId": "r3", "finishedAt": finished_at},
            "candidateLineage": {
                "repairableState": {
                    "available": True,
                    "selection": "challenger",
                    "source": {"digest": source_digest},
                    "evidence": {**evidence, "implementationSha256": source_digest},
                    "freshVerificationRequired": True,
                    "grantsCompletionCredit": False,
                },
            },
            "verifierEvidence": verifier_evidence,
            "failedChecks": failed_checks or [],
            "repairSignals": repair_signals or [],
            "safeguards": {
                "authorityGrantedByHrr": False,
                "repairReuseOnly": True,
                "exactTaskMatchRequired": True,
                "freshVerificationRequired": True,
                "grantsCompletionCredit": False,
            },
        }
        capsule["digest"] = hashlib.sha256(json.dumps(
            capsule,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()).hexdigest()
        capsule_bytes = (json.dumps(capsule, indent=2) + "\n").encode()
        capsule_blob_digest = hashlib.sha256(capsule_bytes).hexdigest()
        capsule_path = (
            root / "blobs" / capsule_blob_digest[:2] / f"{capsule_blob_digest}.blob"
        )
        capsule_path.parent.mkdir(parents=True, exist_ok=True)
        capsule_path.write_bytes(capsule_bytes)
        index = root / "capsules" / "by-instruction" / instruction_digest
        index.mkdir(parents=True, exist_ok=True)
        (index / f"{capsule['digest']}.ref").write_text(capsule_blob_digest + "\n")
        return capsule

    def test_exact_task_loader_selects_strongest_candidate_not_merely_newest(self) -> None:
        instruction_digest = "d" * 64
        base = {
            "implementationPresent": True,
            "implementationSyntaxValid": True,
            "implementationSubstantive": True,
            "implementationContractPresent": True,
            "solverSucceeded": True,
            "selfCheckPresent": True,
            "selfCheckAllPass": True,
            "candidateStatusPresent": True,
            "candidateAllPass": True,
            "failedCheckCount": 0,
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            strongest = self._record_capsule(
                root,
                instruction_digest=instruction_digest,
                task_name="production-planning",
                source="def construct(brief, sources):\n    return {'best': True}\ndef verify(brief, sources, candidate):\n    return []\n",
                evidence=base,
                finished_at="2026-08-26T20:00:00.000Z",
            )
            self._record_capsule(
                root,
                instruction_digest=instruction_digest,
                task_name="production-planning",
                source="def construct(brief, sources):\n    return {'newer': True}\ndef verify(brief, sources, candidate):\n    return ['gap']\n",
                evidence={
                    **base,
                    "candidateAllPass": False,
                    "selfCheckAllPass": False,
                    "failedCheckCount": 1,
                },
                finished_at="2026-08-26T21:00:00.000Z",
            )

            loaded = _load_repairable_challenger(
                str(root),
                task_name="terminal-bench/production-planning",
                instruction_digest=instruction_digest,
            )

        self.assertIsNotNone(loaded)
        self.assertIn("'best': True", loaded["source"])
        self.assertEqual(loaded["metadata"]["capsuleDigest"], strongest["digest"])
        self.assertEqual(loaded["metadata"]["instructionDigest"], instruction_digest)

    def test_exact_task_loader_prioritizes_independent_verifier_quality(self) -> None:
        instruction_digest = "7" * 64
        internally_strong = {
            "implementationPresent": True,
            "implementationSyntaxValid": True,
            "implementationSubstantive": True,
            "implementationContractPresent": True,
            "solverSucceeded": True,
            "selfCheckPresent": True,
            "selfCheckAllPass": True,
            "candidateStatusPresent": True,
            "candidateAllPass": True,
            "failedCheckCount": 0,
        }
        authority = {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._record_capsule(
                root,
                instruction_digest=instruction_digest,
                task_name="production-planning",
                source="def construct(brief, sources):\n    return {'internal': True}\ndef verify(brief, sources, candidate):\n    return []\n",
                evidence=internally_strong,
                finished_at="2026-08-26T21:00:00.000Z",
                verifier_evidence={
                    "present": True,
                    "source": "harbor-official-deterministic",
                    "status": "failed",
                    "reward": 0,
                    "totalChecks": 20,
                    "passedChecks": 11,
                    "failedChecks": 9,
                    "qualityFraction": 0.55,
                    "authority": authority,
                },
            )
            externally_strongest = self._record_capsule(
                root,
                instruction_digest=instruction_digest,
                task_name="production-planning",
                source="def construct(brief, sources):\n    return {'officially_better': True}\ndef verify(brief, sources, candidate):\n    return ['one internal gap']\n",
                evidence={
                    **internally_strong,
                    "candidateAllPass": False,
                    "selfCheckAllPass": False,
                    "failedCheckCount": 1,
                },
                finished_at="2026-08-26T20:00:00.000Z",
                verifier_evidence={
                    "present": True,
                    "source": "harbor-official-deterministic",
                    "status": "failed",
                    "reward": 0,
                    "totalChecks": 20,
                    "passedChecks": 12,
                    "failedChecks": 8,
                    "qualityFraction": 0.60,
                    "authority": authority,
                },
                failed_checks=[{
                    "id": "official:test_outputs.py::test_downtime",
                    "detail": "Official checker reported failed.",
                }],
                repair_signals=["finite-capacity-interval-repair"],
            )

            loaded = _load_repairable_challenger(
                str(root),
                task_name="production-planning",
                instruction_digest=instruction_digest,
            )

        self.assertIsNotNone(loaded)
        self.assertIn("'officially_better': True", loaded["source"])
        self.assertEqual(
            loaded["metadata"]["capsuleDigest"], externally_strongest["digest"]
        )
        self.assertEqual(loaded["metadata"]["verifierEvidence"]["passedChecks"], 12)
        self.assertEqual(
            loaded["metadata"]["failedChecks"][0]["id"],
            "official:test_outputs.py::test_downtime",
        )
        self.assertEqual(
            loaded["metadata"]["repairSignals"],
            ["finite-capacity-interval-repair"],
        )

    def test_instruction_mismatch_cannot_restore_a_candidate(self) -> None:
        instruction_digest = "e" * 64
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._record_capsule(
                root,
                instruction_digest=instruction_digest,
                task_name="production-planning",
                source="def construct(brief, sources):\n    return {}\ndef verify(brief, sources, candidate):\n    return []\n",
                evidence={
                    "implementationPresent": True,
                    "implementationSyntaxValid": True,
                    "implementationSubstantive": True,
                },
                finished_at="2026-08-26T20:00:00.000Z",
            )
            loaded = _load_repairable_challenger(
                str(root),
                task_name="production-planning",
                instruction_digest="f" * 64,
            )

        self.assertIsNone(loaded)


class CrossRunCandidateInitializationTest(unittest.IsolatedAsyncioTestCase):
    async def test_restored_source_advances_only_challenger_after_fresh_observation(self) -> None:
        scaffold = {
            "implementationPresent": True,
            "implementationSyntaxValid": True,
            "implementationSubstantive": False,
            "implementationSha256": "a" * 64,
        }
        restored = {
            **scaffold,
            "implementationSubstantive": True,
            "implementationSha256": "b" * 64,
        }
        environment = mock.AsyncMock()
        environment.exec.return_value = _Result()
        writes: list[tuple[str, dict]] = []

        async def write_json(_environment: object, path: str, value: dict) -> None:
            writes.append((path, value))

        with (
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._run_solver_program_if_present",
                new_callable=mock.AsyncMock,
            ),
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._observe_construction_evidence",
                new=mock.AsyncMock(side_effect=[scaffold, restored]),
            ),
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._copy_candidate_state",
                new_callable=mock.AsyncMock,
            ) as copy_state,
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._restore_candidate_state",
                new_callable=mock.AsyncMock,
            ) as restore_state,
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._write_host_text",
                new_callable=mock.AsyncMock,
            ),
            mock.patch(
                "benchmarks.harbor_agents.amos_task_swarm._write_host_json",
                side_effect=write_json,
            ),
        ):
            await _initialize_candidate_incumbent(
                environment,
                repairable_challenger={
                    "source": "def construct():\n    return 1\n",
                    "metadata": {
                        "capsuleDigest": "c" * 64,
                        "sourceDigest": "b" * 64,
                        "verifierEvidence": {
                            "present": True,
                            "source": "harbor-official-deterministic",
                            "status": "failed",
                            "reward": 0,
                            "totalChecks": 20,
                            "passedChecks": 11,
                            "failedChecks": 9,
                            "authority": {
                                "hostObservedOnly": True,
                                "grantsCompletionCredit": False,
                                "bypassesVerifier": False,
                            },
                        },
                        "failedChecks": [{
                            "id": "official:test_outputs.py::test_downtime",
                            "detail": "Official checker reported failed.",
                        }],
                        "repairSignals": ["finite-capacity-interval-repair"],
                    },
                },
            )

        incumbent_copies = [call for call in copy_state.await_args_list if call.args[1] == "/tmp/amos_swarm/incumbent"]
        challenger_copies = [call for call in copy_state.await_args_list if call.args[1] == CHALLENGER_DIR]
        self.assertEqual(len(incumbent_copies), 1)
        self.assertEqual(len(challenger_copies), 2)
        restore_state.assert_not_awaited()
        evolution = next(value for path, value in writes if path == CANDIDATE_EVOLUTION_PATH)
        self.assertEqual(evolution["incumbentEvidence"], scaffold)
        self.assertEqual(evolution["challengerEvidence"], restored)
        self.assertEqual(
            evolution["crossRunSeed"]["status"],
            "restored-as-repairable-challenger",
        )
        self.assertFalse(evolution["crossRunSeed"]["authority"]["grantsCompletionCredit"])
        self.assertEqual(
            evolution["crossRunSeed"]["source"]["verifierEvidence"]["passedChecks"],
            11,
        )
        self.assertEqual(
            evolution["crossRunSeed"]["source"]["failedChecks"][0]["id"],
            "official:test_outputs.py::test_downtime",
        )


class VerifierContractRecoveryTest(unittest.IsolatedAsyncioTestCase):
    async def test_missing_verdict_gets_typed_feedback_and_one_fresh_lease(self) -> None:
        board = _board()
        board["phase"] = "constructed"
        environment = _MemoryEnvironment({BOARD_PATH: json.dumps(board)})
        agent = object.__new__(AmosTaskSwarm)
        agent._max_verifier_contract_retries = 1
        calls = 0

        async def run_phase(**kwargs: object) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                self.assertNotIn(VERIFIER_CONTRACT_FEEDBACK_PATH, str(kwargs["instruction"]))
                return
            self.assertIn(VERIFIER_CONTRACT_FEEDBACK_PATH, str(kwargs["instruction"]))
            environment.files[PREFLIGHT_VERDICT_PATH] = json.dumps(
                {
                    "schema": "amos.swarm-verdict",
                    "version": 1,
                    "status": "repair",
                    "criteria": [{
                        "id": "criterion-001",
                        "status": "fail",
                        "evidence": "The deterministic candidate check still fails.",
                    }],
                    "gaps": ["The candidate needs another bounded repair."],
                    "artifactReceipts": [],
                    "testReceipts": [],
                }
            )

        agent._run_phase = mock.AsyncMock(side_effect=run_phase)
        verdict = await agent._run_verifier_with_contract_recovery(
            task="Build the plan.",
            phase="preflight",
            verdict_path=PREFLIGHT_VERDICT_PATH,
            board=board,
            environment=environment,
            phase_contexts=[],
            label="preflight-verifier-0",
        )

        self.assertEqual(calls, 2)
        self.assertEqual(verdict["status"], "repair")
        feedback = json.loads(environment.files[VERIFIER_CONTRACT_FEEDBACK_PATH])
        self.assertEqual(feedback["errorKind"], "missing-verdict")
        self.assertEqual(feedback["requiredCriteria"], board["successCriteria"])
        self.assertTrue(feedback["minimalBlockedExample"]["contractScaffold"])
        self.assertEqual(
            [item["id"] for item in feedback["minimalBlockedExample"]["criteria"]],
            ["criterion-001"],
        )
        self.assertFalse(feedback["authority"]["grantsCompletionCredit"])

    async def test_recovery_exhaustion_never_synthesizes_a_verdict(self) -> None:
        board = _board()
        board["phase"] = "constructed"
        environment = _MemoryEnvironment({BOARD_PATH: json.dumps(board)})
        agent = object.__new__(AmosTaskSwarm)
        agent._max_verifier_contract_retries = 1
        agent._run_phase = mock.AsyncMock()

        with self.assertRaisesRegex(RuntimeError, "contract recovery exhausted"):
            await agent._run_verifier_with_contract_recovery(
                task="Build the plan.",
                phase="preflight",
                verdict_path=PREFLIGHT_VERDICT_PATH,
                board=board,
                environment=environment,
                phase_contexts=[],
                label="preflight-verifier-0",
            )

        self.assertNotIn(PREFLIGHT_VERDICT_PATH, environment.files)

    def test_contract_errors_are_classified_without_model_judgment(self) -> None:
        self.assertEqual(
            _verifier_contract_error_kind("Verifier did not create /tmp/verdict.json"),
            "missing-verdict",
        )
        self.assertEqual(
            _verifier_contract_error_kind("Verifier wrote an incomplete pass verdict"),
            "incomplete-pass",
        )
        self.assertEqual(
            _verifier_contract_error_kind(
                "Verifier wrote incomplete criterion evidence to /tmp/verdict.json"
            ),
            "incomplete-criteria",
        )
        self.assertEqual(
            _verifier_contract_error_kind(
                "Verifier left the host contract scaffold unreplaced at /tmp/verdict.json"
            ),
            "unreplaced-scaffold",
        )

    def test_criterion_diagnostics_name_exact_contract_defects(self) -> None:
        diagnostics = _verdict_criterion_diagnostics(
            [
                {"id": "criterion-001", "status": "pass", "evidence": ""},
                {"id": "extra", "status": "unknown", "evidence": "x"},
                {"id": "extra", "status": "blocked", "evidence": "y"},
            ],
            required_criteria=[
                {"id": "criterion-001", "statement": "Pass."},
                {"id": "criterion-002", "statement": "Also pass."},
            ],
        )

        self.assertEqual(diagnostics["missingIds"], ["criterion-002"])
        self.assertEqual(diagnostics["unexpectedIds"], ["extra", "extra"])
        self.assertEqual(diagnostics["duplicateIds"], ["extra"])
        self.assertEqual(diagnostics["invalidStatusIds"], ["extra"])
        self.assertEqual(diagnostics["emptyEvidenceIds"], ["criterion-001"])

    async def test_contract_exhaustion_hands_runnable_candidate_to_official_verifier(self) -> None:
        board = _board()
        environment = _MemoryEnvironment({})
        agent = object.__new__(AmosTaskSwarm)
        agent._official_verifier_handoff = False
        candidate = {
            "candidateAllPass": False,
            "implementationSubstantive": True,
            "solverExecutionPresent": True,
            "implementationSha256": "b" * 64,
        }

        with mock.patch(
            "benchmarks.harbor_agents.amos_task_swarm._observe_construction_evidence",
            new=mock.AsyncMock(return_value=candidate),
        ):
            handed_off = await agent._handoff_exhausted_verifier_contract(
                phase="preflight",
                board=board,
                environment=environment,
                error=RuntimeError("incomplete criterion evidence"),
            )

        self.assertTrue(handed_off)
        self.assertTrue(agent._official_verifier_handoff)
        record = json.loads(environment.files[VERIFIER_HANDOFF_PATH])
        self.assertEqual(record["status"], "official-verifier-handoff")
        self.assertEqual(record["candidateEvidence"], candidate)
        self.assertFalse(record["authority"]["grantsCompletionCredit"])
        self.assertFalse(record["authority"]["bypassesOfficialVerifier"])


class CompiledStateHarvestTest(unittest.IsolatedAsyncioTestCase):
    async def test_host_projects_a_complete_compiler_artifact_to_the_board(self) -> None:
        board = _board()
        state = {
            "schema": "amos.swarm-compiled-state",
            "version": 1,
            "phase": "state-compiled",
            "constraints": ["Use finite capacity."],
            "success_criteria": [{"id": "sc-001", "statement": "Capacity passes."}],
            "source_references": [
                {"path": "/tmp/amos_swarm/source-data/orders.json", "role": "orders"}
            ],
            "gaps": [{"id": "gap-001", "statement": "Resolve substitutions."}],
            "verification": {"all_pass": True},
        }
        environment = _MemoryEnvironment(
            {
                BOARD_PATH: json.dumps(board),
                COMPILED_STATE_PATH: json.dumps(state),
            }
        )

        harvested = await _harvest_compiled_state_if_ready(environment, board)

        self.assertIsNotNone(harvested)
        assert harvested is not None
        self.assertEqual(harvested["phase"], "state-compiled")
        self.assertEqual(harvested["requirements"][-1]["statement"], "Use finite capacity.")
        self.assertEqual(harvested["successCriteria"][-1]["id"], "sc-001")
        self.assertEqual(harvested["sourceReferences"][-1]["role"], "orders")
        self.assertTrue(harvested["facts"][-1]["id"].startswith("fact-compiled-state-"))
        self.assertEqual(harvested["normalizations"][-1]["field"], "compiled-state")

    async def test_host_refuses_an_unverified_compiler_artifact(self) -> None:
        board = _board()
        state = {
            "schema": "amos.swarm-compiled-state",
            "version": 1,
            "phase": "state-compiled",
            "constraints": ["Use finite capacity."],
            "successCriteria": [{"id": "sc-001", "statement": "Capacity passes."}],
            "sourceReferences": ["/tmp/amos_swarm/source-data/orders.json"],
            "gaps": [],
            "verification": {"all_pass": False},
        }
        environment = _MemoryEnvironment(
            {
                BOARD_PATH: json.dumps(board),
                COMPILED_STATE_PATH: json.dumps(state),
            }
        )

        self.assertIsNone(await _harvest_compiled_state_if_ready(environment, board))
        feedback = json.loads(environment.files[COMPILED_FEEDBACK_PATH])
        self.assertEqual(feedback["status"], "repair")
        self.assertIn("verification.all_pass", feedback["errors"][-1])

    async def test_host_returns_repair_feedback_for_empty_compiled_statements(self) -> None:
        board = _board()
        state = {
            "schema": "amos.swarm-compiled-state",
            "version": 1,
            "phase": "state-compiled",
            "constraints": ["Use finite capacity."],
            "successCriteria": [{"id": "sc-001", "description": "wrong field"}],
            "sourceReferences": ["/tmp/amos_swarm/source-data/orders.json"],
            "gaps": [{"id": "gap-001", "statement": ""}],
            "verification": {"all_pass": True},
        }
        environment = _MemoryEnvironment(
            {
                BOARD_PATH: json.dumps(board),
                COMPILED_STATE_PATH: json.dumps(state),
            }
        )

        self.assertIsNone(await _harvest_compiled_state_if_ready(environment, board))
        feedback = json.loads(environment.files[COMPILED_FEEDBACK_PATH])
        self.assertIn(
            "successCriteria[0].statement must be non-empty",
            feedback["errors"],
        )
        self.assertIn("gaps[0].statement must be non-empty", feedback["errors"])
        self.assertEqual(json.loads(environment.files[BOARD_PATH]), board)


class ArtifactReceiptBoundaryTest(unittest.TestCase):
    def test_compiler_gets_one_bounded_corrective_lease_by_default(self) -> None:
        parameter = inspect.signature(AmosTaskSwarm.__init__).parameters[
            "max_state_compiler_cycles"
        ]

        self.assertEqual(parameter.default, 2)

    def test_only_host_minted_artifact_receipts_survive_projection(self) -> None:
        self.assertFalse(
            _is_host_artifact_receipt(
                {
                    "path": "/tmp/amos_swarm/interfaces/erp_schema.json",
                    "type": "schema",
                }
            )
        )
        self.assertTrue(
            _is_host_artifact_receipt(
                {
                    "id": "artifact-0001",
                    "kind": "state-extract",
                    "path": "/tmp/amos_swarm/interfaces/erp_schema.json",
                    "sha256": "b" * 64,
                    "producer": "interface-scanner",
                }
            )
        )

    def test_compiler_contract_forces_artifact_delivery_before_more_discovery(self) -> None:
        instruction = _state_compiler_instruction("Build the plan.", cycle=1, max_cycles=3)

        self.assertIn("first terminal action must create or improve", instruction)
        self.assertIn("Run the program no later than your", instruction)
        self.assertIn("host validates the artifact", instruction)
        self.assertIn("amos.swarm-compiled-state", instruction)
        self.assertIn("compiled-state-feedback.json", instruction)
        self.assertIn("`statement` field", instruction)


class CandidateHarvestTest(unittest.IsolatedAsyncioTestCase):
    async def test_host_projects_a_verified_candidate_without_model_board_edits(self) -> None:
        board = _board()
        board["phase"] = "state-compiled"
        artifact_path = "/tmp/amos_swarm/solver.py"
        test_path = "/tmp/amos_swarm/tests/self-check.json"
        self_check = {
            "all_pass": True,
            "criteria": [{
                "id": "criterion-001",
                "status": "pass",
                "evidence": "candidate output was checked",
            }],
        }
        files = {
            artifact_path: "print('candidate')\n",
            test_path: json.dumps(self_check),
        }
        status = {
            "schema": "amos.swarm-candidate-status",
            "version": 1,
            "phase": "constructed",
            "status": "ready",
            "verification": {
                "all_pass": True,
                "criterionIds": ["criterion-001"],
            },
            "artifactReceipts": [
                {
                    "path": artifact_path,
                    "sha256": hashlib.sha256(files[artifact_path].encode()).hexdigest(),
                }
            ],
            "testReceipts": [
                {
                    "path": test_path,
                    "sha256": hashlib.sha256(files[test_path].encode()).hexdigest(),
                }
            ],
        }
        environment = _MemoryEnvironment(
            {BOARD_PATH: json.dumps(board), CANDIDATE_STATUS_PATH: json.dumps(status), **files}
        )

        harvested = await _harvest_candidate_if_ready(environment, board)

        self.assertIsNotNone(harvested)
        assert harvested is not None
        self.assertEqual(harvested["phase"], "constructed")
        self.assertEqual(harvested["tests"][-1]["path"], test_path)
        self.assertTrue(harvested["facts"][-1]["id"].startswith("fact-candidate-"))

    async def test_host_rejects_bare_model_authored_all_pass_claim(self) -> None:
        board = _board()
        board["phase"] = "state-compiled"
        artifact_path = "/tmp/amos_swarm/solver.py"
        test_path = "/tmp/amos_swarm/tests/self-check.json"
        files = {
            artifact_path: "print('candidate')\n",
            test_path: json.dumps({"all_pass": True, "wo_count": 2, "resv_count": 0}),
        }
        status = {
            "schema": "amos.swarm-candidate-status",
            "version": 1,
            "phase": "constructed",
            "status": "ready",
            "verification": {"all_pass": True},
            "artifactReceipts": [{
                "path": artifact_path,
                "sha256": hashlib.sha256(files[artifact_path].encode()).hexdigest(),
            }],
            "testReceipts": [{
                "path": test_path,
                "sha256": hashlib.sha256(files[test_path].encode()).hexdigest(),
            }],
        }
        environment = _MemoryEnvironment(
            {CANDIDATE_STATUS_PATH: json.dumps(status), **files}
        )

        harvested = await _harvest_candidate_if_ready(environment, board)

        self.assertIsNone(harvested)


class ConstructionRepairCapsuleTest(unittest.TestCase):
    def test_failed_checks_compile_general_solver_repair_signals(self) -> None:
        failed = _extract_failed_self_checks(
            {
                "checks": [
                    {
                        "id": "inventory",
                        "status": "failed",
                        "detail": "Approved substitute component lots were not allocated.",
                    },
                    {
                        "id": "capacity",
                        "status": "failed",
                        "detail": "A shift with downtime lost its remaining free interval.",
                    },
                    {"id": "schema", "status": "passed"},
                ]
            }
        )
        signals = _construction_repair_signals(failed, None)

        self.assertEqual(len(failed), 2)
        self.assertIn("inventory-substitution-feasibility", signals)
        self.assertIn("finite-capacity-interval-repair", signals)
        self.assertIn("candidate-contract-incomplete", signals)
        principles = _construction_repair_principles(signals)
        self.assertTrue(any("substitute groups" in principle for principle in principles))
        self.assertTrue(any("remaining free intervals" in principle for principle in principles))

    def test_builder_retry_is_action_first_and_reads_host_feedback(self) -> None:
        instruction = _builder_instruction("Build the plan.", cycle=2, max_cycles=3)

        self.assertIn(CONSTRUCTION_FEEDBACK_PATH, instruction)
        self.assertIn("patch the existing", instruction)
        self.assertIn("solver implementation", instruction)
        self.assertIn("same first terminal batch", instruction)
        self.assertIn("Do not re-read or print", instruction)
        self.assertIn("do not build another inventory", instruction)
        self.assertNotIn("ORIGINAL MISSION", instruction)
        self.assertIn("immutable domain-neutral runtime", instruction)
        self.assertIn(SOLVER_IMPLEMENTATION_PATH, instruction)
        self.assertIn("Never edit or replace", instruction)

    def test_solver_scaffold_is_fail_closed_and_scenario_neutral(self) -> None:
        runtime = _solver_scaffold_source()
        implementation = _solver_implementation_scaffold_source()

        self.assertIn("def load_exact_state", runtime)
        self.assertIn("from solver_impl import construct, verify", runtime)
        self.assertIn("CANDIDATE_STATUS_PATH.unlink", runtime)
        self.assertIn("checks.get(\"all_pass\") is not computed_all_pass", runtime)
        self.assertIn("criterionContracts", runtime)
        self.assertIn("criteria must preserve every criterionContracts id", runtime)
        self.assertNotIn("raise NotImplementedError", runtime)
        self.assertIn("def construct(brief, sources)", implementation)
        self.assertIn("def verify(brief, sources, candidate)", implementation)
        self.assertIn("raise NotImplementedError", implementation)
        self.assertNotIn("production", (runtime + implementation).lower())

    def test_boolean_check_map_excludes_successes_from_repair_feedback(self) -> None:
        failed = _extract_failed_self_checks(
            {
                "checks": {
                    "solver-executed": True,
                    "candidate-contract": False,
                    "receipts": {"status": "passed"},
                    "capacity": {"status": "failed", "detail": "No feasible interval."},
                }
            }
        )

        self.assertEqual(
            failed,
            [
                {"id": "candidate-contract", "detail": "Deterministic check failed."},
                {"id": "capacity", "detail": "No feasible interval."},
            ],
        )

    def test_typed_criteria_failures_drive_exact_evidence_directed_repair(self) -> None:
        failed = _extract_failed_self_checks(
            {
                "all_pass": False,
                "criteria": [
                    {
                        "id": "criterion-demand",
                        "status": "fail",
                        "evidence": "0 non-WIP sales orders planned",
                    },
                    {
                        "id": "criterion-reservations",
                        "status": "fail",
                        "evidence": "No eligible lot reservations were emitted",
                    },
                    {
                        "id": "criterion-files",
                        "status": "pass",
                        "evidence": "All files exist",
                    },
                ],
            },
            required_criteria=[
                {
                    "id": "criterion-demand",
                    "statement": "Schedule feasible priority demand and at least ten non-WIP orders.",
                },
                {
                    "id": "criterion-reservations",
                    "statement": "Reserve eligible inventory lots without over-allocation.",
                },
                {
                    "id": "criterion-files",
                    "statement": "Write every output file.",
                },
            ],
        )

        self.assertEqual(
            [item["id"] for item in failed],
            ["criterion-demand", "criterion-reservations"],
        )
        self.assertIn("at least ten non-WIP orders", failed[0]["detail"])
        self.assertIn("0 non-WIP sales orders", failed[0]["detail"])
        signals = _construction_repair_signals(failed, None)
        self.assertIn("demand-coverage-repair", signals)
        self.assertIn("inventory-substitution-feasibility", signals)
        self.assertIn("empty-output-repair", signals)

    def test_flat_boolean_self_check_preserves_failed_boundary_and_metrics(self) -> None:
        failed = _extract_failed_self_checks(
            {
                "all_outside_freeze": True,
                "non_wip_count": 6,
                "non_wip_ge_10": False,
                "total_reservations": 124,
                "all_pass": False,
            }
        )

        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["id"], "non_wip_ge_10")
        self.assertIn("non_wip_count=6", failed[0]["detail"])
        self.assertIn("total_reservations=124", failed[0]["detail"])

    def test_recovery_uses_exact_state_without_replaying_original_mission(self) -> None:
        instruction = _construction_recovery_instruction(cycle=2, max_cycles=3)

        self.assertIn(BOARD_PATH, instruction)
        self.assertIn(CONSTRUCTION_FEEDBACK_PATH, instruction)
        self.assertIn("original mission is intentionally not repeated", instruction)
        self.assertIn("Do not rediscover schemas", instruction)
        self.assertIn("smallest root-cause repair", instruction)
        self.assertIn(CONSTRUCTION_DIAGNOSIS_PATH, instruction)
        self.assertIn("Before the first mutation", instruction)
        self.assertIn("learnable across", instruction)
        self.assertIn("modelHypothesisOnly", instruction)
        self.assertIn(CANDIDATE_STATUS_PATH, instruction)
        self.assertIn(CONSTRUCTION_BRIEF_PATH, instruction)
        self.assertNotIn("ORIGINAL MISSION", instruction)

    def test_construction_packet_summarizes_structure_with_a_bounded_sample(self) -> None:
        summary = _summarize_construction_source(
            {
                "path": "/tmp/amos_swarm/source-data/orders.json",
                "role": "source-data",
                "sha256": "a" * 64,
            },
            {
                "system": "erp",
                "rows": [
                    {"order_id": "SO-1", "qty": 4},
                    {"order_id": "SO-2", "qty": 7},
                ],
            },
        )

        self.assertEqual(summary["rowCount"], 2)
        self.assertEqual(summary["fields"], ["order_id", "qty"])
        self.assertEqual(summary["envelopeFields"], ["system"])
        self.assertEqual(summary["sampleRows"], [{"order_id": "SO-1", "qty": 4}])

    def test_construction_packet_unwraps_nested_transport_envelopes(self) -> None:
        summary = _summarize_construction_source(
            {
                "path": "/tmp/amos_swarm/source-data/orders.json",
                "role": "source-data",
                "sha256": "a" * 64,
            },
            {"rows": {"data": {"records": [{"id": "SO-1", "priority": 1}]}}},
        )

        self.assertEqual(summary["rowCount"], 1)
        self.assertEqual(summary["fields"], ["id", "priority"])
        self.assertEqual(summary["sampleRows"], [{"id": "SO-1", "priority": 1}])

    def test_missing_boundaries_are_explicit_contract_failures(self) -> None:
        failures = _construction_contract_failures(None, None)

        self.assertEqual(
            [failure["id"] for failure in failures],
            ["self-check-present", "candidate-status-present"],
        )
        self.assertIn("exit code alone", failures[0]["detail"])

    def test_failed_checks_keep_full_quality_first_recovery_lease(self) -> None:
        self.assertEqual(
            _construction_recovery_turn_budget(
                {"selfCheckPresent": False}, configured_budget=10, cycle=2
            ),
            10,
        )
        self.assertEqual(
            _construction_recovery_turn_budget(
                {
                    "selfCheckPresent": True,
                    "failedCheckCount": 3,
                    "candidateStatusPresent": False,
                },
                configured_budget=10,
                cycle=2,
            ),
            10,
        )
        self.assertEqual(
            _construction_recovery_turn_budget(
                {
                    "selfCheckPresent": True,
                    "failedCheckCount": 0,
                    "candidateStatusPresent": False,
                },
                configured_budget=10,
                cycle=2,
            ),
            4,
        )


class PhaseMemoryPolicyTest(unittest.TestCase):
    def test_long_horizon_compilation_and_mutating_phases_compact_transient_chat(self) -> None:
        self.assertEqual(
            _COMPACTION_PHASES,
            {"state-compiler", "solver-builder", "repairer"},
        )
        self.assertNotIn("verifier", _COMPACTION_PHASES)
        self.assertNotIn("executor", _COMPACTION_PHASES)

    def test_transport_retry_counter_recognizes_only_parser_failures(self) -> None:
        self.assertTrue(_is_malformed_parser_feedback(
            "WARNINGS: No valid JSON object found"
        ))
        self.assertTrue(_is_malformed_parser_feedback("ERROR: invalid json"))
        self.assertFalse(_is_malformed_parser_feedback("WARNINGS: plan was empty"))

    def test_solver_transport_retry_is_compact_and_preserves_exact_failure_state(self) -> None:
        instruction = _transport_retry_instruction(
            role="solver-builder",
            original_instruction="ORIGINAL LARGE PACKET " * 1_000,
            replacement_turns=3,
            construction_feedback={
                "evidenceDigest": "d" * 64,
                "failedChecks": [{"id": "sequence", "detail": "Sequence is not contiguous."}],
                "repairSignals": ["solver-runtime-failure"],
            },
            solver_execution={
                "returnCode": 2,
                "succeeded": False,
                "stdoutTail": "failed deterministic sequence check",
                "stderrTail": "",
            },
        )

        self.assertNotIn("ORIGINAL LARGE PACKET", instruction)
        self.assertIn("3 malformed structured response", instruction)
        self.assertIn("\"evidenceDigest\":\"" + "d" * 64 + "\"", instruction)
        self.assertIn(CONSTRUCTION_DIAGNOSIS_PATH, instruction)
        self.assertIn("working strategy checkpoint", instruction)

    def test_non_solver_transport_retry_keeps_original_phase_contract(self) -> None:
        instruction = _transport_retry_instruction(
            role="state-compiler",
            original_instruction="compile exact state",
            replacement_turns=1,
        )

        self.assertIn("compile exact state", instruction)
        self.assertIn("replacing exactly those lost transport turns", instruction)

    def test_retry_snapshot_and_runtime_diagnostics_are_bounded(self) -> None:
        diagnostic = "a" * 5_000 + "\x00tail"
        self.assertEqual(len(_bounded_diagnostic_tail(diagnostic)), 4_000)
        self.assertTrue(_bounded_diagnostic_tail(diagnostic).endswith("tail"))
        snapshot = _bounded_transport_retry_snapshot(
            construction_feedback={
                "evidenceDigest": "d" * 64,
                "failedChecks": [{"id": "x" * 300, "detail": "y" * 2_000}],
                "repairSignals": ["z" * 300],
            },
            solver_execution={"returnCode": 1, "stdoutTail": "q" * 5_000},
        )
        self.assertEqual(len(snapshot["failedChecks"][0]["id"]), 200)
        self.assertEqual(len(snapshot["failedChecks"][0]["detail"]), 1_000)
        self.assertEqual(len(snapshot["repairSignals"][0]), 200)
        self.assertEqual(len(snapshot["solverExecution"]["stdoutTail"]), 2_000)


class AdaptiveRepairDiagnosisTest(unittest.TestCase):
    def test_repair_agenda_forces_novel_substantive_variation_after_no_op(self) -> None:
        agenda = _repair_agenda(
            failed_checks=[
                {"id": "lot-quantities", "detail": "Lots are overallocated."},
                {"id": "downtime", "detail": "A planned interval overlaps downtime."},
            ],
            repair_signals=[
                "inventory-substitution-feasibility",
                "finite-capacity-interval-repair",
            ],
            candidate_evolution={
                "challengerEvidence": {"implementationSha256": "a" * 64},
                "events": [{
                    "cycle": 1,
                    "seedDigest": "a" * 64,
                    "mutationDigest": "a" * 64,
                    "implementationChanged": False,
                    "substantiveMutation": False,
                    "promoted": False,
                    "reason": "no-implementation-change",
                    "challengerAdvanced": False,
                    "challengerReason": "no-implementation-change",
                    "repairDiagnosis": {
                        "schema": "amos.swarm-repair-diagnosis",
                        "version": 1,
                        "evidenceDigest": "b" * 64,
                        "observation": "No lot was reserved.",
                        "hypothesis": "The same allocator path is wrong.",
                        "nextAction": "Retry the same allocator unchanged.",
                        "failedCheckIds": ["lot-quantities"],
                        "authority": {
                            "modelHypothesisOnly": True,
                            "grantsCompletionCredit": False,
                        },
                    },
                }],
            },
        )

        self.assertEqual(agenda["noOpAttemptCount"], 1)
        self.assertTrue(agenda["novelStrategyRequired"])
        self.assertTrue(agenda["rejectedStrategyFingerprints"])
        self.assertEqual(agenda["preferredCluster"]["id"], "finite-capacity-interval-repair")
        self.assertTrue(
            agenda["minimumMutationContract"]["implementationDigestMustChange"]
        )

    def _feedback(self, *, failed_count: int = 2) -> dict:
        return {
            "schema": "amos.swarm-construction-feedback",
            "version": 1,
            "evidenceDigest": "d" * 64,
            "evidence": {"failedCheckCount": failed_count},
            "failedChecks": [
                {"id": "material-reservation", "detail": "No material reservations."},
                {"id": "work-orders", "detail": "No work orders were emitted."},
            ],
        }

    def _diagnosis(self) -> dict:
        return {
            "schema": "amos.swarm-repair-diagnosis",
            "version": 1,
            "evidenceDigest": "d" * 64,
            "observation": "Every attempted reservation returned no allocation.",
            "hypothesis": "The allocator treats substitute groups as simultaneous requirements.",
            "nextAction": "Repair group-level feasibility and rerun the existing candidate.",
            "failedCheckIds": ["material-reservation", "work-orders"],
            "supportingMetrics": {"failed_reservations": 12},
            "authority": {
                "modelHypothesisOnly": True,
                "grantsCompletionCredit": False,
            },
        }

    def test_new_evidence_bound_diagnosis_earns_one_repair_lease(self) -> None:
        self.assertTrue(_diagnosis_earns_adaptive_repair(
            diagnosis_before=None,
            diagnosis_after=self._diagnosis(),
            input_feedback=self._feedback(),
            latest_feedback=self._feedback(failed_count=5),
        ))

    def test_stale_or_unbound_diagnosis_cannot_expand_the_budget(self) -> None:
        diagnosis = self._diagnosis()
        self.assertFalse(_diagnosis_earns_adaptive_repair(
            diagnosis_before=diagnosis,
            diagnosis_after=diagnosis,
            input_feedback=self._feedback(),
            latest_feedback=self._feedback(),
        ))
        unbound = {**diagnosis, "evidenceDigest": "e" * 64}
        self.assertFalse(_diagnosis_earns_adaptive_repair(
            diagnosis_before=None,
            diagnosis_after=unbound,
            input_feedback=self._feedback(),
            latest_feedback=self._feedback(),
        ))

    def test_diagnosis_is_not_progress_when_checks_already_pass(self) -> None:
        self.assertFalse(_diagnosis_earns_adaptive_repair(
            diagnosis_before=None,
            diagnosis_after=self._diagnosis(),
            input_feedback=self._feedback(),
            latest_feedback=self._feedback(failed_count=0),
        ))

    def test_source_scanner_requires_a_durable_artifact_before_more_inspection(self) -> None:
        instruction = _data_scanner_instruction("Build the plan.", cycle=1, max_cycles=3)

        self.assertIn("first terminal action must create or improve", instruction)
        self.assertIn("extract_source_data.py", instruction)
        self.assertIn("non-empty compact typed", instruction)


class TerminalBootstrapTest(unittest.IsolatedAsyncioTestCase):
    async def test_cloud_bootstrap_uploads_static_tmux_before_terminus_setup(self) -> None:
        environment = _BootstrapEnvironment()
        with tempfile.NamedTemporaryFile() as artifact:
            import benchmarks.harbor_agents.amos_task_swarm as module

            original = module._TMUX_BOOTSTRAP_PATH
            module._TMUX_BOOTSTRAP_PATH = Path(artifact.name)
            try:
                agent = object.__new__(AmosTaskSwarm)
                with mock.patch.object(
                    module.Terminus2,
                    "setup",
                    new=mock.AsyncMock(),
                ) as parent_setup:
                    await AmosTaskSwarm.setup(agent, environment)  # type: ignore[arg-type]
            finally:
                module._TMUX_BOOTSTRAP_PATH = original

        self.assertEqual(environment.uploads[0][1], _TMUX_REMOTE_PATH)
        self.assertIn("tmux -V", environment.commands[-1][0])
        parent_setup.assert_awaited_once_with(environment)


if __name__ == "__main__":
    unittest.main()
