# AMOS Desktop: Dynamic Canvas, Offline Intelligence, and Portable Memory

## Thesis

AMOS Desktop should become the native operating surface for a company brain,
not another chat window. Three capabilities reinforce one another:

1. a dynamic canvas that presents company data and active work in the form best
   suited to the task;
2. a small local model that remains useful without a network connection; and
3. a portable memory capsule that can safely move, fork, and synchronize context
   across models, devices, and AMOS deployments.

The managed AMOS platform remains authoritative for shared company memory,
identity, policy, approvals, and proof. The desktop may hold private and cached
material, but it must never turn an offline copy into a second ungoverned source
of truth.

## Product model

```text
                       AMOS managed company brain
                 identity · ACLs · policy · proof · memory
                                  │
                         scoped sync protocol
                                  │
            ┌─────────────────────┴─────────────────────┐
            │              AMOS Desktop                 │
            │                                           │
            │  portable memory capsule ─ local model    │
            │             │                    │         │
            │             └──── dynamic canvas ┘         │
            │                                           │
            │  local workspace · private files · queue   │
            └───────────────────────────────────────────┘
```

The canvas is the presentation layer. The memory capsule is the context and
sync layer. The local model is an optional intelligence layer that can work
against explicitly available local context.

## 1. Dynamic canvas

### Purpose

The model should choose the clearest safe representation for the work:

- narrative answer or brief;
- KPI cards and time-series charts;
- filterable company records;
- comparison tables;
- timelines and project plans;
- approval and receipt cards;
- document or landing-page previews;
- editable drafts; and
- a split view combining evidence, proposed action, and expected impact.

Chat remains the command surface. The canvas becomes the durable work surface.

### Implementation direction

Use a typed `CanvasSpec` rather than model-generated arbitrary HTML:

```json
{
  "version": "1",
  "title": "Campaign performance",
  "blocks": [
    {
      "type": "metric",
      "label": "Playground sessions",
      "value_binding": "result.metrics.playground_sessions"
    },
    {
      "type": "timeseries",
      "data_binding": "result.daily_sessions",
      "x": "date",
      "y": "sessions"
    },
    {
      "type": "approval",
      "pending_id_binding": "result.proposed_change.pending_id"
    }
  ]
}
```

Desktop owns the renderer and supports a small, versioned block catalog. Data
bindings refer to the bounded result of an AMOS query or task, not to arbitrary
SQL, code, or remote content. Interactive controls invoke named governed tools;
they do not execute code embedded by the model.

### Safety invariants

- No arbitrary script execution or unsanitized model HTML.
- Every write-capable control maps to an existing AMOS/local policy decision.
- Company data shown in a block inherits the viewer's tenant, role, and document
  access scope.
- A saved canvas stores source references and timestamps so stale data is clear.
- A consequential action shown in a canvas produces the same approval and
  receipt as the equivalent chat or MCP action.

### First slice

Read-only support for:

- metric;
- table;
- timeseries;
- markdown brief;
- source/evidence list; and
- approval/receipt cards.

That set is enough to make company-overview, campaign, finance, CRM, goals, and
proof responses materially better without building a general web browser.

## 2. Portable memory capsule

### Purpose

A memory capsule is a user-controlled, portable package of context that can:

- restore an agent or model quickly;
- move private working memory between compatible clients;
- fork a project or agent without losing provenance;
- export a bounded company-memory snapshot when policy permits; and
- reconnect an offline desktop to AMOS without silently overwriting newer
  company knowledge.

It complements AMOS durable company memory. It does not replace it.

### Memory classes

| Class | Authority | Default visibility | Offline behavior |
| --- | --- | --- | --- |
| Session | Desktop | Private | Ephemeral unless promoted |
| Private | User | Private | Encrypted local retention allowed |
| Shared | AMOS | Explicit people/groups | Cache only when policy permits |
| Company | AMOS | Tenant/role scoped | Cache only when policy permits |
| Evidence/receipt | AMOS | Policy scoped, immutable | Read-only verified copy |

### Capsule format

A first version should be an encrypted archive containing:

- versioned manifest;
- subject and tenant identifiers;
- source IDs, provenance, and content hashes;
- visibility and allowed-use labels;
- created, refreshed, and expiry timestamps;
- plaintext or encrypted content blobs as policy permits;
- optional local retrieval index that can be rebuilt;
- checkpoint and fork lineage; and
- signatures for AMOS-issued company material.

Embeddings should not be treated as the durable portable representation. They
are model-specific derived data and should normally be rebuilt on import.
Credentials, OAuth tokens, connection secrets, and unrestricted raw application
data must never enter a capsule.

### Sync rules

- Local private memory stays private until the user explicitly promotes it.
- Company material is pulled only through the current user's effective scope.
- Offline edits append to a journal; they do not mutate the cached source.
- Reconnection performs hash- and version-based reconciliation.
- Conflicts become a reviewable merge, not last-write-wins.
- Revoked or expired company material becomes inaccessible on the next online
  policy check and is removed from active local indexes.
- A fork preserves lineage while receiving a new capsule and agent identity.

## 3. Small offline model

### Useful offline scope

A local model can provide real value without pretending it can operate an
online company:

- search and summarize locally available material;
- draft documents, code, plans, and responses;
- reason over an authorized cached memory capsule;
- inspect and edit the selected local workspace through existing approval gates;
- create a canvas from local/cached data; and
- queue proposed company work for reconciliation when AMOS returns.

It must clearly label offline answers and the age of cached company context.

### Runtime direction

- Support a curated, hardware-aware model package through a local runner.
- Prefer a small quantized instruct model appropriate to available RAM and
  accelerator support.
- Keep the model adapter OpenAI-compatible so Ollama, llama.cpp, and future
  AMOS-packaged runtimes share the existing provider path.
- Store model files outside the application bundle with checksums, resumable
  downloads, disk-space checks, and explicit removal.
- Provide capability labels such as text, vision, tool use, context window, and
  expected device class instead of implying every local model can do every job.

### Offline authority

- Network and AMOS tools are visibly unavailable.
- No cached token is used to simulate an online authorization decision.
- Consequential company actions are saved only as proposals.
- The proposal is re-evaluated against current identity, policy, data, and
  idempotency rules after reconnecting.
- Nothing queued offline is silently executed during sync.

## Recommended sequence

### Phase 0 — distribution foundation

- [x] Signed macOS in-app update checks.
- [x] Explicit download and restart/install.
- [x] Platform-neutral updater state and UI abstraction.
- [ ] Signed Windows packaging and release-feed validation.

The first three items landed in AMOS Desktop 0.4.0. Windows packaging remains a
distribution project; it does not require a different canvas, memory, or offline
architecture.

### Phase 1 — memory contract

- Formalize private, shared, company, and receipt memory classes.
- Define capsule manifest, encryption, signatures, export policy, and sync
  journal.
- Add local private memory with explicit promote/forget controls.

### Phase 2 — canvas

- Add versioned `CanvasSpec` and the first six safe blocks.
- Teach company-overview, goals, approvals, proof, and campaign responses to
  return canvas-capable structured results.
- Save canvas source references and refresh state.

### Phase 3 — curated offline intelligence

- Hardware assessment and model recommendation.
- Signed model manifest, download manager, storage controls, and local runner.
- Offline mode indicator and bounded cached-memory retrieval.

### Phase 4 — portable and forkable work

- Export/import encrypted capsules.
- Device-to-device private memory transfer.
- Project/agent fork lineage.
- Reconnect reconciliation with explicit conflict and queued-action review.

## Success criteria

- A signed-in user can disconnect from the network and still search, summarize,
  draft, code, and visualize against explicitly available local context.
- The user can always tell whether an answer used live company data, cached
  company data, or private local data.
- Returning online never causes an offline proposal to execute without current
  authorization.
- A user can export, import, or fork allowed memory without moving credentials
  or bypassing company access controls.
- The same company question can render as text, a table, a chart, or a decision
  card without inventing a second business-data API.
