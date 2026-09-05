// Host observations only. Completion, retries and route changes are not quality labels.
const CLASSES = ["routine", "balanced", "deep", "frontier"];
const LIMIT = 128;
const SHA = /^[a-f0-9]{64}$/;
const text = (v, n = 256) => typeof v === "string" ? v.slice(0, n) : "";
const hash = (v) => SHA.test(v || "") ? v : null;
const count = (v) => Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 100_000_000) : 0;
const tier = (v) => CLASSES.includes(v) ? v : null;

/** Bounded, synchronous observer: no I/O, no inference, no prompt/tool content. */
export class RouterFeedbackRecorder {
  constructor() {
    this.requests = new Map();
    this.omitted = 0;
    this.toolFailures = 0;
    this.toolResults = 0;
    this.retries = 0;
    this.steeringEvents = 0;
  }

  observe(event = {}) {
    if (event.type === "tool_error" || event.type === "tool_end" && event.result?.ok === false) this.toolFailures++;
    if (event.type === "tool_end") this.toolResults++;
    if (event.type === "phase" && event.phase === "retrying") this.retries++;
    if (event.type === "phase" && event.phase === "steering_applied") this.steeringEvents++;
    const id = text(event.routingRequestId, 100);
    if (event.type === "routing" && event.status === "classified") {
      if (!id || this.requests.has(id)) return;
      if (this.requests.size >= LIMIT) { this.omitted++; return; }
      this.requests.set(id, {
        requestId: id, turn: count(event.turn), phase: event.phase === "continue" ? "continue" : "plan",
        proposedClass: tier(event.minimumClass), applied: event.routingApplied === true,
        rolloutMode: ["active", "shadow"].includes(event.rolloutMode) ? event.rolloutMode : "unknown",
        routerModel: text(event.model), classifierContract: text(event.contract, 100),
        artifactSha256: hash(event.artifactSha256), inputSha256: hash(event.inputSha256),
        promptSha256: hash(event.promptSha256), routerLatencyMs: count(event.latencyMs),
        servedClass: null, servedModel: "", platformCallId: "", platformRoutingPolicy: "", platformRoutingMode: "", platformFallbackUsed: false, responseObserved: false,
        responseLatencyMs: 0, inputTokens: 0, outputTokens: 0, fallbackUsed: false
      });
    }
    const row = this.requests.get(id);
    if (!row) return;
    if (event.type === "routing" && ["served", "compared"].includes(event.status)) {
      row.servedClass = tier(event.hostedClass);
      row.servedModel = text(event.servedModel);
      row.platformCallId = text(event.platformCallId, 100);
      row.platformRoutingPolicy = text(event.platformRoutingPolicy);
      row.platformRoutingMode = text(event.platformRoutingMode);
      row.platformFallbackUsed = event.platformFallbackUsed === true;
    }
    if (event.type === "usage") {
      row.responseObserved = true;
      row.responseLatencyMs = count(event.latencyMs);
      row.inputTokens = count(event.inputTokens);
      row.outputTokens = count(event.outputTokens);
      row.fallbackUsed = event.fallbackUsed === true;
      // An alias/configured model is not the identity of the backend actually served.
    }
  }

  finish(status) {
    if (!this.requests.size) return null;
    return validateRouterFeedback({
      schema: "amos.router-outcome-observation", version: 1,
      terminalStatus: ["completed", "failed", "canceled", "interrupted"].includes(status) ? status : "failed",
      correctness: "unverified", trainingEligible: false,
      omittedRequests: count(this.omitted), toolFailures: count(this.toolFailures),
      toolResults: count(this.toolResults), retries: count(this.retries), steeringEvents: count(this.steeringEvents),
      requests: [...this.requests.values()]
    });
  }
}

/** Strict allowlist also prevents imported observations from smuggling task text. */
export function validateRouterFeedback(value) {
  const keys = ["schema", "version", "terminalStatus", "correctness", "trainingEligible", "omittedRequests", "toolFailures", "toolResults", "retries", "steeringEvents", "requests"];
  exact(value, keys);
  if (value.schema !== "amos.router-outcome-observation" || value.version !== 1 ||
      value.correctness !== "unverified" || value.trainingEligible !== false ||
      !["completed", "failed", "canceled", "interrupted"].includes(value.terminalStatus) ||
      !Array.isArray(value.requests) || value.requests.length < 1 || value.requests.length > LIMIT) throw Error("Invalid router observation");
  for (const k of ["omittedRequests", "toolFailures", "toolResults", "retries", "steeringEvents"]) integer(value[k]);
  const ids = new Set();
  for (const row of value.requests) {
    exact(row, ["requestId", "turn", "phase", "proposedClass", "applied", "rolloutMode", "routerModel", "classifierContract", "artifactSha256", "inputSha256", "promptSha256", "routerLatencyMs", "servedClass", "servedModel", "platformCallId", "platformRoutingPolicy", "platformRoutingMode", "platformFallbackUsed", "responseObserved", "responseLatencyMs", "inputTokens", "outputTokens", "fallbackUsed"]);
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(row.requestId) || ids.has(row.requestId)) throw Error("Invalid or duplicate router request id");
    ids.add(row.requestId);
    if (!["plan", "continue"].includes(row.phase) || !["active", "shadow", "unknown"].includes(row.rolloutMode) ||
        !CLASSES.includes(row.proposedClass) || row.servedClass !== null && !CLASSES.includes(row.servedClass)) throw Error("Invalid observed router class");
    for (const k of ["routerModel", "classifierContract", "servedModel", "platformCallId", "platformRoutingPolicy", "platformRoutingMode"]) if (typeof row[k] !== "string" || row[k].length > 256) throw Error("Invalid router identity");
    for (const k of ["artifactSha256", "inputSha256", "promptSha256"]) if (row[k] !== null && !SHA.test(row[k])) throw Error("Invalid router hash");
    for (const k of ["turn", "routerLatencyMs", "responseLatencyMs", "inputTokens", "outputTokens"]) integer(row[k]);
    for (const k of ["applied", "responseObserved", "fallbackUsed", "platformFallbackUsed"]) if (typeof row[k] !== "boolean") throw Error("Invalid router observation flag");
    if (row.applied && row.rolloutMode !== "active") throw Error("A shadow decision cannot be applied");
  }
  return structuredClone(value);
}

function integer(v) { if (!Number.isSafeInteger(v) || v < 0 || v > 100_000_000) throw Error("Invalid router observation count"); }
function exact(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw Error("Unexpected router observation fields");
}
