import test from "node:test";
import assert from "node:assert/strict";
import { shouldSubmitPrompt } from "../src/desktop/input.js";

test("Enter submits the desktop prompt", () => {
  assert.equal(shouldSubmitPrompt({ key: "Enter", shiftKey: false, isComposing: false }), true);
});

test("Shift+Enter inserts a newline and IME composition does not submit", () => {
  assert.equal(shouldSubmitPrompt({ key: "Enter", shiftKey: true, isComposing: false }), false);
  assert.equal(shouldSubmitPrompt({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(shouldSubmitPrompt({ key: "a", shiftKey: false, isComposing: false }), false);
});
