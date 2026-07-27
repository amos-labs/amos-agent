import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { AmosDesktopDemoSession, createDemoCallbackReceiver } from "../src/auth/demo.js";

test("desktop demo stores a bounded short-lived credential without putting it in the URL", async () => {
  let opened;
  let written;
  const receiver = {
    redirectUri: "http://127.0.0.1:43119/desktop/demo/callback",
    result: Promise.resolve({
      api_key: "amos_demo_secret",
      tenant_id: "884b5f08-7042-427b-9433-398acdf565cd",
      expires_at: new Date(Date.now() + 3_600_000).toISOString()
    }),
    close() {}
  };
  const demo = new AmosDesktopDemoSession({
    mcpUrl: "https://app.amoslabs.com/mcp",
    store: { async write(value) { written = value; } },
    openBrowser(url) {
      opened = url;
      return true;
    },
    callbackReceiverFactory: async () => receiver
  });

  const installId = "25deefb7-0e4f-43ad-8b2f-f2f86fac6594";
  const credentials = await demo.start({
    previousWorkspace: "/work/real",
    installId
  });
  const launch = new URL(opened);
  assert.equal(launch.origin, "https://app.amoslabs.com");
  assert.equal(launch.pathname, "/playground/console");
  assert.equal(
    launch.searchParams.get("desktop_callback"),
    "http://127.0.0.1:43119/desktop/demo/callback"
  );
  assert.equal(launch.searchParams.get("desktop_install_id"), installId);
  assert.ok(!opened.includes("amos_demo_secret"));
  assert.equal(credentials.demo, true);
  assert.equal(credentials.previous_workspace, "/work/real");
  assert.deepEqual(written, credentials);
});

test("loopback receiver accepts one matching form post", async () => {
  const state = "expected-state";
  const receiver = await createDemoCallbackReceiver({ state, timeoutMs: 2_000 });
  const body = new URLSearchParams({
    state,
    api_key: "amos_demo_secret",
    tenant_id: "884b5f08-7042-427b-9433-398acdf565cd",
    expires_at: new Date(Date.now() + 3_600_000).toISOString()
  }).toString();
  const url = new URL(receiver.redirectUri);
  await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      }
    );
    request.on("error", reject);
    request.end(body);
  });
  const payload = await receiver.result;
  assert.equal(payload.api_key, "amos_demo_secret");
  assert.equal(payload.tenant_id, "884b5f08-7042-427b-9433-398acdf565cd");
  receiver.close();
});
