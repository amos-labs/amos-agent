import { estimateMessageTokens } from "./contextCompiler.js";
import { canonicalJson } from "../util/canonicalJson.js";

const DEFAULT_EXPECTED_FUTURE_TURNS = 4;
const DEFAULT_REBUILD_MARGIN = 1.25;

export function evaluateCompactionEconomics({
  tokensSaved = 0,
  rebuildTokens = 0,
  expectedFutureTurns = DEFAULT_EXPECTED_FUTURE_TURNS,
  rebuildMargin = DEFAULT_REBUILD_MARGIN,
  force = false,
  boundary = true
} = {}) {
  const saved = nonNegative(tokensSaved);
  const rebuild = nonNegative(rebuildTokens);
  const turns = boundedNumber(expectedFutureTurns, DEFAULT_EXPECTED_FUTURE_TURNS, 1, 32);
  const margin = boundedNumber(rebuildMargin, DEFAULT_REBUILD_MARGIN, 1, 4);
  const projectedSavingsTokens = Math.round(saved * turns);
  const requiredSavingsTokens = Math.round(rebuild * margin);
  const economic = saved > 0 && projectedSavingsTokens >= requiredSavingsTokens;
  const shouldCompact = Boolean(force || (boundary && economic));
  return {
    version: 1,
    shouldCompact,
    reason: force
      ? "forced_context_pressure"
      : !boundary
        ? "awaiting_natural_boundary"
        : economic
          ? "projected_prefill_savings"
          : "cache_rebuild_cost",
    tokensSaved: Math.round(saved),
    rebuildTokens: Math.round(rebuild),
    expectedFutureTurns: turns,
    rebuildMargin: margin,
    projectedSavingsTokens,
    requiredSavingsTokens
  };
}

export function evaluatePreferredCompaction({
  previousMessages = null,
  exactMessages = [],
  compactedMessages = [],
  contractReused = false,
  expectedFutureTurns = DEFAULT_EXPECTED_FUTURE_TURNS,
  rebuildMargin = DEFAULT_REBUILD_MARGIN
} = {}) {
  const exactTokens = estimateMessageTokens(exactMessages);
  const compactedTokens = estimateMessageTokens(compactedMessages);
  const tokensSaved = Math.max(0, exactTokens - compactedTokens);
  if (!contractReused || !Array.isArray(previousMessages)) {
    return {
      ...evaluateCompactionEconomics({
        tokensSaved,
        rebuildTokens: 0,
        expectedFutureTurns,
        rebuildMargin,
        force: true
      }),
      reason: "cold_prompt_contract",
      exactReusableTokens: 0,
      compactedReusableTokens: 0
    };
  }
  const exactReusableTokens = sharedMessagePrefixTokens(previousMessages, exactMessages);
  const compactedReusableTokens = sharedMessagePrefixTokens(previousMessages, compactedMessages);
  const exactPrefillTokens = Math.max(0, exactTokens - exactReusableTokens);
  const compactedPrefillTokens = Math.max(0, compactedTokens - compactedReusableTokens);
  const rebuildTokens = Math.max(0, compactedPrefillTokens - exactPrefillTokens);
  return {
    ...evaluateCompactionEconomics({
      tokensSaved,
      rebuildTokens,
      expectedFutureTurns,
      rebuildMargin
    }),
    exactReusableTokens,
    compactedReusableTokens,
    exactPrefillTokens,
    compactedPrefillTokens
  };
}

export function sharedMessagePrefix(messages = [], nextMessages = []) {
  const left = Array.isArray(messages) ? messages : [];
  const right = Array.isArray(nextMessages) ? nextMessages : [];
  let count = 0;
  while (count < left.length && count < right.length) {
    if (canonicalJson(left[count]) !== canonicalJson(right[count])) break;
    count += 1;
  }
  return count;
}

export function sharedMessagePrefixTokens(messages = [], nextMessages = []) {
  return estimateMessageTokens(nextMessages.slice(0, sharedMessagePrefix(messages, nextMessages)));
}

function nonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
