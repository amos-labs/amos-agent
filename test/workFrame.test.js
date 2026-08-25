import assert from "node:assert/strict";
import test from "node:test";

import {
  compileWorkFrame,
  isAmbiguousFollowUp,
  workFramePrompt,
  workflowSelectionText
} from "../src/desktop/workFrame.js";
import { resolveTaskWorkflow, selectTaskWorkflow } from "../src/workflows.js";

test("a circling follow-up stays on the conversation's PR instead of the generic route", () => {
  const frame = compileWorkFrame({
    task: {
      title: "hello",
      objective: "hello",
      outcome: {
        summary: "PR is open: **https://github.com/amos-labs/amos-managed-platform/pull/637**"
      },
      workspace: {
        localPath: "/Users/rick/ai_co",
        focusPath: ""
      }
    },
    settings: { workspace: "/Users/rick/ai_co" },
    checkpoint: {
      title: "ok.... 637 is still in reowork...we need to fix that and then we can move to slice two",
      objective: "ok.... 637 is still in reowork...we need to fix that and then we can move to slice two"
    },
    prompt: "ok...it seems like we are goign in circles here?"
  });

  assert.equal(frame.family, "coding");
  assert.equal(frame.pullRequest, "https://github.com/amos-labs/amos-managed-platform/pull/637");
  assert.equal(frame.bound, false);
  assert.equal(isAmbiguousFollowUp(frame.prompt), true);

  const text = workflowSelectionText(frame, frame.prompt);
  assert.match(text, /pull\/637/);
  assert.match(text, /circles/);
  assert.equal(selectTaskWorkflow({ objective: frame.prompt }).id, "outcome-execution");
  assert.equal(
    resolveTaskWorkflow({ objective: text, workFrame: frame }).id,
    "github-issue-diagnosis"
  );

  const prompt = workFramePrompt(frame);
  assert.match(prompt, /Bound project: none/);
  assert.match(prompt, /desktop_request_decision before searching/);
  assert.match(prompt, /pull\/637/);
});

test("a bound nested repo is trusted current work, not a grant-wide search", () => {
  const frame = compileWorkFrame({
    task: {
      title: "Fix slice 1",
      workspace: {
        localPath: "/Users/rick/ai_co",
        focusPath: "/Users/rick/ai_co/amos-platform"
      }
    },
    settings: { workspace: "/Users/rick/ai_co" },
    prompt: "keep going"
  });
  assert.equal(frame.bound, true);
  assert.match(workFramePrompt(frame), /Bound project: \/Users\/rick\/ai_co\/amos-platform/);
  assert.equal(isAmbiguousFollowUp("keep going"), true);
  assert.equal(isAmbiguousFollowUp("look at our MRR and expenses"), false);
});

test("a clearly new request does not inherit the previous coding frame into the selector text", () => {
  const frame = compileWorkFrame({
    task: {
      outcome: { summary: "https://github.com/amos-labs/amos-managed-platform/pull/637" }
    },
    prompt: "compile a list of 50 leads we can then send an email campaign to"
  });
  assert.equal(
    workflowSelectionText(frame, "compile a list of 50 leads we can then send an email campaign to"),
    "compile a list of 50 leads we can then send an email campaign to"
  );
});
