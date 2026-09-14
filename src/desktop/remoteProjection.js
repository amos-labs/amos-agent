export function mergeRemoteProjectionValue(current, candidate, empty, label) {
  if (candidate && candidate.supported !== false) {
    return { ...candidate, stale: false, refreshError: "" };
  }
  if (current?.supported === true) {
    return {
      ...current,
      stale: true,
      refreshError: `${label} is temporarily unavailable. Showing the last successfully synced data.`
    };
  }
  return { ...empty, ...(candidate || {}), stale: false, refreshError: "" };
}

export function mergeRemoteProjection({ current, result, empty, label, errors = [] }) {
  if (result.status === "fulfilled" && result.value) {
    const merged = mergeRemoteProjectionValue(current, result.value, empty, label);
    if (merged.stale) errors.push(merged.refreshError);
    return merged;
  }
  const message = result.reason?.message || `Could not load ${label}`;
  errors.push(message);
  if (current?.supported === true) {
    return { ...current, stale: true, refreshError: message };
  }
  return { ...empty, stale: false, refreshError: message };
}

function fulfilled(value) {
  return { status: "fulfilled", value };
}

function rejected(message) {
  return { status: "rejected", reason: new Error(message) };
}

/**
 * Turn a normalized `desktop_snapshot` (see remoteState.normalizeDesktopSnapshot)
 * into the same settled-result shape the per-verb refresh fan-out produces, so
 * the controller applies both paths through one code path.
 *
 * - a surface the platform reports `unchanged` (or did not read) keeps the
 *   caller's current value;
 * - a surface that is not available to this caller resolves to its empty
 *   value — the lock reason is rendered from `surfaces`, never as an error;
 * - a surface whose primary read was refused or timed out on the platform is
 *   rejected, so the caller keeps the last synced data and reports it stale;
 * - a limited identity is rejected with the platform's reason.
 */
export function snapshotSettledResults(snapshot, current) {
  const surfaces = snapshot?.surfaces || {};
  const sections = snapshot?.sections || {};
  const pick = (key, { unchangedValue, emptyValue, label, value }) => {
    const surface = surfaces[key];
    if (!surface || surface.available === false) return fulfilled(emptyValue);
    if (surface.unchanged === true || surface.read === false) return fulfilled(unchangedValue);
    const section = sections[key];
    const resolved = typeof value === "function" ? value(section) : section?.library;
    if (resolved === null || resolved === undefined) {
      return rejected(`${label} is temporarily unavailable`);
    }
    return fulfilled(resolved);
  };

  return {
    identityResult: snapshot?.identity
      ? fulfilled(snapshot.identity)
      : rejected(
          snapshot?.identityLimited
            ? `Could not load AMOS identity (${snapshot.identityLimited})`
            : "Could not load AMOS identity"
        ),
    connectionsResult: pick("connections", {
      unchangedValue: current.connectionsCatalog,
      emptyValue: { connections: [], providers: [], catalogVersion: 0, curated: [], tenantDefined: [] },
      label: "AMOS connections"
    }),
    receiptsResult: pick("receipts", {
      unchangedValue: current.receipts,
      emptyValue: { display: [], platform: [] },
      label: "AMOS proof receipts"
    }),
    briefingsResult: pick("briefings", {
      unchangedValue: current.briefings,
      emptyValue: { supported: false, contractVersion: 0, templates: [], briefings: [] },
      label: "AMOS Briefings"
    }),
    automationsResult: pick("automations", {
      unchangedValue: current.automations,
      emptyValue: { supported: false, automations: [] },
      label: "AMOS Automations"
    }),
    automationTemplatesResult: pick("automations", {
      unchangedValue: current.automationTemplates,
      emptyValue: current.emptyAutomationTemplates,
      label: "AMOS Automation templates",
      value: (section) => section?.templates ?? null
    }),
    tasksResult: pick("tasks", {
      unchangedValue: current.tasks,
      emptyValue: { supported: false, tasks: [], contract: null },
      label: "AMOS Tasks"
    }),
    projectsResult: pick("projects", {
      unchangedValue: current.projects,
      emptyValue: current.emptyProjects,
      label: "AMOS Projects"
    })
  };
}
