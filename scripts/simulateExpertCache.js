#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  EXPERT_CACHE_POLICIES,
  parseExpertTrace,
  slotsForBudget,
  sweepExpertCache
} from "../src/experiments/expertCache.js";

const args = process.argv.slice(2);
const tracePath = readOption(args, "--trace");
const policies = listOption(args, "--policies", EXPERT_CACHE_POLICIES);
const slots = listOption(args, "--slots", [4, 8, 16, 32, 64, 96], Number);
const budgetsGiB = listOption(args, "--budgets-gib", [], Number);
const budgetsBytes = budgetsGiB.map((value) => value * 1024 ** 3);
const json = args.includes("--json");

if (!tracePath) {
  console.error(
    "Usage: npm run experiment:expert-cache -- --trace TRACE.jsonl " +
    "[--policies lru,lfu,slru,tinylfu] [--slots 4,8,16,32,64,96] " +
    "[--budgets-gib 32,40,48] [--json]"
  );
  process.exit(2);
}

const trace = parseExpertTrace(await readFile(tracePath, "utf8"));
const results = sweepExpertCache(trace, { policies, slots, budgetsBytes });
const rejectedBudgets = budgetsBytes.filter(
  (budget) => slotsForBudget(trace.metadata, budget) < 1
);

if (json) {
  console.log(
    JSON.stringify(
      {
        metadata: trace.metadata,
        rejectedBudgets,
        results
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(
  `ExpertCache sweep · ${trace.metadata.model} · ${trace.tokens.length} tokens · ` +
  `${trace.metadata.layers} layers × top-${trace.metadata.activeExperts}`
);
console.log(
  [
    pad("policy", 10),
    pad("budget", 11),
    pad("slots", 7),
    pad("hit rate", 10),
    pad("p95 cold/token", 17),
    pad("cache", 12),
    pad("resident", 12),
    pad("p95 ranges", 12),
    pad("decode", 10),
    pad("prefill", 10)
  ].join("")
);
for (const result of results) {
  console.log(
    [
      pad(result.policy, 10),
      pad(
        result.requestedBudgetBytes
          ? formatBytes(result.requestedBudgetBytes)
          : "slots",
        11
      ),
      pad(result.slotsPerLayer, 7),
      pad(percent(result.hitRate), 10),
      pad(formatBytes(result.coldBytesPerToken.p95), 17),
      pad(formatBytes(result.cacheFootprintBytes), 12),
      pad(formatBytes(result.estimatedResidentBytes), 12),
      pad(result.coldRangesPerToken.p95, 12),
      pad(percent(result.phases.decode.hitRate), 10),
      pad(percent(result.phases.prefill.hitRate), 10)
    ].join("")
  );
}
for (const budget of rejectedBudgets) {
  console.warn(
    `Budget ${formatBytes(budget)} cannot hold the shared baseline plus one ` +
    "expert slot per layer."
  );
}

function readOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : "";
}

function listOption(values, name, fallback, transform = String) {
  const value = readOption(values, name);
  if (!value) return [...fallback];
  return value
    .split(",")
    .map((item) => transform(item.trim()))
    .filter((item) => (
      typeof item === "number" ? Number.isFinite(item) && item > 0 : Boolean(item)
    ));
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function pad(value, width) {
  return String(value).slice(0, width - 1).padEnd(width, " ");
}
