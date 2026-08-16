import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INTELLIGENCE_ROLES,
  decodeRoleOption,
  defaultRoleForWorkflow,
  encodeRoleOption,
  roleGuidance,
  roleOptionsFromProviders,
  sanitizeIntelligenceRoles
} from "../src/model/intelligenceRoles.js";

test("the default pair is Kimi as planner/checker and Grok as builder", () => {
  const roles = sanitizeIntelligenceRoles({ enabled: true });
  assert.equal(roles.planner.model, "kimi-k3");
  assert.equal(roles.implementer.provider, "xai");
  assert.equal(roles.implementer.model, "grok-4.6");
  assert.equal(roles.checker.model, "kimi-k3");
  assert.equal(defaultRoleForWorkflow({ id: "code-change" }, roles), "planner");
  assert.match(roleGuidance("planner"), /Do not edit files/);
  assert.match(roleGuidance("checker"), /Do not implement a new design/);
});

test("pairing stays off unless explicitly enabled", () => {
  const roles = sanitizeIntelligenceRoles({});
  assert.equal(roles.enabled, false);
  assert.deepEqual(roles.implementer, DEFAULT_INTELLIGENCE_ROLES.implementer);
  assert.equal(defaultRoleForWorkflow({ id: "code-change" }, roles), null);
});

test("role options come from named provider catalogs", () => {
  const options = roleOptionsFromProviders([
    { id: "amos-hosted", displayName: "AMOS Intelligence", defaultModel: "auto" },
    {
      id: "xai",
      displayName: "xAI / Grok",
      models: [{ id: "grok-4.6", label: "Grok 4.6" }]
    }
  ]);
  assert.deepEqual(options.map((option) => option.value), ["xai:grok-4.6"]);
  assert.equal(encodeRoleOption({ provider: "kimi", model: "kimi-k3" }), "kimi:kimi-k3");
  assert.deepEqual(decodeRoleOption("xai:grok-4.6"), { provider: "xai", model: "grok-4.6" });
});
