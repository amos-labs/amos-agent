import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM_PROMPT } from "../src/prompts.js";

test("the company agent grounds capability labels in current platform results", () => {
  assert.match(
    SYSTEM_PROMPT,
    /Never describe data, an engine, a tool, or a feature as connected, enabled, disabled, or locked unless a current platform result explicitly reports that state/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Explain missing evidence or unavailable data in plain language/
  );
});

test("the company agent does not prescribe coaching without user intent or evidence", () => {
  assert.match(
    SYSTEM_PROMPT,
    /Follow the user's objective instead of steering toward a predetermined intervention/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Do not introduce coaching, training, courses, or content unless the user asks for them or cited company evidence makes them relevant/
  );
});

test("the company agent leaves routine workflow narration to Desktop", () => {
  assert.match(SYSTEM_PROMPT, /Desktop already shows the selected workflow/);
  assert.match(SYSTEM_PROMPT, /Do not narrate routine planning/);
});

test("canvas guidance defaults to chat and requires a material visual advantage", () => {
  assert.match(SYSTEM_PROMPT, /Chat is the default/);
  assert.match(SYSTEM_PROMPT, /slightly longer prose does not qualify/);
  assert.match(SYSTEM_PROMPT, /When qualified, use desktop_present_company_view/);
});
