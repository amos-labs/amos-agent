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
