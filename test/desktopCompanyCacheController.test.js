import assert from "node:assert/strict";
import test from "node:test";
import { DesktopController } from "../src/desktop/controller.js";
import { proposalSourceFromGrant } from "../src/desktop/offlineProposal.js";

const settings = {
  provider: "ollama",
  model: "qwen3:4b",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "",
  reasoningEffort: "medium",
  workspace: "/tmp",
  amosMcpUrl: "https://app.amoslabs.com/mcp",
  operatingMode: "offline"
};

test("desktop local-only runtime admits verified cache read and local draft staging only", async () => {
  const grant = {
    claims: {
      cache_id: "cache-1",
      sub: "user-1",
      tenant_id: "tenant-1",
      tenant_slug: "northwind",
      role: "owner",
      scope_fingerprint: "a".repeat(64),
      iat: 1_753_531_200,
      exp: 1_753_545_600
    },
    snapshot: {
      generated_at: "2025-07-26T12:00:00.000Z",
      company_state: { status: "available", name: "Northwind Labs" }
    }
  };
  let staged;
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-company-cache-controller",
    settingsStore: { read: async () => settings },
    companyCacheStore: {
      async read() {
        return grant;
      },
      async status() {
        return { status: "active", available: true };
      }
    },
    offlineProposalStore: {
      async add(input, source) {
        staged = { input, source };
        return {
          id: "proposal-1",
          ...input,
          source
        };
      },
      async list() {
        return [];
      }
    },
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({ status: async () => ({}) });

  const { runtime } = await controller.getRuntime({
    requireAmos: false,
    offline: true
  });
  const tools = runtime.registry.list();
  assert.equal(tools.some((tool) => tool.name === "desktop_read_company_cache"), true);
  assert.equal(tools.some((tool) => tool.name === "desktop_stage_offline_proposal"), true);
  assert.equal(tools.some((tool) => tool.source === "amos"), false);
  assert.equal(tools.some((tool) => tool.name.startsWith("web_")), false);

  const result = await runtime.registry.execute("desktop_read_company_cache", {});
  assert.equal(result.provenance.live, false);
  assert.equal(result.company_state.name, "Northwind Labs");

  const stagedResult = await runtime.registry.execute("desktop_stage_offline_proposal", {
    title: "Prepare renewal",
    objective: "Retain the account",
    summary: "Prepared against the signed briefing.",
    proposed_actions: ["Recheck current account state before preparing a renewal"],
    assumptions: ["The account remains active"]
  });
  assert.equal(stagedResult.status, "saved_locally");
  assert.equal(staged.source.subjectId, "user-1");
  assert.equal(staged.source.tenantId, "tenant-1");
  assert.equal(staged.input.proposedActions[0], "Recheck current account state before preparing a renewal");
});

test("personal workspace runtime exposes local and web tools without AMOS company authority", async () => {
  const personalSettings = {
    ...settings,
    operatingMode: "personal"
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-personal-controller",
    settingsStore: { read: async () => personalSettings },
    openBrowser() {},
    emit() {}
  });
  controller.oauthFor = () => ({ status: async () => ({}) });

  const { runtime } = await controller.getRuntime({
    requireAmos: false,
    boundary: "personal"
  });
  const tools = runtime.registry.list();
  assert.equal(tools.some((tool) => tool.name === "desktop_inspect_project"), true);
  assert.equal(tools.some((tool) => tool.source === "amos"), false);
  assert.equal(tools.some((tool) => tool.name.startsWith("web_")), true);
});

test("desktop clears a saved company cache when live revalidation fails", async () => {
  let cleared = false;
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-company-cache-revalidation",
    settingsStore: { read: async () => settings },
    companyCacheStore: {
      async status() {
        return {
          status: "active",
          cacheId: "cache-1",
          available: true
        };
      },
      async read() {
        throw new Error("AMOS company cache belongs to a different user or company");
      },
      async clear() {
        cleared = true;
      }
    },
    openBrowser() {},
    emit() {}
  });
  const remote = {
    async fetchJwks() {
      return { keys: [] };
    }
  };

  await assert.rejects(
    controller.revalidateCompanyCache(
      remote,
      {
        sub: "user-2",
        tenant_id: "tenant-2",
        principal_type: "user"
      },
      settings
    ),
    /removed because AMOS could not revalidate/
  );
  assert.equal(cleared, true);
});

test("desktop compares an offline draft before loading it for explicit online review", async () => {
  const onlineSettings = { ...settings, operatingMode: "online" };
  const grant = {
    claims: {
      cache_id: "cache-1",
      sub: "user-1",
      tenant_id: "tenant-1",
      tenant_slug: "northwind",
      role: "owner",
      scope_fingerprint: "a".repeat(64),
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 14_400
    },
    snapshot: {
      generated_at: new Date(Date.now() - 60_000).toISOString(),
      company_state: { name: "Northwind Labs" },
      authority: { role: "owner" }
    }
  };
  let proposal = {
    proposalFormat: "amos-offline-proposal",
    proposalVersion: "1",
    id: "proposal-1",
    status: "draft",
    title: "Prepare renewal",
    objective: "Retain the account",
    summary: "Prepared offline.",
    proposedActions: ["Recheck the account and prepare a current renewal"],
    assumptions: ["The account remains active"],
    source: proposalSourceFromGrant(grant),
    reconciliation: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const store = {
    async get() {
      return structuredClone(proposal);
    },
    async list() {
      return [structuredClone(proposal)];
    },
    async saveReconciliation(_id, reconciliation) {
      proposal = { ...proposal, status: "reconciled", reconciliation };
      return structuredClone(proposal);
    }
  };
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-offline-proposal-controller",
    settingsStore: { read: async () => onlineSettings },
    offlineProposalStore: store,
    openBrowser() {},
    emit() {}
  });
  let snapshotReads = 0;
  controller.personalRemote = async () => ({
    async identity() {
      return {
        sub: "user-1",
        tenant_id: "tenant-1",
        principal_type: "user"
      };
    },
    async companySnapshot() {
      snapshotReads += 1;
      return {
        generated_at: new Date().toISOString(),
        company_state: { name: "Northwind Labs", plan: "business" },
        authority: { role: "owner" }
      };
    }
  });

  const compared = await controller.reconcileOfflineProposal("proposal-1");
  assert.equal(snapshotReads, 1);
  assert.equal(compared.proposal.reconciliation.replayAllowed, false);
  assert.deepEqual(compared.proposal.reconciliation.changedSections, ["company_state"]);

  const prepared = await controller.prepareOfflineProposal("proposal-1");
  assert.equal(prepared.executionStarted, false);
  assert.match(prepared.prompt, /explicitly bringing this offline draft back/);
});

test("desktop checks the signed-in identity before reading live company state", async () => {
  const proposal = {
    id: "proposal-1",
    source: { subjectId: "user-1", tenantId: "tenant-1" }
  };
  let snapshotReads = 0;
  const controller = new DesktopController({
    userDataPath: "/tmp/amos-offline-proposal-identity",
    settingsStore: { read: async () => ({ ...settings, operatingMode: "online" }) },
    offlineProposalStore: {
      async get() {
        return proposal;
      },
      async list() {
        return [proposal];
      }
    },
    openBrowser() {},
    emit() {}
  });
  controller.personalRemote = async () => ({
    async identity() {
      return {
        sub: "user-2",
        tenant_id: "tenant-2",
        principal_type: "user"
      };
    },
    async companySnapshot() {
      snapshotReads += 1;
      return {};
    }
  });

  await assert.rejects(
    controller.reconcileOfflineProposal("proposal-1"),
    /different AMOS user or company/
  );
  assert.equal(snapshotReads, 0);
});
