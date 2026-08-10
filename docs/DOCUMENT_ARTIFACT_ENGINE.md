# Deterministic document artifact engine

## Product position

AMOS Desktop should be the place where a business user can investigate,
decide, act, and produce the finished deliverable. A good answer in chat is not
enough when the real output is a board brief, proposal, operating review, SOP,
or customer-ready report.

Document generation therefore follows the same architecture as AMOS analysis
and automation:

- intelligence authors intent, structure, and prose;
- a bounded typed contract carries that intent;
- deterministic code performs repeatable execution; and
- verification proves that the artifact can be reopened before it is written.

The model never writes OOXML, PDF drawing commands, arbitrary HTML, or scripts.
The renderer does not make business judgments or invent content.

## Version 1 contract

`amos.document-spec:1` supports:

- title, subtitle, author, subject, and one of three reviewed visual styles;
- three heading levels and normal paragraphs;
- bulleted and numbered lists;
- fixed-layout tables with up to eight columns;
- highlighted callouts;
- explicit page breaks; and
- numbered HTTPS or AMOS source references.

One normalized spec may render DOCX, PDF, or both. Limits on block count, total
characters, list items, table rows and columns, and sources bound memory and
layout work before rendering begins.

## Execution and safety

The local `desktop_create_document` tool accepts a workspace-relative base path,
requested formats, and the typed document spec.

1. Desktop validates and normalizes the complete request.
2. It resolves every target under the selected workspace and rejects extension
   confusion, blocked paths, and directory escapes.
3. It requests one visible `file-write` approval for the exact outputs unless
   that grant is already active for the selected workspace.
4. It renders every requested format in memory.
5. It checks the DOCX ZIP or PDF signature and reopens each artifact through
   Desktop's normal document extractor.
6. It requires extracted text to include the requested title.
7. Only after all requested formats pass does it write the files.
8. The tool result records each path, format, byte count, SHA-256, and verified
   extracted-character count for task continuity.

Company data used as source material keeps its existing AMOS identity, tenant,
policy, and receipt boundary. Creating a local file does not publish it, place
it in company memory, or grant it company authority. Those remain separate,
explicit operations.

## Local-first behavior

The artifact engine is registered with the local workspace tools in online,
personal, and local-only operation. Rendering has no hosted dependency and no
per-page or per-token cost. A local model can therefore create the same typed
artifact whenever it can produce the contract. AMOS-hosted intelligence may
produce better content for a difficult brief, but it does not own the file
format or execution path.

Inference routing also remains separate. The local AMOS Router may select an
appropriate model for an AMOS Intelligence request; Claude-, Codex-, direct
provider-, and externally controlled sessions keep their controller's model
choice. Every path may use the same deterministic artifact tool when it is
running inside Desktop.

## Parity roadmap

The V1 engine establishes reliable creation, but complete daily-work parity
requires a broader artifact system:

1. **Visual content** — bounded images, deterministic charts, captions, alt
   text, crop rules, and source provenance.
2. **Templates and brand systems** — signed reusable templates, customer fonts,
   logos, page furniture, theme tokens, and template-version receipts.
3. **Preview and repair** — page thumbnails beside chat, overflow diagnostics,
   model-visible layout findings, and deterministic rerendering.
4. **Existing-document work** — read the source structure, edit selected
   sections, preserve unaffected content, compare versions, and create redlines
   and comments without silently flattening the document.
5. **Evidence integrity** — citations bound to source references, optional
   appendix manifests, freshness warnings, and governed publish/share actions.
6. **More artifact types** — spreadsheets and presentations using separate
   typed contracts while sharing approvals, provenance, verification, previews,
   and continuity.
7. **Reusable skills** — reviewed document workflows for board briefs,
   proposals, operating reviews, SOPs, and commercialization packages, with the
   same renderer available to future tenant-defined skills.

Parity is measured by finished-artifact acceptance, not by whether the model
can emit a file. Representative fixtures must render cleanly, reopen without
repair warnings, preserve their required content, and remain attributable to
their sources and execution boundary.
