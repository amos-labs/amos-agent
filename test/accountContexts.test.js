import assert from "node:assert/strict";
import test from "node:test";
import { accountContextChoices } from "../src/desktop/accountContexts.js";

function fixture() {
  return {
    connectionMode: "user",
    mode: {},
    accounts: {
      currentAccountId: "login-a",
      accounts: [
        { id: "login-a", tenantSlug: "acme", email: "alex@example.test" },
        { id: "login-b", tenantSlug: "acme", email: "blair@example.test" }
      ]
    },
    companies: {
      currentTenantId: "company-a",
      tenants: [
        { tenant_id: "company-a", tenant_name: "Acme" },
        { tenant_id: "company-b", tenant_name: "Acme Studio", parent_tenant_name: "Acme", relationship_kind: "subsidiary" }
      ]
    }
  };
}

test("one selector distinguishes memberships from saved logins even at the same company", () => {
  const choices = accountContextChoices(fixture());
  assert.deepEqual(choices.map(({ tenantId, accountId, selected }) => ({ tenantId, accountId, selected })), [
    { tenantId: "company-a", accountId: undefined, selected: true },
    { tenantId: "company-b", accountId: undefined, selected: false },
    { tenantId: undefined, accountId: "login-b", selected: false }
  ]);
  assert.match(choices[0].label, /Acme · alex@example\.test/);
  assert.match(choices[1].label, /Acme Studio \(subsidiary of Acme\)/);
  assert.match(choices[2].label, /acme · blair@example\.test/);
  assert.doesNotMatch(choices[2].label, /\(saved account\)$/);
});

test("a saved login overlapping an active membership retains a distinct action and label", () => {
  const state = fixture();
  Object.assign(state.accounts.accounts[1], {
    tenantId: "company-b", tenantSlug: "acme-studio", email: "alex@example.test"
  });
  const choices = accountContextChoices(state);
  assert.equal(choices[1].tenantId, "company-b");
  assert.equal(choices[1].accountId, undefined);
  assert.equal(choices[2].accountId, "login-b");
  assert.equal(choices[2].tenantId, undefined);
  assert.notEqual(choices[1].value, choices[2].value);
  assert.match(choices[2].label, /\(saved account\)$/);
});

test("an account switch replaces the old login's memberships without dropping either login", () => {
  const state = fixture();
  state.accounts.currentAccountId = "login-b";
  state.companies = { currentTenantId: "company-c", tenants: [{ tenant_id: "company-c", tenant_name: "Birch" }] };
  const choices = accountContextChoices(state);
  assert.deepEqual(choices.map((choice) => choice.value), ["company:company-c", "account:login-a"]);
  assert.equal(choices[0].selected, true);
  assert.match(choices[0].label, /blair@example\.test/);
});

test("offline, personal, and API-key contexts offer saved logins without stale memberships", () => {
  for (const override of [{ mode: { offline: true } }, { mode: { personal: true } }, { connectionMode: "api_key" }]) {
    const choices = accountContextChoices({ ...fixture(), ...override });
    assert.deepEqual(choices.map((choice) => choice.value), ["account:login-a", "account:login-b"]);
    assert.ok(choices.every((choice) => !choice.selected && !choice.tenantId));
  }
});

test("single login, unavailable memberships, demo and signed-out states retain truthful selections", () => {
  const state = fixture();
  state.accounts.accounts.pop();
  state.companies.tenants.pop();
  assert.equal(accountContextChoices(state).length, 1);
  assert.equal(accountContextChoices(state)[0].selected, true);
  state.companies = {};
  assert.deepEqual(accountContextChoices(state).map((choice) => choice.value), ["account:login-a"]);
  assert.equal(accountContextChoices(state)[0].selected, true);
  state.connectionMode = "demo";
  assert.equal(accountContextChoices(state)[0].selected, true);
  assert.deepEqual(accountContextChoices(null), []);
  assert.deepEqual(accountContextChoices({}), []);
});
