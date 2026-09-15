import assert from "node:assert/strict";
import test from "node:test";
import {
  attentionCount,
  bindArgs,
  filterRows,
  formatCell,
  listRows,
  matchesWhen,
  normalizeSurfaceManifest,
  resolvePath,
  statusTone,
  visibleActions
} from "../src/desktop/manifestView.js";

const platformAutomations = {
  schema: "amos.surface_manifest.v1",
  key: "automations",
  title: "Automations",
  nav: { group: "Operate", order: 30 },
  list: {
    capability: "list_automations",
    items: "automations",
    columns: [
      { field: "name", label: "Automation" },
      { field: "status", label: "Status", render: "status_pill" },
      { field: "stats.enrolled", label: "Enrolled", format: "number" },
      { field: "bogus", label: "Bogus", format: "emoji", template: "{{ x }}" }
    ],
    filters: [{ field: "status", values: ["active", "paused"] }],
    status_field: "status",
    attention: { field: "status", values: ["paused"] }
  },
  detail: {
    sections: [
      { block: "metric", fields: ["stats.enrolled", "stats.pending"] },
      { block: "table", field: "steps_summary", columns: [{ field: "stage", label: "Stage" }] },
      { block: "browser", field: "x" }
    ]
  },
  actions: [
    { label: "Pause", capability: "pause_automation", consequence: "write", args: { name: { field: "name" } }, when: { field: "status", in: ["active"] } },
    { label: "Resume", capability: "resume_automation", consequence: "write", args: { name: { field: "name" } }, when: { field: "status", in: ["paused"] } },
    { label: "Simulate", capability: "simulate_automation", consequence: "read", args: { name: { field: "name" }, dry: true }, confirm: true, extra: "dropped" },
    { label: "Broken", capability: "x", consequence: "maybe" }
  ],
  related: [{ label: "Runs", capability: "list_automation_runs" }],
  empty: { title: "No automations yet", body: "Install a template." },
  available: true,
  locked: null,
  unknown_top_level: "dropped"
};

test("normalizeSurfaceManifest keeps exactly the contract and drops the rest", () => {
  const manifest = normalizeSurfaceManifest(platformAutomations);
  assert.equal(manifest.key, "automations");
  assert.deepEqual(Object.keys(manifest).sort(), ["actions", "available", "detail", "empty", "key", "list", "locked", "nav", "related", "title"]);
  assert.equal(manifest.list.columns.length, 3, "a column with an unknown format and a template key is dropped");
  assert.deepEqual(manifest.list.columns[1], { field: "status", label: "Status", render: "status_pill" });
  assert.equal(manifest.list.statusField, "status");
  assert.deepEqual(manifest.list.attention, { field: "status", values: ["paused"] });
  assert.equal(manifest.detail.sections.length, 2, "an unknown block is dropped");
  assert.equal(manifest.actions.length, 3, "an action with an unknown consequence is dropped");
  assert.equal(manifest.actions[2].confirm, true);
  assert.deepEqual(manifest.actions[2].args, { name: { field: "name" }, dry: true });
  assert.equal("extra" in manifest.actions[2], false);
  assert.equal(normalizeSurfaceManifest({ key: "x", list: { capability: "y", columns: [] } }), null);
  assert.equal(normalizeSurfaceManifest(null), null);
});

test("resolvePath walks dotted paths and is undefined off the end", () => {
  const row = { stats: { enrolled: 12 }, name: "Welcome" };
  assert.equal(resolvePath(row, "stats.enrolled"), 12);
  assert.equal(resolvePath(row, "name"), "Welcome");
  assert.equal(resolvePath(row, "stats.missing.deeper"), undefined);
  assert.equal(resolvePath(null, "a"), undefined);
});

test("formatCell honours every contract format and renders status pills with tones", () => {
  assert.equal(formatCell(12345.5, { format: "number" }), new Intl.NumberFormat().format(12345.5));
  assert.equal(formatCell(19.5, { format: "currency" }), new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(19.5));
  assert.equal(formatCell(19.5, { format: "currency" }, { currency: "EUR" }), new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(19.5));
  assert.equal(formatCell(0.256, { format: "percent" }), "25.6%");
  assert.equal(formatCell("2026-09-14T20:00:00Z", { format: "date" }), new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date("2026-09-14T20:00:00Z")));
  assert.equal(formatCell("not a date", { format: "datetime" }), "not a date");
  assert.equal(formatCell(null, { format: "text" }), "—");
  assert.equal(formatCell([1, 2, 3], {}), "3 items");
  assert.deepEqual(formatCell("active", { render: "status_pill" }), { label: "active", tone: "ok" });
  assert.deepEqual(formatCell("paused", { render: "status_pill" }), { label: "paused", tone: "warn" });
  assert.deepEqual(formatCell("failed", { render: "status_pill" }), { label: "failed", tone: "bad" });
  assert.deepEqual(formatCell("odd", { render: "status_pill" }), { label: "odd", tone: "neutral" });
  assert.deepEqual(formatCell(undefined, { render: "status_pill" }), { label: "—", tone: "neutral" });
  assert.equal(statusTone(false), "bad");
});

test("visibleActions applies when, bindArgs binds fields and scalars", () => {
  const manifest = normalizeSurfaceManifest(platformAutomations);
  const active = { name: "Welcome", status: "active" };
  const paused = { name: "Nudge", status: "paused" };
  assert.deepEqual(visibleActions(manifest, active).map((a) => a.label), ["Pause", "Simulate"]);
  assert.deepEqual(visibleActions(manifest, paused).map((a) => a.label), ["Resume", "Simulate"]);
  assert.equal(visibleActions(manifest, active)[0].index, 0);
  assert.equal(visibleActions(manifest, paused)[0].index, 1);
  assert.equal(matchesWhen(undefined, active), true);
  assert.deepEqual(bindArgs(manifest.actions[2], paused), { name: "Nudge", dry: true });
  assert.deepEqual(bindArgs({ args: { id: { field: "missing" }, n: 3 } }, active), { n: 3 });
});

test("listRows reads the items key of the list capability and attentionCount counts flagged rows", () => {
  const manifest = normalizeSurfaceManifest(platformAutomations);
  const section = {
    list_automations: { automations: [{ name: "A", status: "active" }, { name: "B", status: "paused" }, "junk", null] },
    list_automation_grants: { grants: [] }
  };
  const rows = listRows(section, manifest);
  assert.equal(rows.length, 2);
  assert.equal(attentionCount(rows, manifest), 1);
  assert.deepEqual(listRows(null, manifest), []);
  assert.deepEqual(listRows({ list_automations: { automations: "nope" } }, manifest), []);
  assert.deepEqual(filterRows(rows, { status: "paused" }).map((r) => r.name), ["B"]);
  assert.equal(filterRows(rows, {}).length, 2);
});
