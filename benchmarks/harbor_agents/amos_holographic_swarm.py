"""Original-architecture Holographic Swarm treatment for Harbor pilots.

The lightweight task graph remains governed by the base adapter, but logical
agents sharing one Qwen backbone autonomously bid for each newly available work
opportunity. Classical HRR affinity, decaying pheromones, energy, reputation,
and verified experience determine assignment. The official Harbor verifier is
unchanged.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import shlex
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from typing import override
except ImportError:  # Python 3.10/3.11 test and Harbor compatibility
    from typing_extensions import override

from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from benchmarks.harbor_agents.amos_task_swarm import (
    AmosTaskSwarm,
    BOARD_PATH,
    CANDIDATE_STATUS_PATH,
    COMPILED_FEEDBACK_PATH,
    COMPILED_STATE_PATH,
    CONTEXT_SNAPSHOT_PATH,
    CANDIDATE_EVOLUTION_PATH,
    CANDIDATE_CHECKPOINT_PATH,
    CANDIDATE_BRANCHES_DIR,
    CHALLENGER_DIR,
    CONSTRUCTION_BRIEF_PATH,
    CONSTRUCTION_DIAGNOSIS_PATH,
    CONSTRUCTION_FEEDBACK_PATH,
    REPAIR_AGENDA_PATH,
    SELF_CHECK_PATH,
    MODEL_PROVENANCE_PATH,
    INCUMBENT_DIR,
    MUTATION_RECEIPT_PATH,
    WORK_GRAPH_PATH,
    SOLVER_EXECUTION_PATH,
    SOLVER_IMPLEMENTATION_PATH,
    SOLVER_PATH,
    SWARM_DIR,
    _canonical_digest,
    _construction_progress_receipts,
    _is_host_artifact_receipt,
    _observe_construction_evidence,
    _read_board,
    _read_optional_host_json,
    _write_host_json,
)


GENE_EXPRESSION_DIR = f"{SWARM_DIR}/gene-expressions"


_AGENT_PROFILES = (
    {
        "id": "scout",
        "skills": [
            "interface discovery",
            "schema analysis",
            "source data extraction",
            "evidence gathering",
        ],
        "identity": "Fast, careful environmental scout; persists compact evidence instead of narrating it.",
    },
    {
        "id": "analyst",
        "skills": [
            "constraint analysis",
            "state compilation",
            "operations research",
            "causal decomposition",
        ],
        "identity": "Systems analyst who converts distributed evidence into explicit constraints and computable state.",
    },
    {
        "id": "builder",
        "skills": [
            "solver engineering",
            "python programming",
            "algorithm design",
            "artifact integration",
        ],
        "identity": "Deliver-first engineer who writes, runs, and checks concrete artifacts before refining them.",
    },
    {
        "id": "skeptic",
        "skills": [
            "adversarial verification",
            "constraint testing",
            "failure analysis",
            "targeted repair",
        ],
        "identity": "Independent skeptic who seeks falsification and repairs only evidenced gaps.",
    },
    {
        "id": "operator",
        "skills": [
            "governed execution",
            "database writeback",
            "audit receipts",
            "transaction safety",
        ],
        "identity": "Exact-once operator who executes only validated plans and preserves audit evidence.",
    },
    {
        "id": "synthesist",
        "skills": [
            "knowledge synthesis",
            "result integration",
            "evidence communication",
            "mission completion",
        ],
        "identity": "Evidence-bound synthesist who reconstructs the whole without altering verified work.",
    },
)

_ROLE_TAGS = {
    "interface-scanner": ["interface-discovery", "schema-analysis"],
    "data-scanner": ["source-data-extraction", "evidence-gathering"],
    "state-compiler": ["constraint-analysis", "state-compilation", "causal-decomposition"],
    "solver-builder": ["solver-engineering", "algorithm-design", "python-programming"],
    "verifier": ["adversarial-verification", "constraint-testing", "failure-analysis"],
    "repairer": ["targeted-repair", "failure-analysis", "solver-engineering"],
    "executor": ["governed-execution", "database-writeback", "audit-receipts"],
    "integrator": ["knowledge-synthesis", "result-integration", "evidence-communication"],
}


class AmosHolographicSwarm(AmosTaskSwarm):
    """Run the governed task graph through an original-style swarm ecology."""

    def __init__(
        self,
        *args: Any,
        holographic_dimension: int = 128,
        initial_energy: float = 10.0,
        claim_cost: float | None = None,
        organism_policy_path: str | None = None,
        organism_policy_json: str | None = None,
        organism_policy_digest: str | None = None,
        organism_policy_candidate_index: int = 0,
        holographic_world_mode: str = "active",
        lease_feedback_interval: int = 2,
        strategy_gene_store_path: str | None = None,
        strategy_gene_task_name: str | None = None,
        strategy_gene_limit: int = 64,
        **kwargs: Any,
    ) -> None:
        # Keep treatment and control budgets identical by default. Learned
        # ecology may reassign retries inside those budgets; it may not buy a
        # larger context or more phase turns than the base task swarm.
        super().__init__(*args, **kwargs)
        policy_source: Any = {}
        if organism_policy_path and organism_policy_json:
            raise ValueError("Provide organism_policy_path or organism_policy_json, not both")
        if organism_policy_path:
            policy_source = json.loads(Path(organism_policy_path).read_text(encoding="utf-8"))
        elif organism_policy_json:
            policy_source = json.loads(organism_policy_json)
        self._policy_metadata = _validate_organism_policy(
            policy_source,
            expected_digest=organism_policy_digest,
            candidate_index=organism_policy_candidate_index,
        )
        self._policy = self._policy_metadata["policy"]
        self._dimension = max(16, min(2_048, int(holographic_dimension)))
        self._initial_energy = max(0.1, float(initial_energy))
        learned_claim_cost = float(self._policy["energy.claimCost"])
        if (
            claim_cost is not None
            and (organism_policy_path or organism_policy_json)
            and float(claim_cost) != learned_claim_cost
        ):
            raise ValueError("claim_cost cannot override the selected organism policy")
        selected_claim_cost = learned_claim_cost if claim_cost is None else float(claim_cost)
        self._claim_cost = max(0.0, min(selected_claim_cost, self._initial_energy))
        self._cycle = 0
        self._mission_id = ""
        self._agents: list[dict[str, Any]] = []
        self._pheromones: list[dict[str, Any]] = []
        self._assignments: list[dict[str, Any]] = []
        self._energy_events: list[dict[str, Any]] = []
        self._pending: dict[str, Any] | None = None
        self._board_before: dict[str, Any] | None = None
        self._world_memory_digests: list[str] = []
        self._outcome_memories: list[dict[str, Any]] = []
        self._dual_channel_shadow_snapshots: list[dict[str, Any]] = []
        if holographic_world_mode not in {"active", "shadow"}:
            raise ValueError("holographic_world_mode must be active or shadow")
        self._holographic_world_mode = holographic_world_mode
        self._dual_channel_world_snapshots: list[dict[str, Any]] = []
        self._lease_feedback_interval = max(1, min(8, int(lease_feedback_interval)))
        self._strategy_gene_store_path = (
            str(Path(strategy_gene_store_path).expanduser().resolve())
            if strategy_gene_store_path
            else None
        )
        self._strategy_gene_task_name = (
            str(strategy_gene_task_name).strip()[:500]
            if strategy_gene_task_name
            else None
        )
        self._strategy_gene_limit = max(1, min(512, int(strategy_gene_limit)))
        self._strategy_genes: list[dict[str, Any]] = []
        self._gene_expressions: list[dict[str, Any]] = []
        self._strategy_gene_load_error: str | None = None
        self._persisted_ecology_state: dict[str, Any] | None = None
        self._persisted_ecology_load_error: str | None = None
        self._lease_environment: BaseEnvironment | None = None
        self._lease_workspace: dict[str, dict[str, Any]] = {}
        self._lease_turn = 0
        self._lease_events: list[dict[str, Any]] = []

    @staticmethod
    @override
    def name() -> str:
        return "amos-holographic-swarm"

    @override
    def version(self) -> str:
        return "0.11.0"

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        self._initialize_ecology(instruction)
        status = "failed"
        try:
            await super().run(instruction, environment, context)
        except BaseException:
            if self._pending is not None:
                await self._settle_pending_from_environment(environment, phase_boundary=False)
            raise
        else:
            if self._pending is not None:
                await self._settle_pending_from_environment(
                    environment,
                    force_success=not self._official_verifier_handoff,
                )
            status = "completed"
        finally:
            archive_error = await self._archive_safe_workspace(environment)
            self._write_ecology_snapshot(status=status, archive_error=archive_error)

    @override
    async def _run_phase(
        self,
        *,
        role: str,
        instruction: str,
        environment: BaseEnvironment,
        phase_contexts: list[tuple[str, AgentContext]],
        label: str | None = None,
        turn_budget: int | None = None,
    ) -> None:
        if self._pending is not None:
            await self._settle_pending_from_environment(environment, phase_boundary=True)
        self._cycle += 1
        phase_label = label or role
        context_snapshot = (
            await _read_optional_host_json(environment, CONTEXT_SNAPSHOT_PATH)
            if role == "solver-builder"
            else None
        )
        work_node = (
            context_snapshot.get("activeWorkNode")
            if isinstance(context_snapshot, dict)
            and isinstance(context_snapshot.get("activeWorkNode"), dict)
            else None
        )
        task = {
            # Keep one ecological opportunity identity across bounded retries so
            # failed-approach pheromones can inhibit the same agent/approach on
            # the next cycle. The label still distinguishes phase trajectories.
            "id": _safe_id(
                f"{role}-{work_node.get('id')}" if work_node is not None else role
            ),
            "objective": (
                str(work_node.get("objective") or "")[:1_000]
                if work_node is not None
                else _opportunity_objective(role)
            ),
            "requirements": [
                "Leave durable artifacts or verified evidence for the next autonomous agent.",
                "Respect the exact governed phase contract and authority boundaries.",
            ],
            "tags": _repair_aware_task_tags(role, repair_context=None),
        }
        if work_node is not None:
            task["requirements"].extend(
                str(value)[:500]
                for value in work_node.get("requiredEvidence", [])[:16]
                if isinstance(value, str) and value.strip()
            )
            task["tags"] = sorted(set([
                *task["tags"],
                *[
                    _safe_id(value)
                    for value in work_node.get("tags", [])[:16]
                    if isinstance(value, str) and value.strip()
                ],
            ]))
        repair_context = await _repair_context(environment) if role == "solver-builder" else None
        if repair_context is not None:
            task["requirements"].append(
                "Use the host-authored construction failure capsule before further discovery."
            )
            task["tags"] = sorted(set([
                *_repair_aware_task_tags(role, repair_context=repair_context),
                *task["tags"],
            ]))
        gene_expression = _select_strategy_gene_expression(
            self._strategy_genes,
            mission_id=self._mission_id,
            cycle=self._cycle,
            task=task,
            role=role,
            repair_context=repair_context,
        )
        if gene_expression["selectedGenes"]:
            await environment.exec(command=f"mkdir -p {shlex.quote(GENE_EXPRESSION_DIR)}")
            await _write_host_json(
                environment,
                f"{GENE_EXPRESSION_DIR}/expression-{self._cycle:04d}-{_safe_id(role)}.json",
                gene_expression["receipt"],
            )
            self._gene_expressions.append(gene_expression["receipt"])
        self._deposit(
            kind="task-available",
            target_task_id=task["id"],
            intensity=1.0,
            confidence=1.0,
            polarity="attract",
            decay_rate=0.04,
            ttl_cycles=8,
            payload={"role": role, "label": phase_label},
        )
        self._board_before = await _read_board(environment)
        bids = await self._rank_bids(
            task,
            role=role,
            world_board=self._board_before,
            repair_context=repair_context,
            strategy_genes=gene_expression["selectedGenes"],
        )
        if not bids:
            raise RuntimeError(f"No holographic swarm agent could bid for {phase_label}")
        selected = bids[0]
        agent = self._agent(selected["agentId"])
        agent["energy"] -= self._claim_cost
        self._energy_events.append(
            self._energy_event(agent["id"], -self._claim_cost, "task-claim", task["id"])
        )
        self._deposit(
            kind="task-claimed",
            source_agent_id=agent["id"],
            target_task_id=task["id"],
            intensity=0.8,
            confidence=1.0,
            polarity="repel",
            decay_rate=0.3,
            ttl_cycles=3,
            payload={"bidScore": selected["score"], "role": role},
        )
        phase_turn_budget = self._phase_turns[role]
        if turn_budget is not None:
            phase_turn_budget = max(2, min(phase_turn_budget, int(turn_budget)))
        assignment = {
            "missionId": self._mission_id,
            "cycle": self._cycle,
            "taskId": task["id"],
            "role": role,
            "label": phase_label,
            "agentId": agent["id"],
            "bid": selected,
            # Preserve the counterfactual choice surface so organism training
            # can learn from who was not selected, not only from the winner.
            "bidLandscape": [
                {
                    "agentId": bid["agentId"],
                    "score": bid["score"],
                    "affinity": bid["affinity"],
                    "energyFactor": bid["energyFactor"],
                    "reputation": bid["reputation"],
                    "repetitionCount": bid["repetitionCount"],
                    "challengerBoost": bid["challengerBoost"],
                }
                for bid in bids[:16]
            ],
            "status": "working",
            "workspaceBefore": await _workspace_manifest(environment),
            "boardBeforeDigest": _canonical_digest(self._board_before),
            "boardBeforePhase": self._board_before["phase"],
            "repairCapsuleDigest": repair_context["digest"] if repair_context else None,
            "repairSignals": repair_context["repairSignals"] if repair_context else [],
            "repairFailedChecks": repair_context["failedChecks"] if repair_context else [],
            "geneExpressionReceipt": gene_expression["receipt"],
            "expressedStrategyGenes": gene_expression["selectedGenes"],
            "activeWorkNode": work_node,
            "modelProvenance": await _read_optional_host_json(
                environment,
                MODEL_PROVENANCE_PATH,
            ),
            "constructionEvidenceBefore": (
                await _observe_construction_evidence(environment)
                if role == "solver-builder"
                else None
            ),
            "turnBudget": phase_turn_budget,
            "malformedResponseRetryReserve": (
                self._malformed_response_retry_reserve
                if role in {"state-compiler", "solver-builder", "repairer"}
                else 0
            ),
        }
        self._assignments.append(assignment)
        self._pending = assignment
        augmented = _agent_instruction(
            instruction,
            agent=agent,
            assignment=assignment,
            signals=self._active_signals(task["id"]),
        )
        self._lease_environment = environment
        self._lease_workspace = assignment["workspaceBefore"]
        self._lease_turn = 0
        lease_started = time.monotonic()
        try:
            await super()._run_phase(
                role=role,
                instruction=augmented,
                environment=environment,
                phase_contexts=phase_contexts,
                label=f"{phase_label}-{agent['id']}",
                turn_budget=phase_turn_budget,
            )
        finally:
            assignment["turnsUsed"] = self._lease_turn
            assignment["malformedResponses"] = int(
                getattr(self, "_malformed_responses_in_phase", 0)
            )
            assignment["replacementTransportTurns"] = min(
                assignment["malformedResponses"],
                assignment["malformedResponseRetryReserve"],
            )
            assignment["elapsedSeconds"] = round(max(0, time.monotonic() - lease_started), 6)
            self._lease_environment = None
            self._lease_workspace = {}
        self._write_ecology_snapshot(status="running")

    def _initialize_ecology(self, instruction: str) -> None:
        self._mission_id = hashlib.sha256(instruction.encode("utf-8")).hexdigest()[:24]
        self._cycle = 0
        self._pheromones = []
        self._assignments = []
        self._energy_events = []
        self._pending = None
        self._board_before = None
        self._world_memory_digests = []
        self._outcome_memories = []
        self._strategy_genes = []
        self._gene_expressions = []
        self._strategy_gene_load_error = None
        self._persisted_ecology_state = None
        self._persisted_ecology_load_error = None
        if self._strategy_gene_store_path:
            try:
                self._strategy_genes = _load_strategy_genes(
                    self._strategy_gene_store_path,
                    task_name=self._strategy_gene_task_name,
                    limit=self._strategy_gene_limit,
                )
                self._persisted_ecology_state = _load_persisted_ecology_state(
                    self._strategy_gene_store_path,
                    task_name=self._strategy_gene_task_name,
                )
            except (OSError, ValueError, json.JSONDecodeError) as error:
                # Replay memory is advisory. Corruption or an incompatible
                # store must fail closed to a fresh organism, never prevent the
                # governed mission from running.
                self._strategy_gene_load_error = (
                    f"{type(error).__name__}: {error}"
                )[:2_000]
                self._persisted_ecology_load_error = self._strategy_gene_load_error
        self._dual_channel_shadow_snapshots = []
        self._dual_channel_world_snapshots = []
        self._lease_environment = None
        self._lease_workspace = {}
        self._lease_turn = 0
        self._lease_events = []
        self._agents = []
        for profile in _AGENT_PROFILES:
            inherited = _persisted_agent_state(
                self._persisted_ecology_state,
                agent_id=profile["id"],
                initial_energy=self._initial_energy,
            )
            agent = {
                **profile,
                "experiences": inherited["experiences"],
                "energy": inherited["energy"],
                "initialEnergy": self._initial_energy,
                "reputation": inherited["reputation"],
                "activeTaskId": None,
                "completedTasks": inherited["completedTasks"],
                "failedTasks": inherited["failedTasks"],
            }
            self._agents.append(agent)
            self._energy_events.append(
                self._energy_event(
                    agent["id"],
                    agent["energy"],
                    "inherited-endowment" if inherited["inherited"] else "initial-endowment",
                    None,
                )
            )

    async def _rank_bids(
        self,
        task: dict[str, Any],
        *,
        role: str,
        world_board: dict[str, Any] | None = None,
        repair_context: dict[str, Any] | None = None,
        strategy_genes: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        agents = [agent for agent in self._agents if agent["energy"] >= self._claim_cost]
        if role == "verifier":
            authors = {
                assignment["agentId"]
                for assignment in self._assignments
                if assignment["role"] in {"solver-builder", "repairer", "executor"}
            }
            independent = [agent for agent in agents if agent["id"] not in authors]
            if independent:
                agents = independent
        payload = {
            "dimension": self._dimension,
            "namespace": f"amos-harbor-{self._mission_id}",
            "agents": agents,
            "tasks": [task],
            "pheromones": self._pheromones,
            "cycle": self._cycle,
            "claimCost": self._claim_cost,
            "policy": self._policy,
            "dualChannelMode": self._holographic_world_mode,
            "attempts": [
                {"taskId": assignment["taskId"], "agentId": assignment["agentId"]}
                for assignment in self._assignments
            ],
        }
        if world_board is not None:
            payload["worldEntries"] = _verified_world_entries(
                world_board,
                construction_context=repair_context,
                outcome_memories=self._outcome_memories,
                strategy_genes=strategy_genes or [],
            )
            payload["worldBoardDigest"] = _canonical_digest(world_board)
        node = shutil.which("node")
        script = Path(__file__).resolve().parents[2] / "scripts" / "rankHolographicSwarmBids.js"
        if node is None or not script.exists():
            raise RuntimeError("Holographic swarm bid engine is unavailable")
        process = await asyncio.create_subprocess_exec(
            node,
            str(script),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate(
            json.dumps(payload, separators=(",", ":")).encode("utf-8")
        )
        if process.returncode != 0:
            raise RuntimeError(
                "Holographic swarm bid engine failed: " + stderr.decode("utf-8", "replace")
            )
        try:
            result = json.loads(stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError("Holographic swarm bid engine returned invalid JSON") from error
        bids = result.get("bids")
        if not isinstance(bids, list):
            raise RuntimeError("Holographic swarm bid engine omitted bids")
        shadow = result.get("dualChannelShadow")
        if (
            isinstance(shadow, dict)
            and shadow.get("mode") == "read-only-shadow"
            and shadow.get("authorityEnabled") is False
            and shadow.get("behaviorInfluence") is False
            and isinstance(shadow.get("representationDigest"), str)
            and len(shadow["representationDigest"]) == 64
        ):
            self._dual_channel_shadow_snapshots.append(
                {
                    "cycle": self._cycle,
                    "taskId": task["id"],
                    "role": role,
                    **shadow,
                }
            )
        active_world = result.get("dualChannelWorld")
        if (
            isinstance(active_world, dict)
            and active_world.get("mode") == "bounded-active-retrieval"
            and active_world.get("authorityEnabled") is False
            and active_world.get("behaviorInfluence") is True
            and active_world.get("authorityLeakRate") == 0
            and isinstance(active_world.get("representationDigest"), str)
            and len(active_world["representationDigest"]) == 64
        ):
            self._dual_channel_world_snapshots.append(
                {
                    "cycle": self._cycle,
                    "taskId": task["id"],
                    "role": role,
                    **active_world,
                }
            )
        elif self._holographic_world_mode == "active":
            raise RuntimeError("Active dual-channel HRR failed its authority or safety contract")
        for bid in bids:
            digest = bid.get("worldMemoryDigest")
            if isinstance(digest, str) and len(digest) == 64:
                self._world_memory_digests.append(digest)
        return bids

    @override
    async def _execute_commands(
        self,
        commands: list[Any],
        session: Any,
    ) -> tuple[bool, str]:
        """Expose bounded host observations at safe model-turn lease boundaries.

        This does not mint credit, alter the board, or reassign an in-flight
        specialist. It gives the same specialist a heartbeat before its next
        turn and records the signal for later policy learning.
        """

        timed_out, terminal_output = await super()._execute_commands(commands, session)
        if getattr(self, "_current_response_malformed", False):
            return timed_out, terminal_output
        self._lease_turn += 1
        if (
            self._lease_environment is None
            or self._pending is None
            or self._lease_turn % self._lease_feedback_interval != 0
        ):
            return timed_out, terminal_output
        current = await _workspace_manifest(self._lease_environment)
        changes = _manifest_changes(self._lease_workspace, current)
        self._lease_workspace = current
        board_claim = await _unverified_board_checkpoint(self._lease_environment)
        event = {
            "id": f"lease-{len(self._lease_events) + 1:05d}",
            "cycle": self._cycle,
            "turn": self._lease_turn,
            "turnBudget": self._pending["turnBudget"],
            "malformedResponseRetryReserve": self._pending.get(
                "malformedResponseRetryReserve", 0
            ),
            "agentId": self._pending["agentId"],
            "taskId": self._pending["taskId"],
            "unreceiptedWorkspaceChanges": changes,
            "unverifiedBoardClaim": board_claim,
            "creditGranted": False,
        }
        self._lease_events.append(event)
        heartbeat = (
            "AMOS lease heartbeat (host observation, not a completion receipt): "
            f"substantive turn {self._lease_turn}/{self._pending['turnBudget']}; "
            f"{len(changes)} new or changed workspace artifact(s) remain unreceipted. "
            "Use the remaining lease to finish the phase contract and its self-checks."
        )
        return timed_out, f"{terminal_output}\n\n{heartbeat}".strip()

    async def _previous_deliverable_advanced(
        self,
        environment: BaseEnvironment,
        *,
        phase_boundary: bool,
    ) -> bool:
        assert self._pending is not None
        role = self._pending["role"]
        expected = {
            "interface-scanner": "interfaces-scanned",
            "data-scanner": "data-scanned",
            "state-compiler": "state-compiled",
            "solver-builder": "constructed",
            "repairer": "repaired",
            "executor": "executed",
        }.get(role)
        if expected is None:
            # Verifier and integrator success is established by the outer host
            # orchestration reaching the next safe phase boundary. An exception
            # before that boundary cannot mint success credit.
            return phase_boundary
        result = await environment.exec(command=f"cat {BOARD_PATH}")
        if result.return_code != 0 or not result.stdout:
            return False
        try:
            phase = json.loads(result.stdout).get("phase", "")
        except json.JSONDecodeError:
            return False
        return phase == expected or (expected == "repaired" and str(phase).startswith("repaired-"))

    async def _settle_pending_from_environment(
        self,
        environment: BaseEnvironment,
        *,
        force_success: bool = False,
        phase_boundary: bool = False,
    ) -> None:
        assert self._pending is not None
        before = self._pending.pop("workspaceBefore", {})
        after = await _workspace_manifest(environment)
        progress = _manifest_changes(before, after)
        board_after: dict[str, Any] | None = None
        if self._board_before is not None:
            try:
                board_after = await _read_board(
                    environment,
                    previous=self._board_before,
                )
            except RuntimeError:
                if phase_boundary:
                    raise
        verified_progress = (
            _verified_board_advancement(self._board_before, board_after)
            if phase_boundary
            else []
        )
        self._pending["boardAfterPhase"] = (
            str(board_after.get("phase", "")) if isinstance(board_after, dict) else None
        )
        self._pending["boardAfterDigest"] = (
            _canonical_digest(board_after) if isinstance(board_after, dict) else None
        )
        if self._pending["role"] == "solver-builder":
            construction_after = await _observe_construction_evidence(environment)
            self._pending["constructionEvidenceAfter"] = construction_after
            evolution = await _read_optional_host_json(
                environment,
                CANDIDATE_EVOLUTION_PATH,
            )
            if isinstance(evolution, dict) and isinstance(evolution.get("events"), list):
                events = [event for event in evolution["events"] if isinstance(event, dict)]
                if events:
                    self._pending["candidateEvolution"] = events[-1]
                    self._pending["mutationEvidenceAfter"] = events[-1].get("mutationEvidence")
            diagnosis = await _read_optional_host_json(
                environment,
                CONSTRUCTION_DIAGNOSIS_PATH,
            )
            self._pending["repairDiagnosisAfter"] = _bounded_repair_diagnosis(diagnosis)
            verified_progress.extend(_construction_progress_receipts(
                self._pending.get("constructionEvidenceBefore"),
                construction_after,
            ))
        success = force_success or await self._previous_deliverable_advanced(
            environment,
            phase_boundary=phase_boundary,
        )
        self._settle_pending(
            success=success,
            progress=progress,
            verified_progress=verified_progress,
        )
        self._board_before = None

    def _settle_pending(
        self,
        *,
        success: bool,
        progress: list[dict[str, Any]] | None = None,
        verified_progress: list[dict[str, Any]] | None = None,
    ) -> None:
        assert self._pending is not None
        assignment = self._pending
        agent = self._agent(assignment["agentId"])
        progress = progress or []
        verified_progress = verified_progress or []
        epistemic_only = bool(verified_progress) and all(
            receipt.get("kind") == "construction-progress"
            and receipt.get("creditClass") == "epistemic"
            for receipt in verified_progress
        )
        assignment["progressArtifacts"] = progress
        assignment["verifiedProgressReceipts"] = verified_progress
        assignment["status"] = (
            "completed"
            if success
            else (
                "observed"
                if epistemic_only
                else ("progressed" if verified_progress else "incomplete")
            )
        )
        phase_turns = getattr(self, "_phase_turns", {})
        turn_budget = max(1, int(assignment.get("turnBudget") or phase_turns.get(
            assignment["role"], 1
        )))
        turns_used = max(0, int(assignment.get("turnsUsed") or turn_budget))
        utilization = min(1.0, turns_used / turn_budget)
        target_utilization = float(self._policy["time.targetLeaseUtilization"])
        early_fraction = max(0.0, target_utilization - utilization) / max(
            0.001, target_utilization
        )
        late_fraction = max(0.0, utilization - target_utilization) / max(
            0.001, 1 - target_utilization
        )
        assignment["leaseEconomics"] = {
            "turnsUsed": turns_used,
            "turnBudget": turn_budget,
            "utilization": round(utilization, 6),
            "targetUtilization": target_utilization,
            "qualityGated": True,
        }
        outcome_amount = 0.0
        outcome_reason = "unsettled"
        outcome_polarity = "negative"
        if success:
            reward = float(self._policy["energy.verifiedReward"]) * (
                1 + (float(self._policy["energy.efficiencyBonus"]) * early_fraction)
            )
            agent["energy"] += reward
            agent["reputation"] = min(1.0, agent["reputation"] + 0.03)
            agent["completedTasks"] += 1
            agent["experiences"].extend(_ROLE_TAGS[assignment["role"]])
            self._energy_events.append(
                self._energy_event(agent["id"], reward, "verified-progress", assignment["taskId"])
            )
            outcome_amount = reward
            outcome_reason = "verified-progress"
            outcome_polarity = "positive"
            self._deposit(
                kind="verified-knowledge",
                source_agent_id=agent["id"],
                target_task_id=assignment["taskId"],
                intensity=float(self._policy["pheromone.successIntensity"]),
                confidence=1.0,
                polarity="attract",
                decay_rate=float(self._policy["pheromone.successDecay"]),
                ttl_cycles=40,
                payload={"role": assignment["role"]},
            )
        elif epistemic_only:
            # Learning that a candidate fails is useful world-state evidence,
            # but it is not solution improvement. Persist it neutrally so HRR
            # retrieval can avoid the approach without training the ecology to
            # seek failing self-checks for positive energy.
            self._energy_events.append(
                self._energy_event(
                    agent["id"], 0.0, "verified-epistemic-progress", assignment["taskId"]
                )
            )
            outcome_amount = 0.0
            outcome_reason = "verified-epistemic-progress"
            outcome_polarity = "neutral"
        elif verified_progress:
            # Only host-accepted board advancement can earn partial credit.
            # Raw file activity remains observable in progressArtifacts but is
            # never promoted into organism reward or attractive memory.
            construction_receipts = [
                receipt for receipt in verified_progress
                if receipt.get("kind") == "construction-progress"
            ]
            progress_magnitude = max(
                [
                    min(1.0, max(0.1, (
                        float(receipt.get("scoreAfter", 0)) -
                        float(receipt.get("scoreBefore", 0))
                    ) / 3))
                    for receipt in construction_receipts
                ] or [1.0]
            )
            reward = float(self._policy["energy.partialProgressReward"]) * progress_magnitude * (
                1 + (float(self._policy["energy.efficiencyBonus"]) * early_fraction * 0.5)
            )
            agent["energy"] += reward
            agent["reputation"] = min(1.0, agent["reputation"] + 0.01)
            self._energy_events.append(
                self._energy_event(
                    agent["id"], reward, "verified-partial-progress", assignment["taskId"]
                )
            )
            outcome_amount = reward
            outcome_reason = "verified-partial-progress"
            outcome_polarity = "positive"
            self._deposit(
                kind="verified-partial-progress",
                source_agent_id=agent["id"],
                target_task_id=assignment["taskId"],
                intensity=float(self._policy["pheromone.partialProgressIntensity"]),
                confidence=1.0,
                polarity="attract",
                decay_rate=float(self._policy["pheromone.successDecay"]),
                ttl_cycles=16,
                payload={
                    "role": assignment["role"],
                    "receipts": verified_progress[:16],
                },
            )
        else:
            regression = _construction_regressed(assignment)
            repeated_failure = _repeated_failure(
                getattr(self, "_assignments", [assignment]), assignment
            )
            penalty = (
                float(self._policy["energy.failurePenalty"])
                + (float(self._policy["energy.stallPenalty"]) * late_fraction)
                + (
                    float(self._policy["energy.repeatFailurePenalty"])
                    if repeated_failure
                    else 0
                )
                + (
                    float(self._policy["energy.regressionPenalty"])
                    if regression
                    else 0
                )
            )
            agent["energy"] = max(0.0, agent["energy"] - penalty)
            agent["reputation"] = max(
                0.0,
                agent["reputation"] - min(0.2, 0.05 + (0.05 * late_fraction)),
            )
            agent["failedTasks"] += 1
            self._energy_events.append(
                self._energy_event(
                    agent["id"], -penalty, "unproductive-lease-penalty", assignment["taskId"]
                )
            )
            outcome_amount = -penalty
            outcome_reason = "unproductive-lease-penalty"
            self._deposit(
                kind="failed-approach",
                source_agent_id=agent["id"],
                target_task_id=assignment["taskId"],
                intensity=min(
                    1.0,
                    float(self._policy["pheromone.failureIntensity"]) * (1 + late_fraction),
                ),
                confidence=1.0,
                polarity="repel",
                decay_rate=float(self._policy["pheromone.failureDecay"]),
                ttl_cycles=12,
                payload={
                    "role": assignment["role"],
                    "repairCapsuleDigest": assignment.get("repairCapsuleDigest"),
                    "repairSignals": assignment.get("repairSignals", []),
                    "leaseUtilization": round(utilization, 6),
                    "regression": regression,
                    "repeatedFailure": repeated_failure,
                },
            )
        outcome_memory = _build_outcome_memory(
            assignment,
            success=success,
            verified_progress=verified_progress,
            reward_amount=outcome_amount,
            reward_reason=outcome_reason,
            reward_polarity=outcome_polarity,
        )
        if not hasattr(self, "_outcome_memories"):
            self._outcome_memories = []
        self._outcome_memories.append(outcome_memory)
        assignment["outcomeMemoryId"] = outcome_memory["id"]
        self._pending = None

    def _deposit(
        self,
        *,
        kind: str,
        target_task_id: str,
        intensity: float,
        confidence: float,
        polarity: str,
        decay_rate: float,
        ttl_cycles: int,
        payload: dict[str, Any],
        source_agent_id: str | None = None,
    ) -> None:
        self._pheromones.append(
            {
                "id": f"pheromone-{len(self._pheromones) + 1:05d}",
                "kind": kind,
                "sourceAgentId": source_agent_id,
                "targetTaskId": target_task_id,
                "payload": payload,
                "intensity": intensity,
                "confidence": confidence,
                "polarity": polarity,
                "decayRate": decay_rate,
                "depositedAtCycle": self._cycle,
                "ttlCycles": ttl_cycles,
                "evidenceRefs": [],
            }
        )

    def _active_signals(self, task_id: str) -> list[dict[str, Any]]:
        signals = []
        for event in self._pheromones:
            if event["targetTaskId"] != task_id:
                continue
            age = self._cycle - event["depositedAtCycle"]
            if age < 0 or age >= event["ttlCycles"]:
                continue
            intensity = event["intensity"] * (2.718281828459045 ** (-event["decayRate"] * age))
            signals.append(
                {
                    "kind": event["kind"],
                    "polarity": event["polarity"],
                    "intensity": round(intensity, 6),
                    "sourceAgentId": event["sourceAgentId"],
                    "payload": event["payload"],
                }
            )
        return sorted(signals, key=lambda signal: -signal["intensity"])

    def _agent(self, agent_id: str) -> dict[str, Any]:
        return next(agent for agent in self._agents if agent["id"] == agent_id)

    def _energy_event(
        self, agent_id: str, amount: float, reason: str, task_id: str | None
    ) -> dict[str, Any]:
        return {
            "id": f"energy-{len(self._energy_events) + 1:05d}",
            "agentId": agent_id,
            "amount": amount,
            "reason": reason,
            "taskId": task_id,
        }

    async def _archive_safe_workspace(self, environment: BaseEnvironment) -> str | None:
        fixed = [
            BOARD_PATH,
            COMPILED_STATE_PATH,
            COMPILED_FEEDBACK_PATH,
            CONSTRUCTION_BRIEF_PATH,
            CONSTRUCTION_FEEDBACK_PATH,
            REPAIR_AGENDA_PATH,
            CONSTRUCTION_DIAGNOSIS_PATH,
            WORK_GRAPH_PATH,
            CONTEXT_SNAPSHOT_PATH,
            MODEL_PROVENANCE_PATH,
            CANDIDATE_EVOLUTION_PATH,
            CANDIDATE_CHECKPOINT_PATH,
            MUTATION_RECEIPT_PATH,
            f"{SWARM_DIR}/compile_state.py",
            SOLVER_PATH,
            SOLVER_IMPLEMENTATION_PATH,
            SOLVER_EXECUTION_PATH,
            SELF_CHECK_PATH,
            CANDIDATE_STATUS_PATH,
            f"{SWARM_DIR}/preflight_verdict.json",
            f"{SWARM_DIR}/final_verdict.json",
        ]
        discover = await environment.exec(
            command=(
                f"find {shlex.quote(f'{SWARM_DIR}/tests')} "
                f"{shlex.quote(f'{SWARM_DIR}/receipts')} "
                f"{shlex.quote(CANDIDATE_BRANCHES_DIR)} "
                f"{shlex.quote(INCUMBENT_DIR)} "
                f"{shlex.quote(CHALLENGER_DIR)} "
                f"{shlex.quote(GENE_EXPRESSION_DIR)} -type f -size -8000001c "
                "2>/dev/null | sort"
            )
        )
        discovered = (discover.stdout or "").splitlines() if discover.return_code == 0 else []
        sources = []
        for source in [*fixed, *discovered]:
            candidate = str(source).strip()
            if not candidate.startswith(f"{SWARM_DIR}/") or candidate in sources:
                continue
            exists = await environment.exec(command=f"test -s {shlex.quote(candidate)}")
            if exists.return_code == 0:
                sources.append(candidate)
        destination = self.logs_dir / "artifacts" / "swarm"
        errors = []
        for source in sources:
            relative = Path(source).relative_to(Path(SWARM_DIR))
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                await environment.download_file(source_path=source, target_path=target)
            except Exception as error:  # pragma: no cover - provider-specific I/O surface
                errors.append(f"{source}: {type(error).__name__}: {error}")
        return "; ".join(errors)[:2_000] if errors else None

    def _write_ecology_snapshot(
        self,
        *,
        status: str,
        archive_error: str | None = None,
    ) -> None:
        snapshot = {
            "schema": "amos.holographic-swarm-harbor-run",
            "version": 1,
            "status": status,
            "missionId": self._mission_id,
            "cycle": self._cycle,
            "dimension": self._dimension,
            "policy": self._policy,
            "policyMetadata": self._policy_metadata,
            "worldMemoryDigests": sorted(set(self._world_memory_digests)),
            "outcomeMemories": self._outcome_memories,
            "strategyGeneMemory": {
                "mode": "bounded-cross-run-retrieval",
                "authorityEnabled": False,
                "behaviorInfluence": self._holographic_world_mode == "active",
                "taskFilter": self._strategy_gene_task_name,
                "storeConfigured": self._strategy_gene_store_path is not None,
                "loadError": self._strategy_gene_load_error,
                "genes": self._strategy_genes,
            },
            "geneExpressions": {
                "mode": "host-attested-contextual-expression",
                "researchMetabolismAutonomous": True,
                "authorityEnabled": False,
                "promotionRequiresHostEvidence": True,
                "receipts": self._gene_expressions,
            },
            "ecologyHeredity": {
                "mode": "bounded-decayed-cross-run-state",
                "authorityEnabled": False,
                "source": self._persisted_ecology_state,
                "loadError": self._persisted_ecology_load_error,
            },
            "dualChannelShadow": {
                "mode": "read-only-shadow",
                "authorityEnabled": False,
                "behaviorInfluence": False,
                "snapshots": self._dual_channel_shadow_snapshots,
            },
            "dualChannelWorld": {
                "mode": (
                    "bounded-active-retrieval"
                    if self._holographic_world_mode == "active"
                    else "unavailable"
                ),
                "authorityEnabled": False,
                "behaviorInfluence": self._holographic_world_mode == "active",
                "snapshots": self._dual_channel_world_snapshots,
            },
            "leaseEvents": self._lease_events,
            "agents": self._agents,
            "pheromones": self._pheromones,
            "assignments": self._assignments,
            "energyEvents": self._energy_events,
            "archiveError": archive_error,
        }
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        (self.logs_dir / "holographic_swarm.json").write_text(
            json.dumps(snapshot, sort_keys=True, indent=2), encoding="utf-8"
        )


async def _repair_context(environment: BaseEnvironment) -> dict[str, Any] | None:
    result = await environment.exec(command=f"cat {shlex.quote(CONSTRUCTION_FEEDBACK_PATH)}")
    if result.return_code != 0 or not result.stdout:
        return None
    try:
        feedback = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    if feedback.get("schema") != "amos.swarm-construction-feedback":
        return None
    signals = [
        _safe_id(signal)
        for signal in feedback.get("repairSignals", [])
        if isinstance(signal, str) and signal.strip()
    ][:32]
    return {
        "digest": hashlib.sha256(result.stdout.encode("utf-8")).hexdigest(),
        "repairSignals": sorted(set(signals)),
        "evidence": feedback.get("evidence") if isinstance(feedback.get("evidence"), dict) else {},
        "failedChecks": [
            check for check in feedback.get("failedChecks", [])
            if isinstance(check, dict)
        ][:32],
        "requiredNextActions": [
            str(action).strip()[:1_000]
            for action in feedback.get("requiredNextActions", [])
            if isinstance(action, str) and action.strip()
        ][:16],
        "repairPrinciples": [
            str(principle).strip()[:1_000]
            for principle in feedback.get("repairPrinciples", [])
            if isinstance(principle, str) and principle.strip()
        ][:16],
    }


def _construction_regressed(assignment: dict[str, Any]) -> bool:
    before = assignment.get("constructionEvidenceBefore")
    after = assignment.get("constructionEvidenceAfter")
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    milestones = (
        "solverPresent",
        "solverExecutionPresent",
        "solverSucceeded",
        "selfCheckPresent",
        "candidateStatusPresent",
        "candidateAllPass",
    )
    lost = any(before.get(field) is True and after.get(field) is not True for field in milestones)
    added_failures = (
        before.get("selfCheckPresent") is True
        and after.get("selfCheckPresent") is True
        and int(after.get("failedCheckCount") or 0) > int(before.get("failedCheckCount") or 0)
    )
    return lost or added_failures


def _repeated_failure(
    assignments: list[dict[str, Any]],
    current: dict[str, Any],
) -> bool:
    """Detect the same agent repeating the same unproductive role/signals."""
    current_signals = tuple(sorted(str(value) for value in current.get("repairSignals", [])))
    return any(
        previous is not current
        and previous.get("status") == "incomplete"
        and previous.get("role") == current.get("role")
        and previous.get("agentId") == current.get("agentId")
        and tuple(sorted(str(value) for value in previous.get("repairSignals", [])))
            == current_signals
        for previous in assignments
    )


def _safe_id(value: str) -> str:
    return "".join(character if character.isalnum() or character in "-._" else "-" for character in value)


def _validate_organism_policy(
    source: Any,
    *,
    expected_digest: str | None,
    candidate_index: int,
) -> dict[str, Any]:
    """Normalize and verify the exact policy with the canonical JS contract."""

    node = shutil.which("node")
    script = Path(__file__).resolve().parents[2] / "scripts" / "validateHolographicSwarmPolicy.js"
    if node is None or not script.is_file():
        raise RuntimeError("Holographic swarm policy validator is unavailable")
    request = {
        "source": source,
        "candidateIndex": int(candidate_index),
        "expectedPolicyDigest": expected_digest,
    }
    process = subprocess.run(
        [node, str(script)],
        input=json.dumps(request, separators=(",", ":")),
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        detail = process.stderr or process.stdout or "unknown policy validation error"
        raise ValueError(f"Invalid organism policy: {detail.strip()}")
    try:
        metadata = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Holographic swarm policy validator returned invalid JSON") from error
    if not isinstance(metadata.get("policy"), dict):
        raise RuntimeError("Holographic swarm policy validator omitted the normalized policy")
    return metadata


def _verified_world_entries(
    board: dict[str, Any],
    *,
    construction_context: dict[str, Any] | None = None,
    outcome_memories: list[dict[str, Any]] | None = None,
    strategy_genes: list[dict[str, Any]] | None = None,
    limit: int = 128,
) -> list[dict[str, Any]]:
    """Project only host-accepted board state into the shared HRR surface."""

    entries: list[dict[str, Any]] = [
        {
            "id": f"phase-{_safe_id(str(board['phase']))}",
            "kind": "phase",
            "text": f"The governed mission phase is {board['phase']}.",
            "evidenceRefs": [],
            "confidence": 1,
            "verifiedBy": "amos-host",
        }
    ]
    for artifact in board.get("artifacts", []):
        if not _is_host_artifact_receipt(artifact):
            continue
        entries.append(
            {
                "id": artifact["id"],
                "kind": "artifact",
                "text": (
                    f"{artifact['producer']} produced {artifact['path']} with SHA-256 "
                    f"{artifact['sha256']}."
                ),
                "evidenceRefs": [artifact["id"]],
                "confidence": 1,
                "verifiedBy": "amos-host-artifact-harvest",
            }
        )
    for fact in board.get("facts", []):
        fact_id = str(fact.get("id", ""))
        statement = str(fact.get("statement", "")).strip()
        if not statement or not fact_id.startswith(("fact-candidate-", "fact-compiled-state-")):
            continue
        entries.append(
            {
                "id": fact_id,
                "kind": "fact",
                "text": statement,
                "evidenceRefs": [fact_id],
                "confidence": 1,
                "verifiedBy": "amos-host-board-projection",
            }
        )
    phase = str(board.get("phase", ""))
    compiled = phase in {
        "state-compiled",
        "constructed",
        "executed",
    } or phase.startswith(("construction-checkpoint-", "repaired-"))
    if compiled:
        for field, kind in (
            ("requirements", "requirement"),
            ("successCriteria", "criterion"),
            ("gaps", "gap"),
        ):
            for item in board.get(field, []):
                item_id = str(item.get("id", ""))
                statement = str(item.get("statement", "")).strip()
                if not item_id or not statement:
                    continue
                entries.append(
                    {
                        "id": item_id,
                        "kind": kind,
                        "text": statement,
                        "evidenceRefs": [item_id],
                        "confidence": 1,
                        "verifiedBy": "amos-host-compiled-state-projection",
                    }
                )
    if construction_context is not None:
        evidence_ref = f"construction-feedback:{construction_context['digest']}"
        evidence = construction_context.get("evidence") or {}
        state_text = (
            "Host-observed construction state: "
            f"solver present={evidence.get('solverPresent') is True}; "
            f"solver executed={evidence.get('solverExecutionPresent') is True}; "
            f"solver succeeded={evidence.get('solverSucceeded') is True}; "
            f"self-check present={evidence.get('selfCheckPresent') is True}; "
            f"candidate status present={evidence.get('candidateStatusPresent') is True}; "
            f"candidate all-pass={evidence.get('candidateAllPass') is True}; "
            f"failed checks={int(evidence.get('failedCheckCount') or 0)}."
        )
        entries.append({
            "id": f"construction-state-{construction_context['digest'][:12]}",
            "kind": "construction-state",
            "text": state_text,
            "evidenceRefs": [evidence_ref],
            "confidence": 1,
            "verifiedBy": "amos-host-construction-probe",
        })
        for index, action in enumerate(construction_context.get("requiredNextActions", [])):
            entries.append({
                "id": f"construction-action-{construction_context['digest'][:8]}-{index + 1}",
                "kind": "required-action",
                "text": action,
                "evidenceRefs": [evidence_ref],
                "confidence": 1,
                "verifiedBy": "amos-host-construction-probe",
            })
        for index, principle in enumerate(construction_context.get("repairPrinciples", [])):
            entries.append({
                "id": f"repair-principle-{construction_context['digest'][:8]}-{index + 1}",
                "kind": "repair-principle",
                "text": principle,
                "evidenceRefs": [evidence_ref],
                "confidence": 1,
                "verifiedBy": "amos-host-construction-probe",
            })
        for index, check in enumerate(construction_context.get("failedChecks", [])):
            detail = str(check.get("detail") or "Deterministic check failed.").strip()[:1_000]
            entries.append({
                "id": f"failed-check-{construction_context['digest'][:8]}-{index + 1}",
                "kind": "failed-check",
                "text": detail,
                "evidenceRefs": [evidence_ref],
                "confidence": 1,
                "verifiedBy": "amos-host-construction-probe",
            })
    for memory in outcome_memories or []:
        entry = _outcome_world_entry(memory)
        if entry is not None:
            entries.append(entry)
    gene_entries = [
        entry
        for gene in strategy_genes or []
        if (entry := _strategy_gene_world_entry(gene)) is not None
    ]
    # A fixed-size deterministic slice makes collisions and retrieval quality
    # measurable. Exact entries remain on the evidence board even when they are
    # not represented in this bounded world snapshot. Reserve a bounded lane
    # for learned cross-run experience so a large current board cannot silently
    # erase the organism's world model from every bid.
    maximum = max(1, min(int(limit), 512))
    gene_capacity = min(len(gene_entries), max(1, maximum // 4))
    return [
        *entries[: maximum - gene_capacity],
        *gene_entries[:gene_capacity],
    ]


def _build_outcome_memory(
    assignment: dict[str, Any],
    *,
    success: bool,
    verified_progress: list[dict[str, Any]],
    reward_amount: float,
    reward_reason: str,
    reward_polarity: str,
) -> dict[str, Any]:
    """Bind an attempted strategy to host-observed state, effect, and reward.

    The record is scenario-neutral and retrieval-only. It can guide a later
    specialist, but it can never grant authority or completion credit.
    """

    before = assignment.get("constructionEvidenceBefore")
    after = assignment.get("constructionEvidenceAfter")
    changed_artifacts = [
        {
            "path": str(receipt.get("path", ""))[:1_000],
            "sha256": str(receipt.get("sha256", ""))[:64],
            "bytes": int(receipt.get("bytes") or 0),
        }
        for receipt in assignment.get("progressArtifacts", [])
        if isinstance(receipt, dict)
        and isinstance(receipt.get("path"), str)
        and isinstance(receipt.get("sha256"), str)
        and len(receipt["sha256"]) == 64
    ][:32]
    failed_checks = [
        {
            "id": str(check.get("id", "")).strip()[:200],
            "detail": str(check.get("detail", "")).strip()[:1_000],
        }
        for check in assignment.get("repairFailedChecks", [])
        if isinstance(check, dict) and str(check.get("id", "")).strip()
    ][:32]
    receipt_refs = sorted({
        str(receipt.get("id") or receipt.get("evidenceDigest") or "").strip()
        for receipt in verified_progress
        if isinstance(receipt, dict)
        and str(receipt.get("id") or receipt.get("evidenceDigest") or "").strip()
    })[:32]
    state = {
        "boardPhase": str(assignment.get("boardBeforePhase") or "unknown")[:200],
        "boardDigest": str(assignment.get("boardBeforeDigest") or "")[:64],
        "construction": before if isinstance(before, dict) else None,
    }
    effect = {
        "boardPhase": str(assignment.get("boardAfterPhase") or "unknown")[:200],
        "boardDigest": str(assignment.get("boardAfterDigest") or "")[:64],
        "construction": after if isinstance(after, dict) else None,
        "verifiedReceiptRefs": receipt_refs,
    }
    attempted = {
        "role": str(assignment.get("role") or "unknown")[:200],
        "agentId": str(assignment.get("agentId") or "unknown")[:200],
        "repairSignals": [
            str(signal).strip()[:200]
            for signal in assignment.get("repairSignals", [])
            if str(signal).strip()
        ][:32],
        "failedChecks": failed_checks,
        "changedArtifacts": changed_artifacts,
        "repairDiagnosis": _bounded_repair_diagnosis(
            assignment.get("repairDiagnosisAfter")
        ),
        "candidateEvolution": _bounded_candidate_evolution(
            assignment.get("candidateEvolution")
        ),
        "geneExpression": _bounded_gene_expression_receipt(
            assignment.get("geneExpressionReceipt")
        ),
    }
    verification = {
        "phaseAccepted": bool(success),
        "partialProgressAccepted": bool(verified_progress) and not success,
        "completionCreditGranted": False,
        "regression": _construction_regressed(assignment),
    }
    reward = {
        "amount": round(float(reward_amount), 6),
        "reason": str(reward_reason)[:200],
        "polarity": (
            reward_polarity
            if reward_polarity in {"positive", "neutral", "negative"}
            else "negative"
        ),
    }
    attempted["procedure"] = _procedural_gene_payload(
        assignment,
        before=before,
        after=after,
        reward=reward,
    )
    body = {
        "missionId": str(assignment.get("missionId") or "")[:64],
        "cycle": int(assignment.get("cycle") or 0),
        "taskId": str(assignment.get("taskId") or "unknown")[:200],
        "stateBefore": state,
        "attemptedStrategy": attempted,
        "observedEffect": effect,
        "verification": verification,
        "reward": reward,
    }
    digest = _canonical_digest(body)
    return {
        "schema": "amos.holographic-outcome-memory",
        "version": 1,
        "id": f"outcome-{int(assignment.get('cycle') or 0):04d}-{digest[:12]}",
        **body,
        "evidenceRefs": [f"host-outcome:{digest}", *receipt_refs],
        "verifiedBy": "amos-host-outcome-boundary",
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }


def _bounded_candidate_evolution(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    seed = str(value.get("seedDigest") or "")
    mutation = str(value.get("mutationDigest") or "")
    if len(seed) != 64 or len(mutation) != 64:
        return None
    return {
        "seedDigest": seed,
        "mutationDigest": mutation,
        "promoted": value.get("promoted") is True,
        "reason": str(value.get("reason") or "unknown")[:200],
        "challengerAdvanced": value.get("challengerAdvanced") is True,
        "challengerReason": str(value.get("challengerReason") or "unknown")[:200],
        "transport": str(value.get("transport") or "unknown")[:200],
        "mutationReceiptValid": value.get("mutationReceiptValid") is True,
        "implementationChanged": value.get("implementationChanged") is True,
        "substantiveMutation": value.get("substantiveMutation") is True,
        "strategyFingerprint": (
            str(value.get("strategyFingerprint"))
            if len(str(value.get("strategyFingerprint") or "")) == 64
            else None
        ),
        "monotonic": value.get("monotonic") is True,
    }


def _bounded_gene_expression_receipt(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    if (
        value.get("schema") != "amos.gene-expression"
        or value.get("schemaVersion") != 1
        or not str(value.get("id") or "").startswith("expression_")
        or not str(value.get("receiptId") or "").strip()
        or not isinstance(value.get("context"), dict)
        or not isinstance(value.get("selections"), list)
    ):
        return None
    return {
        "schema": "amos.gene-expression",
        "schemaVersion": 1,
        "id": str(value.get("id") or "")[:200],
        "missionId": str(value.get("missionId") or "")[:200],
        "context": value["context"],
        "selections": [
            {
                "geneId": str(selection.get("geneId") or "")[:200],
                "rank": selection.get("rank"),
                "mode": str(selection.get("mode") or "guide")[:50],
                "procedureDigest": str(selection.get("procedureDigest") or "")[:64],
            }
            for selection in value.get("selections", [])[:32]
            if isinstance(selection, dict) and str(selection.get("geneId") or "").strip()
        ],
        "receiptId": str(value.get("receiptId") or "")[:200],
        "expressedAt": str(value.get("expressedAt") or "")[:100],
    }


def _procedural_gene_payload(
    assignment: dict[str, Any],
    *,
    before: Any,
    after: Any,
    reward: dict[str, Any],
) -> dict[str, Any]:
    previous = before if isinstance(before, dict) else {}
    observed = after if isinstance(after, dict) else {}
    evolution = _bounded_candidate_evolution(assignment.get("candidateEvolution")) or {}
    diagnosis = _bounded_repair_diagnosis(assignment.get("repairDiagnosisAfter")) or {}
    failed_ids = sorted({
        str(check.get("id") or "")[:200]
        for check in assignment.get("repairFailedChecks", [])
        if isinstance(check, dict) and str(check.get("id") or "").strip()
    })[:32]
    signals = sorted({
        str(signal).strip()[:200]
        for signal in assignment.get("repairSignals", [])
        if str(signal).strip()
    })[:32]
    signature_source = {
        "role": str(assignment.get("role") or "unknown")[:200],
        "signals": signals,
        "failedCheckIds": failed_ids,
        "milestones": {
            key: previous.get(key) is True
            for key in (
                "implementationSubstantive",
                "solverSucceeded",
                "selfCheckPresent",
                "candidateStatusPresent",
                "candidateAllPass",
            )
        },
    }
    return {
        "schema": "amos.holographic-procedural-gene",
        "version": 1,
        "stateSignature": _canonical_digest(signature_source),
        "incumbentDigest": evolution.get("seedDigest"),
        "mutationDigest": evolution.get("mutationDigest"),
        "preconditions": {
            "repairSignals": signals,
            "failedCheckIds": failed_ids,
            "construction": previous,
        },
        "operation": {
            "hypothesis": str(diagnosis.get("hypothesis") or "")[:2_000] or None,
            "nextAction": str(diagnosis.get("nextAction") or "")[:2_000] or None,
            "transport": evolution.get("transport"),
        },
        "expectedEffects": {
            "resolveFailedCheckIds": failed_ids,
            "preserveVerifiedMilestones": True,
        },
        "observedEffects": {
            "construction": observed,
            "promoted": evolution.get("promoted") is True,
            "challengerAdvanced": evolution.get("challengerAdvanced") is True,
            "monotonic": evolution.get("monotonic") is True,
        },
        "reward": reward,
        "portability": {
            "scope": "matching-evidence-signature",
            "role": str(assignment.get("role") or "unknown")[:200],
            "taskSpecificIdentifiersExcluded": True,
        },
        "authority": {
            "retrievalOnly": True,
            "grantsCompletionCredit": False,
        },
    }


def _outcome_world_entry(memory: dict[str, Any]) -> dict[str, Any] | None:
    if (
        not isinstance(memory, dict)
        or memory.get("schema") != "amos.holographic-outcome-memory"
        or memory.get("verifiedBy") != "amos-host-outcome-boundary"
        or memory.get("authority", {}).get("hostObservedOnly") is not True
        or memory.get("authority", {}).get("grantsCompletionCredit") is not False
        or not isinstance(memory.get("evidenceRefs"), list)
        or not memory["evidenceRefs"]
    ):
        return None
    attempted = memory.get("attemptedStrategy") or {}
    before = (memory.get("stateBefore") or {}).get("construction") or {}
    after = (memory.get("observedEffect") or {}).get("construction") or {}
    reward = memory.get("reward") or {}
    verification = memory.get("verification") or {}
    diagnosis = attempted.get("repairDiagnosis") or {}
    failed_ids = [
        str(check.get("id", "")).strip()
        for check in attempted.get("failedChecks", [])
        if isinstance(check, dict) and str(check.get("id", "")).strip()
    ]
    repair_signals = [
        str(signal).strip()
        for signal in attempted.get("repairSignals", [])
        if str(signal).strip()
    ]
    text = (
        f"Host-observed {memory.get('taskId', 'task')} outcome for "
        f"{attempted.get('role', 'unknown')} agent {attempted.get('agentId', 'unknown')}: "
        f"repair signals={repair_signals or ['none']}; failed checks={failed_ids or ['none']}; "
        f"learned hypothesis={diagnosis.get('hypothesis', 'none')}; "
        f"proposed next action={diagnosis.get('nextAction', 'none')}; "
        f"construction failed checks changed from {int(before.get('failedCheckCount') or 0)} "
        f"to {int(after.get('failedCheckCount') or 0)}; "
        f"candidate all-pass changed from {before.get('candidateAllPass') is True} "
        f"to {after.get('candidateAllPass') is True}; "
        f"phase accepted={verification.get('phaseAccepted') is True}; "
        f"partial progress accepted={verification.get('partialProgressAccepted') is True}; "
        f"regression={verification.get('regression') is True}; "
        f"reward={reward.get('amount', 0)} ({reward.get('polarity', 'negative')}, "
        f"{reward.get('reason', 'unknown')}). Reuse only when exact current evidence matches."
    )
    return {
        "id": str(memory.get("id") or "")[:200],
        "kind": f"outcome-{_safe_id(str(attempted.get('role') or 'unknown'))}",
        "text": text[:4_000],
        "evidenceRefs": [str(ref)[:1_000] for ref in memory["evidenceRefs"][:32]],
        "confidence": 1,
        "verifiedBy": "amos-host-outcome-boundary",
    }


def _bounded_repair_diagnosis(value: Any) -> dict[str, Any] | None:
    if (
        not isinstance(value, dict)
        or value.get("schema") != "amos.swarm-repair-diagnosis"
        or value.get("version") != 1
        or value.get("authority", {}).get("modelHypothesisOnly") is not True
        or value.get("authority", {}).get("grantsCompletionCredit") is not False
    ):
        return None
    evidence_digest = str(value.get("evidenceDigest") or "")
    if len(evidence_digest) != 64 or any(character not in "0123456789abcdef" for character in evidence_digest):
        return None
    diagnosis = {
        "schema": "amos.swarm-repair-diagnosis",
        "version": 1,
        "evidenceDigest": evidence_digest,
        "observation": str(value.get("observation") or "").strip()[:4_000],
        "hypothesis": str(value.get("hypothesis") or "").strip()[:4_000],
        "nextAction": str(value.get("nextAction") or "").strip()[:4_000],
        "failedCheckIds": [
            str(check_id).strip()[:200]
            for check_id in value.get("failedCheckIds", [])
            if isinstance(check_id, str) and check_id.strip()
        ][:64],
        "supportingMetrics": {
            str(key)[:200]: metric if not isinstance(metric, str) else metric[:1_000]
            for key, metric in (value.get("supportingMetrics") or {}).items()
            if isinstance(key, str)
            and isinstance(metric, (str, bool, int, float, type(None)))
        } if isinstance(value.get("supportingMetrics") or {}, dict) else {},
        "authority": {
            "modelHypothesisOnly": True,
            "grantsCompletionCredit": False,
        },
    }
    if not all(diagnosis[field] for field in ("observation", "hypothesis", "nextAction")):
        return None
    if not diagnosis["failedCheckIds"]:
        return None
    return diagnosis


def _load_persisted_ecology_state(
    store_path: str,
    *,
    task_name: str | None,
) -> dict[str, Any] | None:
    """Load the newest rights-eligible ecology as decayed organism heredity."""
    root = Path(store_path).resolve()
    episodes_directory = root / "episodes"
    if not episodes_directory.is_dir():
        return None
    eligible: list[tuple[str, str, dict[str, Any]]] = []
    for ref_path in sorted(episodes_directory.glob("*.ref"))[:2_048]:
        episode_digest = ref_path.read_text(encoding="utf-8").strip()
        if len(episode_digest) != 64:
            continue
        episode = _read_bounded_json_file(
            root / "objects" / episode_digest[:2] / f"{episode_digest}.json",
            root=root,
            maximum_bytes=8_000_000,
        )
        if not isinstance(episode, dict) or (
            episode.get("schema") != "amos.swarm-learning-episode"
            or episode.get("version") != 1
            or episode.get("digest") != episode_digest
            or episode.get("partition") in {"sealed", "canary", "validation"}
            or "research" not in (episode.get("dataPolicy") or {}).get("permittedUses", [])
        ):
            continue
        if task_name and str((episode.get("task") or {}).get("name") or "") != task_name:
            continue
        ecology_ref = episode.get("ecology")
        if not isinstance(ecology_ref, dict):
            continue
        ecology_digest = str(ecology_ref.get("digest") or "")
        ecology = _read_verified_store_blob(root, ecology_digest, maximum_bytes=16_000_000)
        if (
            not isinstance(ecology, dict)
            or ecology.get("schema") != "amos.holographic-swarm-harbor-run"
            or not isinstance(ecology.get("agents"), list)
        ):
            continue
        eligible.append((
            str((episode.get("execution") or {}).get("finishedAt") or ""),
            episode_digest,
            {
                "sourceEpisodeDigest": episode_digest,
                "sourceEcologyDigest": ecology_digest,
                "sourceFinishedAt": str((episode.get("execution") or {}).get("finishedAt") or "")[:100],
                "agents": ecology["agents"],
            },
        ))
    if not eligible:
        return None
    eligible.sort(key=lambda item: (item[0], item[1]), reverse=True)
    source = eligible[0][2]
    return {
        "sourceEpisodeDigest": source["sourceEpisodeDigest"],
        "sourceEcologyDigest": source["sourceEcologyDigest"],
        "sourceFinishedAt": source["sourceFinishedAt"],
        "agents": [
            {
                "id": str(agent.get("id") or "")[:200],
                "energy": agent.get("energy"),
                "reputation": agent.get("reputation"),
                "experiences": agent.get("experiences"),
                "completedTasks": agent.get("completedTasks"),
                "failedTasks": agent.get("failedTasks"),
            }
            for agent in source["agents"][:64]
            if isinstance(agent, dict) and str(agent.get("id") or "").strip()
        ],
    }


def _persisted_agent_state(
    ecology: dict[str, Any] | None,
    *,
    agent_id: str,
    initial_energy: float,
) -> dict[str, Any]:
    source = next((
        agent for agent in (ecology or {}).get("agents", [])
        if isinstance(agent, dict) and agent.get("id") == agent_id
    ), None)
    if source is None:
        return {
            "inherited": False,
            "energy": initial_energy,
            "reputation": 0.5,
            "experiences": [],
            "completedTasks": 0,
            "failedTasks": 0,
        }
    try:
        old_energy = float(source.get("energy"))
    except (TypeError, ValueError):
        old_energy = initial_energy
    try:
        old_reputation = float(source.get("reputation"))
    except (TypeError, ValueError):
        old_reputation = 0.5
    # Carry learned differences forward while decaying toward a neutral prior.
    # This prevents one task family from permanently starving an agent.
    energy = initial_energy + ((old_energy - initial_energy) * 0.5)
    reputation = 0.5 + ((old_reputation - 0.5) * 0.75)
    experiences = sorted({
        str(value).strip()[:200]
        for value in source.get("experiences", [])
        if isinstance(value, str) and value.strip()
    })[:128] if isinstance(source.get("experiences"), list) else []
    try:
        completed_tasks = int(source.get("completedTasks") or 0)
    except (TypeError, ValueError):
        completed_tasks = 0
    try:
        failed_tasks = int(source.get("failedTasks") or 0)
    except (TypeError, ValueError):
        failed_tasks = 0
    return {
        "inherited": True,
        "energy": round(max(initial_energy * 0.25, min(initial_energy * 2, energy)), 6),
        "reputation": round(max(0.05, min(0.95, reputation)), 6),
        "experiences": experiences,
        "completedTasks": max(0, min(10_000, completed_tasks)),
        "failedTasks": max(0, min(10_000, failed_tasks)),
    }


def _load_strategy_genes(
    store_path: str,
    *,
    task_name: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    """Load bounded, research-permitted experience from immutable replay jobs.

    The loader deliberately ignores sealed/canary episodes, raw trajectories,
    and model prose. Only host-bound outcome memories and typed failure
    capsules are eligible for the organism's learned world model.
    """

    root = Path(store_path).resolve()
    episodes_directory = root / "episodes"
    if not episodes_directory.is_dir():
        return []
    maximum = max(1, min(int(limit), 512))
    episodes: list[tuple[str, dict[str, Any]]] = []
    for ref_path in sorted(episodes_directory.glob("*.ref"))[:2_048]:
        digest = ref_path.read_text(encoding="utf-8").strip()
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            continue
        object_path = root / "objects" / digest[:2] / f"{digest}.json"
        episode = _read_bounded_json_file(object_path, root=root, maximum_bytes=8_000_000)
        if not isinstance(episode, dict):
            continue
        if (
            episode.get("schema") != "amos.swarm-learning-episode"
            or episode.get("version") != 1
            or episode.get("digest") != digest
            or episode.get("partition") in {"sealed", "canary"}
            or "research" not in (episode.get("dataPolicy") or {}).get("permittedUses", [])
        ):
            continue
        observed_task = str((episode.get("task") or {}).get("name") or "")
        if task_name and observed_task != task_name:
            continue
        episodes.append((digest, episode))
    episodes.sort(
        key=lambda item: (
            str((item[1].get("execution") or {}).get("finishedAt") or ""),
            item[0],
        ),
        reverse=True,
    )
    genes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for episode_digest, episode in episodes:
        ecology_ref = episode.get("ecology")
        ecology = None
        if isinstance(ecology_ref, dict):
            ecology = _read_verified_store_blob(
                root,
                str(ecology_ref.get("digest") or ""),
                maximum_bytes=16_000_000,
            )
        if isinstance(ecology, dict):
            for memory in reversed(ecology.get("outcomeMemories") or []):
                gene = _strategy_gene_from_outcome_memory(
                    memory,
                    episode=episode,
                    episode_digest=episode_digest,
                    ecology_digest=str(ecology_ref.get("digest") or ""),
                )
                if gene is None or gene["id"] in seen:
                    continue
                seen.add(gene["id"])
                genes.append(gene)
                if len(genes) >= maximum:
                    return _consolidate_strategy_genes(genes, maximum=maximum)
        for reference in episode.get("traces") or []:
            if not isinstance(reference, dict) or reference.get("kind") != "failure-capsule":
                continue
            capsule = _read_verified_store_blob(
                root,
                str(reference.get("digest") or ""),
                maximum_bytes=4_000_000,
            )
            gene = _strategy_gene_from_failure_capsule(
                capsule,
                episode=episode,
                episode_digest=episode_digest,
            )
            if gene is None or gene["id"] in seen:
                continue
            seen.add(gene["id"])
            genes.append(gene)
            if len(genes) >= maximum:
                return _consolidate_strategy_genes(genes, maximum=maximum)
    return _consolidate_strategy_genes(genes, maximum=maximum)


def _consolidate_strategy_genes(
    genes: list[dict[str, Any]],
    *,
    maximum: int,
) -> list[dict[str, Any]]:
    """Consolidate repeated procedures into bounded inherited strategy weights."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for gene in genes:
        attempted = gene.get("attemptedStrategy") or {}
        procedure = gene.get("procedure") or attempted.get("procedure") or {}
        signature = str(procedure.get("stateSignature") or "")
        operation = procedure.get("operation") or {}
        key = _canonical_digest({
            "stateSignature": signature,
            "role": attempted.get("role"),
            "hypothesis": operation.get("hypothesis"),
            "nextAction": operation.get("nextAction"),
        })
        groups.setdefault(key, []).append(gene)
    consolidated = []
    for key, members in groups.items():
        representative = json.loads(json.dumps(members[0]))
        reward_total = sum(float((member.get("reward") or {}).get("amount") or 0) for member in members)
        promotions = sum(
            int(((member.get("procedure") or (member.get("attemptedStrategy") or {}).get("procedure") or {})
                 .get("observedEffects") or {}).get("promoted") is True)
            for member in members
        )
        regressions = sum(int((member.get("verification") or {}).get("regression") is True) for member in members)
        weight = max(0.05, min(8.0, 1 + reward_total + promotions - regressions))
        representative["organismWeight"] = round(weight, 6)
        representative["support"] = {
            "occurrences": len(members),
            "rewardTotal": round(reward_total, 6),
            "promotions": promotions,
            "regressions": regressions,
            "consolidationDigest": key,
        }
        consolidated.append(representative)
    return sorted(
        consolidated,
        key=lambda gene: (
            -float(gene.get("organismWeight") or 0),
            -int((gene.get("support") or {}).get("occurrences") or 0),
            str(gene.get("id") or ""),
        ),
    )[:maximum]


def _read_bounded_json_file(
    path: Path,
    *,
    root: Path,
    maximum_bytes: int,
) -> Any:
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        return None
    if resolved.stat().st_size > maximum_bytes:
        return None
    return json.loads(resolved.read_text(encoding="utf-8"))


def _read_verified_store_blob(root: Path, digest: str, *, maximum_bytes: int) -> Any:
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        return None
    path = root / "blobs" / digest[:2] / f"{digest}.blob"
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        return None
    if resolved.stat().st_size > maximum_bytes:
        return None
    contents = resolved.read_bytes()
    if hashlib.sha256(contents).hexdigest() != digest:
        return None
    try:
        return json.loads(contents)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def _strategy_gene_from_outcome_memory(
    memory: Any,
    *,
    episode: dict[str, Any],
    episode_digest: str,
    ecology_digest: str,
) -> dict[str, Any] | None:
    if _outcome_world_entry(memory) is None:
        return None
    assert isinstance(memory, dict)
    source_id = _safe_id(str(memory.get("id") or "outcome"))
    task = episode.get("task") or {}
    body = {
        "sourceEpisodeDigest": episode_digest,
        "sourceEcologyDigest": ecology_digest,
        "sourceFinishedAt": str((episode.get("execution") or {}).get("finishedAt") or "")[:100],
        "task": {
            "source": str(task.get("source") or "unknown")[:500],
            "name": str(task.get("name") or "unknown")[:500],
            "checksum": str(task.get("checksum") or "")[:64] or None,
        },
        "stateBefore": memory.get("stateBefore"),
        "attemptedStrategy": memory.get("attemptedStrategy"),
        "procedure": (memory.get("attemptedStrategy") or {}).get("procedure"),
        "observedEffect": memory.get("observedEffect"),
        "verification": memory.get("verification"),
        "reward": memory.get("reward"),
    }
    digest = _canonical_digest(body)
    return {
        "schema": "amos.holographic-strategy-gene",
        "version": 1,
        "id": f"gene-{episode_digest[:12]}-{source_id[:120]}-{digest[:8]}",
        **body,
        "evidenceRefs": [
            f"replay-episode:{episode_digest}",
            f"replay-ecology:{ecology_digest}",
        ],
        "verifiedBy": "amos-replay-store-host-outcome",
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }


def _strategy_gene_from_failure_capsule(
    capsule: Any,
    *,
    episode: dict[str, Any],
    episode_digest: str,
) -> dict[str, Any] | None:
    if (
        not isinstance(capsule, dict)
        or capsule.get("schema") != "amos.swarm-failure-capsule"
        or capsule.get("version") != 1
        or capsule.get("safeguards", {}).get("authorityGrantedByHrr") is not False
    ):
        return None
    failed_checks = [
        {
            "id": str(check.get("id") or "")[:200],
            "detail": str(check.get("detail") or "")[:1_000],
        }
        for check in capsule.get("failedChecks") or []
        if isinstance(check, dict) and str(check.get("id") or "").strip()
    ][:64]
    signals = [
        str(signal)[:200]
        for signal in capsule.get("repairSignals") or []
        if isinstance(signal, str) and signal.strip()
    ][:64]
    if not failed_checks and not signals:
        return None
    task = episode.get("task") or {}
    body = {
        "sourceEpisodeDigest": episode_digest,
        "sourceEcologyDigest": None,
        "sourceFinishedAt": str((episode.get("execution") or {}).get("finishedAt") or "")[:100],
        "task": {
            "source": str(task.get("source") or "unknown")[:500],
            "name": str(task.get("name") or "unknown")[:500],
            "checksum": str(task.get("checksum") or "")[:64] or None,
        },
        "stateBefore": {"failure": capsule.get("failure"), "finalState": capsule.get("finalState")},
        "attemptedStrategy": {
            "role": "cross-run-failure-repair",
            "agentId": "organism",
            "repairSignals": signals,
            "failedChecks": failed_checks,
            "changedArtifacts": [],
            "repairDiagnosis": None,
            "procedure": {
                "schema": "amos.holographic-procedural-gene",
                "version": 1,
                "stateSignature": _canonical_digest({
                    "signals": signals,
                    "failedCheckIds": [check["id"] for check in failed_checks],
                }),
                "incumbentDigest": None,
                "mutationDigest": None,
                "preconditions": {
                    "repairSignals": signals,
                    "failedCheckIds": [check["id"] for check in failed_checks],
                },
                "operation": {"hypothesis": None, "nextAction": None, "transport": None},
                "expectedEffects": {
                    "resolveFailedCheckIds": [check["id"] for check in failed_checks],
                    "preserveVerifiedMilestones": True,
                },
                "observedEffects": {"promoted": False, "monotonic": True},
                "portability": {
                    "scope": "matching-evidence-signature",
                    "role": "cross-run-failure-repair",
                    "taskSpecificIdentifiersExcluded": True,
                },
                "authority": {"retrievalOnly": True, "grantsCompletionCredit": False},
            },
        },
        "observedEffect": {"candidate": capsule.get("candidate")},
        "verification": {
            "phaseAccepted": False,
            "partialProgressAccepted": False,
            "completionCreditGranted": False,
            "regression": False,
        },
        "reward": {
            "amount": 0,
            "reason": "cross-run-failure-capsule",
            "polarity": "negative",
        },
    }
    digest = _canonical_digest(body)
    return {
        "schema": "amos.holographic-strategy-gene",
        "version": 1,
        "id": f"gene-{episode_digest[:12]}-failure-{digest[:12]}",
        **body,
        "evidenceRefs": [f"replay-episode:{episode_digest}"],
        "verifiedBy": "amos-replay-store-host-outcome",
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }


def _select_strategy_gene_expression(
    genes: list[dict[str, Any]],
    *,
    mission_id: str,
    cycle: int,
    task: dict[str, Any],
    role: str,
    repair_context: dict[str, Any] | None,
    limit: int = 8,
) -> dict[str, Any]:
    """Select learned procedures for this exact lease and attest prompt expression.

    Replay memory is allowed to shape research behavior without an approval
    round-trip. It still cannot grant authority, promotion, or completion. The
    host, rather than the model, records which genes were actually compiled
    into the specialist's context so later credit and blame are attributable.
    """

    current_signals = {
        _safe_id(str(value))
        for value in (repair_context or {}).get("repairSignals", [])
        if isinstance(value, str) and value.strip()
    }
    current_checks = {
        _safe_id(str(check.get("id") or ""))
        for check in (repair_context or {}).get("failedChecks", [])
        if isinstance(check, dict) and str(check.get("id") or "").strip()
    }
    repair_roles = {"solver-builder", "repairer"}
    ranked: list[tuple[tuple[Any, ...], str, dict[str, Any], dict[str, Any]]] = []
    for gene in genes:
        if _strategy_gene_world_entry(gene) is None:
            continue
        attempted = gene.get("attemptedStrategy") or {}
        procedure = gene.get("procedure") or attempted.get("procedure") or {}
        preconditions = procedure.get("preconditions") or {}
        gene_role = str(attempted.get("role") or "unknown")
        gene_signals = {
            _safe_id(str(value))
            for value in preconditions.get("repairSignals", attempted.get("repairSignals", []))
            if isinstance(value, str) and value.strip()
        }
        gene_checks = {
            _safe_id(str(value))
            for value in preconditions.get(
                "failedCheckIds",
                [
                    check.get("id")
                    for check in attempted.get("failedChecks", [])
                    if isinstance(check, dict)
                ],
            )
            if isinstance(value, str) and value.strip()
        }
        role_match = gene_role == role
        repair_role_match = role in repair_roles and gene_role in {
            *repair_roles,
            "cross-run-failure-repair",
        }
        signal_overlap = current_signals & gene_signals
        check_overlap = current_checks & gene_checks
        if repair_context is not None:
            has_explicit_preconditions = bool(gene_signals or gene_checks)
            if has_explicit_preconditions and not (signal_overlap or check_overlap):
                continue
            if not has_explicit_preconditions and not repair_role_match:
                continue
        elif not role_match:
            continue
        polarity = str((gene.get("reward") or {}).get("polarity") or "neutral")
        expression_mode = "avoid" if polarity == "negative" else "guide"
        support = gene.get("support") or {}
        occurrences = max(1, int(support.get("occurrences") or 1))
        failures = max(0, int(support.get("regressions") or 0))
        if expression_mode == "avoid" and failures == 0:
            failures = 1
        passes = max(0, int(support.get("promotions") or 0))
        if expression_mode == "guide" and passes == 0:
            passes = 1
        evidence_class = 2 if passes > 0 else 0 if failures > 0 else 1
        mean_quality = max(
            0.0,
            min(1.0, float(support.get("rewardTotal") or 0) / occurrences),
        )
        specificity = (
            int(role_match or repair_role_match)
            + len(signal_overlap)
            + len(check_overlap)
        )
        vested_fitness = max(0.0, float(support.get("rewardTotal") or 0))
        uncredited = max(0, occurrences - passes - failures)
        rank = {
            "evidenceClass": evidence_class,
            "meanVerifiedQuality": round(mean_quality, 6),
            "verifiedPasses": passes,
            "specificity": specificity,
            "vestedFitness": round(vested_fitness, 6),
            "verifiedFailures": failures,
            "uncreditedAttempts": uncredited,
        }
        rank_key = (
            -evidence_class,
            -mean_quality,
            -passes,
            -specificity,
            -vested_fitness,
            failures,
            uncredited,
        )
        match = {
            "rank": rank,
            "mode": expression_mode,
        }
        ranked.append((rank_key, str(gene.get("id") or ""), gene, match))
    selected = sorted(ranked, key=lambda item: (*item[0], item[1]))[: max(0, min(32, int(limit)))]
    selected_genes = [item[2] for item in selected]
    selections = [
        {
            "geneId": item[1],
            **item[3],
            "procedureDigest": _canonical_digest(
                item[2].get("procedure")
                or (item[2].get("attemptedStrategy") or {}).get("procedure")
                or {}
            ),
        }
        for item in selected
    ]
    receipt_id = "research-prompt-compiler:" + _canonical_digest({
        "missionId": mission_id,
        "cycle": cycle,
        "taskId": task.get("id"),
        "role": role,
        "selections": selections,
    })[:24]
    body = {
        "schema": "amos.gene-expression",
        "schemaVersion": 1,
        "missionId": str(mission_id)[:200],
        "context": {
            "missionId": str(mission_id)[:200],
            "role": str(role)[:200],
            "phase": str(task.get("phase") or ("repair" if repair_context else role))[:200],
            "artifactClasses": ["candidate-mutation"],
            "failureModes": sorted({*current_signals, *current_checks}),
            "toolFamilies": [],
        },
        "selections": selections,
        "receiptId": receipt_id,
        "expressedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    receipt = {**body, "id": f"expression_{_canonical_digest(body)[:24]}"}
    return {"selectedGenes": selected_genes, "receipt": receipt}


def _strategy_gene_world_entry(gene: Any) -> dict[str, Any] | None:
    if (
        not isinstance(gene, dict)
        or gene.get("schema") != "amos.holographic-strategy-gene"
        or gene.get("version") != 1
        or gene.get("verifiedBy") != "amos-replay-store-host-outcome"
        or gene.get("authority", {}).get("hostObservedOnly") is not True
        or gene.get("authority", {}).get("grantsCompletionCredit") is not False
        or not isinstance(gene.get("evidenceRefs"), list)
        or not gene["evidenceRefs"]
    ):
        return None
    attempted = gene.get("attemptedStrategy") or {}
    procedure = gene.get("procedure") or attempted.get("procedure") or {}
    before = (gene.get("stateBefore") or {}).get("construction") or {}
    after = (gene.get("observedEffect") or {}).get("construction") or {}
    reward = gene.get("reward") or {}
    diagnosis = attempted.get("repairDiagnosis") or {}
    failed_ids = [
        str(check.get("id") or "")
        for check in attempted.get("failedChecks") or []
        if isinstance(check, dict) and str(check.get("id") or "").strip()
    ][:32]
    signals = [str(value) for value in attempted.get("repairSignals") or []][:32]
    operation = procedure.get("operation") or {}
    effects = procedure.get("observedEffects") or {}
    text = (
        f"Cross-run learned world experience; state signature="
        f"{procedure.get('stateSignature', 'unknown')}; role={attempted.get('role', 'unknown')}; "
        f"signals={signals or ['none']}; failed checks={failed_ids or ['none']}; "
        f"hypothesis={operation.get('hypothesis') or diagnosis.get('hypothesis', 'none')}; "
        f"next action={operation.get('nextAction') or diagnosis.get('nextAction', 'none')}; "
        f"mutation transport={operation.get('transport', 'unknown')}; "
        f"promoted={effects.get('promoted') is True}; "
        f"failed-check count {int(before.get('failedCheckCount') or 0)}->"
        f"{int(after.get('failedCheckCount') or 0)}; all-pass "
        f"{before.get('candidateAllPass') is True}->{after.get('candidateAllPass') is True}; "
        f"reward={reward.get('amount', 0)} ({reward.get('polarity', 'negative')}); "
        f"inherited strategy weight={gene.get('organismWeight', 1)} with "
        f"{(gene.get('support') or {}).get('occurrences', 1)} observation(s). "
        "This procedure is learned prior experience, not current-state authority; reuse only after "
        "matching the exact current evidence signature."
    )
    return {
        "id": str(gene.get("id") or "")[:200],
        "kind": f"strategy-gene-{_safe_id(str(attempted.get('role') or 'unknown'))}",
        "text": text[:6_000],
        "evidenceRefs": [str(ref)[:1_000] for ref in gene["evidenceRefs"][:32]],
        "confidence": round(min(1, 0.5 + (float(gene.get("organismWeight") or 1) / 16)), 6),
        "verifiedBy": "amos-replay-store-host-outcome",
    }


def _verified_board_advancement(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if before is None or after is None or _canonical_digest(before) == _canonical_digest(after):
        return []
    receipts: list[dict[str, Any]] = []
    before_phase = str(before.get("phase", ""))
    after_phase = str(after.get("phase", ""))
    # Retry checkpoints are host-created scheduling markers, not evidence that
    # the specialist produced an accepted deliverable. They remain visible in
    # the board and ecology trace but can never mint organism reward. A new
    # host-harvested artifact below may still earn partial credit independently.
    if before_phase != after_phase and not _is_retry_checkpoint_phase(after_phase):
        receipts.append(
            {
                "kind": "board-phase",
                "from": before_phase,
                "to": after_phase,
                "boardDigest": _canonical_digest(after),
                "verifiedBy": "amos-host-phase-boundary",
            }
        )
    previous_artifacts = {
        (entry.get("id"), entry.get("sha256"))
        for entry in before.get("artifacts", [])
        if _is_host_artifact_receipt(entry)
    }
    for entry in after.get("artifacts", []):
        key = (entry.get("id"), entry.get("sha256"))
        if _is_host_artifact_receipt(entry) and key not in previous_artifacts:
            receipts.append(
                {
                    "kind": "artifact-receipt",
                    "id": entry["id"],
                    "path": entry["path"],
                    "sha256": entry["sha256"],
                    "verifiedBy": "amos-host-artifact-harvest",
                }
            )
    return receipts


def _is_retry_checkpoint_phase(phase: str) -> bool:
    return phase.startswith(
        (
            "source-data-checkpoint-",
            "state-compilation-checkpoint-",
            "construction-checkpoint-",
        )
    )


async def _workspace_manifest(environment: BaseEnvironment) -> dict[str, dict[str, Any]]:
    """Hash bounded swarm artifacts without trusting model-authored receipts."""

    program = f"""
import hashlib
import json
import pathlib

root = pathlib.Path({SWARM_DIR!r})
excluded = {{pathlib.Path({BOARD_PATH!r}), root / 'compiled-state-feedback.json'}}
manifest = {{}}
if root.is_dir():
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path in excluded or path.name.startswith('_'):
            continue
        try:
            size = path.stat().st_size
            if size > 8_000_000:
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        manifest[str(path)] = {{'sha256': digest, 'bytes': size}}
print(json.dumps(manifest, sort_keys=True, separators=(',', ':')))
"""
    result = await environment.exec(command=f"python3 -c {shlex.quote(program)}")
    if result.return_code != 0 or not result.stdout:
        return {}
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


async def _unverified_board_checkpoint(environment: BaseEnvironment) -> dict[str, Any] | None:
    """Observe the in-flight board without normalizing, accepting, or writing it."""

    result = await environment.exec(command=f"cat {shlex.quote(BOARD_PATH)}")
    if result.return_code != 0 or not result.stdout:
        return None
    try:
        board = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"validJson": False}
    if not isinstance(board, dict):
        return {"validJson": True, "object": False}
    return {
        "validJson": True,
        "object": True,
        "claimedPhase": board.get("phase"),
        "observedDigest": _canonical_digest(board),
        "verified": False,
    }


def _manifest_changes(
    before: dict[str, dict[str, Any]],
    after: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    changes = []
    for path, receipt in sorted(after.items()):
        if before.get(path) == receipt:
            continue
        if not isinstance(receipt, dict):
            continue
        digest = receipt.get("sha256")
        size = receipt.get("bytes")
        if not isinstance(digest, str) or len(digest) != 64 or not isinstance(size, int):
            continue
        changes.append({"path": path, "sha256": digest, "bytes": size})
    return changes


def _opportunity_objective(role: str) -> str:
    return {
        "interface-scanner": "Capture the authoritative interfaces and schemas as durable evidence.",
        "data-scanner": "Extract all task-relevant source state once into compact typed artifacts.",
        "state-compiler": "Compile source evidence into complete computable constraints and mission state.",
        "solver-builder": "Construct and self-check the strongest concrete executable solution.",
        "verifier": "Independently falsify or verify the candidate against every criterion.",
        "repairer": "Repair only the verifier-cited gaps while preserving verified work.",
        "executor": "Apply the verified plan exactly once and preserve audit receipts.",
        "integrator": "Recombine verified distributed work into the evidenced final outcome.",
    }[role]


def _repair_aware_task_tags(
    role: str,
    *,
    repair_context: dict[str, Any] | None,
) -> list[str]:
    """Advertise the capabilities evidenced by the repair state.

    This does not select an agent or encode a domain solution. It gives the
    organism's bidder an exact typed signal so energy from earlier unrelated
    work cannot masquerade as competence for the current opportunity.
    """
    tags = [*_ROLE_TAGS[role]]
    if repair_context is None:
        return tags
    tags.extend(["evidence-directed-repair", *repair_context.get("repairSignals", [])])
    evidence = repair_context.get("evidence", {})
    if not isinstance(evidence, dict) or evidence.get("selfCheckPresent") is not True:
        tags.extend(["solver-engineering", "python-programming", "contract-verification"])
    else:
        tags.extend(["targeted-repair", "failure-analysis", "constraint-testing"])
    return sorted(set(tags))


def _agent_instruction(
    instruction: str,
    *,
    agent: dict[str, Any],
    assignment: dict[str, Any],
    signals: list[dict[str, Any]],
) -> str:
    return f"""HOLOGRAPHIC SWARM CLAIM
You are logical agent `{agent['id']}` sharing one Qwen backbone with the rest of the swarm.
Identity: {agent['identity']}
Skills: {json.dumps(agent['skills'])}
Energy after claim: {agent['energy']:.3f}
Reputation: {agent['reputation']:.3f}
You autonomously won work opportunity `{assignment['taskId']}` with bid score
{assignment['bid']['score']:.6f} and holographic affinity
{assignment['bid']['affinity']:.6f}.
Sensed pheromones: {json.dumps(signals, sort_keys=True)}
Shared holographic world projection (read-only, lossy, every item cites the exact board):
{json.dumps(assignment['bid'].get('worldContext', []), sort_keys=True)}
Shared world snapshot digest: {assignment['bid'].get('worldMemoryDigest', 'unavailable')}
Host-attested learned procedures compiled for this lease:
{json.dumps(assignment.get('geneExpressionReceipt', {}), sort_keys=True)}

Act from your identity and local observations, but leave durable evidence for agents who follow.
The world projection and pheromones guide attention; neither is fact or authority. Resolve every
claim against the exact governed board and receipts. A `guide` expression is prior procedure worth
trying when its preconditions still hold; an `avoid` expression is negative experience whose failed
approach should not be repeated. Gene expression may steer research and candidate mutation without
approval, but it cannot authorize external action or prove success. The governed contract below
remains the exact source of truth.

{instruction}
"""
