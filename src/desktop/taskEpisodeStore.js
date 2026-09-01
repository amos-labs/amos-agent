import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const DESKTOP_TASK_EPISODE_SCHEMA = "amos.desktop-task-episode";
export const ORGANISM_TRACE_BUNDLE_SCHEMA = "amos.organism-trace-bundle";
export const DESKTOP_TASK_EPISODE_VERSION = 1;

const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled", "interrupted"]);
const SAFE_EVENT_TYPES = new Set([
  "tool_start",
  "tool_end",
  "tool_error",
  "model_call",
  "routing",
  "guard",
  "context_compiled",
  "phase"
]);

/**
 * Immutable, local-only task episodes. The stored payload deliberately contains
 * digests and bounded operational metadata, never conversation text, tool
 * arguments, tool results, credentials, or attachment contents.
 */
export class DesktopTaskEpisodeStore {
  constructor({ rootPath, now = () => new Date() } = {}) {
    if (!rootPath) throw new Error("Desktop task episodes require a storage root");
    this.rootPath = resolve(rootPath);
    this.now = now;
  }

  async record(input = {}) {
    const taskId = boundedId(input.taskId, "taskId");
    const status = String(input.status || "");
    if (!TERMINAL_STATUSES.has(status)) throw new Error("Unsupported Desktop task status");
    const events = (Array.isArray(input.events) ? input.events : [])
      .slice(0, 10_000)
      .map((event, index) => normalizeEpisodeEvent(event, index));
    const outcomeBearing = status === "completed" && events.some((event) =>
      event.type === "tool_end" && event.outcome === "completed"
    );
    const episodeWithoutDigest = {
      schema: DESKTOP_TASK_EPISODE_SCHEMA,
      schemaVersion: DESKTOP_TASK_EPISODE_VERSION,
      episodeId: `desktop-task-${taskId}`,
      taskId,
      boundary: boundedText(input.boundary || "personal", 32),
      model: boundedText(input.model || "", 256),
      objectiveSha256: digestValue(String(input.objective || "")),
      startedAt: validDate(input.startedAt, "startedAt"),
      finishedAt: validDate(input.finishedAt || this.now().toISOString(), "finishedAt"),
      outcome: {
        status,
        outcomeBearing,
        errorSha256: input.error ? digestValue(String(input.error)) : null
      },
      events,
      dataPolicy: {
        contentIncluded: false,
        localOnly: true,
        rightsTags: ["customer-private", "local-only", "training-not-authorized"],
        exportEligible: false,
        exportBlockers: outcomeBearing
          ? ["training-consent-not-recorded", "host-attestation-required"]
          : ["not-an-outcome-bearing-task", "training-consent-not-recorded", "host-attestation-required"]
      }
    };
    const episode = {
      ...episodeWithoutDigest,
      digest: digestValue(episodeWithoutDigest)
    };
    const bundle = {
      schema: ORGANISM_TRACE_BUNDLE_SCHEMA,
      schemaVersion: 1,
      source: {
        kind: DESKTOP_TASK_EPISODE_SCHEMA,
        episodeDigest: episode.digest,
        episode
      },
      entries: [],
      approvals: []
    };
    const directory = join(this.rootPath, "episodes");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const priorName = (await readdir(directory))
      .find((name) => name.startsWith(`${taskId}.`) && name.endsWith(".json"));
    if (priorName) {
      const priorPath = join(directory, priorName);
      const priorBundle = JSON.parse(await readFile(priorPath, "utf8"));
      if (priorBundle?.source?.episode?.digest !== episode.digest) {
        throw new Error(`Desktop task episode is already finalized: ${taskId}`);
      }
      return { filePath: priorPath, episode, bundleDigest: digestValue(bundle) };
    }
    const filePath = join(directory, `${taskId}.${episode.digest}.json`);
    const contents = `${JSON.stringify(bundle, null, 2)}\n`;
    await writeImmutable(filePath, contents);
    return { filePath, episode, bundleDigest: digestValue(bundle) };
  }

  async list() {
    const directory = join(this.rootPath, "episodes");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const bundles = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = join(directory, entry.name);
      const bundle = JSON.parse(await readFile(filePath, "utf8"));
      bundles.push({ filePath, bundle });
    }
    return bundles;
  }
}

export function taskEpisodeEvent(event = {}, { at = new Date().toISOString() } = {}) {
  const type = SAFE_EVENT_TYPES.has(event.type) ? event.type : "phase";
  const base = {
    at: validDate(at, "event.at"),
    type,
    name: boundedText(event.name || event.phase || event.type || "event", 160)
  };
  if (type === "tool_start") {
    return { ...base, argsSha256: digestValue(event.args ?? {}), executionMode: boundedNullable(event.executionMode, 40) };
  }
  if (type === "tool_end") {
    return {
      ...base,
      resultSha256: digestValue(event.result ?? null),
      resultShape: resultShape(event.result),
      durationMs: nonNegativeNumber(event.durationMs),
      executionMode: boundedNullable(event.executionMode, 40),
      outcome: event.result?.ok === false ? "failed" : "completed"
    };
  }
  if (type === "tool_error") {
    return {
      ...base,
      errorSha256: digestValue(String(event.error || "tool failed")),
      durationMs: nonNegativeNumber(event.durationMs),
      executionMode: boundedNullable(event.executionMode, 40),
      outcome: "failed"
    };
  }
  if (type === "model_call") {
    return {
      ...base,
      provider: boundedText(event.provider || "", 128),
      model: boundedText(event.model || "", 256),
      finishReason: boundedText(event.finishReason || "", 128),
      toolCallCount: nonNegativeInteger(event.toolCallCount),
      inputTokens: nonNegativeInteger(event.inputTokens),
      outputTokens: nonNegativeInteger(event.outputTokens),
      cachedInputTokens: nonNegativeInteger(event.cachedInputTokens),
      durationMs: nonNegativeNumber(event.latencyMs)
    };
  }
  if (type === "routing") {
    return {
      ...base,
      minimumClass: boundedNullable(event.minimumClass, 32),
      hostedClass: boundedNullable(event.hostedClass, 32),
      status: boundedNullable(event.status, 40),
      source: boundedNullable(event.source, 80),
      durationMs: nonNegativeNumber(event.latencyMs)
    };
  }
  if (type === "guard") {
    return {
      ...base,
      reasonSha256: digestValue(String(event.reason || "")),
      priorRoutingClass: boundedNullable(event.priorRoutingClass, 32),
      escalatedRoutingClass: boundedNullable(event.escalatedRoutingClass, 32)
    };
  }
  if (type === "context_compiled") {
    const compaction = event.compaction && typeof event.compaction === "object"
      ? event.compaction
      : null;
    return {
      ...base,
      turn: nonNegativeInteger(event.turn),
      messageCount: nonNegativeInteger(event.messageCount),
      toolCount: nonNegativeInteger(event.toolCount),
      promptContractSha256: boundedNullable(event.promptContract?.sha256, 64),
      compaction: compaction ? {
        applied: compaction.applied === true,
        reason: boundedNullable(compaction.reason, 120),
        scope: boundedNullable(compaction.scope, 80)
      } : null
    };
  }
  return {
    ...base,
    phase: boundedNullable(event.phase, 80),
    summarySha256: digestValue(String(event.summary || ""))
  };
}

function normalizeEpisodeEvent(event, sequence) {
  const normalized = event && typeof event === "object" ? structuredClone(event) : {};
  return { sequence, ...normalized };
}

function resultShape(value) {
  if (value == null) return "empty";
  if (Array.isArray(value)) return value.length === 0 ? "empty_array" : "array";
  if (typeof value !== "object") return "scalar";
  const count = ["count", "total", "result_count", "operation_count"]
    .map((key) => Number(value[key]))
    .find(Number.isFinite);
  if (count === 0) return "zero_results";
  return Object.keys(value).length === 0 ? "empty_object" : "object";
}

function digestValue(value) {
  const encoded = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(encoded).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function writeImmutable(filePath, contents) {
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await readFile(filePath, "utf8") !== contents) {
      throw new Error(`Immutable Desktop task episode differs: ${filePath}`);
    }
  } finally {
    await handle?.close();
  }
}

function boundedId(value, label) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function boundedText(value, maximum) {
  return String(value || "").slice(0, maximum);
}

function boundedNullable(value, maximum) {
  const text = boundedText(value, maximum);
  return text || null;
}

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function nonNegativeInteger(value) {
  return Math.round(nonNegativeNumber(value));
}

function validDate(value, label) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO timestamp`);
  return date.toISOString();
}
