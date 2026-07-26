const { contextBridge, ipcRenderer, webUtils } = require("electron");

const eventChannels = new Set([
  "agent:event",
  "agent:status",
  "approval:requested",
  "activity:changed",
  "canvas:changed",
  "offline:changed",
  "offline-proposals:changed",
  "remote:changed",
  "auth:browser",
  "update:changed"
]);

contextBridge.exposeInMainWorld("amosDesktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  saveSettings: (settings) => ipcRenderer.invoke("desktop:save-settings", settings),
  login: () => ipcRenderer.invoke("desktop:login"),
  logout: () => ipcRenderer.invoke("desktop:logout"),
  refreshRemote: () => ipcRenderer.invoke("desktop:refresh-remote"),
  openApproval: (id) => ipcRenderer.invoke("desktop:open-approval", id),
  testModel: () => ipcRenderer.invoke("desktop:test-model"),
  refreshOffline: () => ipcRenderer.invoke("desktop:refresh-offline"),
  refreshCompanyCache: (ttlSeconds) =>
    ipcRenderer.invoke("desktop:refresh-company-cache", ttlSeconds),
  removeCompanyCache: () => ipcRenderer.invoke("desktop:remove-company-cache"),
  reconcileOfflineProposal: (id) =>
    ipcRenderer.invoke("desktop:reconcile-offline-proposal", id),
  prepareOfflineProposal: (id) =>
    ipcRenderer.invoke("desktop:prepare-offline-proposal", id),
  removeOfflineProposal: (id) =>
    ipcRenderer.invoke("desktop:remove-offline-proposal", id),
  installOfflineModel: (id) => ipcRenderer.invoke("desktop:install-offline-model", id),
  removeOfflineModel: (id) => ipcRenderer.invoke("desktop:remove-offline-model", id),
  activateOfflineModel: (id) => ipcRenderer.invoke("desktop:activate-offline-model", id),
  run: (input) => ipcRenderer.invoke("desktop:run", input),
  clear: () => ipcRenderer.invoke("desktop:clear"),
  removeCanvas: (id) => ipcRenderer.invoke("desktop:remove-canvas", id),
  chooseAttachments: () => ipcRenderer.invoke("desktop:choose-attachments"),
  addAttachmentPaths: (paths) => ipcRenderer.invoke("desktop:add-attachment-paths", paths),
  addPastedImage: (input) => ipcRenderer.invoke("desktop:add-pasted-image", input),
  removeAttachment: (id) => ipcRenderer.invoke("desktop:remove-attachment", id),
  usePrivateMemory: (id) => ipcRenderer.invoke("desktop:use-private-memory", id),
  promotePrivateMemory: (id) => ipcRenderer.invoke("desktop:promote-private-memory", id),
  forgetPrivateMemory: (id) => ipcRenderer.invoke("desktop:forget-private-memory", id),
  exportPrivateMemoryCapsule: (input) =>
    ipcRenderer.invoke("desktop:export-private-memory-capsule", input),
  previewPrivateMemoryCapsule: (input) =>
    ipcRenderer.invoke("desktop:preview-private-memory-capsule", input),
  importPrivateMemoryCapsule: (previewId) =>
    ipcRenderer.invoke("desktop:import-private-memory-capsule", previewId),
  cancelPrivateMemoryCapsule: (previewId) =>
    ipcRenderer.invoke("desktop:cancel-private-memory-capsule", previewId),
  pathForFile: (file) => webUtils.getPathForFile(file),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  openApprovals: () => ipcRenderer.invoke("desktop:open-approvals"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  updateState: () => ipcRenderer.invoke("desktop:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  resolveApproval: (id, approved) =>
    ipcRenderer.invoke("desktop:resolve-approval", { id, approved }),
  on(channel, callback) {
    if (!eventChannels.has(channel)) throw new Error(`Unsupported AMOS Desktop event: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
