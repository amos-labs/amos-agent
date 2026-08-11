import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalPreviewRuntime } from "../src/desktop/localPreview.js";
import { createLocalPreviewTool } from "../src/tools/localPreview.js";

const scope = {
  boundary: "personal",
  subjectId: "local-user",
  tenantId: "personal",
  taskId: "task-1"
};

test("local preview serves only bounded static workspace content on IPv4 loopback", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "amos-local-preview-"));
  const preview = new LocalPreviewRuntime();
  try {
    await writeFile(join(workspace, "index.html"), "<h1>AMOS preview</h1>", "utf8");
    await writeFile(join(workspace, "secret.txt"), "not served", "utf8");
    const started = await preview.start(scope, { workspace, path: "index.html" });

    assert.match(started.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(await fetch(started.url).then((response) => response.text()), "<h1>AMOS preview</h1>");
    assert.equal(await fetch(`${started.origin}/secret.txt`).then((response) => response.status), 404);
    assert.equal(await preview.close(scope), true);
  } finally {
    preview.closeAll();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("local preview tool opens the exact granted origin and presents it in the canvas", async () => {
  const calls = [];
  const tool = createLocalPreviewTool({
    preview: {
      async start(receivedScope, input) {
        calls.push({ kind: "start", receivedScope, input });
        return {
          origin: "http://127.0.0.1:43119",
          url: "http://127.0.0.1:43119/index.html",
          root: ".",
          entry: "index.html",
          network: "exact loopback origin only"
        };
      },
      async close() {}
    },
    browser: {
      grantLocalPreview(receivedScope, input) {
        calls.push({ kind: "grant", receivedScope, input });
      },
      revokeLocalPreview() {},
      async open(receivedScope, input) {
        calls.push({ kind: "open", receivedScope, input });
        return {
          ok: true,
          status: "ready",
          operation: "open",
          session_id: "browser-session-1",
          url: input.url,
          title: "Dashboard",
          page_revision: 1,
          observed_at: "2026-08-12T00:00:00.000Z",
          text: "Dashboard",
          summary: "Dashboard",
          elements: [],
          frame: { frame_id: "frame-1", width: 1280, height: 800, bytes: 100 }
        };
      }
    },
    scope: () => scope,
    present(input) {
      calls.push({ kind: "present", input });
      return { id: "canvas-1" };
    }
  });

  const result = await tool.handler(
    { path: "index.html" },
    {
      config: { safety: { workspaceRoot: "/tmp/project" } },
      signal: new AbortController().signal
    }
  );

  assert.deepEqual(calls.map((call) => call.kind), ["start", "grant", "open", "present"]);
  assert.equal(calls.at(-1).input.operation, "local_preview");
  assert.equal(result.canvas_id, "canvas-1");
  assert.equal(result.preview.network, "exact loopback origin only");
});
