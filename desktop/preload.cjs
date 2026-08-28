const { contextBridge, ipcRenderer, webUtils } = require("electron");

const eventChannels = new Set([
  "agent:event",
  "agent:status",
  "desktop-runs:changed",
  "approval:requested",
  "approval:completed",
  "approval:denied",
  "activity:changed",
  "canvas:changed",
  "automation-setup:requested",
  "offline:changed",
  "offline-proposals:changed",
  "task-checkpoints:changed",
  "remote:changed",
  "auth:browser",
  "desktop:navigate",
  "update:changed"
]);

contextBridge.exposeInMainWorld("amosDesktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  saveSettings: (settings) => ipcRenderer.invoke("desktop:save-settings", settings),
  configureBedrockDataRetention: (input) =>
    ipcRenderer.invoke("desktop:configure-bedrock-data-retention", input),
  setTelemetryPreference: (input) =>
    ipcRenderer.invoke("desktop:set-telemetry-preference", input),
  completeOnboarding: (input) =>
    ipcRenderer.invoke("desktop:complete-onboarding", input),
  startPersonal: () => ipcRenderer.invoke("desktop:start-personal"),
  startDemo: () => ipcRenderer.invoke("desktop:start-demo"),
  login: () => ipcRenderer.invoke("desktop:login"),
  addAccount: () => ipcRenderer.invoke("desktop:add-account"),
  switchAccount: (accountId) => ipcRenderer.invoke("desktop:switch-account", accountId),
  logout: () => ipcRenderer.invoke("desktop:logout"),
  refreshRemote: () => ipcRenderer.invoke("desktop:refresh-remote"),
  switchCompany: (tenantId) => ipcRenderer.invoke("desktop:switch-company", tenantId),
  connectProvider: (provider) => ipcRenderer.invoke("desktop:connect-provider", provider),
  disconnectConnection: (connectionId) =>
    ipcRenderer.invoke("desktop:disconnect-connection", connectionId),
  connectSecretProvider: (provider, input) =>
    ipcRenderer.invoke("desktop:connect-secret-provider", { provider, input }),
  openApproval: (id) => ipcRenderer.invoke("desktop:open-approval", id),
  openMissionDecision: (id) => ipcRenderer.invoke("desktop:open-mission-decision", id),
  answerMissionDecision: (id, answer) =>
    ipcRenderer.invoke("desktop:answer-mission-decision", { id, answer }),
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
  activateLocalModel: (id, operatingMode, localRuntime = "auto") =>
    ipcRenderer.invoke("desktop:activate-local-model", { id, operatingMode, localRuntime }),
  run: (input) => ipcRenderer.invoke("desktop:run", input),
  steerTask: (id, content) =>
    ipcRenderer.invoke("desktop:steer-task", { id, content }),
  cancelTask: (id) => ipcRenderer.invoke("desktop:cancel-task", id),
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
  revokeAutomationGrant: (grantId, reason) =>
    ipcRenderer.invoke("desktop:revoke-automation-grant", { grantId, reason }),
  simulateAutomation: (automationId, sampleTrigger) =>
    ipcRenderer.invoke("desktop:simulate-automation", { automationId, sampleTrigger }),
  repairAutomationFailure: (incidentId, resolution) =>
    ipcRenderer.invoke("desktop:repair-automation-failure", { incidentId, resolution }),
  beginAutomationSetup: (input) =>
    ipcRenderer.invoke("desktop:begin-automation-setup", input),
  automationOperations: (connection) =>
    ipcRenderer.invoke("desktop:automation-operations", connection),
  installAutomationSetup: (input) =>
    ipcRenderer.invoke("desktop:install-automation-setup", input),
  activateAutomationSetup: (setupId) =>
    ipcRenderer.invoke("desktop:activate-automation-setup", setupId),
  dismissAutomationSetup: (setupId) =>
    ipcRenderer.invoke("desktop:dismiss-automation-setup", setupId),
  removeBrowserRecipe: (id) =>
    ipcRenderer.invoke("desktop:remove-browser-recipe", id),
  startNewConversation: (input) =>
    ipcRenderer.invoke("desktop:start-new-conversation", input),
  startAutonomousGoal: (input) =>
    ipcRenderer.invoke("desktop:start-autonomous-goal", input),
  openTask: (id) => ipcRenderer.invoke("desktop:open-task", id),
  updateTask: (id, changes) => ipcRenderer.invoke("desktop:update-task", { id, changes }),
  forkTask: (input) => ipcRenderer.invoke("desktop:fork-task", input),
  switchIntelligenceRole: (input) =>
    ipcRenderer.invoke("desktop:switch-intelligence-role", input),
  confirmConsultativeAssertion: (input) =>
    ipcRenderer.invoke("desktop:confirm-consultative-assertion", input),
  correctConsultativeAssertion: (input) =>
    ipcRenderer.invoke("desktop:correct-consultative-assertion", input),
  proposeConsultativeUpdate: (input) =>
    ipcRenderer.invoke("desktop:propose-consultative-update", input),
  rejectConsultativeAssertion: (input) =>
    ipcRenderer.invoke("desktop:reject-consultative-assertion", input),
  reopenConsultativeAssertion: (input) =>
    ipcRenderer.invoke("desktop:reopen-consultative-assertion", input),
  setRelationshipPreference: (input) =>
    ipcRenderer.invoke("desktop:set-relationship-preference", input),
  clearRelationshipPreference: (input) =>
    ipcRenderer.invoke("desktop:clear-relationship-preference", input),
  resetRelationshipProfile: (input) =>
    ipcRenderer.invoke("desktop:reset-relationship-profile", input),
  createProject: (input) => ipcRenderer.invoke("desktop:create-project", input),
  updateProject: (id, changes) =>
    ipcRenderer.invoke("desktop:update-project", { id, changes }),
  assignTaskProject: (taskId, projectId) =>
    ipcRenderer.invoke("desktop:assign-task-project", { taskId, projectId }),
  cancelSupervisedRun: (runId, reason) =>
    ipcRenderer.invoke("desktop:cancel-supervised-run", { runId, reason }),
  refreshProjects: () => ipcRenderer.invoke("desktop:refresh-projects"),
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
  exportEvidencePack: () => ipcRenderer.invoke("desktop:export-evidence-pack"),
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
  allowTaskLocalWork: () => ipcRenderer.invoke("desktop:allow-task-local-work"),
  clearTaskLocalWork: () => ipcRenderer.invoke("desktop:clear-task-local-work"),
  openApprovals: () => ipcRenderer.invoke("desktop:open-approvals"),
  openDocumentArtifact: (path, mode = "open") =>
    ipcRenderer.invoke("desktop:open-document-artifact", { path, mode }),
  copyText: (value) => ipcRenderer.invoke("desktop:copy-text", value),
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
  resolveDecisionInput: (id, input) =>
    ipcRenderer.invoke("desktop:resolve-decision-input", { id, ...(input || {}) }),
  on(channel, callback) {
    if (!eventChannels.has(channel)) throw new Error(`Unsupported AMOS Desktop event: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
