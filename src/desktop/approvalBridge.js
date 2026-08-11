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
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.onRequest({ id, kind, message, requestedAt: new Date().toISOString() });
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
    const callback = this.pending.get(id);
    if (!callback) return false;
    this.pending.delete(id);
    callback(Boolean(approved));
    return true;
  }

  cancelAll() {
    for (const callback of this.pending.values()) callback(false);
    this.pending.clear();
  }
}
