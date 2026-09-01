import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digestResearchValue } from "../src/research/experimentProtocol.js";
import { compileProcessMiningOrganismCurriculum } from "../src/research/processMiningOrganismCurriculum.js";

test("process variants are isolated across train, validation, and holdout scenarios", async () => {
  const root = await mkdtemp(join(tmpdir(), "amos-process-curriculum-"));
  const csv = join(root, "events.csv");
  const header = "Case ID;Event Name;Timestamp;Username;Vendor Name;Amount;Due Date;Last Date Early Discount Payment;Payment Status;Payment Method";
  const variants = [
    ["Receive Invoice", "Digitize Invoice", "Verify Info", "Send Invoice to ERP", "Match Invoice", "Approve Invoice", "Process Payment", "Archive Invoice"],
    ["Receive Invoice", "Digitize Invoice", "Digitize Invoice", "Verify Info", "Send Invoice to ERP", "Match Invoice", "Approve Invoice", "Process Payment", "Archive Invoice"],
    ["Receive Invoice", "Digitize Invoice", "Verify Info", "Send Invoice to ERP", "Dispute Invoice", "Resolve Dispute", "Approve Invoice", "Process Payment", "Archive Invoice"],
    ["Receive Invoice", "Digitize Invoice", "Verify Info", "Send Invoice to ERP", "Match Invoice", "Approve Invoice", "Apply Early Payment Discount", "Process Payment", "Archive Invoice"],
    ["Receive Invoice", "Digitize Invoice", "Verify Info", "Verify Info", "Send Invoice to ERP", "Match Invoice", "Approve Invoice", "Process Payment", "Archive Invoice"]
  ];
  const lines = [header];
  for (const [caseIndex, events] of variants.entries()) {
    for (const [eventIndex, event] of events.entries()) {
      lines.push([
        `INV-${caseIndex + 1}`,
        event,
        `${String(eventIndex + 1).padStart(2, "0")}/01/2024 10:00`,
        "user",
        "vendor",
        "100",
        "31/01/2024 10:00",
        "10/01/2024 10:00",
        event.includes("Discount") ? "Early (Discount Applied)" : "On Time",
        "Bank Transfer"
      ].join(";"));
    }
  }
  await writeFile(csv, `${lines.join("\n")}\n`, "utf8");

  const curriculum = await compileProcessMiningOrganismCurriculum({
    csvPath: csv,
    sourceId: "test-ap-log",
    sourceDigest: digestResearchValue(lines),
    authorizedForInternalTraining: true,
    maximumCases: { training: 20, validation: 20, holdout: 20 }
  });

  assert.equal(curriculum.split.variants.length, variants.length);
  assert.ok(curriculum.partitions.training.length > 0);
  assert.ok(curriculum.partitions.validation.length > 0);
  assert.ok(curriculum.partitions.holdout.length > 0);
  const sets = Object.fromEntries(Object.entries(curriculum.partitions).map(([partition, scenarios]) => [
    partition,
    new Set(scenarios.map(({ processSignals }) => processSignals.variantDigest))
  ]));
  assert.equal([...sets.training].some((value) => sets.validation.has(value)), false);
  assert.equal([...sets.training].some((value) => sets.holdout.has(value)), false);
  assert.equal([...sets.validation].some((value) => sets.holdout.has(value)), false);
  assert.equal(curriculum.source.rawDataIncluded, false);
});

test("private process data cannot enter curriculum without explicit owner authorization", async () => {
  await assert.rejects(() => compileProcessMiningOrganismCurriculum({
    csvPath: "/does/not/matter.csv",
    sourceId: "test-ap-log",
    sourceDigest: "a".repeat(64),
    authorizedForInternalTraining: false
  }), /explicit internal-training authorization/);
});
