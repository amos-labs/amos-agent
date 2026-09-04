import assert from "node:assert/strict";
import test from "node:test";

import {
  createContactCsvTools,
  parseDelimited,
  previewContactCsv
} from "../src/tools/contactCsv.js";

function source(text) {
  return {
    id: "attachment-1",
    name: "contacts.csv",
    sha256: "a".repeat(64),
    text
  };
}

function mcpResult(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

test("contact CSV preview infers columns and deterministically filters rows", () => {
  const result = previewContactCsv(source([
    "First Name,Last Name,Email,Company",
    'Ada,Lovelace,ADA@example.com,"Example, Inc."',
    "Ada,Lovelace,ada@example.com,Duplicate",
    "Internal,User,person@amoslabs.com,AMOS",
    "Bad,Address,not-an-email,Bad",
    'Grace,"Hopper, PhD",grace@example.net,Navy'
  ].join("\n")), {
    exclude_domains: ["amoslabs.com"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mapping, {
    email_column: "Email",
    name_column: null,
    first_name_column: "First Name",
    last_name_column: "Last Name"
  });
  assert.equal(result.eligible_unique_contacts, 2);
  assert.equal(result.duplicate_rows, 1);
  assert.equal(result.invalid_or_blank_email_rows, 1);
  assert.equal(result.excluded_rows, 1);
  assert.deepEqual(result.sample, [
    { email: "ada@example.com", name: "Ada Lovelace" },
    { email: "grace@example.net", name: "Grace Hopper, PhD" }
  ]);
});

test("CSV parser preserves quoted commas, newlines, and escaped quotes", () => {
  assert.deepEqual([...parseDelimited('email,note\na@example.com,"one, two"\nb@example.com,"line 1\nline ""2"""')], [
    ["email", "note"],
    ["a@example.com", "one, two"],
    ["b@example.com", 'line 1\nline "2"']
  ]);
});

test("Desktop contact importer sends deterministic bounded batches and reuses one segment", async () => {
  const rows = ["Name,Email"];
  for (let index = 0; index < 1_201; index += 1) {
    rows.push(`Person ${index},person${index}@example.com`);
  }
  const csv = source(rows.join("\n"));
  const calls = [];
  const progress = [];
  const tools = createContactCsvTools({
    attachments: { tabularText: () => csv },
    onProgress: (value) => progress.push(value)
  });
  const importer = tools.find((tool) => tool.name === "desktop_import_email_contacts_csv");
  const result = await importer.handler({
    attachment_id: csv.id,
    authorization_confirmed: true,
    authorization_basis: "legitimate_interest",
    authorization_source: "predecessor-company customer export",
    authorized_at: "2026-09-01T12:00:00Z",
    segment_name: "Customers",
    batch_size: 500
  }, {
    signal: null,
    amosClient: {
      async callTool(name, args) {
        calls.push({ name, args });
        if (name === "resolve_capabilities") {
          return mcpResult({
            manifest_id: "manifest-1",
            operations: [{ operation: "import_email_contacts" }]
          });
        }
        const count = args.arguments.contacts.length;
        return mcpResult({
          inserted: count,
          updated: 0,
          protected_existing_unsubscribed_or_invalid: 0,
          segment_id: "segment-1",
          segment_name: "Customers",
          segment_member_count: calls
            .filter((call) => call.name === "execute_capability")
            .reduce((sum, call) => sum + call.args.arguments.contacts.length, 0)
        });
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.processed_contacts, 1_201);
  assert.equal(result.batches, 3);
  assert.equal(result.inserted, 1_201);
  assert.equal(result.authorization_basis, "legitimate_interest");
  assert.match(result.warning, /owner remains responsible/i);
  const batches = calls.filter((call) => call.name === "execute_capability");
  assert.deepEqual(batches.map((call) => call.args.arguments.contacts.length), [500, 500, 201]);
  assert.equal(batches.every((call) => call.args.arguments.segment_name === "Customers"), true);
  assert.deepEqual(batches[0].args.arguments.authorization, {
    basis: "legitimate_interest",
    source: "predecessor-company customer export",
    authorized_at: "2026-09-01T12:00:00.000Z",
    user_confirmed: true
  });
  assert.equal("consent" in batches[0].args.arguments.contacts[0], false);
  assert.equal(batches[0].args.arguments.contacts[0].metadata.source_row, 2);
  assert.deepEqual(progress.map((item) => item.processed), [500, 1000, 1201]);
});

test("Desktop contact importer requires the user's asserted audience basis", async () => {
  const csv = source("Email\nperson@example.com");
  const tools = createContactCsvTools({ attachments: { tabularText: () => csv } });
  const importer = tools.find((tool) => tool.name === "desktop_import_email_contacts_csv");
  const result = await importer.handler({
    attachment_id: csv.id,
    authorization_basis: "existing_customer_relationship",
    authorization_source: "legacy customers",
    authorized_at: "2026-09-01T12:00:00Z"
  }, { amosClient: null, signal: null });

  assert.equal(result.ok, false);
  assert.match(result.error, /requires the user's confirmation/);
});
