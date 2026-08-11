const MAX_RECORDED_STEPS = 40;

/**
 * Task-local, non-durable recording of successfully verified browser steps.
 *
 * The recorder never keeps selectors, typed text, file paths, or file bytes.
 * Saving a recipe is a separate explicit operation that compiles these redacted
 * observations into a typed deterministic contract.
 */
export class BrowserRecipeRecorder {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.sessions = new Map();
  }

  record(scope, { operation, args = {}, result = {} } = {}) {
    const sessionId = String(result.session_id || args.session_id || "");
    if (!sessionId) return null;
    const owner = normalizeRecorderScope(scope);
    let recording = this.sessions.get(sessionId);
    if (!recording) {
      recording = {
        sessionId,
        owner,
        steps: [],
        startedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString()
      };
      this.sessions.set(sessionId, recording);
    }
    if (!sameRecorderScope(recording.owner, owner)) {
      throw new Error("That browser recording belongs to another task or account");
    }
    const step = recordedStep(operation, args, result);
    if (!step) return this.summary(sessionId, scope);
    if (recording.steps.length >= MAX_RECORDED_STEPS) {
      throw new Error(`A browser recipe recording is limited to ${MAX_RECORDED_STEPS} verified steps`);
    }
    recording.steps.push({
      index: recording.steps.length + 1,
      ...step,
      recordedAt: this.now().toISOString()
    });
    recording.updatedAt = this.now().toISOString();
    return this.summary(sessionId, scope);
  }

  draft(sessionId, scope) {
    const recording = this.require(sessionId, scope);
    if (!recording.steps.some((step) => step.kind === "open")) {
      throw new Error("Open a page in this browser session before saving a recipe");
    }
    return structuredClone(recording);
  }

  summary(sessionId, scope) {
    const recording = this.require(sessionId, scope);
    return {
      sessionId: recording.sessionId,
      stepCount: recording.steps.length,
      startedAt: recording.startedAt,
      updatedAt: recording.updatedAt
    };
  }

  clearSession(sessionId) {
    return this.sessions.delete(String(sessionId || ""));
  }

  clear() {
    this.sessions.clear();
  }

  require(sessionId, scope) {
    const recording = this.sessions.get(String(sessionId || ""));
    if (!recording || !sameRecorderScope(recording.owner, normalizeRecorderScope(scope))) {
      throw new Error("That browser recipe recording is no longer available to this task and account");
    }
    return recording;
  }
}

function recordedStep(operation, args, result) {
  const kind = String(operation || result.operation || "");
  if (kind === "open") {
    return {
      kind: "open",
      url: cleanUrl(result.url),
      title: cleanText(result.title, 300)
    };
  }
  if (["click", "type", "select", "check"].includes(kind) && result.action_receipt?.verified === true) {
    const receipt = result.action_receipt;
    return {
      kind,
      risk: receipt.risk === "observational" ? "observational" : "consequential",
      target: targetContract(receipt.target),
      payload: recordedPayload(kind, receipt.payload),
      receiptId: cleanText(receipt.receipt_id, 128)
    };
  }
  if (["upload", "download"].includes(kind) && result.transfer_receipt?.verified === true) {
    const receipt = result.transfer_receipt;
    return {
      kind,
      risk: "file-transfer",
      target: targetContract(receipt.target),
      payload: kind === "upload"
        ? {
            name: cleanText(receipt.artifact?.name, 240),
            mime: cleanText(receipt.artifact?.mime, 200),
            bytes: Number(receipt.artifact?.bytes) || 0,
            sha256: cleanText(receipt.artifact?.sha256, 64)
          }
        : {},
      receiptId: cleanText(receipt.receipt_id, 128)
    };
  }
  if (kind === "wait") {
    return {
      kind: "wait",
      condition: ["settled", "url", "text"].includes(args.condition) ? args.condition : "settled",
      value: cleanText(args.value, 300),
      timeoutMs: boundedInteger(args.timeout_ms, 5_000, 250, 10_000)
    };
  }
  return null;
}

function recordedPayload(kind, payload = {}) {
  if (kind === "type") {
    return {
      requiresInput: true,
      characters: boundedInteger(payload.characters, 0, 0, 5_000),
      sha256: cleanText(payload.sha256, 64),
      replace: payload.replace !== false
    };
  }
  if (kind === "select") return { optionName: cleanText(payload.option_name, 300) };
  if (kind === "check") return { checked: payload.checked === true };
  return {};
}

function targetContract(target = {}) {
  return {
    role: cleanText(target.role, 80),
    name: cleanText(target.name, 300),
    tag: cleanText(target.tag, 40).toLowerCase(),
    type: cleanText(target.type, 40).toLowerCase(),
    destination: cleanUrl(target.destination, true)
  };
}

function normalizeRecorderScope(scope = {}) {
  return {
    boundary: cleanText(scope.boundary, 32),
    subjectId: cleanRequired(scope.subjectId, 256, "browser recording subject"),
    tenantId: cleanRequired(scope.tenantId, 256, "browser recording tenant"),
    taskId: cleanRequired(scope.taskId, 256, "browser recording task")
  };
}

function sameRecorderScope(left, right) {
  return left?.boundary === right?.boundary &&
    left?.subjectId === right?.subjectId &&
    left?.tenantId === right?.tenantId &&
    left?.taskId === right?.taskId;
}

function cleanUrl(value, optional = false) {
  const raw = cleanText(value, 2_048);
  if (!raw && optional) return "";
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("A recorded browser recipe URL must be public HTTP(S) without credentials");
  }
  return url.href;
}

function cleanRequired(value, max, label) {
  const result = cleanText(value, max);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

export const browserRecipeRecorderLimits = Object.freeze({ maxSteps: MAX_RECORDED_STEPS });
