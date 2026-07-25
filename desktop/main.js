import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopSettingsStore } from "../src/desktop/settingsStore.js";
import { DesktopController } from "../src/desktop/controller.js";

const here = dirname(fileURLToPath(import.meta.url));
let window;
let controller;

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: "#0a1020",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
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
}

function send(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function encrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("macOS Keychain encryption is unavailable; AMOS will not store this provider key");
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
  ipcMain.handle("desktop:login", () => controller.login());
  ipcMain.handle("desktop:logout", () => controller.logout());
  ipcMain.handle("desktop:test-model", () => controller.testModel());
  ipcMain.handle("desktop:run", (_event, text) => controller.run(text));
  ipcMain.handle("desktop:clear", () => controller.clear());
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
  ipcMain.handle("desktop:open-approvals", () =>
    shell.openExternal("https://app.amoslabs.com/settings/approvals")
  );
}

app.whenReady().then(() => {
  const settingsStore = new DesktopSettingsStore({
    filePath: join(app.getPath("userData"), "settings.json"),
    encrypt,
    decrypt
  });
  controller = new DesktopController({
    userDataPath: app.getPath("userData"),
    settingsStore,
    openBrowser: (url) => shell.openExternal(url),
    emit: send
  });
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  controller?.resetRuntime();
  if (process.platform !== "darwin") app.quit();
});
