import { randomUUID } from "node:crypto";

const DEFAULT_LIMIT = 24;

export class DesktopCanvasResultStore {
  constructor({ limit = DEFAULT_LIMIT, now = () => new Date().toISOString() } = {}) {
    this.limit = limit;
    this.now = now;
    this.results = [];
  }

  capture({ name, result, failed = false } = {}) {
    if (failed || !String(name || "").startsWith("amos_")) return null;
    const entry = {
      id: randomUUID(),
      tool: String(name),
      observedAt: this.now(),
      result: structuredClone(result)
    };
    this.results.unshift(entry);
    if (this.results.length > this.limit) this.results.length = this.limit;
    return {
      result_ref: entry.id,
      source_tool: entry.tool,
      observed_at: entry.observedAt
    };
  }

  get(id) {
    const entry = this.results.find((item) => item.id === id);
    return entry ? structuredClone(entry) : null;
  }

  clear() {
    this.results = [];
  }
}
