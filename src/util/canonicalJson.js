export function canonicalizeJson(value) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item, true));
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value)
      .sort()
      .filter((key) => jsonValueSupported(value[key]))
      .map((key) => [key, canonicalizeJsonValue(value[key], false)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalizeJsonValue(value, arrayItem) {
  if (!jsonValueSupported(value)) return arrayItem ? null : undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return canonicalizeJson(value);
}

function jsonValueSupported(value) {
  return !["undefined", "function", "symbol"].includes(typeof value);
}
