const DEFAULT_INITIAL_DELAY_MS = 15_000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

function normalizedVersion(info) {
  const value = info?.version;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "The update service returned an unknown error");
}

export class DesktopUpdateManager {
  constructor({
    updater,
    currentVersion,
    enabled,
    emit = () => {},
    notify = () => {},
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  }) {
    this.updater = updater;
    this.emit = emit;
    this.notify = notify;
    this.enabled = Boolean(enabled && updater);
    this.initialDelayMs = initialDelayMs;
    this.checkIntervalMs = checkIntervalMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.initialTimer = null;
    this.intervalTimer = null;
    this.started = false;
    this.lastNotifiedVersion = null;
    this.listeners = [];
    this.snapshot = {
      status: this.enabled ? "idle" : "unavailable",
      currentVersion,
      availableVersion: null,
      progress: null,
      message: this.enabled
        ? "AMOS Desktop checks for signed updates automatically."
        : "Automatic updates are available in signed AMOS Desktop builds."
    };
  }

  state() {
    return { ...this.snapshot };
  }

  start() {
    if (this.started || !this.enabled) {
      this.publish(this.snapshot);
      return this.state();
    }
    this.started = true;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.bind("checking-for-update", () => {
      this.publish({
        status: "checking",
        progress: null,
        message: "Checking for a signed AMOS Desktop update…"
      });
    });
    this.bind("update-available", (info) => {
      const version = normalizedVersion(info);
      this.publish({
        status: "available",
        availableVersion: version,
        progress: null,
        message: version
          ? `AMOS Desktop ${version} is ready to download.`
          : "A signed AMOS Desktop update is ready to download."
      });
      if (version !== this.lastNotifiedVersion) {
        this.lastNotifiedVersion = version;
        this.notify({
          stage: "available",
          title: "AMOS Desktop update available",
          body: version
            ? `Version ${version} is ready. Open AMOS Desktop to download it.`
            : "A new signed version is ready. Open AMOS Desktop to download it."
        });
      }
    });
    this.bind("update-not-available", () => {
      this.publish({
        status: "current",
        availableVersion: null,
        progress: null,
        message: "AMOS Desktop is up to date."
      });
    });
    this.bind("download-progress", (progress) => {
      const percent = Number.isFinite(progress?.percent)
        ? Math.max(0, Math.min(100, Math.round(progress.percent)))
        : null;
      this.publish({
        status: "downloading",
        progress: percent,
        message: percent === null
          ? "Downloading the signed update…"
          : `Downloading the signed update… ${percent}%`
      });
    });
    this.bind("update-downloaded", (info) => {
      const version = normalizedVersion(info) || this.snapshot.availableVersion;
      this.publish({
        status: "downloaded",
        availableVersion: version,
        progress: 100,
        message: version
          ? `AMOS Desktop ${version} is ready to install.`
          : "The AMOS Desktop update is ready to install."
      });
      this.notify({
        stage: "downloaded",
        title: "AMOS Desktop is ready to update",
        body: "Open AMOS Desktop and choose Restart and install."
      });
    });
    this.bind("error", (error) => {
      this.publish({
        status: "error",
        progress: null,
        message: `Update check failed: ${errorMessage(error)}`
      });
    });

    this.initialTimer = this.setTimeoutFn(() => {
      this.check().catch(() => {});
    }, this.initialDelayMs);
    this.initialTimer?.unref?.();
    this.intervalTimer = this.setIntervalFn(() => {
      this.check().catch(() => {});
    }, this.checkIntervalMs);
    this.intervalTimer?.unref?.();
    this.publish(this.snapshot);
    return this.state();
  }

  async check() {
    this.assertEnabled();
    if (["checking", "downloading", "downloaded"].includes(this.snapshot.status)) {
      return this.state();
    }
    this.publish({
      status: "checking",
      progress: null,
      message: "Checking for a signed AMOS Desktop update…"
    });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.publish({
        status: "error",
        progress: null,
        message: `Update check failed: ${errorMessage(error)}`
      });
      throw error;
    }
    return this.state();
  }

  async download() {
    this.assertEnabled();
    if (this.snapshot.status === "downloaded") return this.state();
    if (this.snapshot.status !== "available") {
      throw new Error("No AMOS Desktop update is ready to download");
    }
    this.publish({
      status: "downloading",
      progress: 0,
      message: "Downloading the signed update… 0%"
    });
    await this.updater.downloadUpdate();
    return this.state();
  }

  install() {
    this.assertEnabled();
    if (this.snapshot.status !== "downloaded") {
      throw new Error("Download the AMOS Desktop update before installing it");
    }
    this.updater.quitAndInstall(false, true);
  }

  stop() {
    if (this.initialTimer) this.clearTimeoutFn(this.initialTimer);
    if (this.intervalTimer) this.clearIntervalFn(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
    for (const [event, listener] of this.listeners) {
      this.updater?.removeListener?.(event, listener);
    }
    this.listeners = [];
    this.started = false;
  }

  bind(event, listener) {
    this.updater.on(event, listener);
    this.listeners.push([event, listener]);
  }

  publish(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit(this.state());
  }

  assertEnabled() {
    if (!this.enabled) {
      throw new Error("Automatic updates are available only in signed AMOS Desktop builds");
    }
  }
}
