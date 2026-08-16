import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopCompanionServer } from "../src/desktop/companionServer.js";

test("the Desktop companion only answers loopback requests with its token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "amos-companion-"));
  const started = [];
  const server = new DesktopCompanionServer({
    userDataPath: directory,
    controller: {
      companionStatus: async () => ({ workspace: "/tmp/project", provider: "xai" })
    },
    listen(handler) {
      return {
        once() {},
        off() {},
        listen(_port, host, callback) {
          assert.equal(host, "127.0.0.1");
          started.push(handler);
          callback();
        },
        address: () => ({ port: 18765 }),
        close(callback) {
          callback();
        }
      };
    }
  });

  const status = await server.start();
  assert.equal(status.port, 18765);
  const stored = JSON.parse(await readFile(join(directory, "companion.json"), "utf8"));
  assert.equal(stored.schema, "amos.desktop-companion:1");
  assert.equal(stored.port, 18765);
  assert.match(stored.token, /^[a-f0-9]{64}$/);

  const unauthorized = mockResponse();
  await started[0]({ method: "GET", url: "/v1/status", headers: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const authorized = mockResponse();
  await started[0]({
    method: "GET",
    url: "/v1/status",
    headers: { authorization: `Bearer ${stored.token}` }
  }, authorized);
  assert.equal(authorized.statusCode, 200);
  assert.equal(JSON.parse(authorized.body).provider, "xai");
  await server.stop();
});

function mockResponse() {
  return {
    statusCode: 0,
    body: "",
    headersSent: false,
    writeHead(status) {
      this.statusCode = status;
    },
    end(body) {
      this.body = String(body || "");
    }
  };
}
