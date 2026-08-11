const { contextBridge, ipcRenderer, webUtils } = require("electron");

const eventChannels = new Set([
  "agent:event",
  "agent:status",
  "approval:requested",
  "approval:completed",
  "activity:changed",
  "canvas:changed",
  "offline:changed",
  "offline-proposals:changed",
  "task-checkpoints:changed",
  "remote:changed",
  "auth:browser",
  "update:changed"
]);

contextBridge.exposeInMainWorld("amosDesktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  saveSettings: (settings) => ipcRenderer.invoke("desktop:save-settings", settings),
  startPersonal: () => ipcRenderer.invoke("desktop:start-personal"),
  startDemo: () => ipcRenderer.invoke("desktop:start-demo"),
  login: () => ipcRenderer.invoke("desktop:login"),
  addAccount: () => ipcRenderer.invoke("desktop:add-account"),
  switchAccount: (accountId) => ipcRenderer.invoke("desktop:switch-account", accountId),
  logout: () => ipcRenderer.invoke("desktop:logout"),
  refreshRemote: () => ipcRenderer.invoke("desktop:refresh-remote"),
  switchCompany: (tenantId) => ipcRenderer.invoke("desktop:switch-company", tenantId),
  connectProvider: (provider) => ipcRenderer.invoke("desktop:connect-provider", provider),
  connectSecretProvider: (provider, input) =>
    ipcRenderer.invoke("desktop:connect-secret-provider", { provider, input }),
  openApproval: (id) => ipcRenderer.invoke("desktop:open-approval", id),
  reviewApproval: (id) => ipcRenderer.invoke("desktop:review-company-approval", id),
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
  prepareTaskCheckpoint: (id) =>
    ipcRenderer.invoke("desktop:prepare-task-checkpoint", id),
  removeTaskCheckpoint: (id) =>
    ipcRenderer.invoke("desktop:remove-task-checkpoint", id),
  installOfflineModel: (id) => ipcRenderer.invoke("desktop:install-offline-model", id),
  removeOfflineModel: (id) => ipcRenderer.invoke("desktop:remove-offline-model", id),
  activateOfflineModel: (id) => ipcRenderer.invoke("desktop:activate-offline-model", id),
  activateLocalModel: (id, operatingMode) =>
    ipcRenderer.invoke("desktop:activate-local-model", { id, operatingMode }),
  run: (input) => ipcRenderer.invoke("desktop:run", input),
  steerTask: (id, content) =>
    ipcRenderer.invoke("desktop:steer-task", { id, content }),
  cancelTask: (id) => ipcRenderer.invoke("desktop:cancel-task", id),
  clear: () => ipcRenderer.invoke("desktop:clear"),
  removeCanvas: (id) => ipcRenderer.invoke("desktop:remove-canvas", id),
  saveCanvasView: (id) => ipcRenderer.invoke("desktop:save-canvas-view", id),
  runBriefing: (input) => ipcRenderer.invoke("desktop:run-briefing", input),
  openBriefingRun: (runId) => ipcRenderer.invoke("desktop:open-briefing-run", runId),
  scheduleCanvasView: (id, cadence) =>
    ipcRenderer.invoke("desktop:schedule-canvas-view", { id, cadence }),
  setBriefingScheduleStatus: (scheduleId, active) =>
    ipcRenderer.invoke("desktop:set-briefing-schedule-status", { scheduleId, active }),
  setAutomationStatus: (name, active) =>
    ipcRenderer.invoke("desktop:set-automation-status", { name, active }),
  startNewConversation: (input) =>
    ipcRenderer.invoke("desktop:start-new-conversation", input),
  openTask: (id) => ipcRenderer.invoke("desktop:open-task", id),
  updateTask: (id, changes) => ipcRenderer.invoke("desktop:update-task", { id, changes }),
  forkTask: (input) => ipcRenderer.invoke("desktop:fork-task", input),
  removeSavedView: (id) => ipcRenderer.invoke("desktop:remove-saved-view", id),
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
  setLocalApprovalMode: (mode) =>
    ipcRenderer.invoke("desktop:set-local-approval-mode", mode),
  allowLocalApprovalKind: (kind) =>
    ipcRenderer.invoke("desktop:allow-local-approval-kind", kind),
  openApprovals: () => ipcRenderer.invoke("desktop:open-approvals"),
  openDocumentArtifact: (path, mode = "open") =>
    ipcRenderer.invoke("desktop:open-document-artifact", { path, mode }),
  readDocumentPreview: (path) =>
    ipcRenderer.invoke("desktop:read-document-preview", { path }),
  readBrowserFrame: (sessionId, frameId) =>
    ipcRenderer.invoke("desktop:read-browser-frame", { sessionId, frameId }),
  startBrowserTakeover: (sessionId) =>
    ipcRenderer.invoke("desktop:start-browser-takeover", { sessionId }),
  finishBrowserTakeover: (sessionId) =>
    ipcRenderer.invoke("desktop:finish-browser-takeover", { sessionId }),
  saveBrowserDownload: (attachmentId) =>
    ipcRenderer.invoke("desktop:save-browser-download", { attachmentId }),
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
