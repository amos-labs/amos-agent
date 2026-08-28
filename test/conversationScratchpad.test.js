import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "../src/tools/registry.js";
import { inferToolToolkit } from "../src/tools/toolkitCatalog.js";
import {
  applyScratchpadPatch,
  createScratchpadTools,
  emptyScratchpad,
  formatScratchpadCard,
  portableScratchpadFromTask,
  scratchpadHasWork,
  syncScratchpadWithObjective
} from "../src/model/conversationScratchpad.js";

test("scratch pad hops jobs in one conversation and parks the previous current job", () => {
  let pad = emptyScratchpad();
  pad = syncScratchpadWithObjective(pad, "Help me build a Stripe to QuickBooks integration");
  pad = syncScratchpadWithObjective(pad, "We need to add these accounts to QBO");
  pad = syncScratchpadWithObjective(pad, "Fix tax_behavior on the three Stripe prices");
  pad = applyScratchpadPatch(pad, {
    notes: "Stripe writes are form-urlencoded POST.",
    add_open_loop: "Confirm inclusive tax on the three prices"
  });

  assert.equal(pad.currentJob, "Fix tax_behavior on the three Stripe prices");
  assert.equal(pad.jobs.length, 3);
  assert.equal(pad.jobs.filter((job) => job.status === "current").length, 1);
  assert.equal(pad.jobs[0].status, "parked");
  assert.equal(pad.jobs[1].title, "We need to add these accounts to QBO");
  assert.match(pad.notes, /form-urlencoded/);
  assert.deepEqual(pad.openLoops, ["Confirm inclusive tax on the three prices"]);
  assert.equal(scratchpadHasWork(pad), true);
});

test("thin follow-ups do not replace the current job when sync is skipped by the caller", () => {
  const pad = syncScratchpadWithObjective(
    emptyScratchpad(),
    "Update tax_behavior to inclusive on these three Stripe prices"
  );
  const card = formatScratchpadCard({
    scratchpad: pad,
    workingObjective: pad.currentJob,
    compacted: false
  });
  assert.match(card, /<amos_scratchpad>/);
  assert.match(card, /Act on the current job now/);
  assert.match(card, /Do not restart, recover the thread/);
  assert.match(card, /tax_behavior/);
  assert.doesNotMatch(card, /desktop_inspect_conversation/);
});

test("compacted scratch pad does not tell the model to recover the whole thread", () => {
  const card = formatScratchpadCard({
    scratchpad: {
      currentJob: "Fix tax_behavior on the three Stripe prices"
    },
    compacted: true
  });
  assert.match(card, /Continue with this pad/);
  assert.match(card, /desktop_inspect_conversation only for one missing quote/);
  assert.doesNotMatch(card, /recover exact messages/);
});

test("portable scratch pads come from the conversation, not a Project", () => {
  const record = portableScratchpadFromTask({
    id: "task-tax",
    contextKey: "task:task-tax",
    title: "Ops thread",
    objective: "Fix Stripe tax",
    projectId: "",
    scratchpad: {
      currentJob: "Fix tax_behavior on the three Stripe prices",
      jobs: [{ title: "Build Stripe to QBO integration", status: "parked" }]
    }
  });
  assert.equal(record.kind, "conversation_scratchpad");
  assert.equal(record.taskId, "task-tax");
  assert.equal(portableScratchpadFromTask({ id: "empty", scratchpad: {} }), null);
});

test("scratch pad tools are core and the update path does not ask for approval", async () => {
  let stored = emptyScratchpad();
  const registry = new ToolRegistry({ progressive: true });
  for (const tool of createScratchpadTools({
    getPad: () => stored,
    setPad: (pad) => {
      stored = pad;
    }
  })) {
    registry.register(tool);
  }

  assert.equal(inferToolToolkit({ name: "desktop_read_scratchpad" }), "core");
  assert.equal(inferToolToolkit({ name: "desktop_update_scratchpad" }), "core");
  assert.equal(registry.executionPolicy("desktop_read_scratchpad").readOnly, true);
  assert.equal(registry.executionPolicy("desktop_update_scratchpad").readOnly, false);

  const updated = await registry.execute("desktop_update_scratchpad", {
    current_job: "Fix tax_behavior on the three Stripe prices",
    notes: "Do not invent refunds"
  }, {});
  assert.equal(updated.ok, true);
  assert.equal(stored.currentJob, "Fix tax_behavior on the three Stripe prices");
  const read = await registry.execute("desktop_read_scratchpad", {}, {});
  assert.equal(read.scratchpad.notes, "Do not invent refunds");
});
