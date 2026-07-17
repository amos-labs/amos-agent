import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("authentication mode defaults to auto and accepts explicit API-key mode", () => {
  assert.equal(loadConfig({}, ".").auth.mode, "auto");
  assert.equal(loadConfig({ AMOS_AGENT_AUTH_MODE: "api-key" }, ".").auth.mode, "api-key");
  assert.equal(loadConfig({ AMOS_AGENT_AUTH_MODE: "unexpected" }, ".").auth.mode, "auto");
});
