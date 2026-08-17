# Verified presentation artifact engine

AMOS Desktop creates native PowerPoint files through a local
`desktop_create_presentation` tool. Presentation generation is a sibling of the
[DOCX/PDF](DOCUMENT_ARTIFACT_ENGINE.md) and [XLSX](SPREADSHEET_ARTIFACT_ENGINE.md)
engines: intelligence authors structure, deterministic code lays out and writes
the file, and verification reopens the artifact before disk.

Decks are not documents. A document is a flowing page. A presentation is a
closed set of 16:9 frames. The model never writes OOXML, freeform coordinates,
or scripts.

## Version 1 contract

`amos.presentation-spec:1` describes:

- deck metadata: title, subtitle, author, kind, footer;
- one size: `widescreen_16_9`;
- the same three document themes (`business`, `compact`, `proposal`);
- bounded brand tokens and an optional workspace-relative logo;
- a closed layout enum instead of freeform shapes.

V1 layouts:

| Layout | Purpose |
| --- | --- |
| `title` | Cover |
| `section` | Divider |
| `bullets` | Eyebrow, headline, 3–6 points |
| `two_column` | Two evidence columns |
| `metrics` | 3–4 KPI cards |
| `table` | Bounded comparison |
| `chart` | Bar or line snapshot rendered as a PNG |
| `quote` | Callout |
| `image` | Workspace PNG/JPEG plus caption |
| `closer` | Next step and optional sources |

Hard limits fail before write: 40 slides, 8 bullets, 6 metrics, 8×12 tables,
12 charts, 16 visuals. Speaker notes are allowed and extracted; they are not a
substitute for on-slide proof.

V1 is create-from-spec only. Importing or rewriting an existing branded PPTX by
shape id is a later template-edit studio, not this engine.

## Execution and safety

The local `desktop_create_presentation` tool accepts a workspace-relative base path and the typed
spec.

1. Desktop validates and normalizes the complete request.
2. Layout diagnostics flag dense slides, missing covers/closers, and long titles.
3. Workspace images resolve the same way documents do.
4. One `file-write` approval names `path.pptx` and `.amos/previews/<digest>/slide-*.png`.
5. The renderer writes PPTX in memory from AMOS-owned DrawingML.
6. Verification checks the ZIP header, `[Content_Types].xml`,
   `ppt/presentation.xml`, slide count, and extracted text for the deck title
   plus every slide title.
7. Desktop writes the PPTX, caches a bounded 16:9 PNG preview of each slide, and
   presents the verified deck on the dynamic canvas with Open in PowerPoint and
   Show in Folder.

The model never emits OOXML. Preview pixels come from the same AMOS layout that
wrote the file, not from PowerPoint or Keynote. Charts and logos are PNG
snapshots at generation time, same honesty as XLSX.

Creating a local deck does not publish it, place it in company memory, or grant
it company authority.

## Non-goals for V1

- In-place rewrite of an existing customer or investor PPTX
- Freeform coordinates, animations, transitions, SmartArt, or video
- Native Office chart objects
- `.ppt` or Keynote export
- Hosted rendering or a new company engine
- Claiming Keynote-quality inherited-template fidelity
