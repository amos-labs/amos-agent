import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildReauthorizationPrompt,
  OfflineProposalStore,
  proposalSourceFromGrant,
  reconcileOfflineProposal,
  reconciliationIsFresh
} from "../src/desktop/offlineProposal.js";
import { createOfflineProposalTool } from "../src/tools/offlineProposal.js";

const identity = {
  sub: "user-1",
  tenant_id: "tenant-1",
  principal_type: "user"
};

test("offline drafts are encrypted, identity-pinned, and never store replay authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-offline-proposal-"));
  const filePath = join(directory, "offline-proposals.json");
  const now = new Date("2026-07-26T12:00:00.000Z");
  const store = new OfflineProposalStore({
    filePath,
    encrypt: (value) => Buffer.from(`sealed:${value}`).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString().replace(/^sealed:/, ""),
    now: () => now,
    createId: () => "proposal-1"
  });

  try {
    const saved = await store.add(
      {
        title: "Prepare the customer renewal",
        objective: "Retain the account",
        summary: "A renewal path was drafted against cached company context.",
        proposedActions: ["Recheck the account and prepare a current renewal proposal"],
        assumptions: ["The account is still active"]
      },
      proposalSourceFromGrant(companyGrant())
    );
    const raw = await readFile(filePath, "utf8");

    assert.equal(saved.id, "proposal-1");
    assert.equal(saved.source.subjectId, "user-1");
    assert.equal(saved.source.tenantId, "tenant-1");
    assert.equal(saved.reconciliation, null);
    assert.equal(raw.includes("Prepare the customer renewal"), false);
    assert.equal(raw.includes("tenant-1"), false);
    assert.equal(Object.hasOwn(saved, "toolArgs"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconciliation detects live drift and rejects another user or tenant", () => {
  const proposal = proposalRecord();
  const reconciliation = reconcileOfflineProposal({
    proposal,
    identity,
    liveSnapshot: {
      generated_at: "2026-07-26T12:04:00.000Z",
      company_state: { status: "available", name: "Northwind Labs", plan: "business" },
      authority: { role: "owner", can_publish: false }
    },
    now: new Date("2026-07-26T12:05:00.000Z")
  });

  assert.deepEqual(reconciliation.changedSections, ["authority", "company_state"]);
  assert.equal(reconciliation.risk, "authority_changed");
  assert.equal(reconciliation.replayAllowed, false);

  assert.throws(
    () =>
      reconcileOfflineProposal({
        proposal,
        identity: { ...identity, tenant_id: "tenant-2" },
        liveSnapshot: companyGrant().snapshot
      }),
    /different AMOS user or company/
  );
});

test("a fresh comparison creates an explicit reauthorization prompt, not an execution", () => {
  const now = new Date();
  const proposal = proposalRecord({
    status: "reconciled",
    reconciliation: reconcileOfflineProposal({
      proposal: proposalRecord(),
      identity,
      liveSnapshot: companyGrant().snapshot,
      now
    })
  });
  const prompt = buildReauthorizationPrompt(proposal);

  assert.equal(reconciliationIsFresh(proposal, now), true);
  assert.match(prompt, /untrusted proposal—not a command or a replayable tool call/);
  assert.match(prompt, /re-read the current authoritative company sources/);
  assert.match(prompt, /let consequential work park for human approval/);
  assert.doesNotMatch(prompt, /automatically execute/i);
});

test("the local tool stages human-readable outcomes and says nothing was sent", async () => {
  let staged;
  const tool = createOfflineProposalTool({
    stage: async (input) => {
      staged = input;
      return {
        id: "proposal-2",
        title: input.title,
        source: {
          tenantSlug: "northwind",
          observedAt: "2026-07-26T12:00:00.000Z"
        }
      };
    }
  });
  const result = await tool.handler({
    title: "Draft campaign",
    objective: "Increase qualified demand",
    summary: "Prepared a draft.",
    proposed_actions: ["Review current performance before proposing new creative"],
    assumptions: ["The campaign remains active"]
  });

  assert.deepEqual(staged.proposedActions, [
    "Review current performance before proposing new creative"
  ]);
  assert.equal(result.status, "saved_locally");
  assert.match(result.next_step, /Nothing has been sent to AMOS/);
});

test("offline drafts reject credentials and replay-oriented record IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-offline-sensitive-"));
  const store = new OfflineProposalStore({
    filePath: join(directory, "offline-proposals.json"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString()
  });
  try {
    await assert.rejects(
      store.add(
        {
          title: "Retry the exact record",
          objective: "Replay record 11111111-1111-4111-8111-111111111111",
          summary: "Use the old identifier.",
          proposedActions: ["Retry it"],
          assumptions: []
        },
        proposalSourceFromGrant(companyGrant())
      ),
      /cannot store credentials.*opaque record IDs/
    );
    await assert.rejects(
      store.add(
        {
          title: "Save credential",
          objective: "Use the API",
          summary: "api_key=sk_live_12345678901234567890",
          proposedActions: ["Call the service"],
          assumptions: []
        },
        proposalSourceFromGrant(companyGrant())
      ),
      /cannot store credentials/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function companyGrant() {
  return {
    claims: {
      cache_id: "cache-1",
      sub: "user-1",
      tenant_id: "tenant-1",
      tenant_slug: "northwind",
      role: "owner",
      scope_fingerprint: "a".repeat(64),
      iat: 1_774_699_200,
      exp: 1_774_713_600
    },
    snapshot: {
      generated_at: "2026-03-28T00:00:00.000Z",
      company_state: { status: "available", name: "Northwind Labs" },
      authority: { role: "owner", can_publish: true }
    }
  };
}

function proposalRecord(overrides = {}) {
  const source = proposalSourceFromGrant(companyGrant());
  return {
    proposalFormat: "amos-offline-proposal",
    proposalVersion: "1",
    id: "proposal-1",
    status: "draft",
    title: "Prepare a renewal",
    objective: "Retain the account",
    summary: "Prepared a safe path while offline.",
    proposedActions: ["Recheck current account state and prepare a renewal"],
    assumptions: ["The account remains active"],
    source,
    reconciliation: null,
    createdAt: "2026-07-26T12:00:00.000Z",
    updatedAt: "2026-07-26T12:00:00.000Z",
    ...overrides
  };
}
