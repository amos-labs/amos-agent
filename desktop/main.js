import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { DesktopSettingsStore } from "../src/desktop/settingsStore.js";
import { DesktopController } from "../src/desktop/controller.js";
import { CompanyCacheStore } from "../src/desktop/companyCache.js";
import { OfflineProposalStore } from "../src/desktop/offlineProposal.js";
import { OllamaModelManager } from "../src/desktop/offlineIntelligence.js";
import { ManagedOllamaRuntime } from "../src/desktop/managedOllamaRuntime.js";
import { PrivateMemoryStore } from "../src/desktop/privateMemoryStore.js";
import { TaskCheckpointStore } from "../src/desktop/taskCheckpoint.js";
import { LocalReceiptStore } from "../src/desktop/localReceiptStore.js";
import { DesktopUpdateManager } from "../src/desktop/updateManager.js";
import { DesktopTelemetry } from "../src/desktop/telemetry.js";

const here = dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = electronUpdater;
let window;
let controller;
let offlineManager;
let updateManager;
let tray;
let remoteSyncTimer;
let quitting = false;
let pendingApprovalCount = 0;
let agentRunning = false;
let updateState = {
  status: "unavailable",
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  message: "Automatic updates are available in signed AMOS Desktop builds."
};

function createWindow() {
  const platformWindowOptions = process.platform === "darwin"
    ? {
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 18, y: 18 }
      }
    : {
        icon: join(here, "assets", "amos-app-icon-1024.png")
      };
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: "#0a1020",
    ...platformWindowOptions,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  window.loadFile(join(here, "renderer", "index.html"));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
}

function send(channel, payload) {
  if (channel === "agent:status") {
    agentRunning = Boolean(payload?.running);
    updateTray();
  }
  if (channel === "remote:changed") {
    pendingApprovalCount = Array.isArray(payload?.approvals)
      ? payload.approvals.filter((approval) => approval.status === "pending").length
      : 0;
    updateTray();
  }
  if (channel === "update:changed") {
    updateState = payload;
    updateTray();
  }
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function showWindow() {
  if (!window || window.isDestroyed()) createWindow();
  window.show();
  window.focus();
}

function createTray() {
  const icon = nativeImage
    .createFromPath(join(here, "assets", "amos-mark.png"))
    .resize({ width: 18, height: 18 });
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on("click", showWindow);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const approvalsLabel =
    pendingApprovalCount === 0
      ? "No approvals waiting"
      : `${pendingApprovalCount} approval${pendingApprovalCount === 1 ? "" : "s"} waiting`;
  const updateItem = trayUpdateItem();
  tray.setToolTip(`AMOS Desktop · ${approvalsLabel}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open AMOS Desktop", click: showWindow },
      { type: "separator" },
      { label: approvalsLabel, enabled: pendingApprovalCount > 0, click: () => controller.openApprovals() },
      { label: "Review approvals…", click: () => controller.openApprovals() },
      { type: "separator" },
      updateItem,
      { type: "separator" },
      {
        label: "Quit AMOS Desktop",
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
}

function trayUpdateItem() {
  const version = updateState.availableVersion ? ` ${updateState.availableVersion}` : "";
  if (updateState.status === "available") {
    return {
      label: `Download AMOS Desktop${version}`,
      click: () => updateManager?.download().catch(() => showWindow())
    };
  }
  if (updateState.status === "downloading") {
    const progress = Number.isFinite(updateState.progress) ? ` ${updateState.progress}%` : "";
    return { label: `Downloading update…${progress}`, enabled: false };
  }
  if (updateState.status === "downloaded") {
    return {
      label: `Restart and install AMOS Desktop${version}`,
      enabled: !agentRunning,
      click: () => installUpdate()
    };
  }
  if (updateState.status === "checking") {
    return { label: "Checking for updates…", enabled: false };
  }
  return {
    label: "Check for updates…",
    enabled: Boolean(updateManager),
    click: () => updateManager?.check().catch(() => showWindow())
  };
}

function notifyApproval({ title, body, reviewUrl }) {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title,
    body,
    silent: false
  });
  notification.on("click", async () => {
    await shell.openExternal(reviewUrl);
    showWindow();
  });
  notification.show();
  return true;
}

function notifyUpdate({ title, body }) {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title, body, silent: false });
  notification.on("click", showWindow);
  notification.show();
  return true;
}

function installUpdate() {
  if (agentRunning) {
    showWindow();
    throw new Error("Wait for the current AMOS task to finish before restarting to update");
  }
  quitting = true;
  updateManager?.install();
}

function encrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Operating-system encryption is unavailable; AMOS will not store this provider key");
  }
  return safeStorage.encryptString(value).toString("base64");
}

function decrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

function registerIpc() {
  ipcMain.handle("desktop:state", () => controller.state());
  ipcMain.handle("desktop:save-settings", (_event, settings) => controller.saveSettings(settings));
  ipcMain.handle("desktop:start-personal", () => controller.startPersonal());
  ipcMain.handle("desktop:start-demo", () => controller.startDemo());
  ipcMain.handle("desktop:login", () => controller.login());
  ipcMain.handle("desktop:logout", () => controller.logout());
  ipcMain.handle("desktop:refresh-remote", () => controller.refreshRemote());
  ipcMain.handle("desktop:open-approval", (_event, id) => controller.openApproval(id));
  ipcMain.handle("desktop:test-model", () => controller.testModel());
  ipcMain.handle("desktop:refresh-offline", () => controller.refreshOffline());
  ipcMain.handle("desktop:refresh-company-cache", (_event, ttlSeconds) =>
    controller.refreshCompanyCache(ttlSeconds)
  );
  ipcMain.handle("desktop:remove-company-cache", () => controller.removeCompanyCache());
  ipcMain.handle("desktop:reconcile-offline-proposal", (_event, id) =>
    controller.reconcileOfflineProposal(id)
  );
  ipcMain.handle("desktop:prepare-offline-proposal", (_event, id) =>
    controller.prepareOfflineProposal(id)
  );
  ipcMain.handle("desktop:remove-offline-proposal", (_event, id) =>
    controller.removeOfflineProposal(id)
  );
  ipcMain.handle("desktop:prepare-task-checkpoint", (_event, id) =>
    controller.prepareTaskCheckpoint(id)
  );
  ipcMain.handle("desktop:remove-task-checkpoint", (_event, id) =>
    controller.removeTaskCheckpoint(id)
  );
  ipcMain.handle("desktop:install-offline-model", (_event, id) =>
    controller.installOfflineModel(id)
  );
  ipcMain.handle("desktop:remove-offline-model", (_event, id) =>
    controller.removeOfflineModel(id)
  );
  ipcMain.handle("desktop:activate-offline-model", (_event, id) =>
    controller.activateOfflineModel(id)
  );
  ipcMain.handle("desktop:activate-local-model", (_event, input) =>
    controller.activateLocalModel(input?.id, input?.operatingMode)
  );
  ipcMain.handle("desktop:run", (_event, input) => controller.run(input));
  ipcMain.handle("desktop:steer-task", (_event, input) =>
    controller.steerTask(input?.id, input?.content)
  );
  ipcMain.handle("desktop:cancel-task", (_event, id) => controller.cancelTask(id));
  ipcMain.handle("desktop:clear", () => controller.clear());
  ipcMain.handle("desktop:remove-canvas", (_event, id) => controller.removeCanvas(id));
  ipcMain.handle("desktop:add-attachment-paths", (_event, paths) => controller.addAttachmentPaths(paths));
  ipcMain.handle("desktop:add-pasted-image", (_event, input) => controller.addPastedImage({
    name: input?.name,
    mime: input?.mime,
    bytes: new Uint8Array(input?.bytes || [])
  }));
  ipcMain.handle("desktop:remove-attachment", (_event, id) => controller.removeAttachment(id));
  ipcMain.handle("desktop:use-private-memory", (_event, id) => controller.usePrivateMemory(id));
  ipcMain.handle("desktop:promote-private-memory", (_event, id) => controller.promotePrivateMemory(id));
  ipcMain.handle("desktop:forget-private-memory", (_event, id) => controller.forgetPrivateMemory(id));
  ipcMain.handle("desktop:export-private-memory-capsule", async (_event, input) => {
    const result = await dialog.showSaveDialog(window, {
      title: "Export encrypted AMOS private memory",
      defaultPath: "AMOS-private-memory.amos-memory",
      filters: [{ name: "AMOS encrypted memory", extensions: ["amos-memory"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = result.filePath.endsWith(".amos-memory")
      ? result.filePath
      : `${result.filePath}.amos-memory`;
    const summary = await controller.exportPrivateMemoryCapsule({
      filePath,
      passphrase: input?.passphrase,
      ids: Array.isArray(input?.ids) ? input.ids : null
    });
    return { canceled: false, summary };
  });
  ipcMain.handle("desktop:preview-private-memory-capsule", async (_event, input) => {
    const result = await dialog.showOpenDialog(window, {
      title: "Import encrypted AMOS private memory",
      properties: ["openFile"],
      filters: [{ name: "AMOS encrypted memory", extensions: ["amos-memory"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const preview = await controller.previewPrivateMemoryCapsule({
      filePath: result.filePaths[0],
      passphrase: input?.passphrase
    });
    return { canceled: false, preview };
  });
  ipcMain.handle("desktop:import-private-memory-capsule", (_event, previewId) =>
    controller.importPrivateMemoryCapsule(previewId)
  );
  ipcMain.handle("desktop:cancel-private-memory-capsule", (_event, previewId) =>
    controller.cancelPrivateMemoryCapsulePreview(previewId)
  );
  ipcMain.handle("desktop:choose-attachments", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Attach files to AMOS",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Documents, code, and images",
          extensions: [
            "pdf", "docx", "txt", "md", "csv", "tsv", "json", "yaml", "yml",
            "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "rs", "go",
            "java", "c", "cpp", "h", "swift", "sql", "png", "jpg", "jpeg", "webp", "gif"
          ]
        }
      ]
    });
    if (result.canceled) return controller.state().then((state) => state.attachments);
    return controller.addAttachmentPaths(result.filePaths);
  });
  ipcMain.handle("desktop:resolve-approval", (_event, input) =>
    controller.resolveApproval(input?.id, input?.approved)
  );
  ipcMain.handle("desktop:choose-workspace", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose the folders AMOS may work in",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return controller.state();
    return controller.chooseWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("desktop:open-approvals", () => controller.openApprovals());
  ipcMain.handle("desktop:open-external", async (_event, value) => {
    if (typeof value !== "string" || value.length > 2_048) {
      throw new Error("AMOS blocked an invalid external link");
    }
    const url = new URL(value);
    if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
      throw new Error("AMOS blocked an unsupported external link");
    }
    await shell.openExternal(url.href);
  });
  ipcMain.handle("desktop:update-state", () => updateManager?.state() || updateState);
  ipcMain.handle("desktop:check-for-updates", () => updateManager?.check());
  ipcMain.handle("desktop:download-update", () => updateManager?.download());
  ipcMain.handle("desktop:install-update", () => installUpdate());
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => showWindow());

if (process.platform === "win32") {
  app.setAppUserModelId("com.amoslabs.desktop");
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  const settingsStore = new DesktopSettingsStore({
    filePath: join(app.getPath("userData"), "settings.json"),
    encrypt,
    decrypt
  });
  const privateMemoryStore = new PrivateMemoryStore({
    filePath: join(app.getPath("userData"), "private-memory.json"),
    encrypt,
    decrypt
  });
  const companyCacheStore = new CompanyCacheStore({
    filePath: join(app.getPath("userData"), "company-cache.json"),
    encrypt,
    decrypt
  });
  const offlineProposalStore = new OfflineProposalStore({
    filePath: join(app.getPath("userData"), "offline-proposals.json"),
    encrypt,
    decrypt
  });
  const taskCheckpointStore = new TaskCheckpointStore({
    filePath: join(app.getPath("userData"), "task-checkpoints.json"),
    encrypt,
    decrypt
  });
  const localReceiptStore = new LocalReceiptStore({
    filePath: join(app.getPath("userData"), "local-receipts.json"),
    encrypt,
    decrypt
  });
  const managedOllamaRuntime = new ManagedOllamaRuntime({
    platform: process.platform,
    arch: process.arch,
    resourcesPath: app.isPackaged ? process.resourcesPath : join(here, "vendor"),
    userDataPath: app.getPath("userData")
  });
  offlineManager = new OllamaModelManager({
    runtimeManager: managedOllamaRuntime,
    emit: (payload) => send("offline:changed", payload)
  });
  const telemetry = new DesktopTelemetry({
    filePath: join(app.getPath("userData"), "desktop-telemetry.json"),
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch
  });
  const initialSettings = await settingsStore.read();
  await telemetry.initialize({ mcpUrl: initialSettings.amosMcpUrl }).catch(() => {});
  controller = new DesktopController({
    userDataPath: app.getPath("userData"),
    settingsStore,
    privateMemoryStore,
    companyCacheStore,
    offlineProposalStore,
    taskCheckpointStore,
    localReceiptStore,
    offlineManager,
    telemetry,
    openBrowser: (url) => shell.openExternal(url),
    emit: send,
    notify: notifyApproval
  });
  await controller.initializeTaskCheckpoints().catch(() => {});
  registerIpc();
  createWindow();
  createTray();
  updateManager = new DesktopUpdateManager({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    enabled: app.isPackaged && app.getName() === "AMOS Desktop",
    emit: (payload) => send("update:changed", payload),
    notify: notifyUpdate
  });
  updateState = updateManager.state();
  updateManager.start();
  controller.refreshOffline().catch(() => {});
  controller.refreshRemote().catch(() => {});
  remoteSyncTimer = setInterval(() => controller.refreshRemote().catch(() => {}), 30_000);
  remoteSyncTimer.unref?.();

  app.on("activate", () => {
    showWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep the tray process alive so AMOS can notify the signed-in user when a
  // governed company decision arrives.
});

app.on("before-quit", () => {
  quitting = true;
  clearInterval(remoteSyncTimer);
  updateManager?.stop();
  controller?.interruptActiveTask().catch(() => {});
  controller?.resetRuntime();
  offlineManager?.shutdown().catch(() => {});
});
