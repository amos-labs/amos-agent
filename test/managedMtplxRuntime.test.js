import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  AMOS_MTPLX_CONTEXT_LENGTH,
  AMOS_MTPLX_HOST,
  ManagedMtplxRuntime
} from "../src/desktop/managedMtplxRuntime.js";
import {
  MTPLX_QWEN38_MODEL_ID,
  MTPLX_QWEN38_QUALIFICATION,
  MTPLX_RUNTIME_RELEASE,
  MTPLX_SERVED_MODEL_ID,
  mtplxArtifactDirectoryName,
  mtplxModelProfile
} from "../src/desktop/mtplxRuntimeManifest.js";

test("MTPLX manifest chooses the chipset-specific optimized Qwen artifact", () => {
  assert.equal(MTPLX_RUNTIME_RELEASE.version, "2.8.3");
  assert.equal(MTPLX_RUNTIME_RELEASE.license, "Apache-2.0");
  assert.equal(MTPLX_QWEN38_QUALIFICATION.score, 35);
  assert.equal(MTPLX_QWEN38_QUALIFICATION.repetitions, 3);
  assert.match(
    mtplxModelProfile({ platform: "darwin", arch: "arm64", cpuModel: "Apple M1 Max" }).repository,
    /FP16$/
  );
  assert.doesNotMatch(
    mtplxModelProfile({ platform: "darwin", arch: "arm64", cpuModel: "Apple M5 Max" }).repository,
    /FP16$/
  );
  assert.equal(mtplxModelProfile({ platform: "win32", arch: "arm64" }), null);
  assert.equal(
    mtplxArtifactDirectoryName("Youssofal/Qwen3.8-27B-MTPLX-Optimized-Speed-FP16"),
    "Youssofal--Qwen3.8-27B-MTPLX-Optimized-Speed-FP16"
  );
});

test("MTPLX launches a private native-MTP server with persistent session caching", async () => {
  const calls = [];
  const directories = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("exit", 0, "SIGTERM");
  const runtime = new ManagedMtplxRuntime({
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M1 Max",
    resourcesPath: "/resources",
    userDataPath: "/user-data",
    homePath: "/Users/test",
    binaryPath: "/runtime/bin/mtplx",
    modelPath: "/models/qwen38-mtplx",
    totalMemoryBytes: 64 * 1024 ** 3,
    existsImpl: (path) => ["/runtime/bin/mtplx", "/models/qwen38-mtplx"].includes(path),
    mkdirImpl: async (path) => directories.push(path),
    spawnImpl: (binary, args, options) => {
      calls.push({ binary, args, options });
      return child;
    },
    versionCheckImpl: async () => "2.8.3",
    fetchImpl: async () => new Response(JSON.stringify({
      object: "list",
      data: [{ id: MTPLX_SERVED_MODEL_ID }]
    }), { headers: { "content-type": "application/json" } }),
    sleepImpl: async () => {}
  });

  const ready = await runtime.start(MTPLX_QWEN38_MODEL_ID);
  assert.equal(ready.status, "ready");
  assert.equal(ready.available, true);
  assert.equal(ready.contextLength, AMOS_MTPLX_CONTEXT_LENGTH);
  assert.equal(ready.qualification.status, "qualified");
  assert.equal(ready.qualification.averageTokensPerSecond, 9.009);
  assert.equal(runtime.baseUrl, `http://${AMOS_MTPLX_HOST}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].binary, "/runtime/bin/mtplx");
  assert.equal(calls[0].options.stdio[0], "ignore");
  assert.deepEqual(directories.sort(), [
    "/user-data/local-intelligence/mtplx/cache",
    "/user-data/local-intelligence/mtplx/sessions"
  ]);
  const args = calls[0].args;
  assert.equal(args[0], "quickstart");
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), [
    "--model",
    "/models/qwen38-mtplx"
  ]);
  assert.deepEqual(args.slice(args.indexOf("--model-id"), args.indexOf("--model-id") + 2), [
    "--model-id",
    MTPLX_SERVED_MODEL_ID
  ]);
  assert.ok(args.includes("--mtp"));
  assert.ok(args.includes("--no-stats-footer"));
  assert.equal(args[args.indexOf("--profile") + 1], "turbo");
  assert.equal(args[args.indexOf("--depth") + 1], "2");
  assert.equal(args[args.indexOf("--batching-preset") + 1], "solo");
  assert.equal(args[args.indexOf("--ssd-session-cache") + 1], "on");
  assert.equal(args[args.indexOf("--paged-kv-quantization") + 1], "off");

  const sleeping = await runtime.suspend();
  assert.equal(sleeping.status, "sleeping");
  assert.equal(runtime.state().persistentSessionCache, true);
});

test("MTPLX fails closed when runtime, artifact, memory, or platform requirements are absent", async () => {
  const runtime = new ManagedMtplxRuntime({
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M1 Max",
    resourcesPath: "/resources",
    userDataPath: "/user-data",
    homePath: "/Users/test",
    totalMemoryBytes: 16 * 1024 ** 3,
    existsImpl: () => false
  });
  const state = runtime.state();
  assert.equal(state.available, false);
  assert.equal(state.memoryEligible, false);
  assert.match(state.error, /Install MTPLX/);
  await assert.rejects(() => runtime.start(MTPLX_QWEN38_MODEL_ID), /Install MTPLX/);
  await assert.rejects(() => runtime.start("qwen3:8b"), /only accelerates/);
});

test("MTPLX loopback endpoint cannot be widened to the network", () => {
  const input = { resourcesPath: "/resources", userDataPath: "/user-data" };
  assert.throws(
    () => new ManagedMtplxRuntime({ ...input, host: "0.0.0.0:18081" }),
    /explicit IPv4 loopback/
  );
  assert.throws(
    () => new ManagedMtplxRuntime({ ...input, host: "127.0.0.1:80" }),
    /non-privileged/
  );
});

test("sleep cancels an in-flight startup so resume can create a fresh runtime", async () => {
  let releaseRetry;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("exit", 0, "SIGTERM");
  const runtime = new ManagedMtplxRuntime({
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M1 Max",
    resourcesPath: "/resources",
    userDataPath: "/user-data",
    binaryPath: "/runtime/bin/mtplx",
    modelPath: "/models/qwen38-mtplx",
    totalMemoryBytes: 64 * 1024 ** 3,
    existsImpl: () => true,
    mkdirImpl: async () => {},
    spawnImpl: () => child,
    versionCheckImpl: async () => "2.8.3",
    fetchImpl: async () => { throw new Error("still loading"); },
    sleepImpl: () => new Promise((resolveSleep) => { releaseRetry = resolveSleep; })
  });

  const starting = runtime.start(MTPLX_QWEN38_MODEL_ID);
  while (!releaseRetry) await new Promise((resolveWait) => setImmediate(resolveWait));
  await runtime.suspend();
  releaseRetry();

  await assert.rejects(starting, /cancelled for system sleep/);
  assert.equal(runtime.state().status, "sleeping");
  assert.equal(runtime.startPromise, null);
});

test("an MTPLX child failure aborts startup without waiting for the long health timeout", async () => {
  let sleepCalls = 0;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  const runtime = new ManagedMtplxRuntime({
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M1 Max",
    resourcesPath: "/resources",
    userDataPath: "/user-data",
    binaryPath: "/runtime/bin/mtplx",
    modelPath: "/models/qwen38-mtplx",
    totalMemoryBytes: 64 * 1024 ** 3,
    existsImpl: () => true,
    mkdirImpl: async () => {},
    spawnImpl: () => child,
    versionCheckImpl: async () => "2.8.3",
    fetchImpl: async () => {
      child.emit("error", new Error("runtime loader failed"));
      throw new Error("connection refused");
    },
    sleepImpl: async () => { sleepCalls += 1; }
  });

  await assert.rejects(
    () => runtime.start(MTPLX_QWEN38_MODEL_ID),
    /runtime loader failed/
  );
  assert.equal(sleepCalls, 0);
  assert.equal(runtime.state().status, "failed");
});

test("MTPLX refuses an installed runtime version that was not qualified", async () => {
  const runtime = new ManagedMtplxRuntime({
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M1 Max",
    resourcesPath: "/resources",
    userDataPath: "/user-data",
    binaryPath: "/runtime/bin/mtplx",
    modelPath: "/models/qwen38-mtplx",
    totalMemoryBytes: 64 * 1024 ** 3,
    existsImpl: () => true,
    versionCheckImpl: async () => "2.9.0"
  });

  await assert.rejects(
    () => runtime.start(MTPLX_QWEN38_MODEL_ID),
    /requires 2\.8\.3; found 2\.9\.0/
  );
  assert.equal(runtime.state().status, "failed");
  assert.match(runtime.state().error, /requires 2\.8\.3/);
});
