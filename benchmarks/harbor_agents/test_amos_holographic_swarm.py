from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from benchmarks.harbor_agents.amos_holographic_swarm import (
    AmosHolographicSwarm,
    _build_outcome_memory,
    _construction_regressed,
    _repeated_failure,
    _manifest_changes,
    _load_strategy_genes,
    _persisted_agent_state,
    _procedural_gene_payload,
    _repair_aware_task_tags,
    _select_strategy_gene_expression,
    _validate_organism_policy,
    _strategy_gene_world_entry,
    _verified_board_advancement,
    _verified_world_entries,
)


class DurableProgressEcologyTest(unittest.TestCase):
    def _swarm(self) -> AmosHolographicSwarm:
        swarm = object.__new__(AmosHolographicSwarm)
        swarm._cycle = 3
        swarm._claim_cost = 1.0
        swarm._policy_metadata = _validate_organism_policy({}, expected_digest=None, candidate_index=0)
        swarm._policy = swarm._policy_metadata["policy"]
        swarm._pheromones = []
        swarm._energy_events = []
        swarm._outcome_memories = []
        swarm._agents = [
            {
                "id": "builder",
                "energy": 9.0,
                "reputation": 0.5,
                "completedTasks": 0,
                "failedTasks": 0,
                "experiences": [],
            }
        ]
        swarm._pending = {
            "agentId": "builder",
            "taskId": "solver-builder",
            "role": "solver-builder",
            "status": "working",
            "turnBudget": 10,
            "turnsUsed": 10,
        }
        return swarm

    def test_changed_artifacts_are_host_receipts(self) -> None:
        before = {"/tmp/amos_swarm/solver.py": {"sha256": "a" * 64, "bytes": 10}}
        after = {
            "/tmp/amos_swarm/solver.py": {"sha256": "b" * 64, "bytes": 20},
            "/tmp/amos_swarm/tests/check.json": {"sha256": "c" * 64, "bytes": 30},
        }

        self.assertEqual(
            _manifest_changes(before, after),
            [
                {"path": "/tmp/amos_swarm/solver.py", "sha256": "b" * 64, "bytes": 20},
                {
                    "path": "/tmp/amos_swarm/tests/check.json",
                    "sha256": "c" * 64,
                    "bytes": 30,
                },
            ],
        )

    def test_unreceipted_file_activity_cannot_earn_partial_credit(self) -> None:
        swarm = self._swarm()
        receipt = {"path": "/tmp/amos_swarm/solver.py", "sha256": "d" * 64, "bytes": 42}

        swarm._settle_pending(success=False, progress=[receipt])

        self.assertIsNone(swarm._pending)
        self.assertEqual(swarm._agents[0]["failedTasks"], 1)
        self.assertEqual(swarm._agents[0]["energy"], 7.25)
        self.assertEqual(swarm._pheromones[-1]["kind"], "failed-approach")
        self.assertEqual(swarm._energy_events[-1]["reason"], "unproductive-lease-penalty")
        self.assertEqual(swarm._energy_events[-1]["amount"], -1.75)

    def test_receipted_artifact_progress_uses_the_learned_partial_credit(self) -> None:
        swarm = self._swarm()
        receipt = {
            "kind": "artifact-receipt",
            "id": "artifact-0001",
            "path": "/tmp/amos_swarm/solver.py",
            "sha256": "e" * 64,
            "verifiedBy": "amos-host-artifact-harvest",
        }

        swarm._settle_pending(success=False, verified_progress=[receipt])

        self.assertIsNone(swarm._pending)
        self.assertEqual(swarm._agents[0]["failedTasks"], 0)
        self.assertEqual(swarm._agents[0]["energy"], 9.1)
        self.assertEqual(swarm._pheromones[-1]["kind"], "verified-partial-progress")
        self.assertEqual(
            swarm._active_signals("solver-builder")[0]["payload"]["receipts"],
            [receipt],
        )

    def test_epistemic_failure_observation_is_remembered_without_positive_reward(self) -> None:
        swarm = self._swarm()
        assignment = swarm._pending
        receipt = {
            "kind": "construction-progress",
            "evidenceDigest": "f" * 64,
            "verifiedBy": "amos-host-construction-probe",
            "creditClass": "epistemic",
            "solutionQualityImproved": False,
            "scoreBefore": 1,
            "scoreAfter": 0,
        }

        swarm._settle_pending(success=False, verified_progress=[receipt])

        self.assertIsNone(swarm._pending)
        self.assertEqual(swarm._agents[0]["energy"], 9.0)
        self.assertEqual(swarm._agents[0]["failedTasks"], 0)
        self.assertEqual(assignment["status"], "observed")
        self.assertEqual(swarm._energy_events[-1]["amount"], 0.0)
        self.assertEqual(swarm._energy_events[-1]["reason"], "verified-epistemic-progress")
        self.assertEqual(swarm._pheromones, [])
        self.assertEqual(swarm._outcome_memories[-1]["reward"]["polarity"], "neutral")

    def test_settlement_binds_state_action_effect_and_reward(self) -> None:
        swarm = self._swarm()
        swarm._pending.update({
            "missionId": "mission-1",
            "cycle": 3,
            "boardBeforePhase": "construction-checkpoint-1",
            "boardBeforeDigest": "a" * 64,
            "boardAfterPhase": "construction-checkpoint-2",
            "boardAfterDigest": "b" * 64,
            "repairSignals": ["candidate-contract-incomplete"],
            "repairFailedChecks": [
                {"id": "minimum-count", "detail": "At least ten are required."},
            ],
            "constructionEvidenceBefore": {
                "selfCheckPresent": True,
                "candidateStatusPresent": True,
                "candidateAllPass": False,
                "failedCheckCount": 2,
                "failedCheckIds": ["minimum-count", "receipt-gap"],
            },
            "constructionEvidenceAfter": {
                "selfCheckPresent": True,
                "candidateStatusPresent": True,
                "candidateAllPass": False,
                "failedCheckCount": 1,
                "failedCheckIds": ["minimum-count"],
            },
        })
        receipt = {
            "kind": "construction-progress",
            "evidenceDigest": "c" * 64,
            "verifiedBy": "amos-host-construction-probe",
            "scoreBefore": 3,
            "scoreAfter": 4,
        }

        swarm._settle_pending(success=False, verified_progress=[receipt])

        memory = swarm._outcome_memories[-1]
        self.assertEqual(memory["schema"], "amos.holographic-outcome-memory")
        self.assertEqual(memory["stateBefore"]["construction"]["failedCheckCount"], 2)
        self.assertEqual(memory["observedEffect"]["construction"]["failedCheckCount"], 1)
        self.assertEqual(
            memory["attemptedStrategy"]["failedChecks"][0]["id"],
            "minimum-count",
        )
        self.assertEqual(memory["reward"]["polarity"], "positive")
        self.assertFalse(memory["verification"]["completionCreditGranted"])

    def test_outcome_memory_enters_world_only_with_host_authority_boundary(self) -> None:
        assignment = {
            "missionId": "mission-1",
            "cycle": 2,
            "taskId": "solver-builder",
            "role": "solver-builder",
            "agentId": "skeptic",
            "boardBeforePhase": "construction-checkpoint-1",
            "boardAfterPhase": "construction-checkpoint-2",
            "repairSignals": ["constraint-repair"],
            "repairFailedChecks": [{"id": "minimum-count", "detail": "Too few."}],
            "constructionEvidenceBefore": {"failedCheckCount": 2},
            "constructionEvidenceAfter": {"failedCheckCount": 1},
            "progressArtifacts": [],
        }
        memory = _build_outcome_memory(
            assignment,
            success=False,
            verified_progress=[],
            reward_amount=-1.5,
            reward_reason="unproductive-lease-penalty",
            reward_polarity="negative",
        )
        forged = {**memory, "verifiedBy": "model-claim"}
        board = {
            "phase": "construction-checkpoint-2",
            "facts": [],
            "artifacts": [],
            "requirements": [],
            "successCriteria": [],
            "gaps": [],
        }

        entries = _verified_world_entries(
            board,
            outcome_memories=[memory, forged],
        )
        outcomes = [entry for entry in entries if entry["kind"] == "outcome-solver-builder"]

        self.assertEqual(len(outcomes), 1)
        self.assertIn("minimum-count", outcomes[0]["text"])
        self.assertIn("reward=-1.5 (negative", outcomes[0]["text"])
        self.assertEqual(outcomes[0]["verifiedBy"], "amos-host-outcome-boundary")

    def test_policy_validator_normalizes_a_sparse_candidate(self) -> None:
        metadata = _validate_organism_policy(
            {"bid.repetitionPenalty": 1.25, "energy.partialProgressReward": 0.8},
            expected_digest=None,
            candidate_index=0,
        )

        self.assertEqual(metadata["policy"]["bid.repetitionPenalty"], 1.25)
        self.assertEqual(metadata["policy"]["energy.partialProgressReward"], 0.8)
        self.assertEqual(len(metadata["policyDigest"]), 64)

    def test_only_host_receipts_and_projections_enter_the_shared_world(self) -> None:
        board = {
            "phase": "constructed",
            "facts": [
                {"id": "fact-model-claim", "statement": "Unverified model claim."},
                {
                    "id": "fact-compiled-state-abc",
                    "statement": "The host verified compiled state.",
                },
            ],
            "artifacts": [
                {"id": "artifact-fake", "kind": "model-reference", "path": "/tmp/x"},
                {
                    "id": "artifact-0001",
                    "kind": "state-extract",
                    "path": "/tmp/amos_swarm/solver.py",
                    "sha256": "a" * 64,
                    "producer": "solver-builder",
                },
            ],
            "requirements": [{"id": "requirement-1", "statement": "Retry is idempotent."}],
            "successCriteria": [{"id": "criterion-1", "statement": "All checks pass."}],
            "gaps": [],
        }

        entries = _verified_world_entries(board)
        ids = {entry["id"] for entry in entries}

        self.assertIn("artifact-0001", ids)
        self.assertIn("fact-compiled-state-abc", ids)
        self.assertIn("requirement-1", ids)
        self.assertNotIn("artifact-fake", ids)
        self.assertNotIn("fact-model-claim", ids)

    def test_active_world_projects_host_construction_actions_only(self) -> None:
        board = {
            "phase": "construction-checkpoint-2",
            "facts": [],
            "artifacts": [],
            "requirements": [],
            "successCriteria": [],
            "gaps": [],
        }
        context = {
            "digest": "d" * 64,
            "evidence": {
                "solverPresent": True,
                "solverExecutionPresent": False,
                "solverSucceeded": False,
                "selfCheckPresent": False,
                "candidateStatusPresent": False,
                "candidateAllPass": False,
                "failedCheckCount": 0,
            },
            "requiredNextActions": ["Execute the existing solver before further discovery."],
            "repairPrinciples": ["Consume the compiled state programmatically."],
            "failedChecks": [],
        }

        entries = _verified_world_entries(board, construction_context=context)

        self.assertIn("construction-state-dddddddddddd", {entry["id"] for entry in entries})
        self.assertTrue(any(
            entry["kind"] == "required-action" and
            entry["verifiedBy"] == "amos-host-construction-probe"
            for entry in entries
        ))
        self.assertTrue(all(
            reference.startswith("construction-feedback:")
            for entry in entries
            if entry["kind"] in {"construction-state", "required-action", "repair-principle"}
            for reference in entry["evidenceRefs"]
        ))

    def test_repair_state_advertises_capability_without_selecting_an_agent(self) -> None:
        scaffold_tags = _repair_aware_task_tags(
            "solver-builder",
            repair_context={
                "repairSignals": ["self-check-missing"],
                "evidence": {"selfCheckPresent": False},
            },
        )
        tested_tags = _repair_aware_task_tags(
            "solver-builder",
            repair_context={
                "repairSignals": ["finite-capacity-interval-repair"],
                "evidence": {"selfCheckPresent": True},
            },
        )

        self.assertIn("solver-engineering", scaffold_tags)
        self.assertIn("contract-verification", scaffold_tags)
        self.assertIn("targeted-repair", tested_tags)
        self.assertIn("constraint-testing", tested_tags)

    def test_losing_verified_construction_state_is_a_regression(self) -> None:
        assignment = {
            "constructionEvidenceBefore": {
                "solverPresent": True,
                "solverExecutionPresent": True,
                "selfCheckPresent": True,
                "failedCheckCount": 1,
            },
            "constructionEvidenceAfter": {
                "solverPresent": True,
                "solverExecutionPresent": False,
                "selfCheckPresent": True,
                "failedCheckCount": 2,
            },
        }

        self.assertTrue(_construction_regressed(assignment))

    def test_same_agent_repeating_same_failed_approach_is_penalized(self) -> None:
        previous = {
            "role": "solver-builder",
            "agentId": "builder",
            "status": "incomplete",
            "repairSignals": ["solver-not-executed"],
        }
        current = {
            "role": "solver-builder",
            "agentId": "builder",
            "status": "working",
            "repairSignals": ["solver-not-executed"],
        }

        self.assertTrue(_repeated_failure([previous, current], current))

    def test_board_phase_and_host_artifact_mint_partial_progress_receipts(self) -> None:
        base = {
            "schema": "amos.swarm-task-board",
            "version": 1,
            "taskDigest": "a" * 64,
            "taskObjective": "Test",
            "phase": "initialized",
            "successCriteria": [],
            "requirements": [],
            "facts": [],
            "sourceReferences": [],
            "gaps": [],
            "artifacts": [],
            "tests": [],
            "executionReceipts": [],
            "normalizations": [],
        }
        advanced = {**base, "phase": "interfaces-scanned", "artifacts": [{
            "id": "artifact-0001",
            "kind": "state-extract",
            "path": "/tmp/amos_swarm/interfaces.json",
            "sha256": "b" * 64,
            "producer": "interface-scanner",
        }]}

        receipts = _verified_board_advancement(base, advanced)

        self.assertEqual([receipt["kind"] for receipt in receipts], [
            "board-phase",
            "artifact-receipt",
        ])

    def test_host_retry_checkpoint_cannot_mint_partial_progress(self) -> None:
        base = {
            "schema": "amos.swarm-task-board",
            "version": 1,
            "taskDigest": "a" * 64,
            "taskObjective": "Test",
            "phase": "state-compiled",
            "successCriteria": [],
            "requirements": [],
            "facts": [],
            "sourceReferences": [],
            "gaps": [],
            "artifacts": [],
            "tests": [],
            "executionReceipts": [],
            "normalizations": [],
        }
        checkpoint = {**base, "phase": "construction-checkpoint-1"}

        self.assertEqual(_verified_board_advancement(base, checkpoint), [])

    def test_checkpoint_can_only_credit_a_separately_harvested_artifact(self) -> None:
        base = {
            "schema": "amos.swarm-task-board",
            "version": 1,
            "taskDigest": "a" * 64,
            "taskObjective": "Test",
            "phase": "state-compiled",
            "successCriteria": [],
            "requirements": [],
            "facts": [],
            "sourceReferences": [],
            "gaps": [],
            "artifacts": [],
            "tests": [],
            "executionReceipts": [],
            "normalizations": [],
        }
        checkpoint = {
            **base,
            "phase": "construction-checkpoint-1",
            "artifacts": [{
                "id": "artifact-0001",
                "kind": "state-extract",
                "path": "/tmp/amos_swarm/solver.py",
                "sha256": "b" * 64,
                "producer": "solver-builder",
            }],
        }

        receipts = _verified_board_advancement(base, checkpoint)

        self.assertEqual([receipt["kind"] for receipt in receipts], ["artifact-receipt"])


class CrossRunWorldMemoryTest(unittest.TestCase):
    def test_matching_genes_are_host_attested_and_negative_memory_is_avoidance(self) -> None:
        def gene(
            identifier: str,
            *,
            polarity: str,
            signal: str,
            weight: float,
            check_id: str = "lot-allocation",
        ) -> dict:
            return {
                "schema": "amos.holographic-strategy-gene",
                "version": 1,
                "id": identifier,
                "attemptedStrategy": {
                    "role": "solver-builder",
                    "repairSignals": [signal],
                    "failedChecks": [{"id": check_id}],
                    "procedure": {
                        "preconditions": {
                            "repairSignals": [signal],
                            "failedCheckIds": [check_id],
                        },
                        "operation": {
                            "hypothesis": "Allocate from a shared lot ledger.",
                            "nextAction": "Patch the allocator and rerun all checks.",
                        },
                    },
                },
                "reward": {"polarity": polarity, "amount": -1 if polarity == "negative" else 1},
                "organismWeight": weight,
                "evidenceRefs": [f"replay:{identifier}"],
                "verifiedBy": "amos-replay-store-host-outcome",
                "authority": {
                    "hostObservedOnly": True,
                    "grantsCompletionCredit": False,
                },
            }

        expression = _select_strategy_gene_expression(
            [
                gene("positive", polarity="positive", signal="inventory-repair", weight=2),
                gene("negative", polarity="negative", signal="inventory-repair", weight=1),
                gene(
                    "unrelated",
                    polarity="positive",
                    signal="calendar-repair",
                    weight=8,
                    check_id="shift-calendar",
                ),
            ],
            mission_id="mission-1",
            cycle=4,
            task={"id": "solver-builder"},
            role="solver-builder",
            repair_context={
                "repairSignals": ["inventory-repair"],
                "failedChecks": [{"id": "lot-allocation"}],
            },
        )

        receipt = expression["receipt"]
        self.assertEqual([gene["id"] for gene in expression["selectedGenes"]], [
            "positive",
            "negative",
        ])
        self.assertEqual(
            [selection["mode"] for selection in receipt["selections"]],
            ["guide", "avoid"],
        )
        self.assertEqual(receipt["schema"], "amos.gene-expression")
        self.assertEqual(receipt["schemaVersion"], 1)
        self.assertTrue(receipt["id"].startswith("expression_"))
        self.assertTrue(receipt["receiptId"].startswith("research-prompt-compiler:"))
        self.assertEqual(receipt["context"]["missionId"], "mission-1")

    def test_research_episode_becomes_bounded_cross_run_strategy_memory(self) -> None:
        assignment = {
            "missionId": "prior-mission",
            "cycle": 7,
            "taskId": "solver-builder",
            "role": "solver-builder",
            "agentId": "skeptic",
            "boardBeforePhase": "construction-checkpoint-2",
            "boardBeforeDigest": "a" * 64,
            "boardAfterPhase": "construction-checkpoint-3",
            "boardAfterDigest": "b" * 64,
            "repairSignals": ["material-feasibility"],
            "repairFailedChecks": [
                {"id": "reservations", "detail": "No reservations were emitted."},
            ],
            "constructionEvidenceBefore": {"failedCheckCount": 5},
            "constructionEvidenceAfter": {"failedCheckCount": 3},
            "progressArtifacts": [],
        }
        memory = _build_outcome_memory(
            assignment,
            success=False,
            verified_progress=[{"kind": "construction-progress", "id": "receipt-1"}],
            reward_amount=0.5,
            reward_reason="verified-partial-progress",
            reward_polarity="positive",
        )
        ecology = {
            "schema": "amos.holographic-swarm-harbor-run",
            "version": 1,
            "outcomeMemories": [memory],
        }
        ecology_bytes = json.dumps(ecology).encode("utf-8")
        ecology_digest = hashlib.sha256(ecology_bytes).hexdigest()
        episode_digest = "c" * 64
        episode = {
            "schema": "amos.swarm-learning-episode",
            "version": 1,
            "digest": episode_digest,
            "partition": "development",
            "task": {
                "source": "terminal-bench/terminal-bench",
                "name": "terminal-bench/production-planning",
                "checksum": "d" * 64,
            },
            "execution": {"finishedAt": "2026-08-25T00:00:00Z"},
            "ecology": {"digest": ecology_digest},
            "traces": [],
            "dataPolicy": {"permittedUses": ["research", "training"]},
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "episodes").mkdir()
            (root / "objects" / episode_digest[:2]).mkdir(parents=True)
            (root / "blobs" / ecology_digest[:2]).mkdir(parents=True)
            (root / "episodes" / "prior.ref").write_text(f"{episode_digest}\n")
            (root / "objects" / episode_digest[:2] / f"{episode_digest}.json").write_text(
                json.dumps(episode)
            )
            (root / "blobs" / ecology_digest[:2] / f"{ecology_digest}.blob").write_bytes(
                ecology_bytes
            )

            genes = _load_strategy_genes(
                str(root),
                task_name="terminal-bench/production-planning",
                limit=8,
            )
            mismatched = _load_strategy_genes(
                str(root),
                task_name="terminal-bench/unrelated",
                limit=8,
            )

        self.assertEqual(len(genes), 1)
        self.assertEqual(mismatched, [])
        self.assertFalse(genes[0]["authority"]["grantsCompletionCredit"])
        entry = _strategy_gene_world_entry(genes[0])
        self.assertIsNotNone(entry)
        self.assertIn("Cross-run learned world experience", entry["text"])
        self.assertIn("not current-state authority", entry["text"])

    def test_ecology_state_inherits_with_decay_and_bounded_reputation(self) -> None:
        inherited = _persisted_agent_state(
            {
                "agents": [{
                    "id": "builder",
                    "energy": 18,
                    "reputation": 0.9,
                    "experiences": ["solver-engineering", "solver-engineering"],
                    "completedTasks": 12,
                    "failedTasks": 3,
                }],
            },
            agent_id="builder",
            initial_energy=10,
        )

        self.assertTrue(inherited["inherited"])
        self.assertEqual(inherited["energy"], 14)
        self.assertEqual(inherited["reputation"], 0.8)
        self.assertEqual(inherited["experiences"], ["solver-engineering"])

    def test_outcome_compiles_a_portable_procedural_gene(self) -> None:
        assignment = {
            "role": "solver-builder",
            "repairSignals": ["constraint-repair"],
            "repairFailedChecks": [{"id": "check-a"}],
            "candidateEvolution": {
                "seedDigest": "a" * 64,
                "mutationDigest": "b" * 64,
                "promoted": True,
                "reason": "objective-evidence-improved",
                "transport": "bounded-atomic-mutation",
                "mutationReceiptValid": True,
                "monotonic": True,
            },
        }
        procedure = _procedural_gene_payload(
            assignment,
            before={"failedCheckCount": 2, "selfCheckPresent": True},
            after={"failedCheckCount": 1, "selfCheckPresent": True},
            reward={"amount": 0.5, "polarity": "positive"},
        )

        self.assertEqual(procedure["schema"], "amos.holographic-procedural-gene")
        self.assertEqual(procedure["incumbentDigest"], "a" * 64)
        self.assertTrue(procedure["observedEffects"]["promoted"])
        self.assertTrue(procedure["portability"]["taskSpecificIdentifiersExcluded"])

    def test_unverified_or_sealed_memory_never_enters_the_world_model(self) -> None:
        self.assertIsNone(_strategy_gene_world_entry({
            "schema": "amos.holographic-strategy-gene",
            "version": 1,
            "id": "forged",
            "verifiedBy": "model-claim",
            "evidenceRefs": ["none"],
            "authority": {
                "hostObservedOnly": True,
                "grantsCompletionCredit": False,
            },
        }))


if __name__ == "__main__":
    unittest.main()
