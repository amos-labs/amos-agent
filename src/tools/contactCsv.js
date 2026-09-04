import { extname } from "node:path";
import { normalizeMcpToolResult } from "../mcp/amosMcpClient.js";

const MAX_ROWS = 250_000;
const DEFAULT_BATCH_SIZE = 500;
const EMAIL_ALIASES = ["email", "emailaddress", "contactemail", "workemail", "businessemail"];
const NAME_ALIASES = ["name", "fullname", "contactname", "displayname"];
const FIRST_NAME_ALIASES = ["firstname", "givenname", "first"];
const LAST_NAME_ALIASES = ["lastname", "surname", "familyname", "last"];

export function createContactCsvTools({ attachments, onProgress = () => {} }) {
  return [
    {
      name: "desktop_preview_email_contacts_csv",
      source: "desktop",
      toolkit: "spreadsheets",
      readOnly: true,
      parallelSafe: true,
      description: "Deterministically inspect a CSV/TSV attachment as an email-contact import. Infers common email/name columns, counts valid, duplicate, invalid, and explicitly excluded rows, and returns a small sample. Use this instead of reading or formatting the full file in model context.",
      parameters: contactCsvParameters({ importing: false }),
      handler(args) {
        return previewContactCsv(attachments.tabularText(args.attachment_id), args);
      }
    },
    {
      name: "desktop_import_email_contacts_csv",
      source: "desktop",
      toolkit: "spreadsheets",
      description: "Parse and import a CSV/TSV attachment deterministically in idempotent AMOS batches; the model never serializes the rows. Optionally creates/reuses one named static segment and adds active imported contacts during every batch. Record the user's asserted audience basis, warn about responsibility, and proceed when the owner confirms it. Never reactivate unsubscribed, suppressed, bounced, complained, or invalid contacts.",
      parameters: contactCsvParameters({ importing: true }),
      async handler(args, context) {
        return importContactCsv({
          source: attachments.tabularText(args.attachment_id),
          args,
          amosClient: context.amosClient,
          signal: context.signal,
          onProgress
        });
      }
    }
  ];
}

function contactCsvParameters({ importing }) {
  const properties = {
    attachment_id: { type: "string", description: "CSV or TSV attachment id from the task attachment manifest." },
    email_column: { type: "string", description: "Header containing email addresses. Omit to infer a common email header." },
    name_column: { type: "string", description: "Optional full-name header." },
    first_name_column: { type: "string", description: "Optional first-name header, combined with last_name_column." },
    last_name_column: { type: "string", description: "Optional last-name header, combined with first_name_column." },
    exclude_emails: { type: "array", maxItems: 500, items: { type: "string" }, description: "Exact addresses to exclude before import." },
    exclude_domains: { type: "array", maxItems: 100, items: { type: "string" }, description: "Exact email domains to exclude before import." },
    max_contacts: { type: "integer", minimum: 1, maximum: MAX_ROWS, description: "Optional hard cap after validation, exclusion, and deduplication." }
  };
  const required = ["attachment_id"];
  if (importing) {
    Object.assign(properties, {
      authorization_confirmed: {
        type: "boolean",
        const: true,
        description: "Set true after the user confirms their asserted basis for including this audience. AMOS records the assertion and warning; it does not adjudicate the owner's legal conclusion."
      },
      authorization_basis: {
        type: "string",
        enum: ["explicit_consent", "existing_customer_relationship", "legitimate_interest", "contractual_relationship", "other_user_asserted_basis"],
        description: "The user's asserted basis for placing the contacts in this audience."
      },
      authorization_source: { type: "string", maxLength: 200, description: "Concise truthful provenance (maximum 200 characters), such as a predecessor-company customer export and the relationship described by the user." },
      authorized_at: { type: "string", description: "RFC3339 timestamp when the user confirmed this basis to AMOS." },
      segment_name: { type: "string", maxLength: 200, description: "Optional static AMOS segment to create or reuse across every batch." },
      batch_size: { type: "integer", minimum: 1, maximum: 1000, default: DEFAULT_BATCH_SIZE }
    });
    required.push("authorization_confirmed", "authorization_basis", "authorization_source", "authorized_at");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function previewContactCsv(source, args = {}) {
  const analysis = analyze(source, args);
  return {
    ok: true,
    attachment_id: source.id,
    filename: source.name,
    sha256: source.sha256,
    delimiter: delimiterLabel(analysis.delimiter),
    headers: analysis.headers,
    mapping: analysis.mapping,
    total_data_rows: analysis.totalRows,
    eligible_unique_contacts: analysis.eligible.length,
    duplicate_rows: analysis.duplicates,
    invalid_or_blank_email_rows: analysis.invalid,
    excluded_rows: analysis.excluded,
    capped_rows: analysis.capped,
    sample: analysis.eligible.slice(0, 5).map(({ email, name }) => ({ email, name })),
    import_policy: {
      accepted_bases: ["explicit_consent", "existing_customer_relationship", "legitimate_interest", "contractual_relationship", "other_user_asserted_basis"],
      note: "AMOS records the owner's asserted basis and warns without adjudicating it. Suppressed, unsubscribed, bounced, complained, and invalid contacts remain protected."
    },
    next_step: "Confirm the inferred columns, exclusions, audience basis, provenance, and timestamp. Then use the deterministic importer rather than serializing rows in model context."
  };
}

export async function importContactCsv({ source, args, amosClient, signal, onProgress = () => {} }) {
  if (args.authorization_confirmed !== true) {
    return {
      ok: false,
      error: "This import requires the user's confirmation of the asserted audience basis. AMOS records the assertion but does not invent one."
    };
  }
  const authorizationBasis = String(args.authorization_basis || "").trim();
  const acceptedBases = new Set(["explicit_consent", "existing_customer_relationship", "legitimate_interest", "contractual_relationship", "other_user_asserted_basis"]);
  if (!acceptedBases.has(authorizationBasis)) {
    return { ok: false, error: "authorization_basis is not supported" };
  }
  const authorizationSource = String(args.authorization_source || "").trim();
  if (!authorizationSource) return { ok: false, error: "authorization_source is required" };
  const authorizedAt = new Date(String(args.authorized_at || ""));
  if (!Number.isFinite(authorizedAt.getTime())) {
    return { ok: false, error: "authorized_at must be an RFC3339 timestamp" };
  }
  if (authorizedAt.getTime() > Date.now() + 5 * 60_000) {
    return { ok: false, error: "authorized_at cannot be in the future" };
  }
  const analysis = analyze(source, args);
  if (analysis.eligible.length === 0) {
    return { ok: false, error: "The CSV contains no eligible unique email contacts after validation and exclusions", preview: previewContactCsv(source, args) };
  }
  if (!amosClient?.callTool) {
    return { ok: false, error: "Connect an AMOS company before importing email contacts" };
  }
  const resolved = normalizeMcpToolResult(await amosClient.callTool(
    "resolve_capabilities",
    {
      outcome: "Import an owner-authorized email audience in deterministic batches, record its asserted basis, and optionally add it to one named static segment",
      limit: 8,
      ttl_seconds: 86400,
      include_input_schemas: true
    },
    { signal }
  ));
  if (resolved.ok === false) return resolved;
  const operation = (resolved.operations || []).find((item) => item.operation === "import_email_contacts");
  if (!operation || !resolved.manifest_id) {
    return {
      ok: false,
      error: "AMOS did not expose import_email_contacts for this signed-in account",
      available_operations: (resolved.operations || []).map((item) => item.operation)
    };
  }

  const batchSize = boundedInteger(args.batch_size, DEFAULT_BATCH_SIZE, 1, 1000);
  const totals = { inserted: 0, updated: 0, protected: 0 };
  let processed = 0;
  let batchNumber = 0;
  let segment = null;
  for (let offset = 0; offset < analysis.eligible.length; offset += batchSize) {
    const rows = analysis.eligible.slice(offset, offset + batchSize);
    const contacts = rows.map((row) => ({
      email: row.email,
      ...(row.name ? { name: row.name } : {}),
      metadata: {
        imported_from: "amos_desktop_csv",
        attachment_sha256: source.sha256,
        source_filename: source.name,
        source_row: row.rowNumber
      }
    }));
    const result = normalizeMcpToolResult(await amosClient.callTool(
      "execute_capability",
      {
        manifest_id: resolved.manifest_id,
        operation: operation.operation,
        arguments: {
          contacts,
          authorization: {
            basis: authorizationBasis,
            source: authorizationSource,
            authorized_at: authorizedAt.toISOString(),
            user_confirmed: true
          },
          ...(String(args.segment_name || "").trim()
            ? { segment_name: String(args.segment_name).trim() }
            : {})
        }
      },
      { signal }
    ));
    if (result.ok === false || pendingResult(result)) {
      return {
        ok: result.ok !== false,
        status: pendingResult(result) ? "pending_approval" : "partial_failure",
        error: result.ok === false ? result.error : undefined,
        platform_result: result,
        processed_contacts: processed,
        remaining_contacts: analysis.eligible.length - processed,
        totals,
        safe_to_retry: true,
        note: "Completed batches are idempotent and will not duplicate contacts or segment membership."
      };
    }
    batchNumber += 1;
    processed += rows.length;
    totals.inserted += Number(result.inserted) || 0;
    totals.updated += Number(result.updated) || 0;
    totals.protected += Number(result.protected_existing_unsubscribed_or_invalid) || 0;
    if (result.segment_id) {
      segment = {
        id: result.segment_id,
        name: result.segment_name,
        member_count: result.segment_member_count
      };
    }
    onProgress({ batchNumber, processed, total: analysis.eligible.length });
  }

  return {
    ok: true,
    status: "completed",
    attachment_id: source.id,
    filename: source.name,
    eligible_unique_contacts: analysis.eligible.length,
    processed_contacts: processed,
    batches: batchNumber,
    inserted: totals.inserted,
    updated: totals.updated,
    protected_existing_unsubscribed_or_invalid: totals.protected,
    duplicate_rows_skipped: analysis.duplicates,
    invalid_rows_skipped: analysis.invalid,
    excluded_rows_skipped: analysis.excluded,
    capped_rows: analysis.capped,
    segment,
    authorization_basis: authorizationBasis,
    warning: authorizationBasis === "explicit_consent"
      ? null
      : "AMOS recorded the owner's asserted audience basis. The owner remains responsible for applicable outreach law and policy; unsubscribe and provider suppression controls still apply.",
    verified: processed === analysis.eligible.length
  };
}

function analyze(source, args) {
  const delimiter = detectDelimiter(source.text, source.name);
  const rows = [...parseDelimited(source.text, delimiter)];
  if (rows.length === 0) throw new Error(`${source.name} is empty`);
  if (rows.length - 1 > MAX_ROWS) {
    throw new Error(`${source.name} has more than ${MAX_ROWS.toLocaleString()} rows; split it into bounded files before importing`);
  }
  const headers = rows[0].map((value) => String(value || "").trim());
  const mapping = resolveMapping(headers, args);
  const excludedEmails = new Set((args.exclude_emails || []).map(normalizeEmail).filter(Boolean));
  const excludedDomains = new Set((args.exclude_domains || []).map(normalizeDomain).filter(Boolean));
  const seen = new Set();
  const eligible = [];
  let duplicates = 0;
  let invalid = 0;
  let excluded = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.every((value) => !String(value || "").trim())) continue;
    const email = normalizeEmail(row[mapping.emailIndex]);
    if (!validEmail(email)) {
      invalid += 1;
      continue;
    }
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (excludedEmails.has(email) || excludedDomains.has(domain)) {
      excluded += 1;
      continue;
    }
    if (seen.has(email)) {
      duplicates += 1;
      continue;
    }
    seen.add(email);
    eligible.push({ email, name: contactName(row, mapping), rowNumber: index + 1 });
  }
  const maxContacts = boundedInteger(args.max_contacts, eligible.length || 1, 1, MAX_ROWS);
  const capped = Math.max(0, eligible.length - maxContacts);
  return {
    delimiter,
    headers,
    mapping: publicMapping(mapping),
    totalRows: rows.length - 1,
    eligible: eligible.slice(0, maxContacts),
    duplicates,
    invalid,
    excluded,
    capped
  };
}

function resolveMapping(headers, args) {
  const normalized = headers.map(normalizeHeader);
  const find = (requested, aliases) => {
    if (String(requested || "").trim()) {
      const exact = headers.findIndex((header) => header === String(requested).trim());
      const insensitive = normalized.indexOf(normalizeHeader(requested));
      const index = exact >= 0 ? exact : insensitive;
      if (index < 0) throw new Error(`CSV column '${requested}' was not found. Available columns: ${headers.join(", ")}`);
      return index;
    }
    return normalized.findIndex((header) => aliases.includes(header));
  };
  const emailIndex = find(args.email_column, EMAIL_ALIASES);
  if (emailIndex < 0) {
    throw new Error(`Could not infer an email column. Choose one of: ${headers.join(", ")}`);
  }
  return {
    emailIndex,
    nameIndex: find(args.name_column, NAME_ALIASES),
    firstNameIndex: find(args.first_name_column, FIRST_NAME_ALIASES),
    lastNameIndex: find(args.last_name_column, LAST_NAME_ALIASES),
    headers
  };
}

function publicMapping(mapping) {
  const header = (index) => index >= 0 ? mapping.headers[index] : null;
  return {
    email_column: header(mapping.emailIndex),
    name_column: header(mapping.nameIndex),
    first_name_column: header(mapping.firstNameIndex),
    last_name_column: header(mapping.lastNameIndex)
  };
}

function contactName(row, mapping) {
  const full = mapping.nameIndex >= 0 ? cleanText(row[mapping.nameIndex], 320) : "";
  if (full) return full;
  return [mapping.firstNameIndex, mapping.lastNameIndex]
    .filter((index) => index >= 0)
    .map((index) => cleanText(row[index], 160))
    .filter(Boolean)
    .join(" ");
}

export function* parseDelimited(text, delimiter = ",") {
  let field = "";
  let row = [];
  let quoted = false;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function detectDelimiter(text, name) {
  if (extname(String(name || "")).toLowerCase() === ".tsv") return "\t";
  const firstRecord = String(text || "").split(/\r?\n/, 1)[0] || "";
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: unquotedCount(firstRecord, delimiter) }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ",";
}

function unquotedCount(value, needle) {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') {
      if (quoted && value[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && value[index] === needle) {
      count += 1;
    }
  }
  return count;
}

function pendingResult(result) {
  const status = String(result?.status || "").toLowerCase();
  return Boolean(result?.pending_id || result?.pending_operation_id) || /pending|parked|approval/.test(status);
}

function normalizeHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}

function validEmail(value) {
  return value.length <= 320 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
}

function cleanText(value, limit) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function delimiterLabel(delimiter) {
  if (delimiter === "\t") return "tab";
  if (delimiter === ";") return "semicolon";
  return "comma";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
