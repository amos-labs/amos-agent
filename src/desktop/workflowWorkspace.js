// Client projection only. Platform enforces the actual workflow/authority gate.
const VIEWS = new Set([
  "operator",
  "missions",
  "projects",
  "tasks",
  "canvas",
  "connections",
  "automations",
  "integrations",
  "work",
]);
const text = (value, limit) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const key = (value) =>
  /^[a-z][a-z0-9-]{0,79}$/.test(String(value || "")) ? value : "";
const view = (value) =>
  VIEWS.has(value) ||
  /^surface:[a-z][a-z0-9_-]{0,79}$/.test(String(value || ""))
    ? value
    : null;

export function workspacePath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.length > 240
  )
    return null;
  // Encoded slashes/backslashes and controls must not turn a relative route
  // into another origin when a client resolves it against its Platform URL.
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)
    ? null
    : value;
}

export function normalizeWorkflowWorkspace(value, tenantId = null) {
  const empty = {
    supported: false,
    mode: "full",
    tenantId: null,
    revision: 0,
    packageKeys: [],
    catalog: [],
    navigation: [],
    recommendedPackageKeys: [],
  };
  if (
    !value ||
    value.schema !== "amos.workflow_workspace.v1" ||
    !["full", "focused"].includes(value.mode)
  )
    return empty;
  if (tenantId && value.tenant_id !== tenantId) return empty;
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) return empty;
  const catalog = (Array.isArray(value.catalog) ? value.catalog : [])
    .slice(0, 40)
    .map((pkg) => ({
      key: key(pkg?.key),
      version: Number.isSafeInteger(pkg?.version) ? pkg.version : 1,
      title: text(pkg?.title, 80),
      description: text(pkg?.description, 500),
      setupNote: text(pkg?.setup_note, 600),
      setupPrompt: text(pkg?.setup_prompt, 2000),
      readiness: text(pkg?.readiness, 40),
    }))
    .filter((pkg) => pkg.key && pkg.title);
  const known = new Set(catalog.map((pkg) => pkg.key));
  const packageKeys = [
    ...new Set(
      (Array.isArray(value.package_keys) ? value.package_keys : []).filter(
        (item) => known.has(item),
      ),
    ),
  ].slice(0, 8);
  // A withdrawn catalog entry must not broaden a focused workspace to all tools.
  const navigation = (Array.isArray(value.navigation) ? value.navigation : [])
    .slice(0, 32)
    .map((item) => ({
      key: key(item?.key),
      label: text(item?.label, 80),
      webPath: workspacePath(item?.web_path),
      view: view(item?.desktop_view),
    }))
    .filter((item) => item.key && item.label && (item.view || item.webPath));
  return {
    supported: true,
    mode: value.mode,
    tenantId: text(value.tenant_id, 80),
    revision: value.revision,
    catalogSha256: text(value.catalog_sha256, 64),
    requiresReview: value.requires_review === true,
    packageKeys,
    catalog,
    navigation,
    specialists: (Array.isArray(value.specialists) ? value.specialists : [])
      .slice(0, 80)
      .filter(
        (item) =>
          packageKeys.includes(item?.workflow_key) &&
          ["mission", "automation"].includes(item?.resource_kind),
      )
      .map((item) => ({
        id: text(item.id, 80),
        workflowKey: item.workflow_key,
        kind: item.resource_kind,
        name: text(item.name, 160),
        status: text(item.status, 40),
      })),
    recommendedPackageKeys: [
      ...new Set(
        (Array.isArray(value.recommended_package_keys)
          ? value.recommended_package_keys
          : []
        ).filter((item) => known.has(item)),
      ),
    ].slice(0, 8),
  };
}

export function focusedWorkspace(workspace, tenantId) {
  return (
    workspace?.supported === true &&
    workspace.mode === "focused" &&
    Boolean(tenantId) &&
    workspace.tenantId === tenantId
  );
}

export function workspaceAllowsView(workspace, tenantId, requested) {
  if (!focusedWorkspace(workspace, tenantId)) return true;
  if (["operator", "tasks", "work", "settings", "memory"].includes(requested))
    return true;
  return workspace.navigation.some((item) => item.view === requested);
}

export function workflowSetupActions(workspace) {
  if (workspace?.supported !== true || workspace.mode !== "focused") return [];
  return workspace.packageKeys
    .map((id) => workspace.catalog.find((pkg) => pkg.key === id))
    .filter((pkg) => pkg?.setupPrompt)
    .map((pkg) => {
      const existing = workspace.specialists?.some(
        (item) => item.workflowKey === pkg.key,
      );
      return {
        id: `workflow-${pkg.key}`,
        label: `${existing ? "Review" : "Set up"} ${pkg.title}`,
        description: existing
          ? "Review progress, artifacts, blockers and decisions."
          : pkg.setupNote,
        type: "run",
        prompt: existing
          ? `Review current ${pkg.title} work using amos_get_operator_context. Explain outcomes, blockers and decisions, then help me continue inside workflow ${pkg.key}. Do not repeat completed actions.`
          : pkg.setupPrompt,
      };
    });
}

export function workflowOperatorPrompt(workspace, tenantId) {
  if (!focusedWorkspace(workspace, tenantId)) return "";
  const workflows = workspace.packageKeys
    .map((id) => workspace.catalog.find((pkg) => pkg.key === id))
    .filter(Boolean)
    .map((pkg) => `${pkg.key}: ${pkg.title}`)
    .join("; ");
  return [
    "",
    "",
    "WORKFLOW-FOCUSED OPERATOR",
    "You are the user's main coordinating operator, with focused workflow specialists underneath.",
    `Enabled workflows: ${workflows || "None available; ask for a configuration review"}.`,
    "Answer questions naturally, clarify the desired outcome, and work freely within the selected workflow. Do not lead with a generic whole-company audit or a fixed questionnaire.",
    "Read amos_get_operator_context for current specialist status. Load a workflow's tools once when needed; do not browse the entire engine catalog.",
    "Use existing Missions for durable, budgeted specialist work and Automations for deterministic schedules or triggers. The cloud continues approved work while Desktop is closed.",
    "Explain the plan and bounds before launching work. Drafting a new workflow does not activate it or expand permissions. Existing approvals and receipts remain authoritative.",
    "A workflow is a persistent business mandate, not a fixed recipe. Present outcomes, artifacts, blockers and decisions rather than a fleet of bots.",
    workspace.requiresReview
      ? "The workflow capability catalog changed. Ask the owner to review workflows before further execution."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pin a settings action to the displayed company, revision and catalog. */
export function workspaceUpdate(workspace, identity, input = {}) {
  if (!["owner", "admin"].includes(identity?.role))
    throw new Error("Only an owner or admin can change company workflows");
  if (!workspace?.supported || workspace.tenantId !== identity?.tenant_id)
    throw new Error("Refresh the company workspace before saving");
  const keys = Array.isArray(input.packageKeys) ? [...input.packageKeys] : [];
  if (
    !["full", "focused"].includes(input.mode) ||
    keys.length > 8 ||
    (input.mode === "focused" && !keys.length) ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !workspace.catalog.some((pkg) => pkg.key === key))
  )
    throw new Error("Choose valid workflows from the current catalog");
  if (
    input.tenantId !== workspace.tenantId ||
    input.expectedRevision !== workspace.revision ||
    input.catalogSha256 !== workspace.catalogSha256
  ) {
    throw new Error(
      "The company or workflow catalog changed. Reopen workflows before saving.",
    );
  }
  return {
    mode: input.mode,
    packageKeys: keys,
    expectedRevision: workspace.revision,
    catalogSha256: workspace.catalogSha256,
    expectedTenantId: workspace.tenantId,
  };
}

export function workspaceSnapshotInclude(workspace) {
  if (workspace?.supported !== true || workspace.mode !== "focused")
    return null;
  const surfaces = new Set(["approvals", "receipts", "tasks", "connections"]);
  const mapping = {
    canvas: ["briefings"],
    automations: ["automations"],
    projects: ["projects"],
    integrations: ["pipelines", "jobs", "webhooks", "mappings"],
  };
  for (const item of workspace.navigation) {
    if (item.view?.startsWith("surface:")) surfaces.add(item.view.slice(8));
    for (const surface of mapping[item.view] || []) surfaces.add(surface);
  }
  return [...surfaces];
}
