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

- a source kind: `live`, `cached`, `private`, or `local`;
- a refreshed timestamp;
- an optional stale-after timestamp and refresh prompt; and
- source references with identifiers and observation timestamps when available.

Canvas history is session-only in 0.6.0. Desktop does not silently create an
offline company-data cache. Cross-session caching requires current AMOS
identity, scope, expiry, and revocation controls and belongs to the offline
intelligence phase.

Decision cards add no new authority. A pending approval card can only open the
existing signed-in AMOS approval flow. The model cannot approve its own work.

## Example requests

- “Show campaign performance as metrics and a trend.”
- “Compare these accounts in a table and cite the records used.”
- “Show everything waiting for my approval.”
- “Turn the latest goal cycle into an operating brief with evidence.”
- “Refresh the company health canvas.”

The model should use a canvas only when it makes the information easier to
understand or act on. Normal questions should still receive normal answers.
