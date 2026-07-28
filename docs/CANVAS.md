# Typed company canvas

AMOS Desktop can present company data and active work as a safe, typed canvas
when a visual operating view is materially clearer than prose.

Chat remains the command surface. The canvas is a presentation surface for:

- metrics;
- filterable tables;
- time-series charts;
- Markdown briefs;
- source and evidence lists; and
- approval or receipt cards.

## Trust boundary

The model does not generate HTML, JavaScript, SQL, or executable controls.
Instead, it calls the local `desktop_present_canvas` tool with a versioned
`CanvasSpec`. Desktop validates the complete payload and renders it using local
components.

For live company results, Desktop captures successful AMOS tool output in a
short-lived, session-only result store. The tool response includes a
`desktop_result_ref`; the model can pass that reference and a business intent
to `desktop_present_company_view`. Deterministic local adapters—not the
model—select and validate the final metrics, table, trend, funnel, timeline,
approval, receipt, or live-work representation.

Supported managed intents are:

- company overview and KPIs;
- funnels and cohorts;
- timelines and comparisons;
- approvals and receipts; and
- live company work.

`desktop_update_canvas` applies bounded upserts and removals by stable block ID.
It increments the canvas revision while preserving every unrelated block, so a
long-running task can update one result without replacing the rest of the view.

The v1 limits are intentionally bounded:

- 24 blocks per canvas;
- 12 columns and 200 rows per table;
- 6 series and 300 points per series;
- 100 source references; and
- 20 details per decision card.

Unknown block types, non-finite numeric values, oversized content, and malformed
timestamps fail closed.

## Data and authority

Every canvas carries:

- an explicit state: `loading`, `ready`, `empty`, `partial`, `stale`, `error`,
  or `restricted`;
- a source kind: `live`, `cached`, `private`, or `local`;
- a refreshed timestamp;
- an optional stale-after timestamp and refresh prompt; and
- source references with identifiers and observation timestamps when available.

Every block inherits or overrides bounded provenance: source kind and label,
tenant, observation and staleness timestamps, uncertainty, approval/receipt
IDs, and source references. The renderer keeps local/private results visually
distinct from live company data and shows honest empty, partial, stale, error,
and permission-limited states rather than inventing content.

Canvas history is session-only in 0.6.0. Desktop does not silently create an
offline company-data cache. Cross-session caching requires current AMOS
identity, scope, expiry, and revocation controls and belongs to the offline
intelligence phase.

Decision cards add no new authority. A pending approval card can only open the
existing signed-in AMOS approval flow. The model cannot approve its own work.

## Export and sharing boundary

Canvas state is local, session-only UI state. Desktop does not silently export,
upload, persist, or share a canvas.

- A local or private view may be exported only through an explicit future user
  action, and the export must retain its source and freshness labels.
- A live or cached company view cannot become a shared company artifact through
  a local file copy. Publishing or sharing it must route through an AMOS-managed
  operation so tenant scope, policy, approvals, and a receipt remain intact.
- Canvas result references are ephemeral capabilities. They are cleared with the
  session or runtime and are never treated as durable company memory.

## Example requests

- “Show campaign performance as metrics and a trend.”
- “Compare these accounts in a table and cite the records used.”
- “Show everything waiting for my approval.”
- “Turn the latest goal cycle into an operating brief with evidence.”
- “Refresh the company health canvas.”

The model should use a canvas only when it makes the information easier to
understand or act on. Normal questions should still receive normal answers.
