export const HOSTED_TIERS = Object.freeze(["auto", "routine", "balanced", "deep", "frontier"]);

export function normalizeHostedTier(value) {
  return HOSTED_TIERS.includes(value) ? value : "auto";
}

export function hasManualHostedTier(settings) {
  return settings?.provider === "amos-hosted" && normalizeHostedTier(settings.hostedTier) !== "auto";
}

export function hostedTierLabel(value) {
  const tier = normalizeHostedTier(value);
  return tier === "auto" ? "Automatic" : tier[0].toUpperCase() + tier.slice(1);
}
