// Only the active login's memberships are available locally. Other saved
// logins expose their last-used company; switching one refreshes memberships.
export function accountContextChoices(state) {
  const accounts = Array.isArray(state?.accounts?.accounts) ? state.accounts.accounts : [];
  const currentAccountId = state?.accounts?.currentAccountId;
  const currentAccount = accounts.find((account) => account.id === currentAccountId);
  const activeLogin = ["user", "demo"].includes(state?.connectionMode) && !state.mode?.personal && !state.mode?.offline;
  const tenants = activeLogin && state.connectionMode === "user" && Array.isArray(state.companies?.tenants)
    ? state.companies.tenants : [];
  const email = currentAccount?.email || state?.identity?.user?.email;
  const choices = tenants.map((tenant) => ({
    value: `company:${tenant.tenant_id}`,
    tenantId: tenant.tenant_id,
    label: [
      tenant.parent_tenant_name
        ? `${tenant.tenant_name} (${tenant.relationship_kind || "unit"} of ${tenant.parent_tenant_name})`
        : tenant.tenant_name || tenant.tenant_slug || tenant.tenant_id,
      email
    ].filter(Boolean).join(" · "),
    selected: tenant.tenant_id === state.companies.currentTenantId
  }));
  const hasCurrentCompany = choices.some((choice) => choice.selected);
  for (const account of accounts) {
    if (activeLogin && account.id === currentAccountId && hasCurrentCompany) continue;
    const label = [account.tenantSlug || account.label || "AMOS account", account.email || account.name]
      .filter(Boolean).join(" · ");
    const sameMembership = account.email && email && account.email.toLowerCase() === email.toLowerCase() &&
      tenants.some((tenant) => tenant.tenant_id === account.tenantId ||
        (tenant.tenant_slug && tenant.tenant_slug === account.tenantSlug));
    const ambiguous = sameMembership || choices.some((choice) => choice.label.toLowerCase() === label.toLowerCase());
    choices.push({
      value: `account:${account.id}`,
      accountId: account.id,
      label: label + (ambiguous ? " (saved account)" : ""),
      selected: activeLogin && account.id === currentAccountId
    });
  }
  return choices;
}
