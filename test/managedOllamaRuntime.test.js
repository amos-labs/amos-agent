import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  AMOS_LOCAL_DEFAULT_CONTEXT_LENGTH,
  AMOS_LOCAL_HOST,
  AMOS_LOCAL_MAX_CONTEXT_LENGTH,
  contextLength,
  ManagedOllamaRuntime
} from "../src/desktop/managedOllamaRuntime.js";
import {
  OLLAMA_RUNTIME_RELEASE,
  ollamaRuntimeAsset
} from "../src/desktop/ollamaRuntimeManifest.js";

test("runtime manifest pins the official release and verified platform assets", () => {
  assert.equal(OLLAMA_RUNTIME_RELEASE.version, "0.32.5");
  assert.equal(OLLAMA_RUNTIME_RELEASE.license, "MIT");
  const mac = ollamaRuntimeAsset("darwin", "arm64");
  assert.equal(mac.archive, "ollama-darwin.tgz");
  assert.match(mac.sha256, /^[a-f0-9]{64}$/);
  assert.equal(mac.binary, "ollama");
  const windows = ollamaRuntimeAsset("win32", "x64");
  assert.equal(windows.binary, "ollama.exe");
  assert.throws(() => ollamaRuntimeAsset("linux", "s390x"), /does not have/);
});

test("AMOS launches the bundled runtime on a private loopback endpoint", async () => {
  const events = [];
  const calls = [];
  const child = new EventEmitter();
  let killed = false;
  child.kill = () => {
    killed = true;
    child.emit("exit", 0, "SIGTERM");
  };
  const runtime = new ManagedOllamaRuntime({
    platform: "darwin",
    arch: "arm64",
    resourcesPath: "/Applications/AMOS Desktop.app/Contents/Resources",
    userDataPath: "/Users/test/Library/Application Support/AMOS Desktop",
    existsImpl: () => true,
    mkdirImpl: async () => {},
    totalMemoryBytes: 16 * 1024 ** 3,
    spawnImpl: (binary, args, options) => {
      calls.push({ binary, args, options });
      return child;
    },
    emit: (state) => events.push(state)
  });

  const starting = await runtime.start();
  assert.equal(starting.installed, true);
  assert.equal(starting.source, "bundled");
  assert.equal(starting.status, "starting");
  assert.equal(runtime.baseUrl, `http://${AMOS_LOCAL_HOST}`);
  assert.equal(runtime.openAiBaseUrl, `http://${AMOS_LOCAL_HOST}/v1`);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["serve"]);
  assert.equal(calls[0].options.env.OLLAMA_HOST, AMOS_LOCAL_HOST);
  assert.equal(
    calls[0].options.env.OLLAMA_MODELS,
    "/Users/test/Library/Application Support/AMOS Desktop/local-intelligence/ollama/models"
  );
  assert.equal(calls[0].options.env.OLLAMA_NO_CLOUD, "1");
  assert.equal(
    calls[0].options.env.OLLAMA_CONTEXT_LENGTH,
    String(AMOS_LOCAL_DEFAULT_CONTEXT_LENGTH)
  );
  assert.equal(
    calls[0].options.env.HOME,
    "/Users/test/Library/Application Support/AMOS Desktop/local-intelligence/ollama/home"
  );
  assert.equal(calls[0].options.windowsHide, true);

  assert.equal(runtime.markReady().status, "ready");
  await runtime.stop();
  assert.equal(killed, true);
  assert.equal(runtime.state().status, "stopped");
  assert.ok(events.some((state) => state.status === "ready"));
});

test("AMOS Local chooses an adaptive context and accepts bounded explicit overrides", async () => {
  const environments = [
    [{ AMOS_LOCAL_CONTEXT_LENGTH: "65536" }, 16, "65536"],
    [{ AMOS_LOCAL_CONTEXT_LENGTH: "262144" }, 64, String(AMOS_LOCAL_MAX_CONTEXT_LENGTH)],
    [{ AMOS_LOCAL_CONTEXT_LENGTH: "not-a-number" }, 64, "131072"],
    [{}, 32, "65536"],
    [{}, 8, "16384"]
  ];

  for (const [environment, memoryGb, expected] of environments) {
    const child = new EventEmitter();
    const calls = [];
    const runtime = new ManagedOllamaRuntime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/resources",
      userDataPath: "/user-data",
      environment,
      totalMemoryBytes: memoryGb * 1024 ** 3,
      existsImpl: () => true,
      mkdirImpl: async () => {},
      spawnImpl: (binary, args, options) => {
        calls.push({ binary, args, options });
        return child;
      }
    });

    await runtime.start();
    assert.equal(calls[0].options.env.OLLAMA_CONTEXT_LENGTH, expected);
    assert.equal(runtime.state().contextLength, Number(expected));
  }
});

test("context selection preserves a safe default while exposing the qualified ceiling", () => {
  assert.equal(contextLength("", 8 * 1024 ** 3), 16_384);
  assert.equal(contextLength("", 16 * 1024 ** 3), AMOS_LOCAL_DEFAULT_CONTEXT_LENGTH);
  assert.equal(contextLength("", 32 * 1024 ** 3), 65_536);
  assert.equal(contextLength("", 64 * 1024 ** 3), 131_072);
  assert.equal(contextLength("262144", 64 * 1024 ** 3), AMOS_LOCAL_MAX_CONTEXT_LENGTH);
  assert.equal(contextLength("262145", 64 * 1024 ** 3), 131_072);
});

test("a missing runtime fails closed without spawning a system command", async () => {
  let spawned = false;
  const runtime = new ManagedOllamaRuntime({
    platform: "darwin",
    arch: "x64",
    resourcesPath: "/missing",
    userDataPath: "/tmp/amos-test",
    existsImpl: () => false,
    spawnImpl: () => {
      spawned = true;
      throw new Error("must not spawn");
    }
  });
  const state = await runtime.start();
  assert.equal(state.installed, false);
  assert.equal(state.status, "missing");
  assert.match(state.error, /missing the AMOS Local runtime/);
  assert.equal(spawned, false);
});

test("runtime host is restricted to explicit non-privileged IPv4 loopback", () => {
  const input = {
    resourcesPath: "/resources",
    userDataPath: "/user-data",
    existsImpl: () => false
  };
  assert.throws(
    () => new ManagedOllamaRuntime({ ...input, host: "0.0.0.0:11435" }),
    /explicit IPv4 loopback/
  );
  assert.throws(
    () => new ManagedOllamaRuntime({ ...input, host: "127.0.0.1:80" }),
    /non-privileged/
  );
});
