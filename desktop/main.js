import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  session,
  shell,
  Tray
} from "electron";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { DesktopSettingsStore } from "../src/desktop/settingsStore.js";
import { DesktopController } from "../src/desktop/controller.js";
import { CompanyCacheStore } from "../src/desktop/companyCache.js";
import { OfflineProposalStore } from "../src/desktop/offlineProposal.js";
import { OllamaModelManager } from "../src/desktop/offlineIntelligence.js";
import { ManagedOllamaRuntime } from "../src/desktop/managedOllamaRuntime.js";
import { ManagedMtplxRuntime } from "../src/desktop/managedMtplxRuntime.js";
import { PrivateMemoryStore } from "../src/desktop/privateMemoryStore.js";
import { TaskCheckpointStore } from "../src/desktop/taskCheckpoint.js";
import { LocalReceiptStore } from "../src/desktop/localReceiptStore.js";
import { SavedViewStore } from "../src/desktop/savedViewStore.js";
import { SessionContinuityStore } from "../src/desktop/sessionContinuity.js";
import { RelationshipProfileStore } from "../src/desktop/relationshipProfileStore.js";
import { DesktopTaskStore } from "../src/desktop/taskStore.js";
import { DecisionKeyStore } from "../src/desktop/decisionKeyStore.js";
import { BrowserRecipeStore } from "../src/desktop/browserRecipeStore.js";
import {
  DesktopUpdateManager,
  shouldEnableDesktopUpdates
} from "../src/desktop/updateManager.js";
import { DesktopTelemetry } from "../src/desktop/telemetry.js";
import { DesktopCompanionServer } from "../src/desktop/companionServer.js";
import { DesktopAccountStore } from "../src/auth/tokenStore.js";
import { DesktopBrowserRuntime } from "./browserRuntime.js";
import { LocalPreviewRuntime } from "../src/desktop/localPreview.js";

const here = dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = electronUpdater;
let window;
let controller;
let settingsStore;
let telemetry;
let companionServer;
let offlineManager;
let browserRuntime;
let localPreviewRuntime;
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

function navigateFromApplicationMenu(destination) {
  showWindow();
  send("desktop:navigate", { destination });
}

function installApplicationMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Intelligence & Settings…",
          accelerator: "CommandOrControl+,",
          click: () => navigateFromApplicationMenu("settings")
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "Choose Intelligence…",
          click: () => navigateFromApplicationMenu("settings")
        },
        {
          label: "Memory & Context…",
          click: () => navigateFromApplicationMenu("memory")
        },
        { type: "separator" },
        {
          label: "Choose Workspace…",
          accelerator: "CommandOrControl+Shift+O",
          click: () => navigateFromApplicationMenu("choose-workspace")
        },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [{ role: "togglefullscreen" }]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: `AMOS Desktop v${app.getVersion()}`,
          enabled: false
        },
        {
          label: "Check for Updates…",
          click: () => navigateFromApplicationMenu("check-updates")
        },
        { type: "separator" },
        {
          label: "AMOS Labs",
          click: () => shell.openExternal("https://www.amoslabs.com")
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
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
  if (updateState.status === "installing") {
    return { label: "Restarting to install update…", enabled: false };
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

function createUpdaterLogger(logPath) {
  mkdirSync(dirname(logPath), { recursive: true });
  const write = (level, value) => {
    const detail = value instanceof Error
      ? value.stack || value.message
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
    try {
      appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${detail}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
    } catch {
      // An update must not break app startup merely because diagnostics cannot
      // be written. The updater will still surface its user-facing state.
    }
  };
  return {
    debug: (value) => write("debug", value),
    info: (value) => write("info", value),
    warn: (value) => write("warn", value),
    error: (value) => write("error", value)
  };
}

function packagedReleaseChannel() {
  try {
    const metadata = JSON.parse(
      readFileSync(join(app.getAppPath(), "package.json"), "utf8")
    );
    return metadata.amosDesktopReleaseChannel || null;
  } catch {
    return null;
  }
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
  ipcMain.handle("desktop:configure-bedrock-data-retention", (_event, input) =>
    controller.configureBedrockDataRetention(input));
  ipcMain.handle("desktop:set-telemetry-preference", async (_event, input) => {
    if (input?.enabled !== true && input?.enabled !== false) {
      throw new Error("Telemetry preference must be true or false");
    }
    const current = await settingsStore.read();
    const saved = await settingsStore.write({
      ...current,
      telemetryEnabled: input.enabled
    });
    await telemetry.applyPreference({
      enabled: saved.telemetryEnabled === true,
      mcpUrl: saved.amosMcpUrl
    }).catch(() => {});
    return { telemetryEnabled: saved.telemetryEnabled };
  });
  ipcMain.handle("desktop:complete-onboarding", (_event, input) =>
    controller.completeOnboarding(input)
  );
  ipcMain.handle("desktop:start-personal", () => controller.startPersonal());
  ipcMain.handle("desktop:start-demo", () => controller.startDemo());
  ipcMain.handle("desktop:login", () => controller.login());
  ipcMain.handle("desktop:add-account", () => controller.addAccount());
  ipcMain.handle("desktop:switch-account", (_event, accountId) =>
    controller.switchAccount(accountId)
  );
  ipcMain.handle("desktop:logout", () => controller.logout());
  ipcMain.handle("desktop:refresh-remote", () => controller.refreshRemote());
  ipcMain.handle("desktop:switch-company", (_event, tenantId) =>
    controller.switchCompany(tenantId)
  );
  ipcMain.handle("desktop:connect-provider", (_event, provider) =>
    controller.connectProvider(provider)
  );
  ipcMain.handle("desktop:disconnect-connection", (_event, connectionId) =>
    controller.disconnectConnection(connectionId)
  );
  ipcMain.handle("desktop:connect-secret-provider", (_event, payload) =>
    controller.connectSecretProvider(payload?.provider, payload?.input)
  );
  ipcMain.handle("desktop:open-approval", (_event, id) => controller.openApproval(id));
  ipcMain.handle("desktop:review-company-approval", async (_event, id) => {
    const review = await controller.reviewCompanyApproval(id);
    if (review.mode !== "desktop") return review;
    const approval = review.approval;
    const result = await dialog.showMessageBox(window, {
      type: "question",
      title: "Governed AMOS approval",
      message: approval.summary,
      detail: [
        `Operation: ${approval.verb}`,
        `Origin: ${String(approval.agencyOrigin).replaceAll("_", " ")}`,
        approval.requestedAt ? `Requested: ${new Date(approval.requestedAt).toLocaleString()}` : "",
        "",
        "Exact request:",
        JSON.stringify(approval.args, null, 2).slice(0, 4_000)
      ].filter((line) => line !== "").join("\n"),
      buttons: ["Approve once", "Deny", "Cancel"],
      defaultId: 2,
      cancelId: 2,
      noLink: true
    });
    if (result.response === 2) return { mode: "desktop", canceled: true };
    const decision = result.response === 0 ? "approve" : "deny";
    return {
      mode: "desktop",
      decision,
      result: await controller.decideCompanyApproval(id, decision)
    };
  });
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
    controller.activateLocalModel(input?.id, input?.operatingMode, input?.localRuntime)
  );
  ipcMain.handle("desktop:run", (_event, input) => controller.run(input));
  ipcMain.handle("desktop:steer-task", (_event, input) =>
    controller.steerTask(input?.id, input?.content)
  );
  ipcMain.handle("desktop:cancel-task", (_event, id) => controller.cancelTask(id));
  ipcMain.handle("desktop:clear", () => controller.clear());
  ipcMain.handle("desktop:remove-canvas", (_event, id) => controller.removeCanvas(id));
  ipcMain.handle("desktop:save-canvas-view", (_event, id) => controller.saveCanvasView(id));
  ipcMain.handle("desktop:run-briefing", (_event, input) => controller.runBriefing(input));
  ipcMain.handle("desktop:open-briefing-run", (_event, runId) => controller.openBriefingRun(runId));
  ipcMain.handle("desktop:schedule-canvas-view", (_event, input) =>
    controller.scheduleCanvasView(input?.id, input?.cadence)
  );
  ipcMain.handle("desktop:set-briefing-schedule-status", (_event, input) =>
    controller.setBriefingScheduleStatus(input?.scheduleId, input?.active === true)
  );
  ipcMain.handle("desktop:set-automation-status", (_event, input) =>
    controller.setAutomationStatus(input?.name, input?.active === true)
  );
  ipcMain.handle("desktop:revoke-automation-grant", (_event, input) =>
    controller.revokeAutomationGrant(input?.grantId, input?.reason)
  );
  ipcMain.handle("desktop:simulate-automation", (_event, input) =>
    controller.simulateAutomation(input?.automationId, input?.sampleTrigger ?? null)
  );
  ipcMain.handle("desktop:repair-automation-failure", (_event, input) =>
    controller.repairAutomationFailure(input?.incidentId, input?.resolution)
  );
  ipcMain.handle("desktop:begin-automation-setup", (_event, input) =>
    controller.beginAutomationSetup(input)
  );
  ipcMain.handle("desktop:automation-operations", (_event, connection) =>
    controller.automationOperations(connection)
  );
  ipcMain.handle("desktop:install-automation-setup", (_event, input) =>
    controller.installAutomationSetup(input)
  );
  ipcMain.handle("desktop:activate-automation-setup", (_event, setupId) =>
    controller.activateAutomationSetup(setupId)
  );
  ipcMain.handle("desktop:dismiss-automation-setup", (_event, setupId) =>
    controller.dismissAutomationSetup(setupId)
  );
  ipcMain.handle("desktop:remove-browser-recipe", (_event, id) =>
    controller.removeBrowserRecipe(id)
  );
  ipcMain.handle("desktop:start-new-conversation", (_event, input) =>
    controller.startNewConversation(input)
  );
  ipcMain.handle("desktop:start-autonomous-goal", (_event, input) =>
    controller.startAutonomousGoal(input)
  );
  ipcMain.handle("desktop:open-task", (_event, id) => controller.openTask(id));
  ipcMain.handle("desktop:update-task", (_event, input) =>
    controller.updateTaskResource(input?.id, input?.changes)
  );
  ipcMain.handle("desktop:fork-task", (_event, input) => controller.forkTaskResource(input));
  ipcMain.handle("desktop:switch-intelligence-role", (_event, input) =>
    controller.switchTaskIntelligence(input)
  );
  ipcMain.handle("desktop:confirm-consultative-assertion", (_event, input) =>
    controller.confirmConsultativeAssertion(input)
  );
  ipcMain.handle("desktop:correct-consultative-assertion", (_event, input) =>
    controller.correctConsultativeAssertion(input)
  );
  ipcMain.handle("desktop:propose-consultative-update", (_event, input) =>
    controller.proposeConsultativeUpdate(input)
  );
  ipcMain.handle("desktop:reject-consultative-assertion", (_event, input) =>
    controller.rejectConsultativeAssertion(input)
  );
  ipcMain.handle("desktop:reopen-consultative-assertion", (_event, input) =>
    controller.reopenConsultativeAssertion(input)
  );
  ipcMain.handle("desktop:set-relationship-preference", (_event, input) =>
    controller.setRelationshipPreference(input)
  );
  ipcMain.handle("desktop:clear-relationship-preference", (_event, input) =>
    controller.clearRelationshipPreference(input)
  );
  ipcMain.handle("desktop:reset-relationship-profile", (_event, input) =>
    controller.resetRelationshipProfile(input)
  );
  ipcMain.handle("desktop:create-project", (_event, input) => controller.createProject(input));
  ipcMain.handle("desktop:update-project", (_event, input) =>
    controller.updateProjectResource(input?.id, input?.changes)
  );
  ipcMain.handle("desktop:assign-task-project", (_event, input) =>
    controller.assignTaskToProject(input?.taskId, input?.projectId || null)
  );
  ipcMain.handle("desktop:cancel-supervised-run", (_event, input) =>
    controller.cancelSupervisedTaskRun(input?.runId, input?.reason)
  );
  ipcMain.handle("desktop:refresh-projects", () => controller.refreshProjects());
  ipcMain.handle("desktop:remove-saved-view", (_event, id) => controller.removeSavedView(id));
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
  ipcMain.handle("desktop:export-evidence-pack", async () => {
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const result = await dialog.showSaveDialog(window, {
      title: "Export receipt evidence pack",
      defaultPath: `amos-evidence-${day}.json`,
      filters: [{ name: "AMOS evidence pack", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = result.filePath.endsWith(".json")
      ? result.filePath
      : `${result.filePath}.json`;
    const summary = await controller.exportEvidencePack({ filePath });
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
          name: "Documents, spreadsheets, code, and images",
          extensions: [
            "pdf", "docx", "xlsx", "txt", "md", "csv", "tsv", "json", "yaml", "yml",
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
  ipcMain.handle("desktop:resolve-decision-input", (_event, input) =>
    controller.resolveDecisionInput(input?.id, {
      answered: input?.answered !== false,
      answer: input?.answer
    })
  );
  ipcMain.handle("desktop:choose-workspace", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose a folder AMOS may work in",
      defaultPath: homedir(),
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return controller.state();
    return controller.chooseWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("desktop:set-local-approval-mode", async (_event, mode) => {
    if (mode === "ask") return controller.setLocalApprovalMode("ask");
    if (mode !== "workspace") throw new Error("Unsupported local approval mode");

    const current = await controller.state();
    const workspace = current.settings.workspace;
    if (!workspace) throw new Error("Choose a project folder before enabling local auto-approve");
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Auto-approve local work",
      message: `Trust ${basename(workspace)} for local work?`,
      detail: [
        `Exact project folder: ${workspace}`,
        "",
        "AMOS will stop asking before local file edits, code patches, and shell commands for tasks in this folder.",
        "File tools remain bounded to this folder. Shell commands start here with a scrubbed environment, but run with your local user permissions and are not OS-sandboxed to the folder.",
        "Changing folders turns this off automatically.",
        "",
        "AMOS company operations, connected-app writes, and governed decisions always keep their separate Platform policy and approval requirements."
      ].join("\n"),
      buttons: ["Turn on for this folder", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return controller.state();
    return controller.setLocalApprovalMode("workspace");
  });
  ipcMain.handle("desktop:allow-local-approval-kind", (_event, kind) =>
    controller.allowLocalApprovalKind(kind)
  );
  ipcMain.handle("desktop:allow-task-local-work", () =>
    controller.allowTaskLocalWork()
  );
  ipcMain.handle("desktop:clear-task-local-work", () =>
    controller.clearTaskLocalWork()
  );
  ipcMain.handle("desktop:open-approvals", () => controller.openApprovals());
  ipcMain.handle("desktop:open-document-artifact", async (_event, input) => {
    const mode = input?.mode || "open";
    if (!["open", "reveal"].includes(mode)) {
      throw new Error("AMOS blocked an unsupported local artifact action");
    }
    const artifactPath = await controller.resolveDocumentArtifactPath(input?.path);
    if (mode === "reveal") {
      shell.showItemInFolder(artifactPath);
      return { ok: true, mode };
    }
    const error = await shell.openPath(artifactPath);
    if (error) throw new Error(`AMOS could not open that local artifact: ${error}`);
    return { ok: true, mode };
  });
  ipcMain.handle("desktop:copy-text", (_event, value) => {
    const copy = String(value || "");
    if (!copy || copy.length > 1_000_000) throw new Error("AMOS blocked invalid copy text");
    clipboard.writeText(copy);
    return { ok: true, characters: copy.length };
  });
  ipcMain.handle("desktop:read-document-preview", async (_event, input) => {
    const previewPath = await controller.resolveDocumentPreviewPath(input?.path);
    return {
      mime: "image/png",
      base64: readFileSync(previewPath).toString("base64")
    };
  });
  ipcMain.handle("desktop:read-browser-frame", (_event, input) =>
    controller.readBrowserFrame(input?.sessionId, input?.frameId)
  );
  ipcMain.handle("desktop:start-browser-takeover", (_event, input) =>
    controller.startBrowserTakeover(input?.sessionId)
  );
  ipcMain.handle("desktop:finish-browser-takeover", (_event, input) =>
    controller.finishBrowserTakeover(input?.sessionId)
  );
  ipcMain.handle("desktop:save-browser-download", async (_event, input) => {
    const artifact = controller.browserDownloadPayload(input?.attachmentId);
    const result = await dialog.showSaveDialog(window, {
      title: "Save verified browser download",
      defaultPath: artifact.name
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, artifact.buffer, { mode: 0o600 });
    return {
      canceled: false,
      name: artifact.name,
      size: artifact.size,
      sha256: artifact.sha256
    };
  });
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
  settingsStore = new DesktopSettingsStore({
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
  const savedViewStore = new SavedViewStore({
    filePath: join(app.getPath("userData"), "saved-views.json"),
    encrypt,
    decrypt
  });
  const sessionContinuityStore = new SessionContinuityStore({
    filePath: join(app.getPath("userData"), "session-continuity.json"),
    encrypt,
    decrypt
  });
  const relationshipProfileStore = new RelationshipProfileStore({
    filePath: join(app.getPath("userData"), "relationship-profile.json"),
    encrypt,
    decrypt
  });
  const taskStore = new DesktopTaskStore({
    filePath: join(app.getPath("userData"), "tasks.json"),
    encrypt,
    decrypt
  });
  const decisionKeyStore = new DecisionKeyStore({
    filePath: join(app.getPath("userData"), "desktop-approval-key.json"),
    encrypt,
    decrypt
  });
  const browserRecipeStore = new BrowserRecipeStore({
    filePath: join(app.getPath("userData"), "browser-recipes.json"),
    encrypt,
    decrypt
  });
  const accountStore = new DesktopAccountStore({
    filePath: join(app.getPath("userData"), "accounts.json"),
    legacyFilePath: join(app.getPath("userData"), "oauth.json"),
    encrypt,
    decrypt
  });
  await accountStore.initialize();
  const localResourcesPath = app.isPackaged ? process.resourcesPath : join(here, "vendor");
  const managedOllamaRuntime = new ManagedOllamaRuntime({
    platform: process.platform,
    arch: process.arch,
    resourcesPath: localResourcesPath,
    userDataPath: app.getPath("userData")
  });
  const managedMtplxRuntime = new ManagedMtplxRuntime({
    platform: process.platform,
    arch: process.arch,
    resourcesPath: localResourcesPath,
    userDataPath: app.getPath("userData")
  });
  offlineManager = new OllamaModelManager({
    runtimeManager: managedOllamaRuntime,
    acceleratorManager: managedMtplxRuntime,
    routerBundlePath: join(localResourcesPath, "router"),
    emit: (payload) => send("offline:changed", payload)
  });
  browserRuntime = new DesktopBrowserRuntime({
    BrowserWindow,
    session,
    transferRoot: join(app.getPath("userData"), "browser-transfers")
  });
  localPreviewRuntime = new LocalPreviewRuntime();
  telemetry = new DesktopTelemetry({
    filePath: join(app.getPath("userData"), "desktop-telemetry.json"),
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch
  });
  const initialSettings = await settingsStore.read();
  await telemetry.initialize({
    mcpUrl: initialSettings.amosMcpUrl,
    telemetryEnabled: initialSettings.telemetryEnabled
  }).catch(() => {});
  controller = new DesktopController({
    userDataPath: app.getPath("userData"),
    settingsStore,
    privateMemoryStore,
    companyCacheStore,
    offlineProposalStore,
    taskCheckpointStore,
    localReceiptStore,
    savedViewStore,
    sessionContinuityStore,
    relationshipProfileStore,
    taskStore,
    decisionKeyStore,
    accountStore,
    offlineManager,
    browserRuntime,
    localPreviewRuntime,
    browserRecipeStore,
    telemetry,
    openBrowser: (url) => shell.openExternal(url),
    emit: send,
    notify: notifyApproval
  });
  await controller.initializeTaskCheckpoints().catch(() => {});
  companionServer = new DesktopCompanionServer({
    userDataPath: app.getPath("userData"),
    controller
  });
  await companionServer.start().catch(() => {});
  registerIpc();
  createWindow();
  installApplicationMenu();
  createTray();
  autoUpdater.logger = createUpdaterLogger(join(app.getPath("logs"), "amos-updater.log"));
  updateManager = new DesktopUpdateManager({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    enabled: shouldEnableDesktopUpdates({
      isPackaged: app.isPackaged,
      releaseChannel: packagedReleaseChannel()
    }),
    emit: (payload) => send("update:changed", payload),
    notify: notifyUpdate
  });
  updateState = updateManager.state();
  updateManager.start();
  controller.refreshOffline().catch(() => {});
  // Warm only the explicitly active local model. This runs off the startup
  // path and uses the managed 30-minute keep-alive, avoiding a multi-gigabyte
  // cold load when the user's first task begins.
  controller.warmLocalIntelligence(initialSettings).catch(() => {});
  controller.refreshRemote().catch(() => {});
  remoteSyncTimer = setInterval(() => controller.refreshRemote().catch(() => {}), 30_000);
  remoteSyncTimer.unref?.();

  app.on("activate", () => {
    showWindow();
  });
  powerMonitor.on("suspend", () => {
    controller?.interruptForSystemSleep();
    offlineManager?.prepareForSystemSleep().catch(() => {});
  });
  powerMonitor.on("resume", () => {
    controller?.refreshRemote().catch(() => {});
    controller?.refreshOffline().catch(() => {});
    controller?.warmLocalIntelligence().catch(() => {});
  });
});

app.on("window-all-closed", () => {
  // Keep the tray process alive so AMOS can notify the signed-in user when a
  // governed company decision arrives.
});

app.on("before-quit", () => {
  quitting = true;
  clearInterval(remoteSyncTimer);
  controller?.interruptActiveTask().catch(() => {});
  companionServer?.stop().catch(() => {});
  controller?.resetRuntime();
  browserRuntime?.closeAll();
  localPreviewRuntime?.closeAll();
  offlineManager?.shutdown().catch(() => {});
});

app.on("will-quit", () => {
  updateManager?.stop();
});
