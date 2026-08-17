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

## Version 2 contract

`amos.document-spec:2` keeps the complete V1 text contract and adds:

- named business-brief, reference-guide, and proposal templates;
- bounded customer brand tokens, logos, page headers, and page footers;
- workspace-relative PNG and JPEG figures with alt text, captions, sizing, and
  source references;
- deterministic bar and line charts with bounded labels and series; and
- rendered PNG thumbnails generated from the final PDF pages.

The preserved `amos.document-spec:1` contract supports title metadata, three
heading levels, paragraphs, lists, fixed-layout tables, callouts, explicit page
breaks, and numbered HTTPS or AMOS source references. V1 rejects V2-only visual
blocks instead of silently changing their meaning.

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
9. Desktop renders the final PDF into bounded page PNGs and presents those
   pixels in its typed canvas, alongside layout diagnostics and verified
   artifact metadata.

The renderer never receives an arbitrary local path or document HTML. Images
are decoded only after their workspace-relative paths, file sizes, combined
size, and raster type are verified. Preview images live only under the
workspace's `.amos/previews/` cache and cross a read-only, PNG-only IPC route.
Opening or revealing an artifact crosses a narrow IPC boundary that resolves
the exact workspace-relative DOCX or PDF path again in the main process and
requires the file to exist. Regenerating the same output path refreshes the
existing preview revision instead of creating a second work surface.

The primary preview is page-faithful because it displays the pages rendered
from the final PDF. A bounded structural preview remains as the fallback if a
thumbnail cannot be loaded. Deterministic checks still flag likely title
wrapping, orphan headings, dense prose, wide or long tables, unbroken values,
and low-resolution figures before regeneration.

## Review and finalization

`amos.document-review:1` edits an existing workspace DOCX without flattening
the rest of its package. The model supplies exact text anchors; deterministic
OOXML code creates real Word insertions, deletions, comment ranges, comment
bodies, relationships, and content types. The source is never overwritten: a
different workspace-relative output is mandatory and one file-write approval
names the source, destination, and operation.

`desktop_finalize_document` can accept, reject, or preserve tracked changes and
remove or preserve comments. It writes another verified DOCX with source and
output hashes, leaving both earlier documents intact. Anchors must occur inside
one editable Word text run; ambiguous or structurally unsafe edits fail with a
request for a shorter exact anchor.

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

## Qualification and remaining artifact roadmap

The DOCX/PDF slice is qualified against representative multi-page fixtures:
branded page furniture, tables, explicit page breaks, images, bar and line
charts, true redlines/comments, accepted final output, extraction, rendered
page inspection, and accessibility audit. Every artifact still reopens before
the tool reports success.

Remaining artifact work is intentionally separate from document parity:

1. **More artifact types** — presentations now share create, verify, preview,
   and Open/Reveal with documents and spreadsheets. See
   [PRESENTATION_ARTIFACT_ENGINE.md](PRESENTATION_ARTIFACT_ENGINE.md) and the
   sibling [verified XLSX engine](SPREADSHEET_ARTIFACT_ENGINE.md).
2. **Governed publishing** — explicit share/publish actions and optional
   evidence manifests beyond local file creation.
3. **Expanded template catalog** — reviewed tenant-specific template packs and
   fonts without allowing arbitrary executable template content.
4. **Reusable skills** — reviewed document workflows for board briefs,
   proposals, operating reviews, SOPs, and commercialization packages, with the
   same renderer available to future tenant-defined skills.

Parity is measured by finished-artifact acceptance, not by whether the model
can emit a file. Representative fixtures must render cleanly, reopen without
repair warnings, preserve their required content, and remain attributable to
their sources and execution boundary.
