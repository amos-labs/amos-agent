import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown, safeExternalUrl } from "../src/desktop/markdown.js";

test("renders the company catch-up response as semantic Markdown blocks", () => {
  const blocks = parseMarkdown(`Hi Rick — you're signed in as owner of **Amos Labs**.

**Active work**
- **Growth goal running:** 5 Meta campaigns at \`$10/day\`.
- Recent work is on [GitHub](https://github.com/amos-labs).

| Signal | Result |
| --- | --- |
| Conversion | 0% |

\`\`\`json
{"status":"measured"}
\`\`\``);

  assert.deepEqual(blocks.map((block) => block.type), [
    "paragraph",
    "paragraph",
    "list",
    "table",
    "code"
  ]);
  assert.equal(blocks[0].children.some((node) => node.type === "strong"), true);
  assert.equal(blocks[2].items[0].some((node) => node.type === "code"), true);
  assert.equal(blocks[2].items[1].some((node) => node.type === "link"), true);
  assert.equal(blocks[3].headers.length, 2);
  assert.equal(blocks[4].language, "json");
});

test("keeps raw HTML inert and rejects unsafe Markdown links", () => {
  const nodes = parseInline(`<script>alert("no")</script> [bad](javascript:alert(1))`);

  assert.equal(nodes.some((node) => node.type === "link"), false);
  assert.match(nodes.map((node) => node.value || "").join(""), /<script>/);
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("file:///tmp/secret"), null);
});

test("allows only normal web and email links", () => {
  assert.equal(safeExternalUrl("https://amoslabs.com"), "https://amoslabs.com/");
  assert.equal(safeExternalUrl("mailto:hello@amoslabs.com"), "mailto:hello@amoslabs.com");
  assert.equal(safeExternalUrl("not a URL"), null);
});
