import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeSignedText,
  signedTextSha256
} from "../src/model/signedText.js";

test("signed text has one deterministic digest across operating-system line endings", () => {
  const lf = "router\nprompt\n";
  const crlf = "router\r\nprompt\r\n";
  const cr = "router\rprompt\r";

  assert.equal(canonicalizeSignedText(crlf), lf);
  assert.equal(canonicalizeSignedText(cr), lf);
  assert.equal(signedTextSha256(crlf), signedTextSha256(lf));
  assert.equal(signedTextSha256(cr), signedTextSha256(lf));
  assert.notEqual(signedTextSha256("router\nchanged\n"), signedTextSha256(lf));
});

test("signed text rejects non-text values", () => {
  assert.throws(() => canonicalizeSignedText(Buffer.from("prompt")), /must be a string/);
});
