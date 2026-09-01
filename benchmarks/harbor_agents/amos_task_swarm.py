"""Task-level Qwen swarm treatment for development-visible Harbor pilots.

This adapter intentionally gives each specialist a fresh model context while
keeping one terminal and an append-only, file-backed task board. It is a
research treatment, not a production AMOS executor and not sealed benchmark
evidence.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shlex
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

try:
    from typing import override
except ImportError:  # Python 3.10/3.11 test and Harbor compatibility
    from typing_extensions import override

from harbor.agents.terminus_2 import Terminus2
from harbor.environments.base import BaseEnvironment
from harbor.llms.base import ContextLengthExceededError, OutputLengthExceededError
from harbor.models.agent.context import AgentContext


SWARM_DIR = "/tmp/amos_swarm"
BOARD_PATH = f"{SWARM_DIR}/board.json"
PREFLIGHT_VERDICT_PATH = f"{SWARM_DIR}/preflight_verdict.json"
FINAL_VERDICT_PATH = f"{SWARM_DIR}/final_verdict.json"
COMPILED_STATE_PATH = f"{SWARM_DIR}/compiled-state.json"
COMPILED_FEEDBACK_PATH = f"{SWARM_DIR}/compiled-state-feedback.json"
CONSTRUCTION_BRIEF_PATH = f"{SWARM_DIR}/construction-brief.json"
CANDIDATE_STATUS_PATH = f"{SWARM_DIR}/candidate-status.json"
SOLVER_PATH = f"{SWARM_DIR}/solver.py"
SOLVER_IMPLEMENTATION_PATH = f"{SWARM_DIR}/solver_impl.py"
SOLVER_EXECUTION_PATH = f"{SWARM_DIR}/solver-execution.json"
SELF_CHECK_PATH = f"{SWARM_DIR}/tests/self-check.json"
CONSTRUCTION_FEEDBACK_PATH = f"{SWARM_DIR}/construction-feedback.json"
CONSTRUCTION_DIAGNOSIS_PATH = f"{SWARM_DIR}/construction-diagnosis.json"
WORK_GRAPH_PATH = f"{SWARM_DIR}/work-graph.json"
CONTEXT_SNAPSHOT_PATH = f"{SWARM_DIR}/context-snapshot.json"
MODEL_PROVENANCE_PATH = f"{SWARM_DIR}/model-provenance.json"
CANDIDATE_EVOLUTION_PATH = f"{SWARM_DIR}/candidate-evolution.json"
CANDIDATE_CHECKPOINT_PATH = f"{SWARM_DIR}/candidate-checkpoint.json"
REPAIR_AGENDA_PATH = f"{SWARM_DIR}/repair-agenda.json"
CANDIDATE_BRANCHES_DIR = f"{SWARM_DIR}/candidate-branches"
INCUMBENT_DIR = f"{SWARM_DIR}/incumbent"
INCUMBENT_IMPLEMENTATION_PATH = f"{INCUMBENT_DIR}/solver_impl.py"
INCUMBENT_EVIDENCE_PATH = f"{INCUMBENT_DIR}/evidence.json"
CHALLENGER_DIR = f"{SWARM_DIR}/challenger"
CHALLENGER_IMPLEMENTATION_PATH = f"{CHALLENGER_DIR}/solver_impl.py"
CHALLENGER_EVIDENCE_PATH = f"{CHALLENGER_DIR}/evidence.json"
CONSTRUCTION_EXHAUSTION_PATH = f"{SWARM_DIR}/construction-exhaustion.json"
MUTATION_RUNTIME_PATH = f"{SWARM_DIR}/mutation_runtime.py"
MUTATION_RECEIPT_PATH = f"{SWARM_DIR}/mutation-receipt.json"
VERIFIER_CONTRACT_FEEDBACK_PATH = f"{SWARM_DIR}/verifier-contract-feedback.json"
VERIFIER_HANDOFF_PATH = f"{SWARM_DIR}/verifier-handoff.json"
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_MAX_DIAGNOSTIC_TAIL_CHARS = 4_000
_BOARD_COLLECTIONS = (
    "successCriteria",
    "requirements",
    "facts",
    "sourceReferences",
    "gaps",
    "artifacts",
    "tests",
    "executionReceipts",
    "normalizations",
)
_COMPACTION_PHASES = frozenset({"state-compiler", "solver-builder", "repairer"})
_TMUX_BOOTSTRAP_PATH = Path(
    os.environ.get("AMOS_HARBOR_TMUX_BOOTSTRAP", "/opt/amos/bin/tmux-static")
)
_TMUX_REMOTE_PATH = "/usr/local/bin/tmux"


class VerifierContractRecoveryExhausted(RuntimeError):
    """The model could not satisfy the internal verdict transport contract."""


class AmosTaskSwarm(Terminus2):
    """Run bounded task specialists over one shared terminal environment."""

    SUPPORTS_ATIF = False

    def __init__(
        self,
        *args: Any,
        interface_scanner_turns: int = 6,
        data_scanner_turns: int = 8,
        state_compiler_turns: int = 8,
        builder_turns: int = 16,
        verifier_turns: int = 12,
        repairer_turns: int = 8,
        executor_turns: int = 8,
        integrator_turns: int = 4,
        max_data_scanner_cycles: int = 1,
        # One initial compilation lease plus one bounded host-directed repair.
        # Invalid artifacts earn no credit; the exact validator feedback is
        # carried into the corrective lease instead of terminating the mission.
        max_state_compiler_cycles: int = 2,
        max_builder_cycles: int = 3,
        adaptive_repair_turns: int = 12,
        max_repair_cycles: int = 2,
        max_verifier_contract_retries: int = 1,
        malformed_response_retry_reserve: int = 4,
        research_seed: int | None = None,
        model_provenance_json: str | Mapping[str, Any] | None = None,
        failure_capsule_store_path: str | None = None,
        failure_capsule_task_name: str | None = None,
        **kwargs: Any,
    ) -> None:
        self._phase_turns = {
            "interface-scanner": _bounded_int(
                interface_scanner_turns, 2, 12, "interface_scanner_turns"
            ),
            "data-scanner": _bounded_int(data_scanner_turns, 2, 12, "data_scanner_turns"),
            "state-compiler": _bounded_int(state_compiler_turns, 2, 12, "state_compiler_turns"),
            # A solver needs enough horizon to encode and exercise a complete
            # deterministic candidate after it understands the compiled state.
            # Twelve turns caused fresh agents to repeat analysis without ever
            # reaching the governed candidate receipt.
            "solver-builder": _bounded_int(builder_turns, 2, 32, "builder_turns"),
            "verifier": _bounded_int(verifier_turns, 2, 12, "verifier_turns"),
            "repairer": _bounded_int(repairer_turns, 2, 12, "repairer_turns"),
            "executor": _bounded_int(executor_turns, 2, 12, "executor_turns"),
            "integrator": _bounded_int(integrator_turns, 2, 12, "integrator_turns"),
        }
        self._max_repair_cycles = _bounded_int(
            max_repair_cycles, 0, 10, "max_repair_cycles"
        )
        self._max_builder_cycles = _bounded_int(
            max_builder_cycles, 1, 5, "max_builder_cycles"
        )
        self._adaptive_repair_turns = _bounded_int(
            adaptive_repair_turns, 2, 32, "adaptive_repair_turns"
        )
        self._max_data_scanner_cycles = _bounded_int(
            max_data_scanner_cycles, 1, 5, "max_data_scanner_cycles"
        )
        self._max_state_compiler_cycles = _bounded_int(
            max_state_compiler_cycles, 1, 5, "max_state_compiler_cycles"
        )
        self._max_verifier_contract_retries = _bounded_int(
            max_verifier_contract_retries, 0, 3, "max_verifier_contract_retries"
        )
        self._malformed_response_retry_reserve = _bounded_int(
            malformed_response_retry_reserve,
            0,
            8,
            "malformed_response_retry_reserve",
        )
        self._malformed_responses_in_phase = 0
        self._current_response_malformed = False
        self._official_verifier_handoff = False
        self._active_candidate_cycle: int | None = None
        self._model_provenance = _validate_model_provenance(model_provenance_json)
        self._failure_capsule_store_path = (
            str(Path(failure_capsule_store_path).expanduser().resolve())
            if failure_capsule_store_path
            else None
        )
        self._failure_capsule_task_name = (
            str(failure_capsule_task_name).strip()[:500]
            if failure_capsule_task_name
            else None
        )
        self._failure_capsule_load_error: str | None = None
        self._research_seed = int(research_seed) if research_seed is not None else None
        if self._research_seed is not None:
            if self._research_seed < 0 or self._research_seed > 2_147_483_647:
                raise ValueError("research_seed must be between 0 and 2147483647")
            call_kwargs = dict(kwargs.pop("llm_call_kwargs", {}) or {})
            call_kwargs.setdefault("seed", self._research_seed)
            kwargs["llm_call_kwargs"] = call_kwargs
        self._model_provenance["researchSeed"] = self._research_seed
        kwargs.pop("max_turns", None)
        kwargs.pop("enable_summarize", None)
        kwargs.pop("proactive_summarization_threshold", None)
        kwargs.pop("suppress_max_turns_warning", None)
        kwargs.setdefault("record_terminal_session", False)
        super().__init__(
            *args,
            max_turns=self._phase_turns["solver-builder"],
            enable_summarize=False,
            proactive_summarization_threshold=0,
            suppress_max_turns_warning=True,
            **kwargs,
        )

    @override
    async def setup(self, environment: BaseEnvironment) -> None:
        """Bootstrap Harbor's terminal without runtime package downloads.

        Public benchmark containers can still have slow or unavailable package
        mirrors. The cloud runner carries a pinned static tmux binary so agent
        setup does not depend on apt, GitHub, or PyPI. Local Harbor runs without
        that artifact keep Terminus2's normal installation fallback.
        """

        tmux = await environment.exec(command="command -v tmux >/dev/null 2>&1", user="root")
        if tmux.return_code != 0 and _TMUX_BOOTSTRAP_PATH.is_file():
            await environment.upload_file(
                source_path=_TMUX_BOOTSTRAP_PATH,
                target_path=_TMUX_REMOTE_PATH,
            )
            installed = await environment.exec(
                command=f"chmod 0755 {shlex.quote(_TMUX_REMOTE_PATH)} && tmux -V",
                user="root",
            )
            if installed.return_code != 0:
                detail = installed.stderr or installed.stdout or "unknown error"
                raise RuntimeError(f"Static tmux bootstrap failed: {detail.strip()}")
        await super().setup(environment)

    @staticmethod
    @override
    def name() -> str:
        return "amos-task-swarm"

    @override
    def version(self) -> str:
        return "0.9.0"

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        await environment.exec(command=f"mkdir -p {shlex.quote(SWARM_DIR)}")
        await _write_host_json(environment, MODEL_PROVENANCE_PATH, self._model_provenance)
        phase_contexts: list[tuple[str, AgentContext]] = []
        board = await _initialize_board(environment, instruction)

        await self._run_phase(
            role="interface-scanner",
            instruction=_interface_scanner_instruction(instruction),
            environment=environment,
            phase_contexts=phase_contexts,
        )
        board = await _harvest_artifacts(
            environment,
            board,
            producer="interface-scanner",
            phase="interfaces-scanned",
        )
        for cycle in range(1, self._max_data_scanner_cycles + 1):
            await self._run_phase(
                role="data-scanner",
                instruction=_data_scanner_instruction(
                    instruction,
                    cycle=cycle,
                    max_cycles=self._max_data_scanner_cycles,
                ),
                environment=environment,
                phase_contexts=phase_contexts,
                label=f"data-scanner-{cycle}",
            )
            await _run_phase_program_if_present(environment, role="data-scanner")
            source_count = await _count_files_under(
                environment,
                f"{SWARM_DIR}/source-data",
            )
            if source_count > 0:
                board = await _harvest_artifacts(
                    environment,
                    board,
                    producer="data-scanner",
                    phase="data-scanned",
                )
                break
            if cycle == self._max_data_scanner_cycles:
                raise RuntimeError(
                    "Task swarm exhausted source-data cycles without a durable source artifact"
                )
            board = await _advance_board_phase(
                environment,
                board,
                phase=f"source-data-checkpoint-{cycle}",
            )
        for cycle in range(1, self._max_state_compiler_cycles + 1):
            await self._run_phase(
                role="state-compiler",
                instruction=_state_compiler_instruction(
                    instruction,
                    cycle=cycle,
                    max_cycles=self._max_state_compiler_cycles,
                ),
                environment=environment,
                phase_contexts=phase_contexts,
                label=f"state-compiler-{cycle}",
            )
            await _run_phase_program_if_present(environment, role="state-compiler")
            # The compiler owns the lossy compiled-state artifact; the host owns
            # the governed board. Prefer deterministic projection from the last
            # trusted board before parsing any model-authored board edits. This
            # lets a valid artifact recover from harmless schema/version drift.
            harvested = await _harvest_compiled_state_if_ready(environment, board)
            if harvested is not None:
                candidate_board = harvested
            else:
                candidate_board = board
            if candidate_board["phase"] == "state-compiled":
                board = candidate_board
                break
            if cycle == self._max_state_compiler_cycles:
                raise RuntimeError(
                    "Task swarm exhausted state-compilation cycles; task board phase is "
                    f"{candidate_board['phase']!r}"
                )
            board = await _advance_board_phase(
                environment,
                candidate_board,
                phase=f"state-compilation-checkpoint-{cycle}",
            )
        board = await _harvest_artifacts(
            environment,
            board,
            producer="state-compiler",
            phase="state-compiled",
        )
        construction_brief = await _write_construction_brief(environment, board)
        work_graph = await _write_work_graph(environment, board)
        await _write_solver_scaffold_if_missing(environment)
        await _install_mutation_runtime(environment)
        repairable_challenger = None
        self._failure_capsule_load_error = None
        if self._failure_capsule_store_path:
            try:
                repairable_challenger = _load_repairable_challenger(
                    self._failure_capsule_store_path,
                    task_name=self._failure_capsule_task_name,
                    instruction_digest=str(board.get("taskDigest") or ""),
                )
            except (OSError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                # Cross-run memory is advisory. A corrupt, stale, or
                # incompatible capsule fails closed to the fresh scaffold.
                self._failure_capsule_load_error = (
                    f"{type(error).__name__}: {error}"
                )[:2_000]
        await _initialize_candidate_incumbent(
            environment,
            repairable_challenger=repairable_challenger,
            capsule_load_error=self._failure_capsule_load_error,
        )
        if (
            isinstance(repairable_challenger, dict)
            and isinstance((repairable_challenger.get("metadata") or {}).get("verifierEvidence"), dict)
            and (repairable_challenger.get("metadata") or {})["verifierEvidence"].get("present") is True
        ):
            # Carry the last independent verifier gap into the first new lease.
            # It guides repair but cannot claim that the gap is now resolved.
            await _write_construction_feedback(environment, board, cycle=0)
        cycle = 1
        adaptive_repair_granted = False
        construction_cycle_limit = self._max_builder_cycles
        while cycle <= construction_cycle_limit:
            # Every lease starts from the best host-selected repairable
            # challenger. The authoritative incumbent remains separately
            # protected and can only advance through monotonic evidence.
            await _prepare_candidate_mutation(environment, cycle=cycle)
            self._active_candidate_cycle = cycle
            input_feedback = await _read_optional_host_json(
                environment,
                CONSTRUCTION_FEEDBACK_PATH,
            )
            work_graph, active_work_node = await _refresh_work_graph(
                environment,
                work_graph,
                feedback=input_feedback,
                cycle=cycle,
            )
            context_snapshot = await _write_context_snapshot(
                environment,
                construction_brief=construction_brief,
                work_graph=work_graph,
                active_work_node=active_work_node,
                feedback=input_feedback,
                cycle=cycle,
            )
            diagnosis_before = await _read_optional_host_json(
                environment,
                CONSTRUCTION_DIAGNOSIS_PATH,
            )
            phase_instruction = (
                _builder_instruction(
                    instruction,
                    cycle=cycle,
                    max_cycles=construction_cycle_limit,
                    construction_brief=construction_brief,
                    context_snapshot=context_snapshot,
                )
                if cycle == 1
                else _construction_recovery_instruction(
                    cycle=cycle,
                    max_cycles=construction_cycle_limit,
                    construction_brief=construction_brief,
                    context_snapshot=context_snapshot,
                )
            )
            # A first builder gets enough horizon to synthesize a candidate.
            # Later leases are evidence-directed repairs, not fresh attempts:
            # keep them short so they cannot grow another full discovery trace.
            recovery_turn_budget = None
            if adaptive_repair_granted and cycle > self._max_builder_cycles:
                recovery_turn_budget = self._adaptive_repair_turns
            elif cycle > 1:
                recovery_turn_budget = _construction_recovery_turn_budget(
                    await _observe_construction_evidence(environment),
                    configured_budget=self._phase_turns["solver-builder"],
                    cycle=cycle,
                )
            try:
                await self._run_phase(
                    role="solver-builder",
                    instruction=phase_instruction,
                    environment=environment,
                    phase_contexts=phase_contexts,
                    label=f"solver-builder-{cycle}",
                    turn_budget=recovery_turn_budget,
                )
            except BaseException:
                # Harbor may cancel the coroutine at its outer agent timeout.
                # Persist whatever typed candidate state exists before that
                # cancellation escapes so the next exact-task run can resume
                # from bytes rather than replaying the whole lease.
                await _checkpoint_candidate_mutation(
                    environment,
                    cycle=cycle,
                    status="interrupted",
                )
                raise
            await _run_solver_program_if_present(environment)
            mutation_evidence = await _observe_construction_evidence(environment)
            await _checkpoint_candidate_mutation(
                environment,
                cycle=cycle,
                status="lease-complete",
                candidate_evidence=mutation_evidence,
            )
            harvested_candidate = await _harvest_candidate_if_ready(environment, board)
            if harvested_candidate is not None:
                candidate_board = harvested_candidate
            else:
                candidate_board = board
            if candidate_board["phase"] == "constructed":
                await _settle_candidate_mutation(
                    environment,
                    cycle=cycle,
                    candidate_evidence=mutation_evidence,
                )
                board = await _harvest_artifacts(
                    environment,
                    candidate_board,
                    producer="solver-builder",
                    phase="constructed",
                )
                self._active_candidate_cycle = None
                break
            # Settle first so the next repair capsule includes the outcome of
            # the lease that just ran. v11 wrote feedback before settlement,
            # allowing a no-op mutation to be forgotten for one full cycle.
            settlement = await _settle_candidate_mutation(
                environment,
                cycle=cycle,
                candidate_evidence=mutation_evidence,
            )
            latest_feedback = await _write_construction_feedback(
                environment,
                candidate_board,
                cycle=cycle,
            )
            latest_feedback["settlement"] = _bounded_mutation_settlement(settlement)
            await _write_host_json(
                environment,
                CONSTRUCTION_FEEDBACK_PATH,
                latest_feedback,
            )
            self._active_candidate_cycle = None
            diagnosis_after = await _read_optional_host_json(
                environment,
                CONSTRUCTION_DIAGNOSIS_PATH,
            )
            if (
                cycle == self._max_builder_cycles
                and not adaptive_repair_granted
                and _diagnosis_earns_adaptive_repair(
                    diagnosis_before=diagnosis_before,
                    diagnosis_after=diagnosis_after,
                    input_feedback=input_feedback,
                    latest_feedback=latest_feedback,
                )
            ):
                # A final-turn root-cause discovery is learned progress, but it
                # is not solution credit. Grant one bounded implementation
                # lease only when the diagnosis is new and cites the exact
                # host-observed failure state it analyzed.
                adaptive_repair_granted = True
                construction_cycle_limit += 1
            elif cycle == construction_cycle_limit:
                incumbent = (
                    await _read_optional_host_json(environment, INCUMBENT_EVIDENCE_PATH)
                    or {}
                )
                challenger = (
                    await _read_optional_host_json(environment, CHALLENGER_EVIDENCE_PATH)
                    or {}
                )
                await _write_host_json(
                    environment,
                    CONSTRUCTION_EXHAUSTION_PATH,
                    _construction_exhaustion_record(
                        board=candidate_board,
                        cycle=cycle,
                        incumbent=incumbent,
                        challenger=challenger,
                    ),
                )
                board = await _advance_board_phase(
                    environment,
                    candidate_board,
                    phase="construction-exhausted",
                )
                self._official_verifier_handoff = True
                return
            board = await _advance_board_phase(
                environment,
                candidate_board,
                phase=f"construction-checkpoint-{cycle}",
            )
            cycle += 1

        preflight = None
        for cycle in range(self._max_repair_cycles + 1):
            try:
                preflight = await self._run_verifier_with_contract_recovery(
                    task=instruction,
                    phase="preflight",
                    verdict_path=PREFLIGHT_VERDICT_PATH,
                    board=board,
                    environment=environment,
                    phase_contexts=phase_contexts,
                    label=f"preflight-verifier-{cycle}",
                )
            except VerifierContractRecoveryExhausted as error:
                if await self._handoff_exhausted_verifier_contract(
                    phase="preflight",
                    board=board,
                    environment=environment,
                    error=error,
                ):
                    return
                raise
            if _is_verified_pass(preflight):
                break
            if cycle == self._max_repair_cycles:
                raise RuntimeError("Task swarm exhausted repair cycles before preflight passed")
            await self._run_phase(
                role="repairer",
                instruction=_repairer_instruction(instruction, preflight, cycle + 1),
                environment=environment,
                phase_contexts=phase_contexts,
                label=f"repairer-{cycle + 1}",
            )
            await _run_solver_program_if_present(environment)
            observed_board = await _read_board(environment, previous=board)
            expected_repair_phase = f"repaired-{cycle + 1}"
            if observed_board["phase"] == expected_repair_phase:
                board = observed_board
            else:
                # Board bookkeeping is a harness boundary, not a reasoning
                # challenge. If the repairer left a freshly valid candidate
                # but omitted only the phase transition, project the exact
                # host-verified receipts and continue to another independent
                # verifier. This grants neither pass nor completion credit.
                repaired_candidate = await _harvest_candidate_if_ready(
                    environment,
                    observed_board,
                )
                if repaired_candidate is None:
                    raise RuntimeError(
                        f"Task board phase is {observed_board['phase']!r}; "
                        f"expected {expected_repair_phase!r}"
                    )
                board = await _advance_board_phase(
                    environment,
                    repaired_candidate,
                    phase=expected_repair_phase,
                )

        await self._run_phase(
            role="executor",
            instruction=_executor_instruction(instruction, preflight),
            environment=environment,
            phase_contexts=phase_contexts,
        )
        board = await _read_board(
            environment,
            expected_phase="executed",
            previous=board,
        )
        try:
            final_verdict = await self._run_verifier_with_contract_recovery(
                task=instruction,
                phase="post-execution",
                verdict_path=FINAL_VERDICT_PATH,
                board=board,
                environment=environment,
                phase_contexts=phase_contexts,
                label="final-verifier",
            )
        except VerifierContractRecoveryExhausted as error:
            if await self._handoff_exhausted_verifier_contract(
                phase="post-execution",
                board=board,
                environment=environment,
                error=error,
            ):
                return
            raise
        if not _is_verified_pass(final_verdict):
            raise RuntimeError(
                "Task swarm final verification failed: "
                + "; ".join(final_verdict.get("gaps", []))
        )
        board_before_integration = board
        await self._run_phase(
            role="integrator",
            instruction=_integrator_instruction(instruction, final_verdict),
            environment=environment,
            phase_contexts=phase_contexts,
        )
        board = await _read_board(environment, previous=board_before_integration)
        _assert_board_unchanged(board_before_integration, board, "integrator")
        _aggregate_context(context, phase_contexts, final_verdict)

    async def _run_verifier_with_contract_recovery(
        self,
        *,
        task: str,
        phase: str,
        verdict_path: str,
        board: dict[str, Any],
        environment: BaseEnvironment,
        phase_contexts: list[tuple[str, AgentContext]],
        label: str,
    ) -> dict[str, Any]:
        """Retry only the missing/invalid typed verifier boundary.

        The host archives every rejected artifact and supplies exact contract
        feedback to a fresh verifier context. It never synthesizes a verdict,
        changes the evidence board, or treats a retry as progress.
        """

        last_error: RuntimeError | None = None
        for attempt in range(self._max_verifier_contract_retries + 1):
            rejected_path = await _archive_existing_verdict(
                environment,
                verdict_path,
                label=label,
                attempt=attempt,
            )
            feedback_path = VERIFIER_CONTRACT_FEEDBACK_PATH if attempt > 0 else None
            await self._run_phase(
                role="verifier",
                instruction=_verifier_instruction(
                    task,
                    verdict_path=verdict_path,
                    phase=phase,
                    contract_feedback_path=feedback_path,
                ),
                environment=environment,
                phase_contexts=phase_contexts,
                label=label if attempt == 0 else f"{label}-contract-retry-{attempt}",
            )
            observed_board = await _read_board(environment, previous=board)
            _assert_board_unchanged(board, observed_board, f"{phase} verifier")
            try:
                verdict = await _read_verdict(
                    environment,
                    verdict_path,
                    required_criteria=board["successCriteria"],
                )
                if verdict.get("status") == "pass" and not _is_verified_pass(verdict):
                    raise RuntimeError(
                        f"Verifier wrote an incomplete pass verdict to {verdict_path}"
                    )
                if _is_verified_pass(verdict):
                    await _verify_receipts(environment, verdict)
                return verdict
            except RuntimeError as error:
                last_error = error
                rejected_path = await _archive_existing_verdict(
                    environment,
                    verdict_path,
                    label=label,
                    attempt=attempt + 1,
                ) or rejected_path
                await _write_verifier_contract_feedback(
                    environment,
                    phase=phase,
                    verdict_path=verdict_path,
                    attempt=attempt + 1,
                    error=error,
                    rejected_path=rejected_path,
                    required_criteria=board["successCriteria"],
                )
                if attempt >= self._max_verifier_contract_retries:
                    break
        assert last_error is not None
        raise VerifierContractRecoveryExhausted(
            "Verifier contract recovery exhausted after "
            f"{self._max_verifier_contract_retries + 1} attempt(s): {last_error}"
        ) from last_error

    async def _handoff_exhausted_verifier_contract(
        self,
        *,
        phase: str,
        board: dict[str, Any],
        environment: BaseEnvironment,
        error: RuntimeError,
    ) -> bool:
        """Fail open only to Harbor's unchanged official verifier.

        The internal verifier is useful deliberation, not scoring authority. A
        transport-only failure may hand a runnable, substantive candidate to
        Harbor even when its self-check is incomplete. This preserves the
        independent official score as learning evidence; it does not
        manufacture a verdict or award completion credit.
        """

        candidate_evidence = await _observe_construction_evidence(environment)
        if (
            candidate_evidence.get("implementationSubstantive") is not True
            or candidate_evidence.get("solverExecutionPresent") is not True
        ):
            return False
        await _write_host_json(
            environment,
            VERIFIER_HANDOFF_PATH,
            _verifier_contract_handoff_record(
                phase=phase,
                board=board,
                candidate_evidence=candidate_evidence,
                error=error,
            ),
        )
        self._official_verifier_handoff = True
        return True

    @override
    async def _handle_llm_interaction(
        self,
        chat: Any,
        prompt: str,
        original_instruction: str = "",
        session: Any = None,
    ) -> tuple[Any, ...]:
        result = await super()._handle_llm_interaction(
            chat,
            prompt,
            original_instruction,
            session,
        )
        feedback = str(result[2] or "")
        self._current_response_malformed = _is_malformed_parser_feedback(feedback)
        if (
            getattr(self, "_count_malformed_responses", False)
            and self._current_response_malformed
            and self._malformed_responses_in_phase < self._malformed_response_retry_reserve
        ):
            self._malformed_responses_in_phase += 1
        return result

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
        phase_label = label or role
        phase_turn_budget = self._phase_turns[role]
        if turn_budget is not None:
            phase_turn_budget = max(2, min(phase_turn_budget, int(turn_budget)))
        # Harbor already feeds malformed JSON back to the model. Count those
        # failed transport turns and replace exactly the number actually lost;
        # an unused reserve can no longer expand a specialist's action budget.
        retry_enabled = role in _COMPACTION_PHASES
        self._max_episodes = phase_turn_budget
        self._malformed_responses_in_phase = 0
        self._count_malformed_responses = retry_enabled
        # Construction and repair can legitimately consume many terminal
        # observations. Preserve their durable files while compacting only the
        # transient phase chat before the backend's hard context boundary.
        self._enable_summarize = role in _COMPACTION_PHASES
        self._proactive_summarization_threshold = 12_000 if role == "state-compiler" else 6_000
        phase_context = AgentContext()
        retry_context: AgentContext | None = None
        try:
            await super().run(instruction, environment, phase_context)
        except (ContextLengthExceededError, OutputLengthExceededError):
            # A long-running specialist may have already persisted its program
            # or typed result before the provider truncates a later narration.
            # Recover only from the role's durable, host-checkable boundary;
            # never infer success from partial model text.
            if not await _recover_truncated_phase(environment, role=role):
                raise
        finally:
            self._count_malformed_responses = False
            phase_contexts.append((phase_label, phase_context))
            _archive_phase_trajectory(self.logs_dir, phase_label)

        replacement_turns = min(
            self._malformed_responses_in_phase,
            self._malformed_response_retry_reserve,
        )
        if replacement_turns < 1:
            return
        retry_context = AgentContext()
        retry_label = f"{phase_label}-transport-retry"
        construction_feedback = (
            await _read_optional_host_json(environment, CONSTRUCTION_FEEDBACK_PATH)
            if role == "solver-builder"
            else None
        )
        solver_execution = (
            await _read_optional_host_json(environment, SOLVER_EXECUTION_PATH)
            if role == "solver-builder"
            else None
        )
        retry_instruction = _transport_retry_instruction(
            role=role,
            original_instruction=instruction,
            replacement_turns=replacement_turns,
            construction_feedback=construction_feedback,
            solver_execution=solver_execution,
        )
        self._max_episodes = replacement_turns
        try:
            await super().run(retry_instruction, environment, retry_context)
        except (ContextLengthExceededError, OutputLengthExceededError):
            if not await _recover_truncated_phase(environment, role=role):
                raise
        finally:
            phase_contexts.append((retry_label, retry_context))
            _archive_phase_trajectory(self.logs_dir, retry_label)


def _archive_phase_trajectory(logs_dir: Path, phase_label: str) -> None:
    source = logs_dir / "trajectory.json"
    if not source.exists():
        return
    safe_label = re.sub(r"[^a-z0-9-]+", "-", phase_label.lower()).strip("-")
    shutil.copyfile(source, logs_dir / f"trajectory.{safe_label}.json")
    for summary_file in logs_dir.glob("trajectory.summarization-*.json"):
        suffix = summary_file.name.removeprefix("trajectory.")
        shutil.copyfile(summary_file, logs_dir / f"trajectory.{safe_label}.{suffix}")
        summary_file.unlink()


def _is_malformed_parser_feedback(feedback: str) -> bool:
    normalized = feedback.lower()
    return "error:" in normalized or any(
        marker in normalized
        for marker in (
            "no valid json object found",
            "invalid json",
            "failed to parse",
            "could not parse",
        )
    )


def _transport_retry_instruction(
    *,
    role: str,
    original_instruction: str,
    replacement_turns: int,
    construction_feedback: dict[str, Any] | None = None,
    solver_execution: dict[str, Any] | None = None,
) -> str:
    """Re-enter lost transport turns from durable state without prompt replay."""

    count = max(1, int(replacement_turns))
    if role != "solver-builder":
        return (
            f"{original_instruction}\n\nAMOS TRANSPORT-RETRY CONTINUATION:\n"
            f"The provider produced {count} malformed structured response(s), so the host is "
            "replacing exactly those lost transport turns. Durable files and completed commands "
            "remain intact. Inspect the current durable boundary, perform only the remaining "
            "phase work, and do not replay completed actions."
        )

    snapshot = _bounded_transport_retry_snapshot(
        construction_feedback=construction_feedback,
        solver_execution=solver_execution,
    )
    return f"""AMOS TASK-SWARM TRANSPORT RECOVERY: SOLVER BUILDER
The provider produced {count} malformed structured response(s). The host is replacing exactly
those lost transport turns; this is continuation of the existing lease, not a new attempt.
Completed commands and durable files remain intact. Do not replay discovery or reconstruct the
mission from chat. Exact authority remains in {BOARD_PATH}; compact construction state is in
{CONSTRUCTION_BRIEF_PATH}.

CURRENT HOST-OBSERVED SNAPSHOT (bounded, not completion authority):
{json.dumps(snapshot, sort_keys=True, separators=(",", ":"))}

Continue from {SOLVER_IMPLEMENTATION_PATH}. In the first replacement response, inspect only
{CONSTRUCTION_FEEDBACK_PATH}, {SOLVER_EXECUTION_PATH}, {CONSTRUCTION_DIAGNOSIS_PATH},
{SELF_CHECK_PATH}, and {CANDIDATE_STATUS_PATH} as present. If host feedback reports failures,
write or update {CONSTRUCTION_DIAGNOSIS_PATH} before further browsing or mutation. Bind it to the
snapshot's exact evidenceDigest and record your current observation, causal hypothesis, next
action, and failedCheckIds. It is a working strategy checkpoint, not completion evidence. Then
patch and run {SOLVER_PATH}; do not spend a replacement turn merely rereading the whole
implementation. Use targeted numbered slices for a long file because the terminal preserves only
its tail. Preserve passing behavior, change the smallest general root cause, and let deterministic
checks and the host candidate contract decide success.
"""


def _bounded_transport_retry_snapshot(
    *,
    construction_feedback: dict[str, Any] | None,
    solver_execution: dict[str, Any] | None,
) -> dict[str, Any]:
    feedback = construction_feedback if isinstance(construction_feedback, dict) else {}
    execution = solver_execution if isinstance(solver_execution, dict) else {}
    return {
        "evidenceDigest": str(feedback.get("evidenceDigest") or "")[:64] or None,
        "failedChecks": [
            {
                "id": str(check.get("id") or "")[:200],
                "detail": str(check.get("detail") or "")[:1_000],
            }
            for check in feedback.get("failedChecks", [])
            if isinstance(check, dict) and str(check.get("id") or "").strip()
        ][:64],
        "repairSignals": [
            str(signal)[:200]
            for signal in feedback.get("repairSignals", [])
            if isinstance(signal, str) and signal.strip()
        ][:64],
        "solverExecution": {
            "returnCode": execution.get("returnCode"),
            "succeeded": execution.get("succeeded") is True,
            "stdoutTail": str(execution.get("stdoutTail") or "")[-2_000:],
            "stderrTail": str(execution.get("stderrTail") or "")[-2_000:],
        } if execution else None,
    }


async def _recover_truncated_phase(
    environment: BaseEnvironment,
    *,
    role: str,
) -> bool:
    """Recover only when a provider failure left a durable role deliverable."""
    await _run_phase_program_if_present(environment, role=role)
    if role == "data-scanner":
        return await _count_files_under(environment, f"{SWARM_DIR}/source-data") > 0
    if role == "state-compiler":
        result = await environment.exec(command=f"cat {shlex.quote(COMPILED_STATE_PATH)}")
        return result.return_code == 0 and bool(result.stdout)
    if role == "solver-builder":
        result = await environment.exec(command=f"cat {shlex.quote(CANDIDATE_STATUS_PATH)}")
        return result.return_code == 0 and bool(result.stdout)
    return False


async def _run_phase_program_if_present(
    environment: BaseEnvironment,
    *,
    role: str,
) -> bool:
    program = {
        "data-scanner": f"{SWARM_DIR}/extract_source_data.py",
        "state-compiler": f"{SWARM_DIR}/compile_state.py",
    }.get(role)
    if program is None:
        return False
    exists = await environment.exec(command=f"test -s {shlex.quote(program)}")
    if exists.return_code != 0:
        return False
    result = await environment.exec(command=f"python3 {shlex.quote(program)}")
    return result.return_code == 0


def _interface_scanner_instruction(task: str) -> str:
    return _phase_instruction(
        task,
        role="INTERFACE SCANNER",
        objective=f"""
The host already initialized {BOARD_PATH}. You have at most six model calls. Inspect only the
authoritative access documentation, configuration, gateway interface, and schemas. Do not inspect
source rows and do not solve the task. In your first command batch, read the small documentation
and capture every schema directly to files under {SWARM_DIR}/interfaces. In your next command,
create a compact machine-readable schema index without printing full JSON into chat. Verify those
files, set the board phase to `interfaces-scanned`, and finish. The host will automatically harvest
all created files and receipts, so do not add or replace board artifact entries yourself.
""",
    )


def _data_scanner_instruction(task: str, *, cycle: int, max_cycles: int) -> str:
    return _phase_instruction(
        task,
        role="SOURCE DATA SCANNER",
        objective=f"""
This is source-data cycle {cycle} of at most {max_cycles}. Read {BOARD_PATH} and the harvested
interface artifacts first. You have at most eight model calls. Do not reread gateway source or
print raw tables. Hard delivery deadline: your first terminal action must create or improve
{SWARM_DIR}/extract_source_data.py using only the authorized gateway. Run it no later than your
third model call to save all task-relevant source rows and row counts as non-empty compact typed
files under {SWARM_DIR}/source-data. Then validate
file readability and counts without dumping rows, set the board phase to `data-scanned`, and
finish. Do not analyze, schedule, reserve, write target systems, or construct the final solution.
The host automatically registers every created artifact and SHA-256; do not edit board artifacts.
""",
    )


def _state_compiler_instruction(task: str, *, cycle: int, max_cycles: int) -> str:
    return _phase_instruction(
        task,
        role="STATE COMPILER",
        objective=f"""
This is compilation cycle {cycle} of at most {max_cycles}. Start with {BOARD_PATH}, any host
feedback at {COMPILED_FEEDBACK_PATH}, and its
harvested interface and source-data artifact paths. Do not repeat discovery, reread gateway source,
or print raw tables. Hard delivery deadline: your first terminal action must create or improve
{SWARM_DIR}/compile_state.py before any further inspection. Read or enumerate all saved typed files
in that same batch rather than spending one model turn per file. Run the program no later than your
third model call to produce
{SWARM_DIR}/compiled-state.json. That file must be strict JSON with schema
`amos.swarm-compiled-state`, version 1, phase `state-compiled`, non-empty `constraints`, non-empty
`successCriteria`, non-empty in-bound `sourceReferences`, a `gaps` array, and `verification` with
`all_pass` true only after the compiler checked completeness and readability. Each object-form
entry in `constraints`, `successCriteria`, and `gaps` must contain a non-empty `statement` field;
alternative prose fields such as `description` or `criterion` are not accepted. Include a bounded
`workGraph` when the evidence supports meaningful decomposition. Each node has an `id`, one
concrete `objective`, optional `dependsOn`, `requiredEvidence`, and capability `tags`; derive these
from the mission rather than selecting from a fixed role wizard. Then finish. Do
not edit the governed board: the host validates the artifact and projects its statements and receipts.
If a prior compilation-cycle file or feedback file exists, repair it instead of starting over.
Artifact delivery takes priority over further inspection. Do not construct or execute the final
solution.
""",
    )


async def _write_construction_brief(
    environment: BaseEnvironment,
    board: dict[str, Any],
) -> dict[str, Any]:
    """Compile exact durable state into one bounded, scenario-neutral packet.

    Fresh logical agents should not spend their leases learning how to inspect
    the same files. The packet preserves paths and receipts as authority while
    exposing only the compact structure needed to construct code.
    """
    sources: list[dict[str, Any]] = []
    for reference in board.get("sourceReferences", [])[:64]:
        if not isinstance(reference, dict):
            continue
        path = str(reference.get("path") or "").strip()
        if not path.startswith(f"{SWARM_DIR}/"):
            continue
        result = await environment.exec(command=f"cat {shlex.quote(path)}")
        if result.return_code != 0 or not result.stdout:
            continue
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError:
            continue
        sources.append(_summarize_construction_source(reference, value))
    interface_paths = sorted({
        str(artifact.get("path"))
        for artifact in board.get("artifacts", [])
        if isinstance(artifact, dict)
        and artifact.get("producer") == "interface-scanner"
        and str(artifact.get("path") or "").startswith(f"{SWARM_DIR}/")
    })[:64]
    brief = {
        "schema": "amos.swarm-construction-brief",
        "version": 1,
        "taskDigest": board.get("taskDigest"),
        "taskObjective": str(board.get("taskObjective") or "")[:12_000],
        "constraints": [
            str(entry.get("statement") or "")[:2_000]
            for entry in board.get("requirements", [])
            if isinstance(entry, dict) and str(entry.get("statement") or "").strip()
        ][:128],
        "successCriteria": [
            str(entry.get("statement") or "")[:2_000]
            for entry in board.get("successCriteria", [])
            if isinstance(entry, dict) and str(entry.get("statement") or "").strip()
        ][:128],
        "criterionContracts": _normalized_required_criteria(
            board.get("successCriteria", [])
        )[:128],
        "sources": sources,
        "interfacePaths": interface_paths,
        "durableState": {
            "boardPath": BOARD_PATH,
            "compiledStatePath": COMPILED_STATE_PATH,
            "solverPath": SOLVER_PATH,
            "solverImplementationPath": SOLVER_IMPLEMENTATION_PATH,
            "selfCheckPath": SELF_CHECK_PATH,
            "candidateStatusPath": CANDIDATE_STATUS_PATH,
        },
        "authority": {
            "hostDerivedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }
    await _write_host_json(environment, CONSTRUCTION_BRIEF_PATH, brief)
    return brief


async def _write_work_graph(
    environment: BaseEnvironment,
    board: dict[str, Any],
) -> dict[str, Any]:
    """Materialize a bounded, task-derived graph of construction opportunities.

    The state compiler may propose nodes, but the host validates every edge and
    falls back to criterion-derived nodes. Nodes guide specialization only;
    they cannot grant completion credit or weaken the exact board criteria.
    """
    compiled_state = await _read_optional_host_json(environment, COMPILED_STATE_PATH)
    proposed = compiled_state.get("workGraph") if isinstance(compiled_state, dict) else None
    nodes = _normalize_work_nodes(proposed)
    if not nodes:
        criteria = [
            entry for entry in board.get("successCriteria", [])
            if isinstance(entry, dict) and str(entry.get("statement") or "").strip()
        ]
        nodes = [
            {
                "id": f"criterion-{index + 1:03d}",
                "objective": str(entry["statement"]).strip()[:1_000],
                "dependsOn": [],
                "requiredEvidence": [str(entry.get("id") or f"criterion-{index + 1:03d}")[:200]],
                "tags": _work_node_tags(str(entry["statement"])),
                "status": "available",
                "attempts": 0,
            }
            for index, entry in enumerate(criteria[:12])
        ]
    if not nodes:
        nodes = [{
            "id": "construct-candidate",
            "objective": "Construct and deterministically verify the governed candidate.",
            "dependsOn": [],
            "requiredEvidence": [],
            "tags": ["solver-engineering", "constraint-testing"],
            "status": "available",
            "attempts": 0,
        }]
    integration_dependencies = [node["id"] for node in nodes]
    nodes.append({
        "id": "integrate-candidate",
        "objective": "Integrate the strongest verified mutations without regressing prior evidence.",
        "dependsOn": integration_dependencies,
        "requiredEvidence": ["self-check-present", "candidate-status-present"],
        "tags": ["result-integration", "adversarial-verification"],
        "status": "blocked",
        "attempts": 0,
    })
    graph = {
        "schema": "amos.swarm-work-graph",
        "version": 1,
        "taskDigest": board.get("taskDigest"),
        "nodes": nodes,
        "authority": {
            "schedulingOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }
    await _write_host_json(environment, WORK_GRAPH_PATH, graph)
    return graph


def _normalize_work_nodes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    nodes: list[dict[str, Any]] = []
    identifiers: set[str] = set()
    for index, source in enumerate(value[:12]):
        if not isinstance(source, dict):
            continue
        objective = str(source.get("objective") or source.get("statement") or "").strip()
        identifier = re.sub(
            r"[^a-z0-9-]+", "-", str(source.get("id") or f"work-{index + 1}").lower()
        ).strip("-")[:80]
        if not objective or not identifier or identifier in identifiers:
            continue
        identifiers.add(identifier)
        dependencies = source.get("dependsOn") if isinstance(source.get("dependsOn"), list) else []
        required_evidence = (
            source.get("requiredEvidence")
            if isinstance(source.get("requiredEvidence"), list)
            else []
        )
        source_tags = source.get("tags") if isinstance(source.get("tags"), list) else []
        nodes.append({
            "id": identifier,
            "objective": objective[:1_000],
            "dependsOn": [
                re.sub(r"[^a-z0-9-]+", "-", str(item).lower()).strip("-")[:80]
                for item in dependencies[:12]
                if isinstance(item, str) and item.strip()
            ],
            "requiredEvidence": [
                str(item).strip()[:200]
                for item in required_evidence[:32]
                if isinstance(item, str) and item.strip()
            ],
            "tags": _work_node_tags(" ".join([
                objective,
                *[str(item) for item in source_tags if isinstance(item, str)],
            ])),
            "status": "available",
            "attempts": 0,
        })
    valid_ids = {node["id"] for node in nodes}
    for node in nodes:
        node["dependsOn"] = [
            item for item in node["dependsOn"] if item in valid_ids and item != node["id"]
        ]
    return nodes


def _work_node_tags(text: str) -> list[str]:
    words = [
        word for word in re.findall(r"[a-z][a-z0-9-]{2,}", text.lower())
        if word not in {"and", "the", "with", "from", "that", "this", "must", "should"}
    ]
    return sorted(set(["solver-engineering", *words]))[:16]


async def _refresh_work_graph(
    environment: BaseEnvironment,
    graph: dict[str, Any],
    *,
    feedback: dict[str, Any] | None,
    cycle: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    updated = json.loads(json.dumps(graph))
    failed_ids = [
        str(item.get("id") or "").strip()[:200]
        for item in (feedback or {}).get("failedChecks", [])
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    ][:32]
    if failed_ids:
        identifier = f"repair-{_canonical_digest(failed_ids)[:12]}"
        existing = next((node for node in updated["nodes"] if node["id"] == identifier), None)
        if existing is None:
            existing = {
                "id": identifier,
                "objective": "Resolve the current host-observed failed checks: " + ", ".join(failed_ids),
                "dependsOn": [],
                "requiredEvidence": failed_ids,
                "tags": sorted(set([
                    "evidence-directed-repair",
                    "failure-analysis",
                    *[str(value) for value in (feedback or {}).get("repairSignals", [])],
                ]))[:16],
                "status": "available",
                "attempts": 0,
            }
            updated["nodes"].insert(max(0, len(updated["nodes"]) - 1), existing)
        active = existing
    else:
        available = [
            node for node in updated["nodes"]
            if node.get("status") in {"available", "attempted"}
            and node.get("id") != "integrate-candidate"
        ]
        active = available[(max(1, cycle) - 1) % len(available)] if available else updated["nodes"][-1]
    active["status"] = "active"
    active["attempts"] = int(active.get("attempts") or 0) + 1
    updated["activeNodeId"] = active["id"]
    await _write_host_json(environment, WORK_GRAPH_PATH, updated)
    return updated, json.loads(json.dumps(active))


async def _write_context_snapshot(
    environment: BaseEnvironment,
    *,
    construction_brief: dict[str, Any],
    work_graph: dict[str, Any],
    active_work_node: dict[str, Any],
    feedback: dict[str, Any] | None,
    cycle: int,
) -> dict[str, Any]:
    incumbent = await _read_optional_host_json(environment, INCUMBENT_EVIDENCE_PATH)
    challenger = await _read_optional_host_json(environment, CHALLENGER_EVIDENCE_PATH)
    snapshot = {
        "schema": "amos.swarm-context-snapshot",
        "version": 1,
        "cycle": cycle,
        "taskDigest": construction_brief.get("taskDigest"),
        "objective": str(construction_brief.get("taskObjective") or "")[:3_000],
        "activeWorkNode": active_work_node,
        "incumbentEvidence": incumbent,
        "challengerEvidence": challenger,
        "expectedSha256": (challenger or {}).get("implementationSha256"),
        "failure": _bounded_transport_retry_snapshot(
            construction_feedback=feedback,
            solver_execution=await _read_optional_host_json(environment, SOLVER_EXECUTION_PATH),
        ),
        "paths": {
            "exactBrief": CONSTRUCTION_BRIEF_PATH,
            "workGraph": WORK_GRAPH_PATH,
            "incumbent": INCUMBENT_IMPLEMENTATION_PATH,
            "challenger": CHALLENGER_IMPLEMENTATION_PATH,
            "mutation": SOLVER_IMPLEMENTATION_PATH,
            "mutationRuntime": MUTATION_RUNTIME_PATH,
            "mutationReceipt": MUTATION_RECEIPT_PATH,
        },
        "graphDigest": _canonical_digest(work_graph),
        "authority": {
            "attentionOnly": True,
            "grantsCompletionCredit": False,
        },
    }
    await _write_host_json(environment, CONTEXT_SNAPSHOT_PATH, snapshot)
    return snapshot


def _summarize_construction_source(
    reference: dict[str, Any],
    value: Any,
) -> dict[str, Any]:
    rows = _extract_tabular_rows(value)
    envelope_fields: list[str] = []
    if isinstance(value, dict):
        envelope_fields = sorted(
            str(key)
            for key in value.keys()
            if key not in {"rows", "records", "items", "data"}
        )[:64]
    fields = sorted({
        str(key)
        for row in rows[:32]
        if isinstance(row, dict)
        for key in row.keys()
    })[:128]
    samples = []
    for row in rows[:1]:
        encoded = json.dumps(row, sort_keys=True, separators=(",", ":"))
        if len(encoded) <= 1_000:
            samples.append(row)
        else:
            samples.append({"boundedPreview": encoded[:1_000]})
    return {
        "path": str(reference.get("path")),
        "role": str(reference.get("role") or "source-data"),
        "sha256": reference.get("sha256"),
        "rowCount": len(rows),
        "fields": fields,
        "envelopeFields": envelope_fields,
        "sampleRows": samples,
    }


def _extract_tabular_rows(value: Any) -> list[Any]:
    """Unwrap common typed-data envelopes without interpreting their domain."""
    current = value
    for _ in range(5):
        if isinstance(current, list):
            return current
        if not isinstance(current, dict):
            return []
        nested = next(
            (
                current[key]
                for key in ("rows", "records", "items", "data")
                if isinstance(current.get(key), (dict, list))
            ),
            None,
        )
        if nested is None:
            return []
        current = nested
    return current if isinstance(current, list) else []


def _builder_instruction(
    task: str,
    *,
    cycle: int,
    max_cycles: int,
    construction_brief: dict[str, Any] | None = None,
    context_snapshot: dict[str, Any] | None = None,
) -> str:
    packet = _construction_brief_prompt(
        construction_brief,
        context_snapshot=context_snapshot,
    )
    # The packet already contains the exact objective and criteria. Replaying
    # the original mission through the generic phase wrapper wastes context and
    # can trigger compaction before the builder creates its first artifact.
    return f"""AMOS TASK-SWARM PHASE: SOLVER BUILDER
This is one bounded specialist phase in a larger mission. A fresh specialist will follow you and
will see only durable files, not this conversation.

This is construction cycle {cycle} of at most {max_cycles}. Deliver first; refinement comes only
after a runnable candidate exists. The host-derived construction packet below already contains the
exact mission, constraints, source field catalog, and interface paths. Treat it as an attention
surface, while its cited durable files remain exact authority.

HOST-DERIVED CONSTRUCTION PACKET:
{packet}

Do not re-read or print {BOARD_PATH}, {CONSTRUCTION_BRIEF_PATH},
{SWARM_DIR}/compiled-state.json, schemas, or raw inputs interactively: the exact source paths,
fields, constraints, and criteria needed to begin construction are already in the packet. Load the
packet-listed values inside solver code. Read the host-authored repair capsule at
{CONSTRUCTION_FEEDBACK_PATH} and search agenda at {REPAIR_AGENDA_PATH} only when they exist.
Inside this research workspace, candidate generation, mutation, and local testing are autonomous
and require no human approval. External consequences, promotion, and completion remain host-owned.
Direct gateway calls, `/app/data` discovery,
schema inspection, and source-database queries are forbidden in this phase because earlier
specialists already captured that evidence. The shared holographic projection and host repair
capsule already identify the highest-value constraints and missing durable boundary.

Hard delivery deadline: the host owns and restores the immutable domain-neutral runtime at
{SOLVER_PATH} before every execution. Never edit or replace that file. Your first terminal batch
must replace the `construct` and `verify` placeholders in {SOLVER_IMPLEMENTATION_PATH} with the
substantive task algorithm and run {SOLVER_PATH}; do not build another inventory or inspect one
input per turn. The runtime owns exact-state loading and receipt plumbing. An unimplemented
implementation, file-listing scaffold, or program that exits without writing a deterministic
self-check is not solution progress and earns no organism energy. On a retry, patch the existing
solver implementation from the host repair capsule and run it in that same first terminal batch.
Do not restart schema or source analysis when the capsule reports a missing self-check or candidate
contract. Run the substantive solver no later than your third model call, persist the concrete
candidate and deterministic self-check output at
{SELF_CHECK_PATH}, then write
{CANDIDATE_STATUS_PATH} as strict JSON with schema `amos.swarm-candidate-status`, version 1, phase
`constructed`, status `ready`, `verification.all_pass` true,
`verification.criterionIds` copied in exact order from the construction packet, and non-empty
`artifactReceipts` and `testReceipts`. The self-check must contain a `criteria` array with one entry
for every `criterionContracts` ID in exact order; each entry requires `status` (`pass`, `fail`, or
`blocked`) and non-empty concrete `evidence`. Its top-level `all_pass` must equal whether every
criterion passed. Every receipt requires an absolute in-bound path and actual lowercase SHA-256.
The host verifies those receipts and projects the governed board, so candidate delivery takes
priority over board bookkeeping. Do not spend a response merely describing or dumping inputs.
For substantive edits, use the bounded host transport:
`python3 {MUTATION_RUNTIME_PATH} apply <base64-json-payload>`. Bind the payload to the active
repairable challenger using the
`expectedSha256` in {CONTEXT_SNAPSHOT_PATH}; line replacements are applied atomically, syntax
checked, and receipted at {MUTATION_RECEIPT_PATH}. Stale, oversized, malformed, or truncated
mutations are rejected before they replace the candidate.
Existing array entries are immutable: do not delete, reorder, or edit them.
If prior construction-cycle files exist, continue them instead of starting over. Do not set
`task_complete` until the board says `constructed`. Defer irreversible or append-only final
actions until the executor phase whenever possible.

Work autonomously in the terminal. When the phase deliverables are complete, set task_complete
to true and confirm it on the next turn. Completing this phase does not assert that the overall
mission has passed.
"""


def _construction_recovery_instruction(
    *,
    cycle: int,
    max_cycles: int,
    construction_brief: dict[str, Any] | None = None,
    context_snapshot: dict[str, Any] | None = None,
) -> str:
    """Issue a compact, evidence-directed repair lease without replaying the mission.

    The exact objective and criteria already live on the governed board. Repeating
    the original task here makes a fresh model context rediscover the problem and
    lets context growth crowd out the durable construction contract.
    """
    packet = _construction_brief_prompt(
        construction_brief,
        context_snapshot=context_snapshot,
    )
    return f"""AMOS TASK-SWARM PHASE: SOLVER BUILDER RECOVERY
This is construction recovery cycle {cycle} of at most {max_cycles}. The governed board at
{BOARD_PATH} is the exact mission authority; the original mission is intentionally not repeated.
This is a bounded repair of the existing candidate, not a new solution attempt.

HOST-DERIVED CONSTRUCTION PACKET:
{packet}

Your first terminal batch must read {CONSTRUCTION_FEEDBACK_PATH}, {REPAIR_AGENDA_PATH},
{SOLVER_EXECUTION_PATH}, and the existing solver implementation at {SOLVER_IMPLEMENTATION_PATH};
test for {SELF_CHECK_PATH} and
{CANDIDATE_STATUS_PATH} without printing missing files. Never edit or replace the host runtime at
{SOLVER_PATH}. Then patch the existing solver implementation and run {SOLVER_PATH} in that same
batch. Do not `cat` the full board,
compiled state, schemas, or raw inputs into the terminal. If the existing candidate is untested or
only a scaffold, use one programmatic pass over {SWARM_DIR}/compiled-state.json and saved typed
inputs to replace the scaffold with a substantive candidate. Otherwise read saved inputs only when
a failed check requires them. Do not rediscover schemas, query source systems or the gateway, dump
raw datasets, re-plan the mission, or replace behavior already supported by a passing check.

Use the host-authored failed checks as a reusable contract. Before the first mutation in this
lease, write or update {CONSTRUCTION_DIAGNOSIS_PATH} with the working hypothesis you are about to
test. This makes the attempted strategy and its later deterministic outcome learnable across
agents, jobs, and sessions; update it if new evidence changes the hypothesis. Then identify the
smallest root-cause repair that resolves the largest coherent cluster, implement it, run the solver,
and regenerate the deterministic self-check. Iterate only on remaining failed checks. Never change
a check merely to make it pass and never invent evidence. The diagnosis must be strict JSON
with schema `amos.swarm-repair-diagnosis`, version 1, `evidenceDigest` copied exactly from the input
host feedback, non-empty `observation`, `hypothesis`, and `nextAction`, a non-empty `failedCheckIds`
subset of that feedback, optional primitive-only `supportingMetrics`, and
`authority`={{"modelHypothesisOnly":true,"grantsCompletionCredit":false}}. This hypothesis may
earn one bounded repair lease; it never proves progress or completion. If and only if the
deterministic self-check passes, write
{CANDIDATE_STATUS_PATH} as strict JSON with schema `amos.swarm-candidate-status`, version 1, phase
`constructed`, status `ready`, `verification.all_pass` true,
`verification.criterionIds` copied in exact order from the construction packet, and non-empty
`artifactReceipts` and `testReceipts`. The self-check must contain a `criteria` array covering every
`criterionContracts` ID in exact order with typed status and non-empty concrete evidence, and its
top-level `all_pass` must equal those results. Every receipt requires an absolute in-bound path and
actual lowercase SHA-256.

The repair agenda is host-authored search guidance. Prefer its least-tried coherent failure cluster.
When `novelStrategyRequired` is true, do not repeat a rejected hypothesis/action pair. Every
unresolved lease must produce a syntax-valid, substantive implementation whose SHA-256 differs from
`baselineImplementationSha256`, or stop early with an evidence-bound diagnosis rather than spending
the lease on unchanged code. Research-only mutation and local testing require no human approval:
propose, apply, test, and record variants autonomously inside this workspace. Approval is reserved
for external consequences; only host evidence may promote a variant or declare success.

Use `python3 {MUTATION_RUNTIME_PATH} apply <base64-json-payload>` for the repair. Copy the current
`expectedSha256` from {CONTEXT_SNAPSHOT_PATH}; the host applies bounded line replacements
atomically, validates Python syntax, and writes {MUTATION_RECEIPT_PATH}. A stale or truncated
mutation is rejected before it can replace the active repairable challenger. The verified
incumbent remains separately protected until host evidence supports promotion.

The host validates every receipt and grants completion credit; model prose grants none. Keep chat
output compact and put implementation detail in durable files. Existing array entries are immutable.
When the phase deliverables are complete, set task_complete to true and confirm it on the next turn.
"""


def _construction_brief_prompt(
    value: dict[str, Any] | None,
    *,
    context_snapshot: dict[str, Any] | None = None,
) -> str:
    if not isinstance(value, dict):
        return f"Read the durable packet at {CONSTRUCTION_BRIEF_PATH}."
    snapshot = context_snapshot if isinstance(context_snapshot, dict) else {}
    compact = {
        "taskDigest": value.get("taskDigest"),
        "objective": str(value.get("taskObjective") or "")[:3_000],
        "activeWorkNode": snapshot.get("activeWorkNode"),
        "incumbentEvidence": snapshot.get("incumbentEvidence"),
        "challengerEvidence": snapshot.get("challengerEvidence"),
        "expectedSha256": snapshot.get("expectedSha256"),
        "failure": snapshot.get("failure"),
        "constraints": value.get("constraints", [])[:128],
        "criterionContracts": value.get("criterionContracts", [])[:128],
        "sourceCatalog": [
            {
                "path": source.get("path"),
                "sha256": source.get("sha256"),
                "rowCount": source.get("rowCount"),
                "fields": source.get("fields", [])[:64],
            }
            for source in value.get("sources", [])[:32]
            if isinstance(source, dict)
        ],
        "interfacePaths": value.get("interfacePaths", [])[:32],
        "exactStatePaths": value.get("durableState"),
        "contextSnapshotPath": CONTEXT_SNAPSHOT_PATH,
    }
    return json.dumps(compact, sort_keys=True, separators=(",", ":"))


async def _write_solver_scaffold_if_missing(environment: BaseEnvironment) -> None:
    """Install immutable runtime plumbing and a separate learnable implementation.

    The host runtime is restored unconditionally so a failed model turn cannot
    corrupt the authority or receipt boundary. The organism owns only the
    implementation module, which remains durable across recovery leases.
    """
    await _write_host_text(environment, SOLVER_PATH, _solver_scaffold_source())
    if not await _file_exists(environment, SOLVER_IMPLEMENTATION_PATH):
        await _write_host_text(
            environment,
            SOLVER_IMPLEMENTATION_PATH,
            _solver_implementation_scaffold_source(),
        )


def _solver_scaffold_source() -> str:
    return f'''#!/usr/bin/env python3
"""AMOS host-owned solver runtime. Do not edit; implement solver_impl.py."""
import hashlib
import json
from pathlib import Path

from solver_impl import construct, verify

BRIEF_PATH = Path({CONSTRUCTION_BRIEF_PATH!r})
SELF_CHECK_PATH = Path({SELF_CHECK_PATH!r})
CANDIDATE_STATUS_PATH = Path({CANDIDATE_STATUS_PATH!r})


def load_exact_state():
    brief = json.loads(BRIEF_PATH.read_text())
    sources = {{}}
    for source in brief.get("sources", []):
        path = Path(source["path"])
        if path.is_file() and path.suffix == ".json":
            sources[str(path)] = json.loads(path.read_text())
    return brief, sources


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    SELF_CHECK_PATH.unlink(missing_ok=True)
    CANDIDATE_STATUS_PATH.unlink(missing_ok=True)
    brief, sources = load_exact_state()
    candidate = construct(brief, sources)
    checks = verify(brief, sources, candidate)
    if not isinstance(checks, dict) or "all_pass" not in checks:
        raise RuntimeError("verify() must return a check map containing all_pass")
    SELF_CHECK_PATH.parent.mkdir(parents=True, exist_ok=True)
    SELF_CHECK_PATH.write_text(json.dumps(checks, sort_keys=True, indent=2) + "\\n")
    required = brief.get("criterionContracts")
    criteria = checks.get("criteria")
    if not isinstance(required, list) or not required:
        raise RuntimeError("construction brief must contain criterionContracts")
    if not isinstance(criteria, list) or not criteria:
        raise RuntimeError("verify() must return non-empty typed criteria evidence")
    required_ids = [str(item.get("id") or "").strip() for item in required if isinstance(item, dict)]
    observed_ids = [str(item.get("id") or "").strip() for item in criteria if isinstance(item, dict)]
    if (
        len(required_ids) != len(required)
        or len(set(required_ids)) != len(required_ids)
        or observed_ids != required_ids
    ):
        raise RuntimeError("verify() criteria must preserve every criterionContracts id in order")
    if any(
        item.get("status") not in {{"pass", "fail", "blocked"}}
        or not isinstance(item.get("evidence"), str)
        or not item["evidence"].strip()
        for item in criteria
    ):
        raise RuntimeError("verify() criteria require typed status and non-empty evidence")
    computed_all_pass = all(item["status"] == "pass" for item in criteria)
    if checks.get("all_pass") is not computed_all_pass:
        raise RuntimeError("verify() all_pass must equal the typed criterion results")
    if not computed_all_pass:
        return 2
    artifact_paths = candidate.get("artifactPaths", []) if isinstance(candidate, dict) else []
    artifact_receipts = [
        {{"path": str(Path(path)), "sha256": sha256(path)}}
        for path in artifact_paths
        if Path(path).is_file()
    ]
    if not artifact_receipts:
        raise RuntimeError("passing candidate must expose at least one existing artifact path")
    status = {{
        "schema": "amos.swarm-candidate-status",
        "version": 1,
        "phase": "constructed",
        "status": "ready",
        "verification": {{"all_pass": True, "criterionIds": required_ids}},
        "artifactReceipts": artifact_receipts,
        "testReceipts": [{{"path": str(SELF_CHECK_PATH), "sha256": sha256(SELF_CHECK_PATH)}}],
    }}
    CANDIDATE_STATUS_PATH.write_text(json.dumps(status, sort_keys=True, indent=2) + "\\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _solver_implementation_scaffold_source() -> str:
    return '''"""Learnable task implementation used by the AMOS host runtime."""


def construct(brief, sources):
    raise NotImplementedError("replace with the task construction algorithm")


def verify(brief, sources, candidate):
    raise NotImplementedError("replace with deterministic task checks")
'''


async def _install_mutation_runtime(environment: BaseEnvironment) -> None:
    await _write_host_text(environment, MUTATION_RUNTIME_PATH, _mutation_runtime_source())


def _mutation_runtime_source() -> str:
    """Return the host-owned, atomic line-mutation transport.

    The specialist supplies a base64 JSON payload rather than a giant shell
    heredoc. Every operation is bounded and tied to the source digest it saw.
    """
    return f'''#!/usr/bin/env python3
import ast
import base64
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

TARGET = Path({SOLVER_IMPLEMENTATION_PATH!r})
RECEIPT = Path({MUTATION_RECEIPT_PATH!r})
MAX_PAYLOAD_BYTES = 131072
MAX_OPERATIONS = 64
MAX_INSERTED_BYTES = 65536


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fail(message):
    raise SystemExit(message)


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "apply":
        fail("usage: mutation_runtime.py apply <base64-json-payload>")
    try:
        raw = base64.b64decode(sys.argv[2], validate=True)
    except Exception as error:
        fail(f"invalid base64 mutation payload: {{error}}")
    if len(raw) > MAX_PAYLOAD_BYTES:
        fail("mutation payload exceeds the bounded transport")
    try:
        payload = json.loads(raw)
    except Exception as error:
        fail(f"invalid mutation JSON: {{error}}")
    if payload.get("schema") != "amos.swarm-line-mutation" or payload.get("version") != 1:
        fail("unsupported mutation contract")
    source = TARGET.read_bytes()
    expected = str(payload.get("expectedSha256") or "")
    if expected != digest(source):
        fail("stale mutation: expectedSha256 does not match the current candidate")
    operations = payload.get("operations")
    if not isinstance(operations, list) or not operations or len(operations) > MAX_OPERATIONS:
        fail("mutation operations must be a non-empty bounded array")
    lines = source.decode("utf-8").splitlines(keepends=True)
    inserted = 0
    normalized = []
    for operation in operations:
        if not isinstance(operation, dict) or operation.get("op") != "replace-lines":
            fail("only replace-lines mutation operations are supported")
        start = operation.get("startLine")
        end = operation.get("endLine")
        if not isinstance(start, int) or not isinstance(end, int) or start < 1 or end < start - 1:
            fail("mutation line range is invalid")
        if start > len(lines) + 1 or end > len(lines):
            fail("mutation line range is outside the candidate")
        try:
            content = base64.b64decode(operation.get("contentBase64", ""), validate=True)
        except Exception as error:
            fail(f"invalid operation content: {{error}}")
        inserted += len(content)
        if inserted > MAX_INSERTED_BYTES:
            fail("mutation inserts more than the bounded maximum")
        normalized.append((start, end, content.decode("utf-8").splitlines(keepends=True)))
    previous_start = len(lines) + 2
    for start, end, content_lines in sorted(normalized, reverse=True):
        if end >= previous_start:
            fail("mutation line ranges overlap")
        lines[start - 1:end] = content_lines
        previous_start = start
    candidate = "".join(lines).encode("utf-8")
    try:
        tree = ast.parse(candidate.decode("utf-8"), filename=str(TARGET))
    except SyntaxError as error:
        fail(f"mutation failed syntax validation: {{error}}")
    names = {{node.name for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}}
    if not {{"construct", "verify"}}.issubset(names):
        fail("mutation removed the construct/verify interface")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix="solver_impl.", suffix=".py", dir=TARGET.parent)
    try:
        with os.fdopen(handle, "wb") as output:
            output.write(candidate)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, TARGET)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    receipt = {{
        "schema": "amos.swarm-mutation-receipt",
        "version": 1,
        "sourceSha256": expected,
        "resultSha256": digest(candidate),
        "operationCount": len(normalized),
        "insertedBytes": inserted,
        "syntaxValid": True,
        "interfaceValid": True,
        "authority": {{"hostObservedOnly": True, "grantsCompletionCredit": False}},
    }}
    RECEIPT.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\\n")


if __name__ == "__main__":
    main()
'''


def _construction_recovery_turn_budget(
    evidence: dict[str, Any],
    *,
    configured_budget: int,
    cycle: int,
) -> int:
    """Allocate reasoning to evidence quality, not to a scenario name.

    An untested scaffold has not earned a narrow repair assumption and needs a
    real construction lease. Durable failures direct the repair but do not prove
    it is small, so any failed deterministic check keeps the full quality-first
    lease. A passed self-check with only a missing candidate receipt gets the
    smallest contract-completion lease.
    """
    budget = max(2, int(configured_budget))
    if evidence.get("selfCheckPresent") is not True:
        return budget
    if evidence.get("failedCheckCount", 0) == 0 and evidence.get("candidateStatusPresent") is not True:
        return min(budget, 4)
    return budget


async def _run_solver_program_if_present(environment: BaseEnvironment) -> bool:
    """Restore the fixed runtime, run the implementation, and receipt the boundary."""
    exists = await environment.exec(
        command=f"test -s {shlex.quote(SOLVER_IMPLEMENTATION_PATH)}"
    )
    if exists.return_code != 0:
        return False
    await _write_host_text(environment, SOLVER_PATH, _solver_scaffold_source())
    result = await environment.exec(command=f"python3 {shlex.quote(SOLVER_PATH)}")
    receipt = {
        "schema": "amos.swarm-solver-execution",
        "version": 1,
        "solverPath": SOLVER_PATH,
        "implementationPath": SOLVER_IMPLEMENTATION_PATH,
        "returnCode": int(result.return_code),
        "succeeded": result.return_code == 0,
        "stdoutSha256": hashlib.sha256((result.stdout or "").encode("utf-8")).hexdigest(),
        "stderrSha256": hashlib.sha256((result.stderr or "").encode("utf-8")).hexdigest(),
        "stdoutBytes": len((result.stdout or "").encode("utf-8")),
        "stderrBytes": len((result.stderr or "").encode("utf-8")),
        # Exact hashes preserve the full receipt; bounded tails make runtime
        # evidence actionable without replaying or retaining an unbounded
        # terminal transcript in learned memory.
        "stdoutTail": _bounded_diagnostic_tail(result.stdout),
        "stderrTail": _bounded_diagnostic_tail(result.stderr),
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }
    await _write_host_json(environment, SOLVER_EXECUTION_PATH, receipt)
    return result.return_code == 0


def _bounded_diagnostic_tail(value: Any) -> str:
    text = str(value or "").replace("\x00", "")
    return text[-_MAX_DIAGNOSTIC_TAIL_CHARS:]


async def _write_construction_feedback(
    environment: BaseEnvironment,
    board: dict[str, Any],
    *,
    cycle: int,
) -> dict[str, Any]:
    """Compile host-observed solver evidence into a bounded repair capsule."""
    self_check = await _read_optional_host_json(environment, SELF_CHECK_PATH)
    candidate_status = await _read_optional_host_json(environment, CANDIDATE_STATUS_PATH)
    solver_execution = await _read_optional_host_json(environment, SOLVER_EXECUTION_PATH)
    candidate_evolution = await _read_optional_host_json(environment, CANDIDATE_EVOLUTION_PATH)
    inherited_verifier = _inherited_verifier_feedback(candidate_evolution)
    failed_checks = _extract_failed_self_checks(
        self_check,
        required_criteria=board.get("successCriteria", []),
    )
    failed_checks.extend(_construction_contract_failures(
        self_check,
        candidate_status,
        required_criteria=board.get("successCriteria", []),
    ))
    failed_checks = _merge_repair_checks(
        failed_checks,
        inherited_verifier.get("failedChecks", []),
    )
    contract_diagnostics = _candidate_contract_diagnostics(
        self_check,
        candidate_status,
        required_criteria=board.get("successCriteria", []),
    ) if self_check is not None else {}
    probe = await _implementation_probe(environment)
    signals = _construction_repair_signals(
        failed_checks,
        candidate_status,
        solver_execution=solver_execution,
        self_check_present=self_check is not None,
    )
    signals = sorted(set([*signals, *inherited_verifier.get("repairSignals", [])]))
    evidence = {
        **probe,
        "solverPresent": await _file_exists(environment, SOLVER_PATH),
        "solverExecutionPresent": solver_execution is not None,
        "solverSucceeded": solver_execution is not None
        and solver_execution.get("succeeded") is True,
        "selfCheckPresent": self_check is not None,
        "selfCheckAllPass": self_check is not None
        and self_check.get("all_pass") is True
        and not contract_diagnostics,
        "candidateStatusPresent": candidate_status is not None,
        "candidateAllPass": candidate_status is not None
        and candidate_status.get("verification", {}).get("all_pass") is True
        and not contract_diagnostics,
        "failedCheckCount": len(failed_checks),
        "failedCheckIds": [
            str(check.get("id", "")).strip()[:200]
            for check in failed_checks
            if isinstance(check, dict) and str(check.get("id", "")).strip()
        ][:64],
        "inheritedVerifierFailedCheckCount": len(inherited_verifier.get("failedChecks", [])),
    }
    evidence_digest = _canonical_digest({
        "boardPhase": board.get("phase", "unknown"),
        "evidence": evidence,
        "failedChecks": failed_checks,
    })
    repair_agenda = _repair_agenda(
        failed_checks=failed_checks,
        repair_signals=signals,
        candidate_evolution=candidate_evolution,
    )
    feedback = {
        "schema": "amos.swarm-construction-feedback",
        "version": 1,
        "status": "repair",
        "cycle": cycle,
        "boardPhase": board.get("phase", "unknown"),
        "evidenceDigest": evidence_digest,
        "evidence": evidence,
        "failedChecks": failed_checks,
        "repairSignals": signals,
        "requiredNextActions": _construction_required_actions(signals),
        "repairPrinciples": _construction_repair_principles(signals),
        "repairAgenda": repair_agenda,
        "inheritedVerifierEvidence": inherited_verifier.get("verifierEvidence"),
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }
    await _write_host_json(environment, REPAIR_AGENDA_PATH, repair_agenda)
    await _write_host_json(environment, CONSTRUCTION_FEEDBACK_PATH, feedback)
    return feedback


def _diagnosis_earns_adaptive_repair(
    *,
    diagnosis_before: dict[str, Any] | None,
    diagnosis_after: dict[str, Any] | None,
    input_feedback: dict[str, Any] | None,
    latest_feedback: dict[str, Any] | None,
) -> bool:
    """Accept one new, evidence-bound repair hypothesis as a scheduling signal.

    A diagnosis is model-authored epistemic state. It may earn another bounded
    attempt, but never solution reward, authority, or completion credit.
    """

    if not all(isinstance(value, dict) for value in (
        diagnosis_after,
        input_feedback,
        latest_feedback,
    )):
        return False
    assert diagnosis_after is not None
    assert input_feedback is not None
    assert latest_feedback is not None
    if (
        diagnosis_after.get("schema") != "amos.swarm-repair-diagnosis"
        or diagnosis_after.get("version") != 1
        or diagnosis_after.get("authority", {}).get("grantsCompletionCredit") is not False
        or diagnosis_after.get("authority", {}).get("modelHypothesisOnly") is not True
    ):
        return False
    evidence_digest = str(input_feedback.get("evidenceDigest") or "")
    if not _SHA256.fullmatch(evidence_digest):
        return False
    if diagnosis_after.get("evidenceDigest") != evidence_digest:
        return False
    if diagnosis_before is not None and _canonical_digest(diagnosis_before) == _canonical_digest(
        diagnosis_after
    ):
        return False
    if int((latest_feedback.get("evidence") or {}).get("failedCheckCount") or 0) < 1:
        return False
    for field in ("observation", "hypothesis", "nextAction"):
        value = diagnosis_after.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > 4_000:
            return False
    diagnosed_ids = diagnosis_after.get("failedCheckIds")
    if not isinstance(diagnosed_ids, list) or not diagnosed_ids or len(diagnosed_ids) > 64:
        return False
    available_ids = {
        str(check.get("id") or "").strip()
        for check in input_feedback.get("failedChecks", [])
        if isinstance(check, dict) and str(check.get("id") or "").strip()
    }
    if not all(
        isinstance(check_id, str)
        and 0 < len(check_id.strip()) <= 200
        and check_id.strip() in available_ids
        for check_id in diagnosed_ids
    ):
        return False
    metrics = diagnosis_after.get("supportingMetrics", {})
    if not isinstance(metrics, dict) or len(metrics) > 64:
        return False
    return all(
        isinstance(key, str)
        and 0 < len(key) <= 200
        and (
            value is None
            or isinstance(value, (str, bool, int, float))
            and (not isinstance(value, str) or len(value) <= 1_000)
        )
        for key, value in metrics.items()
    )


def _construction_contract_failures(
    self_check: dict[str, Any] | None,
    candidate_status: dict[str, Any] | None,
    *,
    required_criteria: list[dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    """Represent missing durable boundaries as explicit, domain-neutral checks."""
    failures: list[dict[str, str]] = []
    if self_check is None:
        failures.append({
            "id": "self-check-present",
            "detail": (
                f"The candidate has no deterministic self-check at {SELF_CHECK_PATH}; "
                "an exit code alone is not evidence of solution quality."
            ),
        })
    if candidate_status is None:
        failures.append({
            "id": "candidate-status-present",
            "detail": (
                f"The candidate has no host-verifiable receipt contract at {CANDIDATE_STATUS_PATH}."
            ),
        })
    if self_check is not None:
        diagnostics = _candidate_contract_diagnostics(
            self_check,
            candidate_status,
            required_criteria=required_criteria,
        )
        if diagnostics:
            failures.append({
                "id": "candidate-criterion-contract",
                "detail": (
                    "The candidate self-check is not an independently inspectable criterion "
                    "contract: "
                    + json.dumps(diagnostics, sort_keys=True, separators=(",", ":"))
                )[:2_000],
            })
    return failures


def _candidate_contract_diagnostics(
    self_check: dict[str, Any] | None,
    candidate_status: dict[str, Any] | None,
    *,
    required_criteria: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Validate candidate claims against the host-derived criterion contract.

    This deliberately does not decide whether the solution is correct. It
    prevents a model-authored ``all_pass`` boolean from becoming selection
    evidence unless every exact criterion has a typed, inspectable result and
    the durable status/receipt envelope agrees. Harbor's official verifier
    remains the only task-success authority.
    """

    if not isinstance(self_check, dict):
        return {"selfCheckType": type(self_check).__name__}
    required = _normalized_required_criteria(required_criteria)
    criteria = self_check.get("criteria")
    criterion_diagnostics = _verdict_criterion_diagnostics(
        criteria,
        required_criteria=required,
    )
    diagnostics: dict[str, Any] = {}
    if criterion_diagnostics:
        diagnostics["criteria"] = criterion_diagnostics
    criteria_all_pass = bool(
        isinstance(criteria, list)
        and criteria
        and not criterion_diagnostics
        and all(item.get("status") == "pass" for item in criteria)
    )
    if self_check.get("all_pass") is not criteria_all_pass:
        diagnostics["allPassMismatch"] = {
            "declared": self_check.get("all_pass"),
            "computed": criteria_all_pass,
        }
    if candidate_status is None:
        return diagnostics
    if candidate_status.get("schema") != "amos.swarm-candidate-status":
        diagnostics["candidateSchema"] = candidate_status.get("schema")
    if candidate_status.get("version") != 1:
        diagnostics["candidateVersion"] = candidate_status.get("version")
    if candidate_status.get("phase") != "constructed":
        diagnostics["candidatePhase"] = candidate_status.get("phase")
    if candidate_status.get("status") != "ready":
        diagnostics["candidateStatus"] = candidate_status.get("status")
    verification = candidate_status.get("verification")
    required_ids = [item["id"] for item in required]
    if not isinstance(verification, dict):
        diagnostics["verificationType"] = type(verification).__name__
    else:
        if verification.get("all_pass") is not criteria_all_pass:
            diagnostics["verificationAllPassMismatch"] = {
                "declared": verification.get("all_pass"),
                "computed": criteria_all_pass,
            }
        if verification.get("criterionIds") != required_ids:
            diagnostics["verificationCriterionIds"] = {
                "observed": verification.get("criterionIds"),
                "required": required_ids,
            }
    for field in ("artifactReceipts", "testReceipts"):
        receipts = candidate_status.get(field)
        if not isinstance(receipts, list) or not receipts:
            diagnostics[field] = "must be a non-empty array"
    return diagnostics


async def _read_optional_host_json(
    environment: BaseEnvironment,
    path: str,
) -> dict[str, Any] | None:
    result = await environment.exec(command=f"cat {shlex.quote(path)}")
    if result.return_code != 0 or not result.stdout:
        return None
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


async def _file_exists(environment: BaseEnvironment, path: str) -> bool:
    result = await environment.exec(command=f"test -s {shlex.quote(path)}")
    return result.return_code == 0


async def _implementation_probe(environment: BaseEnvironment) -> dict[str, Any]:
    probe = (
        "import ast,hashlib,json,pathlib,sys; "
        "p=pathlib.Path(sys.argv[1]); b=p.read_bytes() if p.is_file() else b''; "
        "r={'implementationPresent':bool(b),'implementationBytes':len(b),"
        "'implementationSha256':hashlib.sha256(b).hexdigest() if b else None,"
        "'implementationSyntaxValid':False,'implementationContractPresent':False,"
        "'implementationSubstantive':False}; "
        "t=ast.parse(b.decode('utf-8')) if b else None; "
        "f={n.name:n for n in ast.walk(t) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))} if t else {}; "
        "r.update({'implementationSyntaxValid':t is not None,"
        "'implementationContractPresent':{'construct','verify'}.issubset(f),"
        "'implementationSubstantive':bool(t) and not any(isinstance(n,ast.Raise) and "
        "isinstance(n.exc,ast.Call) and getattr(n.exc.func,'id','')=='NotImplementedError' "
        "for name in ('construct','verify') for n in ast.walk(f.get(name,ast.Pass())))}); "
        "print(json.dumps(r,sort_keys=True))"
    )
    result = await environment.exec(
        command=f"python3 -c {shlex.quote(probe)} {shlex.quote(SOLVER_IMPLEMENTATION_PATH)}"
    )
    if result.return_code != 0:
        present = await _file_exists(environment, SOLVER_IMPLEMENTATION_PATH)
        checksum = await environment.exec(
            command=f"sha256sum -- {shlex.quote(SOLVER_IMPLEMENTATION_PATH)}"
        )
        digest = (checksum.stdout or "").split(maxsplit=1)[0].lower()
        return {
            "implementationPresent": present,
            "implementationBytes": 0,
            "implementationSha256": digest if _SHA256.fullmatch(digest) else None,
            "implementationSyntaxValid": False,
            "implementationContractPresent": False,
            "implementationSubstantive": False,
        }
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _load_repairable_challenger(
    store_path: str,
    *,
    task_name: str | None,
    instruction_digest: str,
) -> dict[str, Any] | None:
    """Load the strongest exact-task candidate as non-authoritative memory.

    The append-only capsule index makes exact retrieval proportional to the
    number of prior attempts for this mission, not the entire organism history.
    HRR handles approximate strategy recall elsewhere; executable source must
    always cross this exact digest boundary and be freshly observed in the new
    task sandbox before it can become even a repairable challenger.
    """

    if not _SHA256.fullmatch(instruction_digest):
        return None
    root = Path(store_path).expanduser().resolve()
    index = root / "capsules" / "by-instruction" / instruction_digest
    if not index.is_dir():
        return None
    eligible: list[tuple[tuple[int, ...], str, str, dict[str, Any]]] = []
    for ref_path in sorted(index.glob("*.ref"))[:2_048]:
        capsule_blob_digest = ref_path.read_text(encoding="utf-8").strip()
        if not _SHA256.fullmatch(capsule_blob_digest):
            continue
        capsule_bytes = _read_replay_blob(
            root,
            capsule_blob_digest,
            maximum_bytes=4_000_000,
        )
        capsule = json.loads(capsule_bytes)
        if not _valid_repair_capsule(
            capsule,
            instruction_digest=instruction_digest,
            task_name=task_name,
        ):
            continue
        repairable = (capsule.get("candidateLineage") or {}).get("repairableState") or {}
        source_record = repairable.get("source") or {}
        source_digest = str(source_record.get("digest") or "")
        stored_evidence = repairable.get("evidence") or {}
        if (
            not _SHA256.fullmatch(source_digest)
            or stored_evidence.get("implementationSha256") != source_digest
            or stored_evidence.get("implementationPresent") is not True
            or stored_evidence.get("implementationSyntaxValid") is not True
            or stored_evidence.get("implementationSubstantive") is not True
        ):
            continue
        source_bytes = _read_replay_blob(root, source_digest, maximum_bytes=2_000_000)
        if not source_bytes or b"\x00" in source_bytes:
            continue
        source = source_bytes.decode("utf-8")
        finished_at = str((capsule.get("execution") or {}).get("finishedAt") or "")[:100]
        eligible.append((
            (
                *_external_verifier_evidence_vector(capsule),
                *_challenger_evidence_vector(stored_evidence),
            ),
            finished_at,
            str(capsule.get("digest") or ""),
            {
                "source": source,
                "metadata": {
                    "capsuleDigest": capsule.get("digest"),
                    "capsuleBlobDigest": capsule_blob_digest,
                    "sourceDigest": source_digest,
                    "sourceRunId": (capsule.get("execution") or {}).get("sourceRunId"),
                    "sourceFinishedAt": finished_at or None,
                    "selection": repairable.get("selection"),
                    "taskSignature": (capsule.get("task") or {}).get("signature"),
                    "instructionDigest": instruction_digest,
                    "storedEvidence": stored_evidence,
                    "verifierEvidence": _bounded_external_verifier_evidence(
                        capsule.get("verifierEvidence")
                    ),
                    "failedChecks": _merge_repair_checks(capsule.get("failedChecks", [])),
                    "repairSignals": [
                        _bounded_repair_id(signal)
                        for signal in capsule.get("repairSignals", [])
                        if isinstance(signal, str) and signal.strip()
                    ][:64],
                },
            },
        ))
    if not eligible:
        return None
    eligible.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    return eligible[0][3]


def _valid_repair_capsule(
    capsule: Any,
    *,
    instruction_digest: str,
    task_name: str | None,
) -> bool:
    if not isinstance(capsule, dict):
        return False
    if (
        capsule.get("schema") != "amos.swarm-failure-capsule"
        or capsule.get("version") != 1
        or not _SHA256.fullmatch(str(capsule.get("digest") or ""))
    ):
        return False
    unsigned = {key: value for key, value in capsule.items() if key != "digest"}
    if capsule["digest"] != _canonical_digest(unsigned):
        return False
    task = capsule.get("task") or {}
    if task.get("instructionDigest") != instruction_digest:
        return False
    if task_name and not _same_task_name(str(task.get("name") or ""), task_name):
        return False
    task_identity = {
        "source": task.get("source"),
        "name": task.get("name"),
        "ref": task.get("ref"),
        "checksum": task.get("checksum"),
        "instructionDigest": task.get("instructionDigest"),
    }
    if task.get("signature") != _canonical_digest(task_identity):
        return False
    safeguards = capsule.get("safeguards") or {}
    if not (
        safeguards.get("authorityGrantedByHrr") is False
        and safeguards.get("repairReuseOnly") is True
        and safeguards.get("exactTaskMatchRequired") is True
        and safeguards.get("freshVerificationRequired") is True
        and safeguards.get("grantsCompletionCredit") is False
    ):
        return False
    repairable = (capsule.get("candidateLineage") or {}).get("repairableState") or {}
    return (
        repairable.get("available") is True
        and repairable.get("freshVerificationRequired") is True
        and repairable.get("grantsCompletionCredit") is False
    )


def _read_replay_blob(root: Path, digest: str, *, maximum_bytes: int) -> bytes:
    if not _SHA256.fullmatch(digest):
        raise ValueError("Replay blob digest is invalid")
    path = (root / "blobs" / digest[:2] / f"{digest}.blob").resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ValueError("Replay blob escaped its store root") from error
    data = path.read_bytes()
    if len(data) > maximum_bytes:
        raise ValueError(f"Replay blob {digest} exceeds its bounded size")
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Replay blob {digest} does not match its contents")
    return data


def _same_task_name(left: str, right: str) -> bool:
    normalized_left = left.strip().rstrip("/")
    normalized_right = right.strip().rstrip("/")
    return bool(normalized_left) and (
        normalized_left == normalized_right
        or normalized_left.rsplit("/", 1)[-1] == normalized_right.rsplit("/", 1)[-1]
    )


async def _initialize_candidate_incumbent(
    environment: BaseEnvironment,
    *,
    repairable_challenger: dict[str, Any] | None = None,
    capsule_load_error: str | None = None,
) -> None:
    await environment.exec(
        command=(
            f"mkdir -p {shlex.quote(INCUMBENT_DIR)} "
            f"{shlex.quote(CHALLENGER_DIR)} "
            f"{shlex.quote(CANDIDATE_BRANCHES_DIR)}"
        )
    )
    await _run_solver_program_if_present(environment)
    evidence = await _observe_construction_evidence(environment)
    await _copy_candidate_state(environment, INCUMBENT_DIR)
    await _write_host_json(environment, INCUMBENT_EVIDENCE_PATH, evidence)
    await _copy_candidate_state(environment, CHALLENGER_DIR)
    await _write_host_json(environment, CHALLENGER_EVIDENCE_PATH, evidence)
    evolution = {
        "schema": "amos.swarm-candidate-evolution",
        "version": 1,
        "selection": "monotonic-incumbent-with-repairable-challenger",
        "events": [],
        "incumbentEvidence": evidence,
        "challengerEvidence": evidence,
        "crossRunSeed": {
            "status": "not-configured" if repairable_challenger is None else "pending",
            "source": None,
            "freshEvidence": None,
            "loadError": capsule_load_error,
            "authority": {
                "hostObservedOnly": True,
                "grantsCompletionCredit": False,
                "bypassesVerifier": False,
            },
        },
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }
    if repairable_challenger is not None:
        source = str(repairable_challenger.get("source") or "")
        metadata = repairable_challenger.get("metadata") or {}
        await _write_host_text(environment, SOLVER_IMPLEMENTATION_PATH, source)
        await _run_solver_program_if_present(environment)
        restored_evidence = await _observe_construction_evidence(environment)
        accepted, reason = _challenger_evidence_preferred(evidence, restored_evidence)
        if accepted:
            await _copy_candidate_state(environment, CHALLENGER_DIR)
            await _write_host_json(
                environment,
                CHALLENGER_EVIDENCE_PATH,
                restored_evidence,
            )
            evolution["challengerEvidence"] = restored_evidence
            status = "restored-as-repairable-challenger"
        else:
            await _restore_candidate_state(environment, CHALLENGER_DIR)
            status = "rejected-after-fresh-observation"
        evolution["crossRunSeed"] = {
            "status": status,
            "reason": reason,
            "source": {
                "capsuleDigest": metadata.get("capsuleDigest"),
                "capsuleBlobDigest": metadata.get("capsuleBlobDigest"),
                "sourceDigest": metadata.get("sourceDigest"),
                "sourceRunId": metadata.get("sourceRunId"),
                "sourceFinishedAt": metadata.get("sourceFinishedAt"),
                "selection": metadata.get("selection"),
                "taskSignature": metadata.get("taskSignature"),
                "instructionDigest": metadata.get("instructionDigest"),
                "verifierEvidence": metadata.get("verifierEvidence"),
                "failedChecks": metadata.get("failedChecks", []),
                "repairSignals": metadata.get("repairSignals", []),
            },
            "storedEvidence": metadata.get("storedEvidence"),
            "freshEvidence": restored_evidence,
            "loadError": capsule_load_error,
            "authority": {
                "hostObservedOnly": True,
                "grantsCompletionCredit": False,
                "bypassesVerifier": False,
            },
        }
    await _write_host_json(environment, CANDIDATE_EVOLUTION_PATH, evolution)


async def _prepare_candidate_mutation(
    environment: BaseEnvironment,
    *,
    cycle: int,
) -> None:
    branch = f"{CANDIDATE_BRANCHES_DIR}/cycle-{cycle:02d}"
    await environment.exec(command=f"mkdir -p {shlex.quote(branch)}")
    await _restore_candidate_state(environment, CHALLENGER_DIR)
    await environment.exec(command=f"rm -f -- {shlex.quote(MUTATION_RECEIPT_PATH)}")
    await environment.exec(
        command=(
            f"cp {shlex.quote(SOLVER_IMPLEMENTATION_PATH)} "
            f"{shlex.quote(f'{branch}/seed.py')}"
        )
    )
    challenger = await _read_optional_host_json(environment, CHALLENGER_EVIDENCE_PATH)
    if challenger is not None:
        await _write_host_json(environment, f"{branch}/seed-evidence.json", challenger)


async def _checkpoint_candidate_mutation(
    environment: BaseEnvironment,
    *,
    cycle: int,
    status: str,
    candidate_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist a non-authoritative candidate lease boundary.

    The outer Harbor timeout can cancel a long specialist before the normal
    settlement path runs. This checkpoint binds the current implementation
    bytes, host-observed evidence, diagnosis, and repair input to the exact
    candidate cycle. It is replayable only as repair state and grants neither
    promotion nor completion credit.
    """

    normalized_status = str(status or "unknown").strip()[:100] or "unknown"
    branch = f"{CANDIDATE_BRANCHES_DIR}/cycle-{max(1, int(cycle)):02d}"
    await environment.exec(command=f"mkdir -p {shlex.quote(branch)}")
    evidence = candidate_evidence or await _observe_construction_evidence(environment)
    challenger = (
        await _read_optional_host_json(environment, CHALLENGER_EVIDENCE_PATH)
        or {}
    )
    diagnosis = await _read_optional_host_json(
        environment,
        CONSTRUCTION_DIAGNOSIS_PATH,
    )
    feedback = await _read_optional_host_json(
        environment,
        CONSTRUCTION_FEEDBACK_PATH,
    )
    receipt = await _read_optional_host_json(environment, MUTATION_RECEIPT_PATH)
    source_digest = str(challenger.get("implementationSha256") or "")
    result_digest = str(evidence.get("implementationSha256") or "")
    changed = bool(
        _SHA256.fullmatch(source_digest)
        and _SHA256.fullmatch(result_digest)
        and source_digest != result_digest
    )
    receipt_valid = _mutation_receipt_matches(
        receipt,
        source_digest=source_digest,
        result_digest=result_digest,
    )
    await _copy_candidate_state(environment, branch)
    checkpoint = {
        "schema": "amos.swarm-candidate-checkpoint",
        "version": 1,
        "cycle": max(1, int(cycle)),
        "status": normalized_status,
        "branch": branch,
        "sourceDigest": source_digest if _SHA256.fullmatch(source_digest) else None,
        "candidateDigest": result_digest if _SHA256.fullmatch(result_digest) else None,
        "implementationChanged": changed,
        "substantiveMutation": (
            changed
            and evidence.get("implementationSyntaxValid") is True
            and evidence.get("implementationSubstantive") is True
        ),
        "mutationReceiptValid": receipt_valid,
        "candidateEvidence": evidence,
        "repairDiagnosis": _bounded_repair_diagnosis(diagnosis),
        "strategyFingerprint": _repair_strategy_fingerprint(diagnosis),
        "inputEvidenceDigest": (
            str(feedback.get("evidenceDigest") or "")
            if isinstance(feedback, dict)
            and _SHA256.fullmatch(str(feedback.get("evidenceDigest") or ""))
            else None
        ),
        "authority": {
            "hostObservedOnly": True,
            "repairReuseOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }
    await _write_host_json(environment, CANDIDATE_CHECKPOINT_PATH, checkpoint)
    await _write_host_json(environment, f"{branch}/checkpoint.json", checkpoint)
    evolution = await _read_optional_host_json(environment, CANDIDATE_EVOLUTION_PATH) or {
        "schema": "amos.swarm-candidate-evolution",
        "version": 1,
        "events": [],
    }
    evolution["pendingCheckpoint"] = checkpoint
    evolution["lastCheckpoint"] = checkpoint
    await _write_host_json(environment, CANDIDATE_EVOLUTION_PATH, evolution)
    return checkpoint


async def _settle_candidate_mutation(
    environment: BaseEnvironment,
    *,
    cycle: int,
    candidate_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    branch = f"{CANDIDATE_BRANCHES_DIR}/cycle-{cycle:02d}"
    candidate = candidate_evidence or await _observe_construction_evidence(environment)
    incumbent = await _read_optional_host_json(environment, INCUMBENT_EVIDENCE_PATH) or {}
    challenger = await _read_optional_host_json(environment, CHALLENGER_EVIDENCE_PATH) or incumbent
    source_digest = str(challenger.get("implementationSha256") or "")
    result_digest = str(candidate.get("implementationSha256") or "")
    implementation_changed = bool(
        _SHA256.fullmatch(source_digest)
        and _SHA256.fullmatch(result_digest)
        and source_digest != result_digest
    )
    substantive_mutation = bool(
        implementation_changed
        and candidate.get("implementationSyntaxValid") is True
        and candidate.get("implementationSubstantive") is True
    )
    if not implementation_changed:
        promoted, reason = False, "no-implementation-change"
        challenger_advanced, challenger_reason = False, "no-implementation-change"
    elif not substantive_mutation:
        promoted, reason = False, "non-substantive-implementation-change"
        challenger_advanced, challenger_reason = (
            False,
            "non-substantive-implementation-change",
        )
    else:
        promoted, reason = _candidate_evidence_preferred(incumbent, candidate)
        challenger_advanced, challenger_reason = _challenger_evidence_preferred(
            challenger,
            candidate,
        )
    await _copy_candidate_state(environment, branch)
    await _write_host_json(environment, f"{branch}/candidate-evidence.json", candidate)
    mutation_receipt = await _read_optional_host_json(environment, MUTATION_RECEIPT_PATH)
    receipt_valid = _mutation_receipt_matches(
        mutation_receipt,
        source_digest=source_digest,
        result_digest=result_digest,
    )
    diagnosis = await _read_optional_host_json(
        environment,
        CONSTRUCTION_DIAGNOSIS_PATH,
    )
    if promoted:
        await _copy_candidate_state(environment, INCUMBENT_DIR)
        await _write_host_json(environment, INCUMBENT_EVIDENCE_PATH, candidate)
        incumbent_after = candidate
        await _copy_candidate_state(environment, CHALLENGER_DIR)
        await _write_host_json(environment, CHALLENGER_EVIDENCE_PATH, candidate)
        challenger_after = candidate
        challenger_advanced = True
        challenger_reason = "authoritative-promotion"
    elif challenger_advanced:
        incumbent_after = incumbent
        await _copy_candidate_state(environment, CHALLENGER_DIR)
        await _write_host_json(environment, CHALLENGER_EVIDENCE_PATH, candidate)
        challenger_after = candidate
    else:
        incumbent_after = incumbent
        challenger_after = challenger

    # The next repair lease always sees the best repairable challenger. The
    # incumbent stays separately archived as the only authoritative state.
    await _restore_candidate_state(environment, CHALLENGER_DIR)
    event = {
        "cycle": cycle,
        "branch": branch,
        "seedDigest": challenger.get("implementationSha256"),
        "mutationDigest": candidate.get("implementationSha256"),
        "implementationChanged": implementation_changed,
        "substantiveMutation": substantive_mutation,
        "promoted": promoted,
        "reason": reason,
        "challengerAdvanced": challenger_advanced,
        "challengerReason": challenger_reason,
        "transport": "bounded-atomic-mutation" if receipt_valid else "legacy-terminal-write",
        "mutationReceiptValid": receipt_valid,
        "repairDiagnosis": _bounded_repair_diagnosis(diagnosis),
        "strategyFingerprint": _repair_strategy_fingerprint(diagnosis),
        "incumbentEvidenceBefore": incumbent,
        "challengerEvidenceBefore": challenger,
        "mutationEvidence": candidate,
        "incumbentEvidenceAfter": incumbent_after,
        "challengerEvidenceAfter": challenger_after,
        "monotonic": not _candidate_evidence_regressed(incumbent, incumbent_after),
    }
    evolution = await _read_optional_host_json(environment, CANDIDATE_EVOLUTION_PATH) or {
        "schema": "amos.swarm-candidate-evolution",
        "version": 1,
        "events": [],
    }
    evolution.setdefault("events", []).append(event)
    evolution["incumbentEvidence"] = incumbent_after
    evolution["challengerEvidence"] = challenger_after
    pending_checkpoint = evolution.get("pendingCheckpoint")
    if isinstance(pending_checkpoint, dict):
        evolution["lastCheckpoint"] = {
            **pending_checkpoint,
            "status": "settled",
            "settlement": _bounded_mutation_settlement(event),
        }
    evolution["pendingCheckpoint"] = None
    await _write_host_json(environment, CANDIDATE_EVOLUTION_PATH, evolution)
    await _write_host_json(environment, f"{branch}/selection.json", event)
    return event


async def _copy_candidate_state(environment: BaseEnvironment, destination: str) -> None:
    await environment.exec(command=f"mkdir -p {shlex.quote(destination)}")
    for source, name in (
        (SOLVER_IMPLEMENTATION_PATH, "solver_impl.py"),
        (SOLVER_EXECUTION_PATH, "solver-execution.json"),
        (SELF_CHECK_PATH, "self-check.json"),
        (CANDIDATE_STATUS_PATH, "candidate-status.json"),
        (CONSTRUCTION_DIAGNOSIS_PATH, "construction-diagnosis.json"),
        (MUTATION_RECEIPT_PATH, "mutation-receipt.json"),
    ):
        if await _file_exists(environment, source):
            await environment.exec(
                command=f"cp {shlex.quote(source)} {shlex.quote(f'{destination}/{name}')}"
            )


async def _restore_candidate_state(environment: BaseEnvironment, source: str) -> None:
    targets = (
        SOLVER_IMPLEMENTATION_PATH,
        SOLVER_EXECUTION_PATH,
        SELF_CHECK_PATH,
        CANDIDATE_STATUS_PATH,
        CONSTRUCTION_DIAGNOSIS_PATH,
    )
    await environment.exec(
        command="rm -f -- " + " ".join(shlex.quote(path) for path in targets)
    )
    for name, target in (
        ("solver_impl.py", SOLVER_IMPLEMENTATION_PATH),
        ("solver-execution.json", SOLVER_EXECUTION_PATH),
        ("self-check.json", SELF_CHECK_PATH),
        ("candidate-status.json", CANDIDATE_STATUS_PATH),
        ("construction-diagnosis.json", CONSTRUCTION_DIAGNOSIS_PATH),
    ):
        candidate = f"{source}/{name}"
        if await _file_exists(environment, candidate):
            await environment.exec(
                command=f"cp {shlex.quote(candidate)} {shlex.quote(target)}"
            )


def _candidate_evidence_preferred(
    incumbent: dict[str, Any],
    candidate: dict[str, Any],
) -> tuple[bool, str]:
    if _candidate_evidence_regressed(incumbent, candidate):
        return False, "objective-evidence-regression"
    before = _candidate_evidence_vector(incumbent)
    after = _candidate_evidence_vector(candidate)
    if after > before:
        return True, "objective-evidence-improved"
    if (
        candidate.get("implementationSha256")
        and candidate.get("implementationSha256") == incumbent.get("implementationSha256")
    ):
        return False, "no-implementation-change"
    return False, "no-objective-evidence-improvement"


def _challenger_evidence_preferred(
    challenger: dict[str, Any],
    candidate: dict[str, Any],
) -> tuple[bool, str]:
    """Select a repairable working branch without granting promotion credit.

    Unlike the protected incumbent, a challenger may temporarily lose the
    complete construct/verify interface while replacing a scaffold with real
    logic. It must remain present, syntactically valid, changed, and stronger
    on host-observed repair evidence. Model prose is never part of selection.
    """

    if (
        candidate.get("implementationPresent") is not True
        or candidate.get("implementationSyntaxValid") is not True
    ):
        return False, "unrepairable-candidate"
    if (
        candidate.get("implementationSha256")
        and candidate.get("implementationSha256")
        == challenger.get("implementationSha256")
    ):
        return False, "no-implementation-change"
    if _challenger_evidence_vector(candidate) > _challenger_evidence_vector(challenger):
        return True, "repair-evidence-improved"
    return False, "no-repair-evidence-improvement"


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


def _external_verifier_evidence_vector(capsule: dict[str, Any]) -> tuple[int, ...]:
    verifier = _bounded_external_verifier_evidence(capsule.get("verifierEvidence"))
    if verifier is None:
        return (0, 0, 0, 0, 0)
    return (
        1,
        int(float(verifier.get("reward") or 0) > 0),
        int(round(float(verifier.get("qualityFraction") or 0) * 1_000_000)),
        int(verifier.get("passedChecks") or 0),
        -int(verifier.get("failedChecks") or 0),
    )


def _bounded_external_verifier_evidence(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("present") is not True:
        return None
    authority = value.get("authority") or {}
    if not (
        authority.get("hostObservedOnly") is True
        and authority.get("grantsCompletionCredit") is False
        and authority.get("bypassesVerifier") is False
    ):
        return None
    total = _bounded_nonnegative_integer(value.get("totalChecks"), maximum=1_000_000)
    passed = _bounded_nonnegative_integer(
        value.get("passedChecks"), maximum=total or 1_000_000
    )
    failed = _bounded_nonnegative_integer(
        value.get("failedChecks"), maximum=total or 1_000_000
    )
    return {
        "present": True,
        "source": str(value.get("source") or "unknown")[:500],
        "status": str(value.get("status") or "unknown")[:200],
        "reward": value.get("reward") if isinstance(value.get("reward"), (int, float)) else None,
        "totalChecks": total,
        "passedChecks": passed,
        "failedChecks": failed,
        "qualityFraction": (passed / total) if total > 0 else 0,
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }


def _bounded_nonnegative_integer(value: Any, *, maximum: int) -> int:
    try:
        number = int(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0
    return max(0, min(maximum, number))


def _construction_exhaustion_record(
    *,
    board: dict[str, Any],
    cycle: int,
    incumbent: dict[str, Any],
    challenger: dict[str, Any],
) -> dict[str, Any]:
    """Record bounded agent exhaustion as evidence for the official scorer."""

    return {
        "schema": "amos.swarm-construction-exhaustion",
        "version": 1,
        "status": "official-verifier-handoff",
        "cycle": max(1, int(cycle)),
        "boardPhase": str(board.get("phase") or "unknown")[:200],
        "taskDigest": board.get("taskDigest"),
        "incumbentEvidence": incumbent,
        "challengerEvidence": challenger,
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesOfficialVerifier": False,
        },
    }


def _verifier_contract_handoff_record(
    *,
    phase: str,
    board: dict[str, Any],
    candidate_evidence: dict[str, Any],
    error: RuntimeError,
) -> dict[str, Any]:
    """Record an internal transport failure without claiming task success."""

    return {
        "schema": "amos.swarm-verifier-handoff",
        "version": 1,
        "status": "official-verifier-handoff",
        "phase": str(phase)[:200],
        "reason": "internal-verifier-contract-recovery-exhausted",
        "taskDigest": board.get("taskDigest"),
        "boardDigest": _canonical_digest(board),
        "candidateEvidence": candidate_evidence,
        "internalError": str(error)[:2_000],
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesInternalVerifier": True,
            "bypassesOfficialVerifier": False,
        },
    }


def _candidate_evidence_regressed(
    incumbent: dict[str, Any],
    candidate: dict[str, Any],
) -> bool:
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


def _candidate_evidence_vector(value: dict[str, Any]) -> tuple[int, ...]:
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


def _mutation_receipt_matches(
    receipt: dict[str, Any] | None,
    *,
    source_digest: str,
    result_digest: str,
) -> bool:
    return bool(
        isinstance(receipt, dict)
        and receipt.get("schema") == "amos.swarm-mutation-receipt"
        and receipt.get("version") == 1
        and receipt.get("sourceSha256") == source_digest
        and receipt.get("resultSha256") == result_digest
        and receipt.get("syntaxValid") is True
        and receipt.get("interfaceValid") is True
        and receipt.get("authority", {}).get("hostObservedOnly") is True
        and receipt.get("authority", {}).get("grantsCompletionCredit") is False
    )


async def _observe_construction_evidence(
    environment: BaseEnvironment,
) -> dict[str, Any]:
    """Read only bounded, host-checkable construction milestones."""
    self_check = await _read_optional_host_json(environment, SELF_CHECK_PATH)
    candidate_status = await _read_optional_host_json(environment, CANDIDATE_STATUS_PATH)
    solver_execution = await _read_optional_host_json(environment, SOLVER_EXECUTION_PATH)
    construction_brief = await _read_optional_host_json(environment, CONSTRUCTION_BRIEF_PATH)
    required_criteria = (
        construction_brief.get("criterionContracts", [])
        if isinstance(construction_brief, dict)
        else []
    )
    failed_checks = _extract_failed_self_checks(
        self_check,
        required_criteria=required_criteria,
    )
    failed_checks.extend(_construction_contract_failures(
        self_check,
        candidate_status,
        required_criteria=required_criteria,
    ))
    contract_diagnostics = _candidate_contract_diagnostics(
        self_check,
        candidate_status,
        required_criteria=required_criteria,
    ) if self_check is not None else {}
    receipt_contract_valid = False
    if candidate_status is not None and not contract_diagnostics:
        try:
            await _verify_receipts(environment, candidate_status)
            receipt_contract_valid = True
        except RuntimeError:
            receipt_contract_valid = False
    probe = await _implementation_probe(environment)
    return {
        **probe,
        "solverPresent": await _file_exists(environment, SOLVER_PATH),
        "solverExecutionPresent": solver_execution is not None,
        "solverSucceeded": solver_execution is not None
        and solver_execution.get("succeeded") is True,
        "selfCheckPresent": self_check is not None,
        "selfCheckAllPass": self_check is not None
        and self_check.get("all_pass") is True
        and not contract_diagnostics,
        "candidateStatusPresent": candidate_status is not None,
        "candidateAllPass": candidate_status is not None
        and candidate_status.get("verification", {}).get("all_pass") is True
        and not contract_diagnostics
        and receipt_contract_valid,
        "candidateReceiptContractValid": receipt_contract_valid,
        "candidateContractDiagnostics": contract_diagnostics,
        "failedCheckCount": len(failed_checks),
        "failedCheckIds": [
            str(check.get("id") or "")[:200]
            for check in failed_checks
            if isinstance(check, dict) and str(check.get("id") or "").strip()
        ][:64],
        "artifactReceiptCount": len(candidate_status.get("artifactReceipts", []))
        if isinstance(candidate_status, dict)
        and isinstance(candidate_status.get("artifactReceipts"), list)
        else 0,
        "testReceiptCount": len(candidate_status.get("testReceipts", []))
        if isinstance(candidate_status, dict)
        and isinstance(candidate_status.get("testReceipts"), list)
        else 0,
    }


def _construction_progress_receipts(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Mint bounded partial credit only for verified construction improvement."""
    previous = _normalize_construction_evidence(before)
    current = _normalize_construction_evidence(after)
    # A file that exists and exits zero can still be an empty scaffold. Reward
    # only closed-loop evidence: a deterministic self-check, a candidate
    # receipt contract, or a reduction in already-observed failed checks.
    milestones = [
        field
        for field in (
            "selfCheckPresent",
            "selfCheckAllPass",
            "candidateStatusPresent",
            "candidateAllPass",
        )
        if current[field] and not previous[field]
    ]
    failure_reduction = max(
        0,
        previous["failedCheckCount"] - current["failedCheckCount"],
    ) if previous["selfCheckPresent"] and current["selfCheckPresent"] else 0
    before_score = _construction_evidence_score(previous)
    after_score = _construction_evidence_score(current)
    if not milestones and failure_reduction <= 0:
        return []
    solution_quality_improved = (
        failure_reduction > 0
        or (current["candidateAllPass"] and not previous["candidateAllPass"])
        or (current["selfCheckAllPass"] and not previous["selfCheckAllPass"])
    )
    state = {
        "before": previous,
        "after": current,
        "milestonesAdded": milestones,
        "failedChecksRemoved": failure_reduction,
        "scoreBefore": before_score,
        "scoreAfter": after_score,
        "creditClass": "solution" if solution_quality_improved else "epistemic",
        "solutionQualityImproved": solution_quality_improved,
    }
    return [{
        "kind": "construction-progress",
        **state,
        "evidenceDigest": _canonical_digest(state),
        "verifiedBy": "amos-host-construction-probe",
        "grantsCompletionCredit": False,
    }]


def _normalize_construction_evidence(value: dict[str, Any] | None) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    try:
        failed_check_count = max(0, int(source.get("failedCheckCount") or 0))
    except (TypeError, ValueError):
        failed_check_count = 0
    return {
        "implementationPresent": source.get("implementationPresent") is True,
        "implementationSyntaxValid": source.get("implementationSyntaxValid") is True,
        "implementationContractPresent": source.get("implementationContractPresent") is True,
        "implementationSubstantive": source.get("implementationSubstantive") is True,
        "solverPresent": source.get("solverPresent") is True,
        "solverExecutionPresent": source.get("solverExecutionPresent") is True,
        "solverSucceeded": source.get("solverSucceeded") is True,
        "selfCheckPresent": source.get("selfCheckPresent") is True,
        "selfCheckAllPass": source.get("selfCheckAllPass") is True,
        "candidateStatusPresent": source.get("candidateStatusPresent") is True,
        "candidateAllPass": source.get("candidateAllPass") is True,
        "failedCheckCount": failed_check_count,
    }


def _construction_evidence_score(value: dict[str, Any]) -> int:
    return sum(int(value[field]) for field in (
        "implementationPresent",
        "implementationSyntaxValid",
        "implementationContractPresent",
        "implementationSubstantive",
        "solverPresent",
        "solverExecutionPresent",
        "solverSucceeded",
        "selfCheckPresent",
        "selfCheckAllPass",
        "candidateStatusPresent",
        "candidateAllPass",
    )) - min(5, int(value["failedCheckCount"]))


def _extract_failed_self_checks(
    source: dict[str, Any] | None,
    *,
    required_criteria: list[dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    if not isinstance(source, dict):
        return []
    raw_checks = source.get("checks")
    if raw_checks is None:
        # The host-owned runtime requires this typed verifier-compatible shape.
        # Keep accepting the earlier `checks` and flat-map formats so prior
        # capsules remain repairable across harness versions.
        raw_checks = source.get("criteria")
    if isinstance(raw_checks, dict):
        checks = [
            {"id": key, **(value if isinstance(value, dict) else {"status": value})}
            for key, value in raw_checks.items()
        ]
    elif isinstance(raw_checks, list):
        checks = [value for value in raw_checks if isinstance(value, dict)]
    elif raw_checks is None:
        # Deterministic solvers commonly emit a compact flat map such as
        # {"capacity_ok": false, "row_count": 17, "all_pass": false}.
        # Treat only boolean leaves as checks; numeric/string leaves are
        # bounded observations that make a failed check actionable.
        observations = ", ".join(
            f"{key}={value}"
            for key, value in sorted(source.items())
            if key not in {"all_pass", "checks", "criteria", "failures"}
            and not isinstance(value, (dict, list, bool))
        )[:1_000]
        checks = [
            {
                "id": key,
                "status": value,
                "detail": (
                    f"Top-level deterministic check `{key}` reported false."
                    + (f" Observed metrics: {observations}." if observations else "")
                ),
            }
            for key, value in source.items()
            if key != "all_pass" and isinstance(value, bool)
        ]
    else:
        checks = []
    failures: list[dict[str, str]] = []
    for index, check in enumerate(checks[:128]):
        status = check.get("status")
        passed = (
            check.get("pass") is True
            or check.get("passed") is True
            or status is True
            or (
                isinstance(status, str)
                and status.strip().lower() in {"pass", "passed", "ok", "success"}
            )
        )
        if passed:
            continue
        identifier = _bounded_repair_id(check.get("id") or check.get("name") or f"check-{index + 1}")
        detail = str(
            check.get("detail")
            or check.get("evidence")
            or check.get("message")
            or check.get("error")
            or "Deterministic check failed."
        ).strip()[:1_000]
        failures.append({"id": identifier, "detail": detail})
    for index, failure in enumerate(source.get("failures", []) if isinstance(source.get("failures"), list) else []):
        if len(failures) >= 128:
            break
        if isinstance(failure, str):
            failures.append({
                "id": f"failure-{index + 1}",
                "detail": failure.strip()[:1_000] or "Deterministic check failed.",
            })
        elif isinstance(failure, dict):
            failures.append({
                "id": _bounded_repair_id(failure.get("id") or failure.get("name") or f"failure-{index + 1}"),
                "detail": str(failure.get("detail") or failure.get("message") or "Deterministic check failed.").strip()[:1_000],
            })
    criterion_statements = {
        str(item.get("id") or "").strip(): str(item.get("statement") or "").strip()
        for item in (required_criteria or [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        and str(item.get("statement") or "").strip()
    }
    for failure in failures:
        statement = criterion_statements.get(failure["id"])
        if statement:
            failure["detail"] = (
                f"Required criterion: {statement[:700]} Observed evidence: "
                f"{failure['detail'][:700]}"
            )[:1_000]
    return sorted(failures, key=lambda item: (item["id"], item["detail"]))


def _merge_repair_checks(*groups: list[dict[str, Any]]) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    for check in (item for group in groups for item in group):
        if not isinstance(check, dict) or len(merged) >= 128:
            continue
        normalized = {
            "id": _bounded_repair_id(check.get("id") or f"check-{len(merged) + 1}"),
            "detail": str(
                check.get("detail") or "Deterministic check failed."
            ).strip()[:1_000],
        }
        if normalized not in merged:
            merged.append(normalized)
    return sorted(merged, key=lambda item: (item["id"], item["detail"]))


def _inherited_verifier_feedback(
    candidate_evolution: dict[str, Any] | None,
) -> dict[str, Any]:
    cross_run = (
        candidate_evolution.get("crossRunSeed")
        if isinstance(candidate_evolution, dict)
        else None
    )
    if (
        not isinstance(cross_run, dict)
        or cross_run.get("status") != "restored-as-repairable-challenger"
    ):
        return {"failedChecks": [], "repairSignals": [], "verifierEvidence": None}
    source = cross_run.get("source") or {}
    verifier = source.get("verifierEvidence") or {}
    authority = verifier.get("authority") or {}
    if not (
        isinstance(verifier, dict)
        and verifier.get("present") is True
        and authority.get("hostObservedOnly") is True
        and authority.get("grantsCompletionCredit") is False
        and authority.get("bypassesVerifier") is False
    ):
        return {"failedChecks": [], "repairSignals": [], "verifierEvidence": None}
    failed_checks = _merge_repair_checks(source.get("failedChecks", []))
    repair_signals = sorted({
        _bounded_repair_id(signal)
        for signal in source.get("repairSignals", [])
        if isinstance(signal, str) and signal.strip()
    })[:64]
    return {
        "failedChecks": failed_checks,
        "repairSignals": repair_signals,
        "verifierEvidence": _bounded_external_verifier_evidence(verifier),
    }


def _construction_repair_signals(
    failed_checks: list[dict[str, str]],
    candidate_status: dict[str, Any] | None,
    *,
    solver_execution: dict[str, Any] | None = None,
    self_check_present: bool = True,
) -> list[str]:
    evidence = " ".join(
        part.lower() for check in failed_checks for part in (check["id"], check["detail"])
    )
    signals = []
    if re.search(r"inventory|stock|lot|material|component|substitut|bom|reserv|allocat", evidence):
        signals.append("inventory-substitution-feasibility")
    if re.search(r"shift|capacity|downtime|changeover|schedule|dispatch", evidence):
        signals.append("finite-capacity-interval-repair")
    if re.search(r"demand|sales order|work order|priority|non[- ]?wip", evidence):
        signals.append("demand-coverage-repair")
    if re.search(r"empty|zero|missing|fewer|\b0\b|no .*output|no .*row", evidence):
        signals.append("empty-output-repair")
    if solver_execution is None:
        signals.append("solver-not-executed")
    elif solver_execution.get("succeeded") is not True:
        signals.append("solver-runtime-failure")
    if not self_check_present:
        signals.append("self-check-missing")
    if candidate_status is None:
        signals.append("candidate-status-missing")
    if candidate_status is None or candidate_status.get("verification", {}).get("all_pass") is not True:
        signals.append("candidate-contract-incomplete")
    return sorted(set(signals or ["evidence-directed-repair"]))


def _construction_repair_principles(signals: list[str]) -> list[str]:
    principles = [
        "Change the smallest general algorithmic assumption that explains the failed evidence.",
        "Re-run all prior passing checks after the repair; a local fix may not regress them.",
    ]
    if "inventory-substitution-feasibility" in signals:
        principles.append(
            "Treat approved substitute groups as one requirement, allocate only eligible lots, and reserve atomically from a shared inventory ledger."
        )
    if "finite-capacity-interval-repair" in signals:
        principles.append(
            "Represent shifts as remaining free intervals after downtime, existing work, and changeovers; do not discard an entire shift because one interval is blocked."
        )
    if "demand-coverage-repair" in signals:
        principles.append(
            "Trace demand eligibility and rejection reasons before scheduling; preserve priority ordering while maximizing feasible coverage."
        )
    if "empty-output-repair" in signals:
        principles.append(
            "Trace the first filter that removes every candidate and emit bounded rejection counts before loosening any constraint."
        )
    if "solver-not-executed" in signals or "solver-runtime-failure" in signals:
        principles.append(
            "Preserve the existing executable and repair the earliest host-observed runtime boundary before adding features."
        )
    if "self-check-missing" in signals or "candidate-status-missing" in signals:
        principles.append(
            "Complete the durable candidate contract before inspecting more source data; use the saved typed inputs programmatically."
        )
    return principles


def _construction_required_actions(signals: list[str]) -> list[str]:
    actions = [
        f"Patch the existing solver implementation at {SOLVER_IMPLEMENTATION_PATH}; "
        f"never edit the host runtime at {SOLVER_PATH} and do not restart discovery."
    ]
    if "solver-not-executed" in signals or "solver-runtime-failure" in signals:
        actions.append(
            "Run the solver in the first terminal batch and repair its earliest failing boundary."
        )
    if "self-check-missing" in signals:
        actions.append(
            f"Write the deterministic self-check at {SELF_CHECK_PATH} before reading more inputs."
        )
    if "candidate-status-missing" in signals:
        actions.append(
            f"Write the candidate contract and actual receipts at {CANDIDATE_STATUS_PATH}."
        )
    if any(signal not in {
        "solver-not-executed",
        "solver-runtime-failure",
        "self-check-missing",
        "candidate-status-missing",
        "candidate-contract-incomplete",
    } for signal in signals):
        actions.append("Address every failed deterministic check without regressing prior passes.")
    actions.append("Preserve receipts for candidate artifacts and deterministic checks.")
    return actions


def _bounded_repair_diagnosis(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    failed_check_ids = [
        _bounded_repair_id(item)
        for item in value.get("failedCheckIds", [])
        if isinstance(item, str) and item.strip()
    ][:64]
    supporting_metrics = {
        str(key)[:200]: metric
        for key, metric in (value.get("supportingMetrics") or {}).items()
        if isinstance(key, str)
        and isinstance(metric, (str, int, float, bool))
    } if isinstance(value.get("supportingMetrics"), dict) else {}
    bounded = {
        "schema": str(value.get("schema") or "")[:200],
        "version": value.get("version"),
        "evidenceDigest": str(value.get("evidenceDigest") or "")[:64] or None,
        "observation": str(value.get("observation") or "")[:4_000],
        "hypothesis": str(value.get("hypothesis") or "")[:4_000],
        "nextAction": str(value.get("nextAction") or "")[:4_000],
        "failedCheckIds": failed_check_ids,
        "supportingMetrics": supporting_metrics,
        "authority": {
            "modelHypothesisOnly": value.get("authority", {}).get(
                "modelHypothesisOnly"
            ) is True,
            "grantsCompletionCredit": value.get("authority", {}).get(
                "grantsCompletionCredit"
            ) is True,
        },
    }
    return bounded


def _repair_strategy_fingerprint(value: Any) -> str | None:
    diagnosis = _bounded_repair_diagnosis(value)
    if not isinstance(diagnosis, dict):
        return None
    if not diagnosis.get("hypothesis") or not diagnosis.get("nextAction"):
        return None
    return _canonical_digest({
        "hypothesis": diagnosis["hypothesis"].strip().lower(),
        "nextAction": diagnosis["nextAction"].strip().lower(),
        "failedCheckIds": sorted(set(diagnosis["failedCheckIds"])),
    })


def _bounded_mutation_settlement(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    return {
        "cycle": max(0, int(value.get("cycle") or 0)),
        "seedDigest": (
            str(value.get("seedDigest"))
            if _SHA256.fullmatch(str(value.get("seedDigest") or ""))
            else None
        ),
        "mutationDigest": (
            str(value.get("mutationDigest"))
            if _SHA256.fullmatch(str(value.get("mutationDigest") or ""))
            else None
        ),
        "implementationChanged": value.get("implementationChanged") is True,
        "substantiveMutation": value.get("substantiveMutation") is True,
        "promoted": value.get("promoted") is True,
        "reason": str(value.get("reason") or "unknown")[:200],
        "challengerAdvanced": value.get("challengerAdvanced") is True,
        "challengerReason": str(value.get("challengerReason") or "unknown")[:200],
        "mutationReceiptValid": value.get("mutationReceiptValid") is True,
        "strategyFingerprint": (
            str(value.get("strategyFingerprint"))
            if _SHA256.fullmatch(str(value.get("strategyFingerprint") or ""))
            else None
        ),
    }


def _repair_agenda(
    *,
    failed_checks: list[dict[str, str]],
    repair_signals: list[str],
    candidate_evolution: dict[str, Any] | None,
) -> dict[str, Any]:
    """Turn verifier evidence into a generic, non-authoritative search agenda."""

    evolution = candidate_evolution if isinstance(candidate_evolution, dict) else {}
    attempts = []
    for event in evolution.get("events", [])[-32:]:
        if not isinstance(event, dict):
            continue
        settlement = _bounded_mutation_settlement(event)
        if settlement is None:
            continue
        diagnosis = _bounded_repair_diagnosis(event.get("repairDiagnosis"))
        attempts.append({
            **settlement,
            "strategyFingerprint": (
                settlement.get("strategyFingerprint")
                or _repair_strategy_fingerprint(event.get("repairDiagnosis"))
            ),
            "failedCheckIds": diagnosis.get("failedCheckIds", []) if diagnosis else [],
            "hypothesis": diagnosis.get("hypothesis") if diagnosis else None,
            "nextAction": diagnosis.get("nextAction") if diagnosis else None,
        })
    check_ids = [check["id"] for check in failed_checks]
    signal_patterns = {
        "inventory-substitution-feasibility": re.compile(
            r"inventory|stock|lot|material|component|substitut|bom|reserv|allocat",
            re.I,
        ),
        "finite-capacity-interval-repair": re.compile(
            r"shift|capacity|downtime|changeover|schedule|dispatch|calendar",
            re.I,
        ),
        "demand-coverage-repair": re.compile(
            r"demand|sales[-_ ]?order|work[-_ ]?order|priority|coverage|date",
            re.I,
        ),
        "empty-output-repair": re.compile(
            r"empty|zero|missing|output|record|row|writeback|run[-_ ]?id",
            re.I,
        ),
    }
    clusters = []
    assigned: set[str] = set()
    for signal in repair_signals:
        pattern = signal_patterns.get(signal)
        related = [
            check["id"]
            for check in failed_checks
            if pattern and pattern.search(f"{check['id']} {check['detail']}")
        ]
        if not related:
            continue
        assigned.update(related)
        attempts_for_cluster = sum(
            1
            for attempt in attempts
            if set(attempt.get("failedCheckIds", [])) & set(related)
        )
        clusters.append({
            "id": signal,
            "failedCheckIds": related,
            "attemptCount": attempts_for_cluster,
            "objective": (
                "Derive one general invariant from the task contract and these independent "
                "check names, implement it in the solver, and add a local reproduction that "
                "does not depend on hidden verifier code."
            ),
        })
    unassigned = [identifier for identifier in check_ids if identifier not in assigned]
    if unassigned:
        clusters.append({
            "id": "unclassified-verifier-evidence",
            "failedCheckIds": unassigned,
            "attemptCount": sum(
                1
                for attempt in attempts
                if set(attempt.get("failedCheckIds", [])) & set(unassigned)
            ),
            "objective": (
                "Trace the named observable back to the explicit task contract, reproduce the "
                "failure with public inputs, and repair the smallest general algorithmic cause."
            ),
        })
    preferred = min(
        clusters,
        key=lambda cluster: (
            int(cluster["attemptCount"]),
            -len(cluster["failedCheckIds"]),
            cluster["id"],
        ),
    ) if clusters else None
    rejected_fingerprints = sorted({
        str(attempt.get("strategyFingerprint"))
        for attempt in attempts
        if _SHA256.fullmatch(str(attempt.get("strategyFingerprint") or ""))
        and not (
            attempt.get("promoted") is True
            or attempt.get("challengerAdvanced") is True
        )
    })
    challenger = evolution.get("challengerEvidence") or {}
    baseline_digest = str(challenger.get("implementationSha256") or "")
    no_op_count = sum(
        1 for attempt in attempts if attempt.get("implementationChanged") is not True
    )
    return {
        "schema": "amos.swarm-repair-agenda",
        "version": 1,
        "baselineImplementationSha256": (
            baseline_digest if _SHA256.fullmatch(baseline_digest) else None
        ),
        "unresolvedCheckIds": check_ids[:128],
        "clusters": clusters[:32],
        "preferredCluster": preferred,
        "priorAttempts": attempts,
        "rejectedStrategyFingerprints": rejected_fingerprints,
        "noOpAttemptCount": no_op_count,
        "novelStrategyRequired": no_op_count > 0,
        "minimumMutationContract": {
            "implementationDigestMustChange": bool(check_ids),
            "syntaxMustRemainValid": True,
            "implementationMustRemainSubstantive": True,
            "priorPassingChecksMustBeRerun": True,
            "hiddenVerifierMayNotBeRead": True,
        },
        "authority": {
            "hostObservedOnly": True,
            "searchGuidanceOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }


def _bounded_repair_id(value: Any) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._:/-]+", "-", str(value).strip())[:500]
    return normalized or "unknown"


def _verifier_instruction(
    task: str,
    *,
    verdict_path: str,
    phase: str,
    contract_feedback_path: str | None = None,
) -> str:
    execution_rule = (
        "Verify the candidate before final execution; do not perform final writes or repair it."
        if phase == "preflight"
        else "Verify the actual post-execution state; do not modify or repair it."
    )
    recovery_rule = ""
    if contract_feedback_path is not None:
        recovery_rule = f"""
The host rejected the previous verifier artifact. Read {contract_feedback_path} first. In your
first terminal batch, use Python to copy its `minimalBlockedExample` object exactly to
{verdict_path} and validate the JSON. That object is only a transport scaffold and contains
`contractScaffold: true`; it is never an accepted verifier decision. Run the independent checks,
preserve every exact ID in `requiredCriteria`, replace all placeholder evidence, remove
`contractScaffold`, and replace the file with the complete verdict. Before returning, re-read the
exact file and compare its criterion ID set to `requiredCriteria`.
"""
    return _phase_instruction(
        task,
        role=f"INDEPENDENT VERIFIER ({phase.upper()})",
        objective=f"""
Read {BOARD_PATH} and independently test every enumerated success criterion. {execution_rule}
Write complete test output to one or more receipt files under {SWARM_DIR}. Write {verdict_path}
as strict JSON with schema `amos.swarm-verdict`, version 1, status `pass`, `repair`, or `blocked`,
criteria entries with id/status/evidence, a gaps array, artifactReceipts, and testReceipts. Each
receipt must contain an absolute file path and its actual lowercase SHA-256. `pass` is forbidden
unless every criterion passes, gaps is empty, and both receipt arrays are non-empty.
{recovery_rule}
""",
    )


def _repairer_instruction(task: str, verdict: dict[str, Any], cycle: int) -> str:
    return _phase_instruction(
        task,
        role=f"REPAIRER (CYCLE {cycle})",
        objective=f"""
Read {BOARD_PATH} and this verifier verdict:
{json.dumps(verdict, sort_keys=True)}

Fix only the cited gaps, rerun the relevant self-checks, append replacement artifact and receipt
entries to the board, and set its phase to `repaired-{cycle}`. Existing array entries are
immutable: append a superseding or resolution entry instead of changing history. Preserve
verified facts and do not replay discovery or irreversible actions.
""",
    )


def _executor_instruction(task: str, verdict: dict[str, Any]) -> str:
    return _phase_instruction(
        task,
        role="GOVERNED EXECUTOR",
        objective=f"""
The candidate passed preflight with this verdict:
{json.dumps(verdict, sort_keys=True)}

Execute only the verified plan and exact artifacts referenced by that verdict. Perform required
final writes exactly once, collect command/audit receipts under {SWARM_DIR}, append them to
{BOARD_PATH}, and set the board phase to `executed`. Existing array entries are immutable. Do not
redesign the solution or broaden scope. If execution cannot match the verified plan, stop and
record the mismatch instead of inventing success.
""",
    )


def _integrator_instruction(task: str, verdict: dict[str, Any]) -> str:
    return _phase_instruction(
        task,
        role="INTEGRATOR",
        objective=f"""
The independent final verdict is:
{json.dumps(verdict, sort_keys=True)}

Do not change files, databases, or external state. Briefly inspect the durable board and receipts,
then return the verified outcome. Mark the task complete only after confirming the verdict paths
still exist. Do not claim anything beyond the cited evidence.
""",
    )


def _phase_instruction(task: str, *, role: str, objective: str) -> str:
    return f"""AMOS TASK-SWARM PHASE: {role}
This is one bounded specialist phase in a larger mission. A fresh specialist will follow you and
will see only durable files, not this conversation. {objective.strip()}

Work autonomously in the terminal. When the phase deliverables are complete, set task_complete
to true and confirm it on the next turn. Completing this phase does not assert that the overall
mission has passed.

ORIGINAL MISSION (the phase contract above controls your current scope):
{task}
"""


async def _initialize_board(
    environment: BaseEnvironment, task: str
) -> dict[str, Any]:
    board = {
        "schema": "amos.swarm-task-board",
        "version": 1,
        "phase": "initialized",
        "taskDigest": hashlib.sha256(task.encode("utf-8")).hexdigest(),
        "taskObjective": task,
        "successCriteria": [
            {
                "id": "criterion-001",
                "statement": (
                    "Satisfy every explicit task requirement and pass the official verifier."
                ),
            }
        ],
        "requirements": [],
        "facts": [],
        "sourceReferences": [],
        "gaps": [],
        "artifacts": [],
        "tests": [],
        "executionReceipts": [],
        "normalizations": [],
    }
    await _write_board(environment, board)
    return await _read_board(environment, expected_phase="initialized")


async def _harvest_artifacts(
    environment: BaseEnvironment,
    board: dict[str, Any],
    *,
    producer: str,
    phase: str,
) -> dict[str, Any]:
    scanner = (
        "import hashlib,json,pathlib; "
        f"root=pathlib.Path({SWARM_DIR!r}); "
        "items=[]; "
        "[(items.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})) "
        "for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'board.json']; "
        "print(json.dumps(items,separators=(',',':')))"
    )
    result = await environment.exec(command=f"python3 -c {shlex.quote(scanner)}")
    if result.return_code != 0:
        raise RuntimeError(f"Host could not harvest task artifacts: {result.stderr}")
    try:
        discovered = json.loads(result.stdout or "[]")
    except json.JSONDecodeError as error:
        raise RuntimeError("Host artifact harvest returned invalid JSON") from error
    updated = json.loads(json.dumps(board))
    # Artifact receipts are host-owned. Models sometimes helpfully append a path
    # without a digest (or invent a digest) even when told not to. Preserve only
    # receipts previously minted in the canonical host shape, then reconstruct
    # the complete set from bytes observed in the shared workspace.
    trusted_artifacts = [
        entry for entry in updated["artifacts"] if _is_host_artifact_receipt(entry)
    ]
    updated["artifacts"] = trusted_artifacts
    trusted_board = json.loads(json.dumps(board))
    trusted_board["artifacts"] = json.loads(json.dumps(trusted_artifacts))
    existing = {
        (entry.get("path"), entry.get("sha256")) for entry in updated["artifacts"]
    }
    existing_by_path = {
        entry.get("path"): entry.get("sha256") for entry in updated["artifacts"]
    }
    for artifact in discovered:
        key = (artifact.get("path"), artifact.get("sha256"))
        if key in existing:
            continue
        path, sha256 = key
        if not isinstance(path, str) or not path.startswith(f"{SWARM_DIR}/"):
            raise RuntimeError("Host artifact harvest found an out-of-bound path")
        if not isinstance(sha256, str) or not _SHA256.fullmatch(sha256):
            raise RuntimeError(f"Host artifact harvest found an invalid receipt for {path}")
        if path in existing_by_path and existing_by_path[path] != sha256:
            raise RuntimeError(f"Task specialist overwrote immutable artifact {path}")
        updated["artifacts"].append(
            {
                "id": f"artifact-{len(updated['artifacts']) + 1:04d}",
                "kind": "state-extract",
                "path": path,
                "sha256": sha256,
                "producer": producer,
            }
        )
        existing.add(key)
        existing_by_path[path] = sha256
    updated["phase"] = phase
    _assert_board_append_only(trusted_board, updated)
    await _write_board(environment, updated)
    return await _read_board(environment, expected_phase=phase, previous=trusted_board)


async def _count_files_under(environment: BaseEnvironment, path: str) -> int:
    counter = (
        "import pathlib,sys; "
        "root=pathlib.Path(sys.argv[1]); "
        "print(sum(1 for item in root.rglob('*') if item.is_file()))"
    )
    result = await environment.exec(
        command=f"python3 -c {shlex.quote(counter)} {shlex.quote(path)}"
    )
    if result.return_code != 0:
        return 0
    try:
        return max(0, int((result.stdout or "0").strip()))
    except ValueError:
        return 0


def _is_host_artifact_receipt(entry: Any) -> bool:
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("id"), str)
        and entry.get("kind") == "state-extract"
        and isinstance(entry.get("path"), str)
        and entry["path"].startswith(f"{SWARM_DIR}/")
        and isinstance(entry.get("sha256"), str)
        and _SHA256.fullmatch(entry["sha256"]) is not None
        and isinstance(entry.get("producer"), str)
        and bool(entry["producer"])
    )


async def _harvest_candidate_if_ready(
    environment: BaseEnvironment,
    board: dict[str, Any],
) -> dict[str, Any] | None:
    """Project a typed candidate contract without trusting model board edits."""
    result = await environment.exec(command=f"cat {shlex.quote(CANDIDATE_STATUS_PATH)}")
    if result.return_code != 0 or not result.stdout:
        return None
    try:
        status = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    self_check = await _read_optional_host_json(environment, SELF_CHECK_PATH)
    if _candidate_contract_diagnostics(
        self_check,
        status,
        required_criteria=board.get("successCriteria", []),
    ):
        return None
    try:
        await _verify_receipts(environment, status)
    except RuntimeError:
        return None

    updated = json.loads(json.dumps(board))
    existing_tests = {
        (entry.get("path"), entry.get("sha256")) for entry in updated["tests"]
    }
    for receipt in status["testReceipts"]:
        key = (receipt.get("path"), str(receipt.get("sha256", "")).lower())
        if key in existing_tests:
            continue
        updated["tests"].append(
            {
                "id": f"test-{len(updated['tests']) + 1:04d}",
                "path": key[0],
                "sha256": key[1],
                "status": "pass",
                "producer": "solver-builder",
            }
        )
        existing_tests.add(key)
    status_digest = hashlib.sha256(result.stdout.encode("utf-8")).hexdigest()
    updated["facts"].append(
        {
            "id": f"fact-candidate-{status_digest[:12]}",
            "statement": (
                "The host verified the constructed candidate manifest and all declared "
                f"receipts at {CANDIDATE_STATUS_PATH}."
            ),
        }
    )
    updated["normalizations"].append(
        {
            "id": f"normalization-candidate-{status_digest[:12]}",
            "field": "candidate-status",
            "inputType": "verified-artifact",
            "outputType": "governed-board-projection",
        }
    )
    updated["phase"] = "constructed"
    _assert_board_append_only(board, updated)
    await _write_board(environment, updated)
    return await _read_board(
        environment,
        expected_phase="constructed",
        previous=board,
    )


async def _harvest_compiled_state_if_ready(
    environment: BaseEnvironment,
    board: dict[str, Any],
) -> dict[str, Any] | None:
    """Promote a complete compiler artifact without requiring model bookkeeping.

    Specialists own the lossy analysis artifact. The host owns the exact board,
    validates the compiler contract, and performs the append-only projection.
    """
    result = await environment.exec(command=f"cat {shlex.quote(COMPILED_STATE_PATH)}")
    if result.return_code != 0 or not result.stdout:
        return None
    try:
        state = json.loads(result.stdout)
    except json.JSONDecodeError:
        await _write_compiled_state_feedback(
            environment,
            ["compiled-state.json is not valid JSON"],
        )
        return None
    constraints = state.get("constraints")
    criteria = state.get("successCriteria", state.get("success_criteria"))
    sources = state.get("sourceReferences", state.get("source_references"))
    gaps = state.get("gaps")
    verification = state.get("verification")
    contract_errors = _compiled_state_contract_errors(
        state,
        constraints=constraints,
        criteria=criteria,
        sources=sources,
        gaps=gaps,
        verification=verification,
    )
    if contract_errors:
        await _write_compiled_state_feedback(environment, contract_errors)
        return None

    updated = json.loads(json.dumps(board))
    _append_compiled_statements(updated["requirements"], constraints, "requirement")
    _append_compiled_statements(updated["successCriteria"], criteria, "criterion")
    _append_compiled_statements(updated["gaps"], gaps, "gap")
    _append_compiled_sources(updated["sourceReferences"], sources)
    state_digest = hashlib.sha256(result.stdout.encode("utf-8")).hexdigest()
    fact = {
        "id": f"fact-compiled-state-{state_digest[:12]}",
        "statement": (
            f"The host validated {COMPILED_STATE_PATH} as a complete compiled-state "
            f"artifact with SHA-256 {state_digest}."
        ),
    }
    if all(entry.get("id") != fact["id"] for entry in updated["facts"]):
        updated["facts"].append(fact)
    if "success_criteria" in state or "source_references" in state:
        normalization = {
            "id": f"normalization-compiled-state-{state_digest[:12]}",
            "field": "compiled-state",
            "inputType": "snake-case-compatible",
            "outputType": "amos.swarm-task-board",
        }
        if all(entry.get("id") != normalization["id"] for entry in updated["normalizations"]):
            updated["normalizations"].append(normalization)
    updated["phase"] = "state-compiled"
    _assert_board_append_only(board, updated)
    await _write_board(environment, updated)
    return await _read_board(
        environment,
        expected_phase="state-compiled",
        previous=board,
    )


def _compiled_state_contract_errors(
    state: dict[str, Any],
    *,
    constraints: Any,
    criteria: Any,
    sources: Any,
    gaps: Any,
    verification: Any,
) -> list[str]:
    errors = []
    if state.get("schema") != "amos.swarm-compiled-state":
        errors.append("schema must equal amos.swarm-compiled-state")
    if state.get("version") != 1:
        errors.append("version must equal 1")
    if state.get("phase") != "state-compiled":
        errors.append("phase must equal state-compiled")
    errors.extend(
        _compiled_statement_contract_errors(
            constraints,
            "constraints",
            require_non_empty=True,
        )
    )
    errors.extend(
        _compiled_statement_contract_errors(
            criteria,
            "successCriteria",
            require_non_empty=True,
        )
    )
    if not isinstance(sources, list) or not sources:
        errors.append("sourceReferences must be a non-empty array")
    elif any(not _compiled_source_path(value).startswith(("/app/data/", f"{SWARM_DIR}/")) for value in sources):
        errors.append("every sourceReferences path must remain under /app/data or /tmp/amos_swarm")
    errors.extend(
        _compiled_statement_contract_errors(
            gaps,
            "gaps",
            require_non_empty=False,
        )
    )
    if not isinstance(verification, dict) or verification.get("all_pass") is not True:
        errors.append("verification.all_pass must be true after deterministic compiler checks")
    return errors


def _compiled_statement_contract_errors(
    values: Any,
    label: str,
    *,
    require_non_empty: bool,
) -> list[str]:
    if not isinstance(values, list):
        return [f"{label} must be an array"]
    if require_non_empty and not values:
        return [f"{label} must be a non-empty array"]

    errors = []
    for index, value in enumerate(values):
        if isinstance(value, str):
            statement = value.strip()
        elif isinstance(value, dict):
            statement = str(value.get("statement", "")).strip()
        else:
            errors.append(f"{label}[{index}] must be a string or object")
            continue
        if not statement:
            errors.append(f"{label}[{index}].statement must be non-empty")
    return errors


def _compiled_source_path(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("path", "")).strip()
    return ""


async def _write_compiled_state_feedback(
    environment: BaseEnvironment,
    errors: list[str],
) -> None:
    feedback = {
        "schema": "amos.swarm-compiled-state-feedback",
        "version": 1,
        "status": "repair",
        "errors": errors,
    }
    await _write_host_json(environment, COMPILED_FEEDBACK_PATH, feedback)


def _append_compiled_statements(
    destination: list[dict[str, Any]],
    values: list[Any],
    prefix: str,
) -> None:
    existing_ids = {entry.get("id") for entry in destination}
    for index, value in enumerate(values):
        if isinstance(value, str):
            statement = value.strip()
            proposed_id = ""
        elif isinstance(value, dict):
            statement = str(value.get("statement", "")).strip()
            proposed_id = str(value.get("id", "")).strip()
        else:
            raise RuntimeError("Compiled-state statement collections must contain strings or objects")
        if not statement:
            raise RuntimeError("Compiled-state statements must be non-empty")
        suffix = hashlib.sha256(f"{prefix}\0{statement}".encode("utf-8")).hexdigest()[:12]
        entry_id = proposed_id or f"{prefix}-compiled-{index + 1:03d}-{suffix}"
        if entry_id in existing_ids:
            matching = next(entry for entry in destination if entry.get("id") == entry_id)
            if matching.get("statement") != statement:
                raise RuntimeError(f"Compiled-state entry id {entry_id} conflicts with the board")
            continue
        destination.append({"id": entry_id, "statement": statement})
        existing_ids.add(entry_id)


def _append_compiled_sources(
    destination: list[dict[str, Any]],
    values: list[Any],
) -> None:
    existing_ids = {entry.get("id") for entry in destination}
    existing_paths = {entry.get("path") for entry in destination}
    for value in values:
        if isinstance(value, str):
            path = value.strip()
            role = "compiled-state-source"
        elif isinstance(value, dict):
            path = str(value.get("path", "")).strip()
            role = str(value.get("role", "compiled-state-source")).strip()
        else:
            raise RuntimeError("Compiled-state source references must contain strings or objects")
        if not path or not path.startswith(("/app/data/", f"{SWARM_DIR}/")):
            raise RuntimeError(f"Compiled-state source path is outside the task boundary: {path}")
        if path in existing_paths:
            continue
        suffix = hashlib.sha256(path.encode("utf-8")).hexdigest()[:12]
        entry_id = f"source-compiled-{suffix}"
        if entry_id in existing_ids:
            raise RuntimeError(f"Compiled-state source id {entry_id} conflicts with the board")
        destination.append({"id": entry_id, "path": path, "role": role})
        existing_ids.add(entry_id)
        existing_paths.add(path)


async def _write_board(environment: BaseEnvironment, board: dict[str, Any]) -> None:
    await _write_host_json(environment, BOARD_PATH, board)


async def _write_host_json(
    environment: BaseEnvironment,
    path: str,
    value: dict[str, Any],
) -> None:
    encoded = base64.b64encode(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    writer = (
        "import base64,pathlib,sys; "
        "pathlib.Path(sys.argv[1]).write_bytes(base64.b64decode(sys.argv[2]))"
    )
    result = await environment.exec(
        command=(
            f"python3 -c {shlex.quote(writer)} "
            f"{shlex.quote(path)} {shlex.quote(encoded)}"
        )
    )
    if result.return_code != 0:
        raise RuntimeError(f"Host could not write {path}: {result.stderr}")


async def _write_host_text(
    environment: BaseEnvironment,
    path: str,
    value: str,
) -> None:
    encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
    writer = (
        "import base64,pathlib,sys; "
        "pathlib.Path(sys.argv[1]).write_bytes(base64.b64decode(sys.argv[2]))"
    )
    result = await environment.exec(
        command=(
            f"python3 -c {shlex.quote(writer)} "
            f"{shlex.quote(path)} {shlex.quote(encoded)}"
        )
    )
    if result.return_code != 0:
        raise RuntimeError(f"Host could not write {path}: {result.stderr}")


async def _advance_board_phase(
    environment: BaseEnvironment,
    board: dict[str, Any],
    *,
    phase: str,
) -> dict[str, Any]:
    updated = json.loads(json.dumps(board))
    updated["phase"] = phase
    _assert_board_append_only(board, updated)
    await _write_board(environment, updated)
    return await _read_board(environment, expected_phase=phase, previous=board)


async def _read_board(
    environment: BaseEnvironment,
    *,
    expected_phase: str | None = None,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = await environment.exec(command=f"cat {shlex.quote(BOARD_PATH)}")
    if result.return_code != 0 or not result.stdout:
        raise RuntimeError(f"Task specialist did not create {BOARD_PATH}")
    try:
        board = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Task specialist wrote invalid JSON to {BOARD_PATH}: {error}") from error
    normalized = _normalize_board_shorthand(board)
    if normalized != board:
        board = normalized
        await _write_board(environment, board)
    if board.get("schema") != "amos.swarm-task-board" or board.get("version") != 1:
        raise RuntimeError(f"Task specialist wrote an unsupported board to {BOARD_PATH}")
    if not isinstance(board.get("phase"), str) or not board["phase"]:
        raise RuntimeError("Task board must contain a non-empty phase")
    if expected_phase is not None and board["phase"] != expected_phase:
        raise RuntimeError(
            f"Task board phase is {board['phase']!r}; expected {expected_phase!r}"
        )
    for field in _BOARD_COLLECTIONS:
        entries = board.get(field)
        if not isinstance(entries, list):
            raise RuntimeError(f"Task board field {field} must be an array")
        if any(not isinstance(entry, dict) for entry in entries):
            raise RuntimeError(f"Task board field {field} must contain only objects")
    criteria = board["successCriteria"]
    criterion_ids = [entry.get("id") for entry in criteria]
    if (
        not criteria
        or any(not isinstance(value, str) or not value for value in criterion_ids)
        or len(set(criterion_ids)) != len(criterion_ids)
        or any(not isinstance(entry.get("statement"), str) or not entry["statement"] for entry in criteria)
    ):
        raise RuntimeError("Task board must contain non-empty success criteria with unique IDs")
    if previous is not None:
        _assert_board_append_only(previous, board)
    return board


def _normalize_board_shorthand(board: Any) -> Any:
    if not isinstance(board, dict):
        return board
    normalized = json.loads(json.dumps(board))
    normalization_log = normalized.get("normalizations")
    if not isinstance(normalization_log, list):
        return normalized
    for field in _BOARD_COLLECTIONS:
        if field == "normalizations":
            continue
        entries = normalized.get(field)
        if not isinstance(entries, list):
            continue
        for index, entry in enumerate(entries):
            if not isinstance(entry, str):
                continue
            suffix = hashlib.sha256(f"{field}\0{entry}".encode("utf-8")).hexdigest()[:12]
            if field == "sourceReferences":
                replacement = {"id": f"source-{suffix}", "path": entry}
            elif field == "artifacts":
                replacement = {
                    "id": f"artifact-{suffix}",
                    "kind": "model-reference",
                    "path": entry,
                }
            else:
                singular = field.removesuffix("s")
                replacement = {"id": f"{singular}-{suffix}", "statement": entry}
            entries[index] = replacement
            normalization_log.append(
                {
                    "id": f"normalization-{field}-{suffix}",
                    "field": field,
                    "inputType": "string",
                    "outputType": "object",
                }
            )
    return normalized


def _assert_board_append_only(previous: dict[str, Any], current: dict[str, Any]) -> None:
    for field in ("schema", "version", "taskDigest", "taskObjective"):
        if current.get(field) != previous.get(field):
            raise RuntimeError(f"Task specialist rewrote immutable board field {field}")
    for field in _BOARD_COLLECTIONS:
        prior_entries = previous[field]
        current_entries = current[field]
        if len(current_entries) < len(prior_entries):
            raise RuntimeError(f"Task specialist deleted entries from append-only field {field}")
        if current_entries[: len(prior_entries)] != prior_entries:
            raise RuntimeError(f"Task specialist rewrote or reordered append-only field {field}")


def _assert_board_unchanged(
    previous: dict[str, Any], current: dict[str, Any], actor: str
) -> None:
    if _canonical_digest(previous) != _canonical_digest(current):
        raise RuntimeError(f"The {actor} mutated the evidence board it was required to judge")


def _canonical_digest(value: Any) -> str:
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def _read_verdict(
    environment: BaseEnvironment,
    path: str,
    *,
    required_criteria: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    result = await environment.exec(command=f"cat {shlex.quote(path)}")
    if result.return_code != 0 or not result.stdout:
        raise RuntimeError(f"Verifier did not create {path}")
    try:
        verdict = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Verifier wrote invalid JSON to {path}: {error}") from error
    if verdict.get("schema") != "amos.swarm-verdict" or verdict.get("version") != 1:
        raise RuntimeError(f"Verifier wrote an unsupported verdict to {path}")
    if verdict.get("status") not in {"pass", "repair", "blocked"}:
        raise RuntimeError(f"Verifier wrote an invalid status to {path}")
    criteria = verdict.get("criteria")
    criterion_diagnostics = _verdict_criterion_diagnostics(
        criteria,
        required_criteria=required_criteria,
    )
    if criterion_diagnostics:
        detail = json.dumps(criterion_diagnostics, sort_keys=True, separators=(",", ":"))
        raise RuntimeError(
            f"Verifier wrote incomplete criterion evidence to {path}: {detail}"
        )
    if verdict.get("contractScaffold") is True:
        raise RuntimeError(
            f"Verifier left the host contract scaffold unreplaced at {path}"
        )
    gaps = verdict.get("gaps")
    if not isinstance(gaps, list) or any(not isinstance(gap, str) for gap in gaps):
        raise RuntimeError(f"Verifier wrote invalid gaps to {path}")
    if verdict["status"] != "pass" and not any(gap.strip() for gap in gaps):
        raise RuntimeError(f"Verifier wrote a non-pass verdict without an evidence gap to {path}")
    if not isinstance(verdict.get("artifactReceipts"), list) or not isinstance(
        verdict.get("testReceipts"), list
    ):
        raise RuntimeError(f"Verifier wrote invalid receipt arrays to {path}")
    return verdict


async def _archive_existing_verdict(
    environment: BaseEnvironment,
    path: str,
    *,
    label: str,
    attempt: int,
) -> str | None:
    """Preserve a stale or rejected verdict before a fresh verifier lease."""

    result = await environment.exec(command=f"cat {shlex.quote(path)}")
    if result.return_code != 0 or not result.stdout:
        return None
    safe_label = re.sub(r"[^a-z0-9-]+", "-", label.lower()).strip("-") or "verifier"
    archive_path = f"{path}.rejected-{safe_label}-{attempt}"
    encoded = base64.b64encode(result.stdout.encode("utf-8")).decode("ascii")
    writer = (
        "import base64,pathlib,sys; "
        "pathlib.Path(sys.argv[1]).write_bytes(base64.b64decode(sys.argv[2]))"
    )
    written = await environment.exec(
        command=(
            f"python3 -c {shlex.quote(writer)} "
            f"{shlex.quote(archive_path)} {shlex.quote(encoded)}"
        )
    )
    if written.return_code != 0:
        raise RuntimeError(f"Host could not archive rejected verdict {path}")
    removed = await environment.exec(command=f"rm -f -- {shlex.quote(path)}")
    if removed.return_code != 0:
        raise RuntimeError(f"Host could not clear rejected verdict {path}")
    return archive_path


async def _write_verifier_contract_feedback(
    environment: BaseEnvironment,
    *,
    phase: str,
    verdict_path: str,
    attempt: int,
    error: RuntimeError,
    rejected_path: str | None,
    required_criteria: list[dict[str, Any]],
) -> dict[str, Any]:
    message = str(error)[:2_000]
    normalized_criteria = _normalized_required_criteria(required_criteria)
    feedback = {
        "schema": "amos.swarm-verifier-contract-feedback",
        "version": 1,
        "phase": phase,
        "attempt": attempt,
        "status": "retry-required",
        "errorKind": _verifier_contract_error_kind(message),
        "error": message,
        "verdictPath": verdict_path,
        "rejectedArtifactPath": rejected_path,
        "requiredCriteria": normalized_criteria,
        "minimalBlockedExample": _verifier_contract_scaffold(normalized_criteria),
        "requiredNextActions": [
            "In the first terminal batch, copy minimalBlockedExample to the verdict path with Python and validate the JSON.",
            "Independently test every requiredCriteria entry; preserve each exact criterion ID.",
            "Replace every placeholder status/evidence with the observed decision and remove contractScaffold.",
            "Use status pass only when every criterion passes, gaps is empty, and exact artifact/test receipts are present.",
            "Re-read the persisted verdict and verify the criterion ID set before declaring the phase complete.",
        ],
        "authority": {
            "hostObservedOnly": True,
            "grantsCompletionCredit": False,
            "bypassesVerifier": False,
        },
    }
    await _write_host_json(environment, VERIFIER_CONTRACT_FEEDBACK_PATH, feedback)
    return feedback


def _verifier_contract_error_kind(message: str) -> str:
    lowered = message.lower()
    if "did not create" in lowered:
        return "missing-verdict"
    if "invalid json" in lowered:
        return "invalid-json"
    if "unsupported verdict" in lowered:
        return "unsupported-schema"
    if "invalid status" in lowered:
        return "invalid-status"
    if "incomplete pass" in lowered:
        return "incomplete-pass"
    if "incomplete criterion evidence" in lowered:
        return "incomplete-criteria"
    if "contract scaffold unreplaced" in lowered:
        return "unreplaced-scaffold"
    if "receipt" in lowered:
        return "invalid-receipt"
    return "invalid-verdict"


def _normalized_required_criteria(
    required_criteria: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    return [
        {
            "id": str(item.get("id") or "").strip(),
            "statement": str(item.get("statement") or "").strip(),
        }
        for item in (required_criteria or [])
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    ]


def _verifier_contract_scaffold(
    required_criteria: list[dict[str, Any]],
) -> dict[str, Any]:
    normalized = _normalized_required_criteria(required_criteria)
    return {
        "schema": "amos.swarm-verdict",
        "version": 1,
        "status": "blocked",
        "contractScaffold": True,
        "criteria": [
            {
                "id": item["id"],
                "status": "blocked",
                "evidence": (
                    "Independent verification has not completed for: "
                    + item["statement"]
                )[:1_000],
            }
            for item in normalized
        ],
        "gaps": ["Independent verification has not completed."],
        "artifactReceipts": [],
        "testReceipts": [],
    }


def _verdict_criterion_diagnostics(
    criteria: Any,
    *,
    required_criteria: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    required_ids = [item["id"] for item in _normalized_required_criteria(required_criteria)]
    if not isinstance(criteria, list):
        return {"criteriaType": type(criteria).__name__, "requiredIds": required_ids}
    if not criteria:
        return {"emptyCriteria": True, "missingIds": required_ids}

    observed_ids: list[str] = []
    invalid_entries: list[int] = []
    invalid_status_ids: list[str] = []
    empty_evidence_ids: list[str] = []
    for index, item in enumerate(criteria):
        if not isinstance(item, dict):
            invalid_entries.append(index)
            continue
        criterion_id = str(item.get("id") or "").strip()
        if not criterion_id:
            invalid_entries.append(index)
            continue
        observed_ids.append(criterion_id)
        if item.get("status") not in {"pass", "fail", "blocked"}:
            invalid_status_ids.append(criterion_id)
        evidence = item.get("evidence")
        if not isinstance(evidence, str) or not evidence.strip():
            empty_evidence_ids.append(criterion_id)

    duplicate_ids = sorted({item for item in observed_ids if observed_ids.count(item) > 1})
    missing_ids = [item for item in required_ids if item not in observed_ids]
    unexpected_ids = [item for item in observed_ids if required_ids and item not in required_ids]
    diagnostics = {
        "missingIds": missing_ids,
        "unexpectedIds": unexpected_ids,
        "duplicateIds": duplicate_ids,
        "invalidEntryIndexes": invalid_entries,
        "invalidStatusIds": invalid_status_ids,
        "emptyEvidenceIds": empty_evidence_ids,
    }
    return {key: value for key, value in diagnostics.items() if value}


def _is_verified_pass(verdict: dict[str, Any]) -> bool:
    criteria = verdict.get("criteria")
    gaps = verdict.get("gaps")
    artifacts = verdict.get("artifactReceipts")
    tests = verdict.get("testReceipts")
    return (
        verdict.get("status") == "pass"
        and isinstance(criteria, list)
        and len(criteria) > 0
        and all(item.get("status") == "pass" and item.get("evidence") for item in criteria)
        and gaps == []
        and isinstance(artifacts, list)
        and len(artifacts) > 0
        and isinstance(tests, list)
        and len(tests) > 0
    )


async def _verify_receipts(environment: BaseEnvironment, verdict: dict[str, Any]) -> None:
    for field in ("artifactReceipts", "testReceipts"):
        for receipt in verdict.get(field, []):
            path = str(receipt.get("path", ""))
            expected = str(receipt.get("sha256", "")).lower()
            if not path.startswith(("/app/output/", f"{SWARM_DIR}/")):
                raise RuntimeError(f"Verifier receipt path is outside the task boundary: {path}")
            if not _SHA256.fullmatch(expected):
                raise RuntimeError(f"Verifier receipt has an invalid SHA-256 for {path}")
            result = await environment.exec(command=f"sha256sum -- {shlex.quote(path)}")
            actual = (result.stdout or "").split(maxsplit=1)[0].lower()
            if result.return_code != 0 or actual != expected:
                raise RuntimeError(f"Verifier receipt does not match {path}")


def _aggregate_context(
    target: AgentContext,
    phases: list[tuple[str, AgentContext]],
    verdict: dict[str, Any],
) -> None:
    target.n_input_tokens = sum(context.n_input_tokens or 0 for _, context in phases)
    target.n_output_tokens = sum(context.n_output_tokens or 0 for _, context in phases)
    target.n_cache_tokens = sum(context.n_cache_tokens or 0 for _, context in phases)
    total_cost = sum(context.cost_usd or 0 for _, context in phases)
    target.cost_usd = total_cost or None
    target.rollout_details = [
        detail
        for _, context in phases
        for detail in (context.rollout_details or [])
    ]
    target.metadata = {
        "architecture": "amos-task-swarm-v1",
        "phases": [
            {
                "role": role,
                "inputTokens": context.n_input_tokens,
                "outputTokens": context.n_output_tokens,
                "cacheTokens": context.n_cache_tokens,
            }
            for role, context in phases
        ],
        "finalVerdict": verdict,
    }


def _bounded_int(value: Any, minimum: int, maximum: int, label: str) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be an integer") from error
    if normalized < minimum or normalized > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return normalized


def _validate_model_provenance(
    source: str | Mapping[str, Any] | None,
) -> dict[str, Any]:
    # Harbor decodes JSON-shaped --agent-kwarg values before constructing a
    # custom agent. Direct callers may still provide the serialized form, so
    # this boundary deliberately accepts both without weakening validation.
    if isinstance(source, str) and source.strip():
        try:
            value = json.loads(source)
        except json.JSONDecodeError as error:
            raise ValueError("model_provenance_json must be valid JSON") from error
    elif isinstance(source, Mapping):
        value = dict(source)
    elif source is None or source == "":
        value = {}
    else:
        raise ValueError("model_provenance_json must describe an object")
    if not isinstance(value, dict):
        raise ValueError("model_provenance_json must describe an object")
    provider = str(value.get("provider") or "openai-compatible-private-endpoint").strip()[:200]
    model = str(value.get("model") or "configured-by-harbor").strip()[:500]
    route = str(value.get("route") or "direct-research").strip()[:200]
    if value.get("frontierEscalationAllowed") is True:
        raise ValueError("Research swarm runs may not enable frontier escalation")
    return {
        "schema": "amos.swarm-model-provenance",
        "version": 1,
        "provider": provider,
        "model": model,
        "route": route,
        "frontierEscalationAllowed": False,
        "authority": {
            "hostConfiguredOnly": True,
            "actualResponseModelMustBeAuditedByRunner": True,
        },
    }
