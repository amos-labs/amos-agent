import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

/**
 * Owns concurrent Desktop execution lanes without becoming a source of
 * business authority. Each lane is local, bounded, and isolated through
 * AsyncLocalStorage; AMOS Platform remains the admission and supervision
 * control plane for Project-backed runs.
 */
export class DesktopRunManager {
  constructor({ maxRuns = 32, createId = randomUUID, now = () => new Date() } = {}) {
    this.maxRuns = boundedInteger(maxRuns, 32, 1, 32);
    this.createId = createId;
    this.now = now;
    this.storage = new AsyncLocalStorage();
    this.runs = new Map();
    this.selectedRunId = null;
  }

  launch(input = {}, execute) {
    if (typeof execute !== "function") throw new Error("A Desktop run needs an executor");
    if (this.nonTerminal().length >= this.maxRuns) {
      throw new Error(`AMOS Desktop can run up to ${this.maxRuns} tasks at once`);
    }
    const id = cleanIdentifier(input.id || this.createId(), 160, "run id");
    if (this.runs.has(id)) throw new Error("That Desktop run already exists");
    const taskRecordId = cleanIdentifier(input.taskRecordId, 128, "task id");
    if (this.findByTask(taskRecordId)) {
      throw new Error("That task already has a running Desktop worker");
    }
    const createdAt = this.now().toISOString();
    const lane = {
      ...input,
      id,
      taskRecordId,
      contextKey: cleanIdentifier(input.contextKey, 128, "context key"),
      status: "starting",
      phase: "starting",
      summary: "Preparing the task",
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
      promise: null
    };
    this.runs.set(id, lane);
    if (input.select !== false) this.selectedRunId = id;
    const promise = this.storage.run(lane, async () => {
      try {
        const result = await execute(lane);
        this.transition(lane.id, "completed", {
          phase: "completed",
          summary: "Task completed"
        });
        return result;
      } catch (error) {
        const cancelled = lane.abortController?.signal?.aborted === true ||
          error?.code === "AMOS_TASK_CANCELED";
        this.transition(lane.id, cancelled ? "cancelled" : "failed", {
          phase: cancelled ? "cancelled" : "failed",
          summary: cancelled ? "Task stopped safely" : cleanText(error?.message, 500)
        });
        throw error;
      } finally {
        lane.finishedAt = this.now().toISOString();
        lane.updatedAt = lane.finishedAt;
      }
    });
    lane.promise = promise;
    return { lane, promise };
  }

  current() {
    return this.storage.getStore() || null;
  }

  selected() {
    return this.selectedRunId ? this.runs.get(this.selectedRunId) || null : null;
  }

  get(id) {
    return this.runs.get(String(id || "")) || null;
  }

  withLane(id, callback) {
    const lane = typeof id === "object" && id ? id : this.get(id);
    if (!lane) throw new Error("That Desktop run is no longer available");
    return this.storage.run(lane, () => callback(lane));
  }

  findByTask(taskRecordId) {
    const id = String(taskRecordId || "");
    if (!id) return null;
    return [...this.runs.values()].find((lane) => lane.taskRecordId === id && !TERMINAL.has(lane.status)) || null;
  }

  select(id = null) {
    if (id === null || id === "") {
      this.selectedRunId = null;
      return null;
    }
    const lane = this.get(id);
    if (!lane) throw new Error("That Desktop run is no longer available");
    this.selectedRunId = lane.id;
    return lane;
  }

  transition(id, status, changes = {}) {
    const lane = this.get(id);
    if (!lane) return null;
    const normalized = cleanStatus(status);
    if (TERMINAL.has(lane.status) && normalized !== lane.status) return lane;
    Object.assign(lane, changes, {
      status: normalized,
      updatedAt: this.now().toISOString()
    });
    return lane;
  }

  active() {
    return this.nonTerminal().map((lane) => publicRun(lane, lane.id === this.selectedRunId));
  }

  nonTerminal() {
    return [...this.runs.values()].filter((lane) => !TERMINAL.has(lane.status));
  }

  delete(id) {
    const key = String(id || "");
    if (this.selectedRunId === key) this.selectedRunId = null;
    return this.runs.delete(key);
  }

  async interruptAll(reason = "AMOS Desktop closed before this task finished") {
    const active = this.nonTerminal();
    for (const lane of active) {
      lane.phase = "interrupted";
      lane.summary = cleanText(reason, 500);
      lane.approvals?.cancelAll?.();
      lane.abortController?.abort?.();
    }
    await Promise.allSettled(active.map((lane) => lane.promise));
    return active.length;
  }
}

export class DesktopRunSupervisor {
  constructor({
    remote,
    abortController,
    onUpdate = () => {},
    heartbeatMs = 30_000,
    reportThrottleMs = 2_000,
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval
  } = {}) {
    if (!remote?.startTaskRun || !remote?.reportTaskRun) {
      throw new Error("Supervised Desktop runs require the AMOS Platform run contract");
    }
    this.remote = remote;
    this.abortController = abortController;
    this.onUpdate = onUpdate;
    this.heartbeatMs = heartbeatMs;
    this.reportThrottleMs = reportThrottleMs;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.run = null;
    this.sequence = 0;
    this.phase = "starting";
    this.summary = "Preparing the task";
    this.tokensUsed = 0;
    this.costUsedMicrousd = 0;
    this.toolCallsUsed = 0;
    this.lastReportAt = 0;
    this.reportQueue = Promise.resolve();
    this.timer = null;
    this.closed = false;
    this.stopReason = "";
  }

  async admit(input) {
    const admitted = await this.remote.startTaskRun(input, {
      signal: this.abortController?.signal
    });
    if (!admitted.accepted || !admitted.run) {
      throw new Error("AMOS Platform did not admit this task run");
    }
    this.run = admitted.run;
    this.sequence = Number(admitted.run.sequence || 0);
    this.onUpdate(admitted.run);
    if (admitted.continue === false) {
      this.stopReason = String(admitted.reason || admitted.run?.stopReason || "run_not_admitted");
      this.abortController?.abort(this.stopReason);
      return admitted;
    }
    this.timer = this.setIntervalImpl(() => {
      this.report("running").catch(() => {});
    }, this.heartbeatMs);
    this.timer?.unref?.();
    return admitted;
  }

  observe(event = {}) {
    if (this.closed || !this.run) return;
    if (event.type === "phase") {
      this.phase = String(event.phase || this.phase).slice(0, 160);
      this.summary = String(event.summary || this.summary).slice(0, 4_000);
    } else if (event.type === "tool_start") {
      this.phase = "acting";
      this.summary = `Running ${String(event.name || "a tool").slice(0, 140)}`;
    } else if (event.type === "tool_end" || event.type === "tool_error") {
      this.toolCallsUsed += 1;
    } else if (event.type === "usage") {
      this.tokensUsed += boundedCount(event.totalTokens);
      this.costUsedMicrousd += boundedCount(event.costUsedMicrousd);
    }
    if (this.now() - this.lastReportAt >= this.reportThrottleMs) {
      this.report(runReportStatus(event)).catch(() => {});
    }
  }

  report(status = "running", resultSummary = "") {
    if (!this.run || this.closed && !isTerminalRunStatus(status)) return this.reportQueue;
    const sequence = ++this.sequence;
    this.lastReportAt = this.now();
    // One transient heartbeat failure must not poison every later progress or
    // terminal report in the lane.
    this.reportQueue = this.reportQueue.catch(() => null).then(async () => {
      const result = await this.remote.reportTaskRun({
        runId: this.run.id,
        sequence,
        status,
        phase: this.phase,
        progressSummary: this.summary,
        resultSummary,
        tokensUsed: this.tokensUsed,
        costUsedMicrousd: this.costUsedMicrousd,
        toolCallsUsed: this.toolCallsUsed
      });
      this.run = result.run;
      this.onUpdate(result.run);
      if (result.continue === false && !isTerminalRunStatus(status)) {
        this.stopReason = String(result.reason || result.run?.stopReason || "run_stop_requested");
        this.abortController?.abort(this.stopReason);
      }
      return result;
    });
    return this.reportQueue;
  }

  async finish(status, resultSummary = "") {
    if (!this.run || this.closed) return null;
    this.closed = true;
    if (this.timer) this.clearIntervalImpl(this.timer);
    this.timer = null;
    return this.report(status, resultSummary);
  }
}

function publicRun(lane, selected = false) {
  return {
    id: lane.id,
    taskRecordId: lane.taskRecordId,
    remoteTaskId: String(lane.remoteTaskId || ""),
    projectId: String(lane.projectId || ""),
    platformRunId: String(lane.platformRunId || ""),
    contextKey: lane.contextKey,
    status: lane.status,
    phase: String(lane.phase || "").slice(0, 160),
    summary: cleanText(lane.summary, 500),
    pendingInputId: cleanText(lane.pendingInputId, 160) || null,
    objective: cleanText(lane.activeTask?.objective || lane.objective, 6_000),
    codingLifecycle: lane.activeTask?.codingLifecycle?.state?.() || null,
    startedAt: lane.activeTask?.startedAt || lane.createdAt,
    updatedAt: lane.updatedAt,
    selected
  };
}

function cleanStatus(value) {
  const status = String(value || "");
  return new Set([
    "starting", "running", "waiting", "blocked", "cancel_requested",
    "completed", "failed", "cancelled", "interrupted"
  ]).has(status) ? status : "running";
}

function cleanIdentifier(value, limit, label) {
  const result = String(value || "").trim();
  if (!result || result.length > limit || !/^[A-Za-z0-9._:-]+$/.test(result)) {
    throw new Error(`AMOS blocked an invalid ${label}`);
  }
  return result;
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function boundedCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function runReportStatus(event) {
  if (event?.type === "phase" && ["waiting", "blocked"].includes(event.phase)) return event.phase;
  return "running";
}

function isTerminalRunStatus(status) {
  return ["completed", "failed", "cancelled", "interrupted"].includes(status);
}
