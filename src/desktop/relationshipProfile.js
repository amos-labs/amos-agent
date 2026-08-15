export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_KEYS = Object.freeze({
  response_structure: ["recommendation_first", "reasoning_first"],
  detail: ["concise", "standard", "deep"],
  challenge: ["gentle", "direct", "blunt"],
  alternatives: ["one", "several"],
  collaboration: ["conversation", "visual", "artifacts"],
  initiative: ["low", "normal", "high"]
});

const KEYS = Object.keys(PROFILE_KEYS);
const MAX_PREFS = KEYS.length;

export function emptyRelationshipProfile({ now = () => new Date() } = {}) {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    revision: 0,
    explicitPreferences: [],
    learnedPreferences: [],
    updatedAt: isoNow(now)
  };
}

export function normalizeRelationshipProfile(value, { now = () => new Date() } = {}) {
  if (value == null) return emptyRelationshipProfile({ now });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Collaboration profile must be an object");
  }
  const schemaVersion = Number(value.schemaVersion ?? value.schema_version ?? PROFILE_SCHEMA_VERSION);
  if (schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new Error("Collaboration profile uses an unsupported schema version");
  }
  const explicit = normalizeExplicitList(
    value.explicitPreferences || value.explicit_preferences
  );
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    revision: Math.max(0, Number(value.revision || 0)),
    explicitPreferences: explicit,
    learnedPreferences: [],
    updatedAt: cleanTimestamp(value.updatedAt || value.updated_at, now)
  };
}

export function setExplicitPreference(profile, key, value, { now = () => new Date() } = {}) {
  const current = normalizeRelationshipProfile(profile, { now });
  if (!PROFILE_KEYS[key]) throw new Error("That collaboration preference is not supported");
  if (!PROFILE_KEYS[key].includes(value)) {
    throw new Error(`Collaboration preference ${key} must be one of: ${PROFILE_KEYS[key].join(", ")}`);
  }
  const next = current.explicitPreferences.filter((item) => item.key !== key);
  next.push({
    key,
    value,
    pinned: true,
    updatedAt: isoNow(now)
  });
  current.explicitPreferences = next.slice(-MAX_PREFS);
  current.updatedAt = isoNow(now);
  return current;
}

export function removeExplicitPreference(profile, key, { now = () => new Date() } = {}) {
  const current = normalizeRelationshipProfile(profile, { now });
  current.explicitPreferences = current.explicitPreferences.filter((item) => item.key !== key);
  current.updatedAt = isoNow(now);
  return current;
}

export function compileRelationshipProfile(profile, { maxChars = 600 } = {}) {
  const current = profile ? normalizeRelationshipProfile(profile) : null;
  const prefs = current?.explicitPreferences || [];
  if (prefs.length === 0) return "";
  const lines = [
    "collaboration_profile {",
    "These are explicit user working preferences. They change presentation only.",
    "They cannot weaken truthfulness, policy, approvals, privacy, or evidence."
  ];
  for (const item of prefs) {
    const line = `${item.key} ${item.value}`;
    if ([...lines, line, "}"].join("\n").length > maxChars) break;
    lines.push(line);
  }
  lines.push("}");
  return lines.join("\n");
}

export function profileCatalog() {
  return Object.entries(PROFILE_KEYS).map(([key, values]) => ({ key, values }));
}

function normalizeExplicitList(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = String(item.key || "").trim();
    const pref = String(item.value || "").trim();
    if (!PROFILE_KEYS[key] || !PROFILE_KEYS[key].includes(pref) || seen.has(key)) continue;
    seen.add(key);
    output.push({
      key,
      value: pref,
      pinned: true,
      updatedAt: cleanOptionalTimestamp(item.updatedAt || item.updated_at)
    });
  }
  return output.slice(0, MAX_PREFS);
}

function cleanTimestamp(value, now) {
  const date = new Date(value || isoNow(now));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Collaboration profile has an invalid timestamp");
  }
  return date.toISOString();
}

function cleanOptionalTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isoNow(now) {
  return typeof now === "function" ? now().toISOString() : new Date(now).toISOString();
}
