// Canonical input-shaping helpers shared across the agent, desktop, model, and
// tool modules. Each was previously copied verbatim into many files.

// Trimmed string bounded to `maxLength`; null/undefined/false become "".
export function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

// Integer clamp with a fallback for non-numeric input. `null`/`undefined`
// fall back; fractional values are floored.
export function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}

// Integer clamp with a fallback for non-finite input; fractional values are
// truncated toward zero. Unlike boundedNumber, `null` coerces to 0.
export function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}
