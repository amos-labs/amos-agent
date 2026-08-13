# Verified spreadsheet artifact engine

AMOS Desktop creates native Excel workbooks through the local
`desktop_create_spreadsheet` tool. Spreadsheet generation is a first-class
product capability: the user does not need to know about Bash, Python,
openpyxl, or a CSV fallback.

## Contract and correctness

The versioned `amos.spreadsheet-spec:1` contract describes populated cells,
units, typed formula trees, roles, formatting, multiple sheets, checks,
scenario baselines, and charts. The model defines the business structure, but
it is not the arithmetic runtime.

Before AMOS writes a file it:

1. normalizes every cell, reference, range, unit, and formula operation;
2. evaluates the entire dependency graph and rejects circular, empty, mixed-unit,
   non-finite, and divide-by-zero calculations;
3. requires explicit `annual_to_monthly` and `monthly_to_annual` operations so
   dividing by 12 cannot silently masquerade as a verified period conversion;
4. checks every required invariant, including current-state inputs carried into
   every financial scenario; and
5. writes the XLSX, reopens it, and verifies sheets and formulas before success.

`desktop_calculate` exposes the same typed arithmetic for consequential numbers
stated in chat. Multi-scenario finance work routes to a reasoning-capable model
for construction, while the deterministic engine remains the numeric source of
truth.

## Financial-model conventions

Financial models distinguish inputs, linked values, formulas, totals, checks,
and notes visually. Inputs use explicit units such as `usd_per_year`,
`usd_per_month`, `percentage`, or `count`. A financial scenario sheet must have
at least one baseline invariant; a confirmed current MRR therefore cannot reset
to zero unnoticed.

The generated workbook includes an `AMOS Checks` sheet when checks are present.
Required failures stop creation before the output path is written.

## Dynamic canvas and artifact actions

Successful generation automatically presents a local dynamic canvas containing:

- verification, sheet, formula, and check status;
- the workbook's sheet names;
- a bounded table preview of generated values;
- live canvas charts based on the same calculated payload; and
- a clickable artifact path plus **Open in Excel**, **Show in Folder**, and
  **Refine with AMOS** actions.

The XLSX embeds verified PNG chart snapshots because ExcelJS does not author
native Excel chart objects. Source cells and formulas remain editable. The
snapshots describe the values at generation time and do not refresh after a
person edits the workbook; the canvas charts represent that same verified
generation payload.

## Attachments and boundaries

Desktop accepts `.xlsx` attachments and extracts bounded sheet values, formula
text, and cached results for model context. Generated and attached workbooks
remain local to the selected workspace. Opening or revealing an artifact uses
the same path confinement as DOCX/PDF artifacts. Spreadsheet generation creates
no hosted dependency, company write, or new business authority.

The production dependency tree is audited with no known runtime vulnerabilities.
The renderer receives only validated canvas data and a workspace-relative
artifact path; it never renders workbook HTML or executes workbook content.
