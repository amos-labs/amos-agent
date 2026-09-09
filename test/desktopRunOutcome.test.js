import assert from "node:assert/strict";
import test from "node:test";
import { runInterruptionMessage } from "../src/desktop/runOutcome.js";

test("interruption messages distinguish provider, sleep, and budget failures", () => {
  const message = reason => runInterruptionMessage({ interrupted: true, recovery: { reason } });
  assert.match(message("model_timeout_after_progress"), /model timed out/i);
  assert.match(message("model_transient_after_progress"), /model connection failed/i);
  assert.doesNotMatch(message("model_transient_after_progress"), /timed out/i);
  assert.match(message("system_sleep"), /computer went to sleep/i);
  assert.doesNotMatch(message("system_sleep"), /model|budget/i);
  assert.match(message("budget_exhausted"), /configured budget/i);
  assert.doesNotMatch(message("budget_exhausted"), /model|sleep/i);
});

test("unknown interruptions do not invent a cause or display an untrusted reason", () => {
  for (const result of [undefined, null, {}, ...["<script>made up timeout</script>", "__proto__", "toString"].map(reason => ({ recovery: { reason } }))]) {
    const message = runInterruptionMessage(result);
    assert.match(message, /stopped before completion/);
    assert.doesNotMatch(message, /model|budget|sleep|script|made up/);
  }
});
