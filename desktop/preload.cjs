const { contextBridge, ipcRenderer, webUtils } = require("electron");

const eventChannels = new Set([
  "agent:event",
  "agent:status",
  "approval:requested",
  "activity:changed",
  "remote:changed",
  "auth:browser"
]);

contextBridge.exposeInMainWorld("amosDesktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  saveSettings: (settings) => ipcRenderer.invoke("desktop:save-settings", settings),
  login: () => ipcRenderer.invoke("desktop:login"),
  logout: () => ipcRenderer.invoke("desktop:logout"),
  refreshRemote: () => ipcRenderer.invoke("desktop:refresh-remote"),
  openApproval: (id) => ipcRenderer.invoke("desktop:open-approval", id),
  testModel: () => ipcRenderer.invoke("desktop:test-model"),
  run: (input) => ipcRenderer.invoke("desktop:run", input),
  clear: () => ipcRenderer.invoke("desktop:clear"),
  chooseAttachments: () => ipcRenderer.invoke("desktop:choose-attachments"),
  addAttachmentPaths: (paths) => ipcRenderer.invoke("desktop:add-attachment-paths", paths),
  addPastedImage: (input) => ipcRenderer.invoke("desktop:add-pasted-image", input),
  removeAttachment: (id) => ipcRenderer.invoke("desktop:remove-attachment", id),
  pathForFile: (file) => webUtils.getPathForFile(file),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  openApprovals: () => ipcRenderer.invoke("desktop:open-approvals"),
  resolveApproval: (id, approved) =>
    ipcRenderer.invoke("desktop:resolve-approval", { id, approved }),
  on(channel, callback) {
    if (!eventChannels.has(channel)) throw new Error(`Unsupported AMOS Desktop event: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
