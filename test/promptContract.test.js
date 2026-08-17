import assert from "node:assert/strict";
import test from "node:test";

import {
  AMOS_OPERATOR_CONSTITUTION,
  AMOS_OPERATOR_CONSTITUTION_VERSION,
  DEMO_SYSTEM_PROMPT,
  OFFLINE_SYSTEM_PROMPT,
  PERSONAL_SYSTEM_PROMPT,
  SYSTEM_PROMPT
} from "../src/prompts.js";
import { readFile } from "node:fs/promises";

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

test("the shared AMOS constitution is versioned and used on every boundary", () => {
  assert.equal(AMOS_OPERATOR_CONSTITUTION_VERSION, 1);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /Investigate before interrogating/);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /Ask only consequential questions/);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /desktop_request_decision/);
  assert.match(SYSTEM_PROMPT, /call desktop_request_decision/);
  assert.doesNotMatch(AMOS_OPERATOR_CONSTITUTION, /What kind of business/);
  assert.match(AMOS_OPERATOR_CONSTITUTION, /Do not run a personality survey or a fixed questionnaire/);
  for (const prompt of [
    SYSTEM_PROMPT,
    DEMO_SYSTEM_PROMPT,
    PERSONAL_SYSTEM_PROMPT,
    OFFLINE_SYSTEM_PROMPT
  ]) {
    assert.match(prompt, /AMOS Operator constitution v1/);
    assert.match(prompt, /Investigate before interrogating/);
  }
});

test("automation setup waits for understanding instead of launching immediately", () => {
  assert.doesNotMatch(
    SYSTEM_PROMPT,
    /call desktop_begin_automation_setup once with their exact intent/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Inspect available connections, schemas, and relevant company context before asking for discoverable facts/
  );
  assert.match(
    SYSTEM_PROMPT,
    /Call desktop_begin_automation_setup once when the workflow is ready to design, or immediately when the user's specification is already sufficient/
  );
  assert.match(SYSTEM_PROMPT, /Never collect credentials in chat/);
});

test("consultative doctrine is not a questionnaire, regex router, or second model", async () => {
  const prompts = await readFile(new URL("../src/prompts.js", import.meta.url), "utf8");
  assert.doesNotMatch(prompts, /services · trades · e-commerce/);
  assert.doesNotMatch(prompts, /ask what kind of business they run/i);
  assert.match(prompts, /Do not implement this as a fixed question list/);
  assert.match(prompts, /Explicit collaboration preferences change presentation only/);
  assert.match(prompts, /or a second model call to classify personality or the next move/);
  assert.doesNotMatch(prompts, /from ["'].*workflows\.js["']/);
  assert.doesNotMatch(prompts, /selectWorkflow|phrase\/regex/);
});
