import { randomUUID } from "node:crypto";

export class DesktopApprovalBridge {
  constructor({ onRequest = () => {} } = {}) {
    this.onRequest = onRequest;
    this.pending = new Map();
  }

  confirm(message, { kind = "local-action" } = {}) {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.onRequest({ id, kind, message, requestedAt: new Date().toISOString() });
    });
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
