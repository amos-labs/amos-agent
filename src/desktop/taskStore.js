import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const MAX_TASKS = 100;
const MAX_STORE_CHARS = 16 * 1024 * 1024;
const STATUSES = new Set(["active", "waiting", "completed", "failed", "interrupted"]);
const KINDS = new Set(["general", "automation_builder", "goal_pursuit", "fork"]);
const WORKSPACE_MODES = new Set(["same_directory", "new_worktree", "context_only"]);
const CONTEXT_SCOPES = new Set(["everything", "from_here", "selected_artifacts"]);

/**
 * Encrypted, user-private Desktop metadata for durable AMOS tasks.
 *
 * This store owns local-only presentation and workspace state. It deliberately
 * does not persist transcripts, provider credentials, approvals, queued writes,
 * tool arguments, or execution authority. Model-run checkpoints remain in the
 * separate TaskCheckpointStore.
 */
export class DesktopTaskStore {
  constructor({
    filePath,
    encrypt,
    decrypt,
    now = () => new Date(),
    createId = randomUUID
  }) {
    if (!filePath) throw new Error("Tasks require a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Tasks require operating-system encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
    this.createId = createId;
  }

  async list(scope, { includeArchived = false, query = "" } = {}) {
    const owner = normalizeOwner(scope);
    const search = cleanText(query, 160).toLowerCase();
    const store = await this.readStore();
    return store.tasks
      .filter((task) => sameOwner(task.owner, owner))
      .filter((task) => includeArchived || !task.archivedAt)
      .filter((task) => !search || `${task.title}\n${task.objective}`.toLowerCase().includes(search))
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .map(publicTask);
  }

  async get(scope, id) {
    const owner = normalizeOwner(scope);
    const taskId = cleanRequired(id, 128, "task id");
    const store = await this.readStore();
    const task = store.tasks.find((item) => item.id === taskId && sameOwner(item.owner, owner));
    return task ? publicTask(task) : null;
  }

  async findByContext(scope, contextKey) {
    const owner = normalizeOwner(scope);
    const normalizedContextKey = normalizeIdentifier(contextKey, 128, "context key");
    const store = await this.readStore();
    const task = store.tasks.find((item) => (
      item.contextKey === normalizedContextKey && sameOwner(item.owner, owner)
    ));
    return task ? publicTask(task) : null;
  }

  async selected(scope) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    const candidates = store.tasks.filter((task) => (
      sameOwner(task.owner, owner) && !task.archivedAt
    ));
    if (candidates.length === 0) return null;
    const explicitlySelected = candidates.filter((task) => task.selectedAt);
    const ranked = explicitlySelected.length > 0 ? explicitlySelected : candidates;
    ranked.sort((left, right) => {
      const leftTime = left.selectedAt || left.updatedAt;
      const rightTime = right.selectedAt || right.updatedAt;
      return rightTime.localeCompare(leftTime) || right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id);
    });
    return publicTask(ranked[0]);
  }

  async select(scope, id) {
    const owner = normalizeOwner(scope);
    const taskId = cleanRequired(id, 128, "task id");
    const store = await this.readStore();
    const index = store.tasks.findIndex((item) => (
      item.id === taskId && sameOwner(item.owner, owner)
    ));
    if (index < 0 || store.tasks[index].archivedAt) {
      throw new Error("That AMOS task is not available to this account");
    }
    store.tasks[index] = normalizeTask({
      ...store.tasks[index],
      selectedAt: this.now().toISOString()
    });
    await this.writeStore(store);
    return publicTask(store.tasks[index]);
  }

  async create(scope, input = {}) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    const now = this.now().toISOString();
    const id = cleanText(input.id, 128) || this.createId();
    if (store.tasks.some((item) => item.id === id)) {
      throw new Error("That AMOS task already exists on this computer");
    }
    const contextKey = normalizeIdentifier(input.contextKey || `task:${id}`, 128, "context key");
    if (store.tasks.some((item) => (
      sameOwner(item.owner, owner) && item.contextKey === contextKey
    ))) {
      throw new Error("That AMOS task context already exists on this computer");
    }
    const task = normalizeTask({
      ...input,
      id,
      contextKey,
      owner,
      createdAt: now,
      updatedAt: now
    });
    if (store.tasks.filter((item) => sameOwner(item.owner, owner)).length >= MAX_TASKS) {
      throw new Error(`AMOS Desktop keeps up to ${MAX_TASKS} tasks per account`);
    }
    store.tasks.push(task);
    await this.writeStore(store);
    return publicTask(task);
  }

  async upsert(scope, input = {}) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    const now = this.now().toISOString();
    const id = cleanRequired(input.id, 128, "task id");
    const index = store.tasks.findIndex((item) => item.id === id && sameOwner(item.owner, owner));
    const existing = index >= 0 ? store.tasks[index] : null;
    const task = normalizeTask({
      ...(existing || {}),
      ...input,
      id,
      contextKey: input.contextKey || existing?.contextKey || `task:${id}`,
      owner,
      createdAt: existing?.createdAt || input.createdAt || now,
      updatedAt: input.updatedAt || now
    });
    if (index >= 0) store.tasks[index] = task;
    else store.tasks.push(task);
    await this.writeStore(store);
    return publicTask(task);
  }

  async update(scope, id, changes = {}) {
    const owner = normalizeOwner(scope);
    const store = await this.readStore();
    const index = store.tasks.findIndex((item) => item.id === id && sameOwner(item.owner, owner));
    if (index < 0) throw new Error("That AMOS task is not available to this account");
    const current = store.tasks[index];
    const updated = normalizeTask({
      ...current,
      ...(Object.hasOwn(changes, "title") ? { title: changes.title } : {}),
      ...(Object.hasOwn(changes, "objective") ? { objective: changes.objective } : {}),
      ...(Object.hasOwn(changes, "status") ? { status: changes.status } : {}),
      ...(Object.hasOwn(changes, "pinned") ? { pinned: changes.pinned === true } : {}),
      ...(Object.hasOwn(changes, "archived")
        ? { archivedAt: changes.archived === true ? this.now().toISOString() : null }
        : {}),
      ...(Object.hasOwn(changes, "projectId") ? { projectId: changes.projectId } : {}),
      ...(Object.hasOwn(changes, "canvasState") ? { canvasState: changes.canvasState } : {}),
      ...(Object.hasOwn(changes, "workspace") ? { workspace: changes.workspace } : {}),
      ...(Object.hasOwn(changes, "outcome") ? { outcome: changes.outcome } : {}),
      updatedAt: this.now().toISOString()
    });
    store.tasks[index] = updated;
    await this.writeStore(store);
    return publicTask(updated);
  }

  async readStore() {
    let outer;
    try {
      outer = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { version: VERSION, tasks: [] };
      throw new Error(`Could not read AMOS tasks: ${error.message}`);
    }
    if (
      outer?.version !== VERSION ||
      typeof outer.encryptedRecord !== "string" ||
      outer.encryptedRecord.length === 0 ||
      outer.encryptedRecord.length > MAX_STORE_CHARS
    ) {
      throw new Error("Unsupported or corrupted AMOS task store");
    }
    try {
      const value = JSON.parse(this.decrypt(outer.encryptedRecord));
      if (value?.version !== VERSION || !Array.isArray(value.tasks) || value.tasks.length > 500) {
        throw new Error("invalid task store contract");
      }
      return { version: VERSION, tasks: value.tasks.map(normalizeTask) };
    } catch (error) {
      throw new Error(`Could not decrypt AMOS tasks: ${error.message}`);
    }
  }

  async writeStore(store) {
    const value = {
      version: VERSION,
      tasks: store.tasks.map(normalizeTask)
    };
    const encryptedRecord = this.encrypt(JSON.stringify(value));
    if (!encryptedRecord || encryptedRecord.length > MAX_STORE_CHARS) {
      throw new Error("Encrypted AMOS tasks exceed the local storage limit");
    }
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(
      temporary,
      `${JSON.stringify({ version: VERSION, encryptedRecord }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

export function taskOwnerScope({ identity = null, boundary = "personal", workspace = "" } = {}) {
  const normalizedBoundary = ["online", "personal", "offline"].includes(boundary)
    ? boundary
    : "personal";
  if (normalizedBoundary === "online") {
    const subjectId = cleanText(identity?.sub || identity?.user?.id, 256);
    const tenantId = cleanText(identity?.tenant_id, 256);
    if (identity?.principal_type !== "user" || !subjectId || !tenantId) return null;
    return { boundary: normalizedBoundary, subjectId, tenantId, workspace: cleanText(workspace, 4_096) };
  }
  return {
    boundary: normalizedBoundary,
    subjectId: "local-user",
    tenantId: normalizedBoundary,
    workspace: cleanText(workspace, 4_096)
  };
}

function normalizeOwner(value) {
  if (!value) throw new Error("An AMOS task needs an account scope");
  return {
    boundary: enumValue(value.boundary, new Set(["online", "personal", "offline"]), "personal"),
    subjectId: cleanRequired(value.subjectId, 256, "task subject"),
    tenantId: cleanRequired(value.tenantId, 256, "task tenant")
  };
}

function normalizeTask(value) {
  const id = cleanRequired(value?.id, 128, "task id");
  const contextKey = normalizeIdentifier(value?.contextKey || `task:${id}`, 128, "context key");
  const workspaceMode = enumValue(value?.workspaceMode, WORKSPACE_MODES, "same_directory");
  return {
    id,
    remoteId: cleanText(value?.remoteId, 128),
    contextKey,
    title: redact(cleanRequired(value?.title || "Untitled task", 160, "task title")),
    objective: redact(cleanRequired(value?.objective || value?.title || "Untitled task", 6_000, "task objective")),
    kind: enumValue(value?.kind, KINDS, "general"),
    status: enumValue(value?.status, STATUSES, "active"),
    pinned: value?.pinned === true,
    archivedAt: optionalTimestamp(value?.archivedAt),
    parentTaskId: cleanText(value?.parentTaskId, 128),
    projectId: optionalUuid(value?.projectId),
    sourceEventId: cleanText(value?.sourceEventId, 160),
    contextScope: enumValue(value?.contextScope, CONTEXT_SCOPES, "from_here"),
    workspaceMode,
    workspace: normalizeWorkspace(value?.workspace, workspaceMode),
    resourceRefs: uniqueStrings(value?.resourceRefs, 40, 1_024),
    forkManifest: normalizeForkManifest(value?.forkManifest),
    canvasState: normalizeCanvasState(value?.canvasState),
    outcome: normalizeTaskOutcome(value?.outcome),
    owner: normalizeOwner(value?.owner),
    selectedAt: optionalTimestamp(value?.selectedAt),
    createdAt: normalizeTimestamp(value?.createdAt),
    updatedAt: normalizeTimestamp(value?.updatedAt)
  };
}

function normalizeWorkspace(value, mode) {
  if (mode === "context_only") return {};
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    localPath: cleanText(source.localPath, 4_096),
    // Persisted best-effort focus. Desktop revalidates on resume that the folder
    // still exists inside the grant; a stale entry is dropped, never widened.
    focusPath: cleanText(source.focusPath, 4_096),
    label: redact(cleanText(source.label, 160)),
    repository: cleanText(source.repository, 500),
    branch: cleanText(source.branch, 300),
    commit: /^[a-f0-9]{7,64}$/i.test(String(source.commit || "")) ? String(source.commit) : "",
    dirty: source.dirty === true
  };
}

function normalizeCanvasState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { activeCanvasId: null, canvases: [] };
  }
  const canvases = (Array.isArray(value.canvases) ? value.canvases : [])
    .slice(0, 20)
    .flatMap((canvas) => {
      if (!canvas || typeof canvas !== "object" || Array.isArray(canvas)) return [];
      const serialized = JSON.stringify(canvas);
      if (serialized.length > 512_000) return [];
      return [JSON.parse(redact(serialized))];
    });
  const activeCanvasId = cleanText(value.activeCanvasId, 128) || null;
  return { activeCanvasId, canvases };
}

function normalizeTaskOutcome(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    status: cleanText(value.status, 32),
    summary: redact(cleanText(value.summary, 2_000)),
    answer: redact(cleanText(value.answer, 8_000)),
    diff: cleanText(value.diff, 8_000),
    files: uniqueStrings(value.files, 40, 1_024),
    usage: value.usage && typeof value.usage === "object" ? {
      inputTokens: Number(value.usage.inputTokens) || 0,
      outputTokens: Number(value.usage.outputTokens) || 0,
      totalTokens: Number(value.usage.totalTokens) || 0,
      costUsedMicrousd: Number(value.usage.costUsedMicrousd) || 0,
      requestedRuntime: cleanText(value.usage.requestedRuntime, 32),
      runtime: cleanText(value.usage.runtime, 32),
      runtimeFallbacks: Math.max(0, Number(value.usage.runtimeFallbacks) || 0),
      fallbackReason: cleanText(value.usage.fallbackReason, 500) || null,
      performance: value.usage.performance && typeof value.usage.performance === "object"
        ? JSON.parse(JSON.stringify(value.usage.performance))
        : null
    } : null,
    finishedAt: optionalTimestamp(value.finishedAt),
    error: cleanText(value.error, 1_000) || null
  };
}

function normalizeForkManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const safe = {
    format: value.format === "amos.task_fork_manifest" ? value.format : "amos.task_fork_manifest",
    version: 1,
    parentTaskId: cleanText(value.parentTaskId || value.scope?.parentTaskId, 128),
    sourceEventId: cleanText(value.sourceEventId || value.scope?.sourceEventId, 160),
    contextScope: enumValue(value.contextScope || value.scope?.contextScope, CONTEXT_SCOPES, "from_here"),
    workspaceMode: enumValue(value.workspaceMode || value.scope?.workspaceMode, WORKSPACE_MODES, "same_directory"),
    selectedArtifacts: uniqueStrings(value.selectedArtifacts, 40, 1_024),
    safeguards: {
      orientationOnly: true,
      requiresFreshIdentity: true,
      requiresFreshCompanyEvidence: true,
      requiresFreshPolicy: true,
      requiresFreshApprovals: true,
      requiresFreshReceipts: true,
      replayAllowed: false,
      pendingOperationsCopied: false,
      credentialsIncluded: false,
      executionAuthorityIncluded: false
    }
  };
  return safe;
}

function publicTask(task) {
  return JSON.parse(JSON.stringify(task));
}

function sameOwner(left, right) {
  return left?.boundary === right?.boundary &&
    left?.subjectId === right?.subjectId &&
    left?.tenantId === right?.tenantId;
}

function normalizeIdentifier(value, max, label) {
  const result = cleanRequired(value, max, label);
  if (!/^[A-Za-z0-9._:-]+$/.test(result)) throw new Error(`AMOS ${label} is invalid`);
  return result;
}

function optionalUuid(value) {
  const id = cleanText(value, 128);
  if (!id) return "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("task Project id is invalid");
  }
  return id;
}

function enumValue(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function uniqueStrings(value, maxItems, maxLength) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => redact(cleanText(item, maxLength)))
    .filter(Boolean))]
    .slice(-maxItems);
}

function cleanRequired(value, max, label) {
  const result = cleanText(value, max);
  if (!result) throw new Error(`AMOS is missing ${label}`);
  return result;
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeTimestamp(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) throw new Error("AMOS task has an invalid timestamp");
  return date.toISOString();
}

function optionalTimestamp(value) {
  return value ? normalizeTimestamp(value) : null;
}

function redact(value) {
  return String(value || "")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]")
    .replace(/((?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}
