import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EVIDENCE_PACK_SCHEMA,
  MAX_PLATFORM_EVIDENCE_ITEMS
} from "./memoryContract.js";

const VERSION = 1;
const MAX_RECEIPTS = 500;

export class LocalReceiptStore {
  constructor({
    filePath,
    encrypt,
    decrypt,
    now = () => new Date(),
    createId = randomUUID
  }) {
    if (!filePath) throw new Error("Local receipts require a storage path");
    if (typeof encrypt !== "function" || typeof decrypt !== "function") {
      throw new Error("Local receipts require operating-system encryption");
    }
    this.filePath = filePath;
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.now = now;
    this.createId = createId;
  }

  async list(scope = null) {
    const store = await this.readStore();
    return store.receipts
      .map((envelope) => {
        const receipt = JSON.parse(this.decrypt(envelope.payload));
        if (receipt.id !== envelope.id || receipt.digest !== envelope.digest) {
          throw new Error("local receipt envelope does not match its encrypted content");
        }
        return receipt;
      })
      .filter((receipt) => scopeMatches(receipt, scope))
      .map(publicReceipt)
      .reverse();
  }

  async add(input, scope = null) {
    const store = await this.readStore();
    const receipt = normalizeReceipt({
      ...input,
      ...normalizedScope(scope),
      id: this.createId(),
      recordedAt: this.now().toISOString()
    });
    receipt.digest = createHash("sha256")
      .update(JSON.stringify({ ...receipt, digest: undefined }))
      .digest("hex");
    store.receipts.push({
      id: receipt.id,
      recordedAt: receipt.recordedAt,
      digest: receipt.digest,
      payload: this.encrypt(JSON.stringify(receipt))
    });
    store.receipts = store.receipts.slice(-MAX_RECEIPTS);
    await this.writeStore(store);
    return publicReceipt(receipt);
  }

  async bindUnscoped(scope) {
    const normalized = normalizedScope(scope);
    if (!normalized.ownerSubjectId) return 0;
    const store = await this.readStore();
    let changed = 0;
    store.receipts = store.receipts.map((envelope) => {
      const receipt = JSON.parse(this.decrypt(envelope.payload));
      if (receipt.ownerSubjectId || receipt.ownerTenantId) return envelope;
      changed += 1;
      const updated = { ...receipt, ...normalized };
      updated.digest = createHash("sha256")
        .update(JSON.stringify({ ...updated, digest: undefined }))
        .digest("hex");
      return {
        ...envelope,
        digest: updated.digest,
        payload: this.encrypt(JSON.stringify(updated))
      };
    });
    if (changed > 0) await this.writeStore(store);
    return changed;
  }

  async readStore() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.version !== VERSION || !Array.isArray(parsed.receipts)) {
        throw new Error("unsupported receipt format");
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return { version: VERSION, receipts: [] };
      throw new Error(`Could not read local AMOS receipts: ${error.message}`);
    }
  }

  async writeStore(store) {
    const directory = dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => {});
  }
}

function normalizeReceipt(input) {
  const status = ["completed", "failed", "canceled"].includes(input.status)
    ? input.status
    : "failed";
  return {
    id: String(input.id),
    taskId: String(input.taskId || "").slice(0, 128),
    status,
    boundary: ["online", "personal", "offline"].includes(input.boundary)
      ? input.boundary
      : "personal",
    workspace: String(input.workspace || "").slice(0, 256),
    model: String(input.model || "").slice(0, 256),
    objective: String(input.objective || "").slice(0, 500),
    startedAt: String(input.startedAt || ""),
    finishedAt: String(input.finishedAt || ""),
    events: Array.isArray(input.events)
      ? input.events.slice(0, 200).map((event) => ({
          type: String(event.type || "").slice(0, 80),
          name: String(event.name || "").slice(0, 160),
          outcome: String(event.outcome || "").slice(0, 160)
        }))
      : [],
    error: input.error ? String(input.error).slice(0, 1_000) : null,
    ownerSubjectId: clean(input.ownerSubjectId, 256),
    ownerTenantId: clean(input.ownerTenantId, 256),
    recordedAt: String(input.recordedAt),
    digest: ""
  };
}

function normalizedScope(scope) {
  return {
    ownerSubjectId: clean(scope?.ownerSubjectId, 256),
    ownerTenantId: clean(scope?.ownerTenantId, 256)
  };
}

function scopeMatches(receipt, scope) {
  if (!scope) return true;
  const normalized = normalizedScope(scope);
  return Boolean(
    normalized.ownerSubjectId &&
    receipt.ownerSubjectId === normalized.ownerSubjectId &&
    receipt.ownerTenantId === normalized.ownerTenantId
  );
}

export function publicReceipt(receipt) {
  const { ownerSubjectId: _ownerSubjectId, ownerTenantId: _ownerTenantId, ...value } = receipt;
  return value;
}

// Insertion order used by normalizeReceipt. owner* are hashed, not exported.
export const LOCAL_RECEIPT_DIGEST_KEYS = Object.freeze([
  "id",
  "taskId",
  "status",
  "boundary",
  "workspace",
  "model",
  "objective",
  "startedAt",
  "finishedAt",
  "events",
  "error",
  "ownerSubjectId",
  "ownerTenantId",
  "recordedAt"
]);

export const LOCAL_RECEIPT_PUBLIC_KEYS = Object.freeze([
  "id",
  "taskId",
  "status",
  "boundary",
  "workspace",
  "model",
  "objective",
  "startedAt",
  "finishedAt",
  "events",
  "error",
  "recordedAt",
  "digest"
]);

const LOCAL_STATUSES = new Set(["completed", "failed", "canceled"]);
const LOCAL_BOUNDARIES = new Set(["online", "personal", "offline"]);
const PLATFORM_AGENCIES = new Set([
  "human_directed",
  "standing_automation",
  "goal_pursuit",
  "legacy_unclassified"
]);
const PLATFORM_LIFECYCLES = new Set([
  "proposed",
  "parked",
  "executed",
  "failed",
  "denied",
  "measured",
  "legacy_unclassified"
]);
const CORRELATION_KEYS = Object.freeze([
  "pending_id",
  "goal_id",
  "proposal_id",
  "cycle",
  "run_id",
  "automation_id",
  "enrollment_id"
]);
const EMBEDDED_HASH_KEYS = Object.freeze([
  "digest",
  "sha256",
  "content_hash",
  "receipt_hash"
]);
const HEX64 = /^[a-f0-9]{64}$/;

export function toDesktopLocalItem(receipt) {
  if (!receipt || typeof receipt !== "object") return null;
  const id = String(receipt.id || "").trim();
  if (!id) return null;
  const status = LOCAL_STATUSES.has(receipt.status) ? receipt.status : "failed";
  const boundary = LOCAL_BOUNDARIES.has(receipt.boundary) ? receipt.boundary : "personal";
  return {
    kind: "desktop-local",
    id,
    taskId: String(receipt.taskId || ""),
    status,
    boundary,
    workspace: String(receipt.workspace || ""),
    model: String(receipt.model || ""),
    objective: String(receipt.objective || ""),
    startedAt: String(receipt.startedAt || ""),
    finishedAt: String(receipt.finishedAt || ""),
    events: normalizePublicEvents(receipt.events),
    error: receipt.error == null || receipt.error === "" ? null : String(receipt.error),
    recordedAt: String(receipt.recordedAt || ""),
    digest: String(receipt.digest || "")
  };
}

export function toPlatformEvidenceItem(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "").trim();
  const operation = String(row.operation || "").trim();
  if (!id || !operation) return null;
  const nestedSource = row.receipt && typeof row.receipt === "object" && !Array.isArray(row.receipt)
    ? row.receipt
    : null;
  const agency = coerceEnum(
    row.agency || nestedSource?.agency,
    PLATFORM_AGENCIES,
    "legacy_unclassified"
  );
  const lifecycle = coerceEnum(
    row.lifecycle_state || row.lifecycleState || nestedSource?.lifecycle_state,
    PLATFORM_LIFECYCLES,
    "legacy_unclassified"
  );
  const effectApplied = firstBoolean(
    row.effect_applied,
    row.effectApplied,
    nestedSource?.effect_applied
  );
  const item = {
    kind: "platform",
    id,
    operation,
    agency,
    lifecycle_state: lifecycle,
    effect_applied: effectApplied,
    verified: row.verified === true,
    correlation: sanitizeCorrelation(row.correlation || nestedSource?.correlation)
  };
  const actor = String(row.actor || nestedSource?.actor || "").trim();
  if (actor) item.actor = actor;
  const createdAt = String(row.created_at || row.createdAt || nestedSource?.emitted_at || "").trim();
  if (createdAt) item.created_at = createdAt;
  const nested = sanitizeNestedReceipt(nestedSource);
  if (nested) item.receipt = nested;
  for (const key of EMBEDDED_HASH_KEYS) {
    if (typeof row[key] === "string") item[key] = row[key];
  }
  return item;
}

export function buildEvidencePack({
  localReceipts = [],
  platformReceipts = [],
  exportedAt = new Date().toISOString()
} = {}) {
  const localItems = (Array.isArray(localReceipts) ? localReceipts : [])
    .map(toDesktopLocalItem)
    .filter(Boolean);
  const platformItems = (Array.isArray(platformReceipts) ? platformReceipts : [])
    .map(toPlatformEvidenceItem)
    .filter(Boolean)
    .slice(0, MAX_PLATFORM_EVIDENCE_ITEMS);
  return {
    schema: EVIDENCE_PACK_SCHEMA,
    exportedAt: String(exportedAt),
    items: [...localItems, ...platformItems]
  };
}

export async function writeEvidencePack(filePath, pack) {
  if (!filePath) throw new Error("Choose where to save the AMOS evidence pack");
  const serialized = `${JSON.stringify(pack, null, 2)}\n`;
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, serialized, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  await rename(temporary, filePath);
  await chmod(filePath, 0o600).catch(() => {});
  return pack;
}

export function replayLocalReceiptDigest(item, {
  ownerSubjectId = "",
  ownerTenantId = ""
} = {}) {
  const payload = {
    id: String(item.id),
    taskId: String(item.taskId || ""),
    status: LOCAL_STATUSES.has(item.status) ? item.status : "failed",
    boundary: LOCAL_BOUNDARIES.has(item.boundary) ? item.boundary : "personal",
    workspace: String(item.workspace || ""),
    model: String(item.model || ""),
    objective: String(item.objective || ""),
    startedAt: String(item.startedAt || ""),
    finishedAt: String(item.finishedAt || ""),
    events: normalizePublicEvents(item.events),
    error: item.error == null || item.error === "" ? null : String(item.error),
    ownerSubjectId: String(ownerSubjectId || ""),
    ownerTenantId: String(ownerTenantId || ""),
    recordedAt: String(item.recordedAt || "")
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function verifyEvidencePack(pack) {
  const errors = [];
  const warnings = [];
  const items = [];
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    return { ok: false, errors: ["Evidence pack must be a JSON object"], warnings, items };
  }
  if (pack.schema !== EVIDENCE_PACK_SCHEMA) {
    errors.push(`schema must be ${EVIDENCE_PACK_SCHEMA}`);
  }
  if (!isIsoInstant(pack.exportedAt)) {
    errors.push("exportedAt must be a UTC ISO-8601 instant");
  }
  if (!Array.isArray(pack.items)) {
    errors.push("items must be an array");
    return { ok: false, errors, warnings, items };
  }

  let platformCount = 0;
  pack.items.forEach((item, index) => {
    const result = { index, kind: item?.kind || "", id: String(item?.id || ""), digest: "n/a" };
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`items[${index}] must be an object`);
      items.push(result);
      return;
    }
    if (item.kind === "desktop-local") {
      const local = verifyDesktopLocalItem(item, index);
      errors.push(...local.errors);
      result.digest = local.digest;
      items.push(result);
      return;
    }
    if (item.kind === "platform") {
      platformCount += 1;
      errors.push(...verifyPlatformItem(item, index));
      items.push(result);
      return;
    }
    errors.push(`items[${index}].kind is unsupported`);
    items.push(result);
  });
  if (platformCount > MAX_PLATFORM_EVIDENCE_ITEMS) {
    errors.push(`platform items exceed ${MAX_PLATFORM_EVIDENCE_ITEMS}`);
  }
  return { ok: errors.length === 0, errors, warnings, items };
}

function verifyDesktopLocalItem(item, index) {
  const errors = [];
  const prefix = `items[${index}]`;
  requireString(item.id, `${prefix}.id`, errors, { nonempty: true });
  requireString(item.taskId, `${prefix}.taskId`, errors);
  if (!LOCAL_STATUSES.has(item.status)) {
    errors.push(`${prefix}.status must be completed, failed, or canceled`);
  }
  if (!LOCAL_BOUNDARIES.has(item.boundary)) {
    errors.push(`${prefix}.boundary must be online, personal, or offline`);
  }
  for (const key of ["workspace", "model", "objective", "startedAt", "finishedAt"]) {
    requireString(item[key], `${prefix}.${key}`, errors);
  }
  if (!Array.isArray(item.events) || item.events.length > 200) {
    errors.push(`${prefix}.events must be an array of at most 200 objects`);
  } else {
    item.events.forEach((event, eventIndex) => {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        errors.push(`${prefix}.events[${eventIndex}] must be an object`);
        return;
      }
      requireString(event.type, `${prefix}.events[${eventIndex}].type`, errors);
      requireString(event.name, `${prefix}.events[${eventIndex}].name`, errors);
      requireString(event.outcome, `${prefix}.events[${eventIndex}].outcome`, errors);
    });
  }
  if (item.error !== null && typeof item.error !== "string") {
    errors.push(`${prefix}.error must be a string or null`);
  }
  if (!isIsoInstant(item.recordedAt)) {
    errors.push(`${prefix}.recordedAt must be a non-empty ISO-8601 instant`);
  }
  if (typeof item.digest !== "string" || !HEX64.test(item.digest)) {
    errors.push(`${prefix}.digest must be 64-char lowercase hex`);
    return { errors, digest: "invalid" };
  }
  if (Object.hasOwn(item, "ownerSubjectId") || Object.hasOwn(item, "ownerTenantId")) {
    errors.push(`${prefix} must omit ownerSubjectId and ownerTenantId`);
  }
  const replayed = replayLocalReceiptDigest(item);
  return { errors, digest: replayed === item.digest ? "ok" : "unverified" };
}

function verifyPlatformItem(item, index) {
  const errors = [];
  const prefix = `items[${index}]`;
  requireString(item.id, `${prefix}.id`, errors, { nonempty: true });
  requireString(item.operation, `${prefix}.operation`, errors, { nonempty: true });
  if (!PLATFORM_AGENCIES.has(item.agency)) {
    errors.push(`${prefix}.agency is not a recognized agency`);
  }
  if (!PLATFORM_LIFECYCLES.has(item.lifecycle_state)) {
    errors.push(`${prefix}.lifecycle_state is not a recognized lifecycle`);
  }
  if (item.effect_applied !== null && typeof item.effect_applied !== "boolean") {
    errors.push(`${prefix}.effect_applied must be a boolean or null`);
  }
  if (typeof item.verified !== "boolean") {
    errors.push(`${prefix}.verified must be a boolean`);
  }
  if (!isPlainObject(item.correlation)) {
    errors.push(`${prefix}.correlation must be an object`);
  }
  checkEmbeddedHashes(item, prefix, errors);
  if (item.receipt !== undefined) {
    if (!isPlainObject(item.receipt)) {
      errors.push(`${prefix}.receipt must be an object when present`);
    } else {
      verifyNestedReceipt(item.receipt, `${prefix}.receipt`, errors);
    }
  }
  return errors;
}

function verifyNestedReceipt(receipt, prefix, errors) {
  if (hasNonEmptyInputs(receipt.inputs)) {
    errors.push(`${prefix}.inputs must be omitted or {}`);
  }
  requireString(receipt.operation, `${prefix}.operation`, errors, { nonempty: true });
  requireString(receipt.actor, `${prefix}.actor`, errors, { nonempty: true });
  requireString(receipt.intent?.summary, `${prefix}.intent.summary`, errors, { nonempty: true });
  requireString(
    receipt.intent?.scope_classification,
    `${prefix}.intent.scope_classification`,
    errors,
    { nonempty: true }
  );
  requireString(receipt.result_summary, `${prefix}.result_summary`, errors, { nonempty: true });
  if (Object.hasOwn(receipt, "lifecycle_state")) {
    const lifecycle = receipt.lifecycle_state;
    const effect = receipt.effect_applied;
    if (["proposed", "parked", "denied", "measured"].includes(lifecycle) && effect !== false) {
      errors.push(`${prefix} lifecycle ${lifecycle} requires effect_applied=false`);
    }
    if (lifecycle === "executed" && effect !== true) {
      errors.push(`${prefix} lifecycle executed requires effect_applied=true`);
    }
  }
  checkEmbeddedHashes(receipt, prefix, errors);
}

function sanitizeNestedReceipt(receipt) {
  if (!isPlainObject(receipt) || !nestedReceiptExportable(receipt)) return undefined;
  const nested = { ...receipt };
  if (hasNonEmptyInputs(nested.inputs)) delete nested.inputs;
  else if (isPlainObject(nested.inputs)) nested.inputs = {};
  return nested;
}

function nestedReceiptExportable(receipt) {
  return Boolean(
    String(receipt.operation || "").trim() &&
    String(receipt.actor || "").trim() &&
    String(receipt.intent?.summary || "").trim() &&
    String(receipt.intent?.scope_classification || "").trim() &&
    String(receipt.result_summary || "").trim()
  );
}

function sanitizeCorrelation(value) {
  if (!isPlainObject(value)) return {};
  const correlation = {};
  for (const key of CORRELATION_KEYS) {
    if (value[key] !== undefined) correlation[key] = value[key];
  }
  return correlation;
}

function normalizePublicEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.slice(0, 200).map((event) => ({
    type: String(event?.type || ""),
    name: String(event?.name || ""),
    outcome: String(event?.outcome || "")
  }));
}

function checkEmbeddedHashes(target, prefix, errors) {
  for (const key of EMBEDDED_HASH_KEYS) {
    if (!Object.hasOwn(target, key)) continue;
    if (typeof target[key] !== "string" || !HEX64.test(target[key])) {
      errors.push(`${prefix}.${key} must be 64-char lowercase hex`);
    }
  }
}

function hasNonEmptyInputs(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function coerceEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim();
  return allowed.has(normalized) ? normalized : fallback;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function requireString(value, label, errors, { nonempty = false } = {}) {
  if (typeof value !== "string") {
    errors.push(`${label} must be a string`);
    return;
  }
  if (nonempty && !value.trim()) errors.push(`${label} must be non-empty`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoInstant(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function clean(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
