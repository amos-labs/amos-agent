import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { DesktopUpdateManager } from "../src/desktop/updateManager.js";

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCount = 0;
    this.downloadCount = 0;
    this.installArgs = null;
  }

  async checkForUpdates() {
    this.checkCount += 1;
  }

  async downloadUpdate() {
    this.downloadCount += 1;
  }

  quitAndInstall(...args) {
    this.installArgs = args;
  }
}

function managerOptions(overrides = {}) {
  return {
    updater: new FakeUpdater(),
    currentVersion: "0.4.0",
    enabled: true,
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {},
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
    ...overrides
  };
}

test("signed packaged builds check periodically without downloading automatically", () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => {
    updater.checkCount += 1;
    updater.emit("update-not-available", { version: "0.4.0" });
  };
  let initialCheck;
  let periodicCheck;
  const manager = new DesktopUpdateManager(managerOptions({
    updater,
    setTimeoutFn(callback, delay) {
      assert.equal(delay, 15_000);
      initialCheck = callback;
      return { unref() {} };
    },
    setIntervalFn(callback, delay) {
      assert.equal(delay, 6 * 60 * 60 * 1_000);
      periodicCheck = callback;
      return { unref() {} };
    }
  }));

  manager.start();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.autoRunAppAfterInstall, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);

  initialCheck();
  periodicCheck();
  assert.equal(updater.checkCount, 2);
});

test("an available update is announced once and downloaded only after user action", async () => {
  const updater = new FakeUpdater();
  const emitted = [];
  const notifications = [];
  const manager = new DesktopUpdateManager(managerOptions({
    updater,
    emit: (state) => emitted.push(state),
    notify: (notification) => notifications.push(notification)
  }));
  manager.start();

  updater.emit("update-available", { version: "0.4.1" });
  updater.emit("update-available", { version: "0.4.1" });
  assert.equal(manager.state().status, "available");
  assert.equal(manager.state().availableVersion, "0.4.1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].stage, "available");
  assert.equal(updater.downloadCount, 0);

  await manager.download();
  assert.equal(updater.downloadCount, 1);
  assert.equal(manager.state().status, "downloading");
  assert.ok(emitted.some((state) => state.status === "available"));
});

test("download progress ends in an explicit restart-and-install state", () => {
  const updater = new FakeUpdater();
  const notifications = [];
  const manager = new DesktopUpdateManager(managerOptions({
    updater,
    notify: (notification) => notifications.push(notification)
  }));
  manager.start();

  updater.emit("update-available", { version: "0.4.1" });
  updater.emit("download-progress", { percent: 61.7 });
  assert.equal(manager.state().status, "downloading");
  assert.equal(manager.state().progress, 62);

  updater.emit("update-downloaded", { version: "0.4.1" });
  assert.equal(manager.state().status, "downloaded");
  assert.equal(manager.state().progress, 100);
  assert.equal(notifications.at(-1).stage, "downloaded");

  const installing = manager.install();
  assert.deepEqual(updater.installArgs, [false, true]);
  assert.equal(manager.isInstalling(), true);
  assert.equal(installing.status, "installing");
  assert.match(installing.message, /Restarting AMOS Desktop/);
});

test("development builds cannot contact or install from the production release feed", async () => {
  const updater = new FakeUpdater();
  const manager = new DesktopUpdateManager(managerOptions({
    updater,
    enabled: false
  }));
  manager.start();

  assert.equal(manager.state().status, "unavailable");
  await assert.rejects(manager.check(), /signed AMOS Desktop builds/);
  await assert.rejects(manager.download(), /signed AMOS Desktop builds/);
  assert.throws(() => manager.install(), /signed AMOS Desktop builds/);
  assert.equal(updater.checkCount, 0);
});
