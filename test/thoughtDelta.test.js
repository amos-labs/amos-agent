import assert from "node:assert/strict";
import test from "node:test";
import { collapseThoughtStream, mergeThoughtDelta } from "../src/model/thoughtDelta.js";

test("thought deltas append incrementally and replace cumulative snapshots", () => {
  assert.equal(mergeThoughtDelta("", "CI"), "CI");
  assert.equal(mergeThoughtDelta("CI", " failed"), "CI failed");
  assert.equal(mergeThoughtDelta("CI", "CI failed"), "CI failed");
  assert.equal(
    mergeThoughtDelta("CI failed on the `20260904000001", "CI failed on the 20260904000001 collision"),
    "CI failed on the 20260904000001 collision"
  );
});

test("thought streams collapse growing prefixes into one line", () => {
  const streamed = [
    "CI",
    "CI failed",
    "CI failed on the `20260904000001",
    "CI failed on the 20260904000001 collision.",
    "CI failed on the 20260904000001 collision. The local fix (`615c26d"
  ].join("\n");
  const collapsed = collapseThoughtStream(streamed);
  assert.equal(collapsed.includes("\n"), false);
  assert.match(collapsed, /CI failed on the 20260904000001 collision/);
  assert.match(collapsed, /local fix/);
  assert.doesNotMatch(collapsed, /^CI\nCI failed/m);
});

test("thought deltas replace last-line retransmissions without stacking the line", () => {
  assert.equal(
    mergeThoughtDelta("The user asked about CI.\nI should inspect", "I should inspect the logs."),
    "The user asked about CI.\nI should inspect the logs."
  );
  assert.equal(
    mergeThoughtDelta(
      "The user asked about CI.\nI should inspect the logs.",
      "I should inspect the logs.\nThen patch the collision."
    ),
    "The user asked about CI.\nI should inspect the logs.\nThen patch the collision."
  );
});

test("thought streams keep distinct lines and drop replayed snapshots", () => {
  const streamed = [
    "The user asked about CI.",
    "The user asked about CI.",
    "I should inspect the logs.",
    "The user asked about CI.",
    "I should inspect the logs.",
    "Then patch the collision."
  ].join("\n");
  const collapsed = collapseThoughtStream(streamed);
  assert.equal(
    collapsed,
    "The user asked about CI.\nI should inspect the logs.\nThen patch the collision."
  );
});
