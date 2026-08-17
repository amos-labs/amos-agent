import { randomUUID } from "node:crypto";

export class DesktopApprovalBridge {
  constructor({ onRequest = () => {} } = {}) {
    this.onRequest = onRequest;
    this.pending = new Map();
    this.taskScope = null;
    this.taskGrants = new Set();
  }

  confirm(message, { kind = "local-action" } = {}) {
    if (this.taskGrants.has(kind)) return Promise.resolve(true);
    const id = randomUUID();
    const request = {
      id,
      kind,
      message: String(message || "").trim(),
      requestedAt: new Date().toISOString()
    };
    return new Promise((resolve) => {
      this.pending.set(id, { mode: "confirm", request, resolve });
      this.onRequest(request);
    });
  }

  ask(question, { title = "", context = "", options = [] } = {}) {
    const message = String(question || "").trim();
    if (!message) {
      return Promise.resolve({ answered: false, answer: "", error: "A question is required" });
    }
    const id = randomUUID();
    const request = {
      id,
      kind: "decision-input",
      message,
      title: String(title || "AMOS needs your input").trim().slice(0, 160) || "AMOS needs your input",
      context: String(context || "").trim().slice(0, 2_000),
      options: normalizeDecisionOptions(options),
      requestedAt: new Date().toISOString()
    };
    return new Promise((resolve) => {
      this.pending.set(id, { mode: "input", request, resolve });
      this.onRequest(request);
    });
  }

  setTaskScope({ key, workspace } = {}) {
    const next = {
      key: String(key || "").trim(),
      workspace: String(workspace || "").trim()
    };
    if (!next.key || !next.workspace) {
      this.clearTaskGrants();
      return false;
    }
    if (
      this.taskScope?.key === next.key &&
      this.taskScope?.workspace === next.workspace
    ) {
      return false;
    }
    this.cancelAll();
    this.taskScope = next;
    this.taskGrants.clear();
    return true;
  }

  grantTask(kinds = []) {
    if (!this.taskScope) throw new Error("A running local task is required before granting task access");
    for (const kind of kinds) {
      const value = String(kind || "").trim();
      if (value) this.taskGrants.add(value);
    }
    return this.state();
  }

  clearTaskGrants() {
    this.cancelAll();
    this.taskScope = null;
    this.taskGrants.clear();
  }

  state() {
    return {
      active: Boolean(this.taskScope && this.taskGrants.size > 0),
      scope: this.taskScope ? { ...this.taskScope } : null,
      kinds: [...this.taskGrants].sort()
    };
  }

  resolve(id, approved) {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    if (entry.mode === "input") {
      entry.resolve({ answered: Boolean(approved), answer: "" });
    } else {
      entry.resolve(Boolean(approved));
    }
    return true;
  }

  resolveInput(id, { answered = true, answer = "" } = {}) {
    const entry = this.pending.get(id);
    if (!entry || entry.mode !== "input") return false;
    this.pending.delete(id);
    const text = String(answer || "").trim().slice(0, 8_000);
    entry.resolve({
      answered: answered === true && text !== "",
      answer: text
    });
    return true;
  }

  pendingRequests() {
    return [...this.pending.values()]
      .filter((entry) => entry.mode === "input")
      .map((entry) => ({ ...entry.request }));
  }

  cancelAll() {
    for (const entry of this.pending.values()) {
      if (entry.mode === "input") entry.resolve({ answered: false, answer: "" });
      else entry.resolve(false);
    }
    this.pending.clear();
  }
}

function normalizeDecisionOptions(value) {
  if (!Array.isArray(value)) return [];
  const options = [];
  for (const item of value) {
    const option = String(item || "").trim().slice(0, 200);
    if (option && !options.includes(option)) options.push(option);
    if (options.length >= 8) break;
  }
  return options;
}
