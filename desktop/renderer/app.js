import { shouldSubmitPrompt } from "../../src/desktop/input.js";
import { parseMarkdown } from "../../src/desktop/markdown.js";

const api = window.amosDesktop;

const providerDefaults = {
  kimi: {
    model: "kimi-k3",
    baseUrl: "https://api.moonshot.ai/v1",
    credential: "Moonshot API key"
  },
  "amos-hosted": {
    model: "auto",
    baseUrl: "",
    credential: "Uses your AMOS sign-in—no second key. Included credits apply first; additional use is metered."
  },
  bedrock: {
    model: "openai.gpt-5.6-terra",
    baseUrl: "https://bedrock-mantle.us-east-1.api.aws/openai/v1",
    credential: "AWS credential chain or Amazon Bedrock API key",
    authMode: "sigv4"
  },
  openai: {
    model: "gpt-5.6-terra",
    baseUrl: "https://api.openai.com/v1",
    credential: "OpenAI API key"
  },
  anthropic: {
    model: "claude-sonnet-5",
    baseUrl: "https://api.anthropic.com/v1",
    credential: "Anthropic API key"
  },
  ollama: {
    model: "gpt-oss:20b",
    baseUrl: "http://127.0.0.1:11435/v1",
    credential: "No credential required"
  },
  "llama-cpp": {
    model: "local-model",
    baseUrl: "http://127.0.0.1:8080/v1",
    credential: "No credential required"
  },
  "openai-compatible": {
    model: "",
    baseUrl: "",
    credential: "Provider key, when required"
  }
};

let state = null;
let currentView = "operator";
let currentWorkTab = "open";
let selectedProvider = "amos-hosted";
let pendingApproval = null;
let running = false;
let attachments = [];
let dragDepth = 0;
let updateState = null;
let activeCanvasId = null;
let capsuleFlow = null;
let connectionSetupProvider = null;
let currentTaskId = null;
let streamingMessage = null;
let canvasSidecarOpen = false;
let pendingUiActions = [];
let pendingGenericConnectCalls = 0;
let continuityConversationRestored = false;
const transientTaskMessages = new Set();
let resumingCheckpointId = null;
let forkTaskSource = null;
const NAV_COLLAPSED_KEY = "amos.desktop.nav-collapsed.v1";
const CONTEXT_WIDTH_KEY = "amos.desktop.context-width.v1";
const elements = Object.fromEntries(
  [
    "loading", "app", "onboardingView", "operatorView", "workView", "settingsView",
    "memoryView", "tasksView", "canvasView", "connectionsView", "automationsView",
    "connectionDot", "connectionLabel", "connectionDetail", "runtimeBadge", "modeBadge", "workspaceLabel",
    "localApprovalButton", "localApprovalLabel",
    "identityDetail", "identityBadge", "accountMenuButton", "accountMenu", "accountMenuClose",
    "accountList", "addAccountButton", "signOutAccountButton", "accountVersion", "accountUpdateButton",
    "accountMemoryButton", "accountIntelligenceButton",
    "companySwitcherControl", "companySwitcher",
    "decisionBadge", "privateMemoryBadge", "taskBadge", "canvasBadge", "connectionBadge", "automationBadge",
    "operatorEyebrow", "operatorTitle", "readyTitle", "readyDescription",
    "appearanceControl", "appearanceToggle", "appearanceInput",
    "connectButton", "localModeButton", "demoModeButton", "connectCheck",
    "providerCheck", "onboardingProviderText", "workspaceCheck", "enterButton", "boundaryReadinessText",
    "conversation", "conversationHeading", "welcomeMessage", "messages", "promptForm", "promptInput", "runButton", "cancelButton", "clearButton", "liveEvents",
    "newConversationButton", "forkConversationButton",
    "sidebarToggle", "operatorGrid", "activityStream", "activityStreamTitle",
    "canvasSidecar", "contextResizeHandle",
    "attachmentList", "attachButton",
    "runningIndicator", "deploymentSummary", "activityList", "providerCards", "settingsForm",
    "managedProfileField", "advancedInfrastructureDetails",
    "managedConnectionCallout", "managedConnectButton",
    "localSetupField", "localSetupButton", "offlineIntelligenceCard",
    "modelSelectField", "modelInput", "customModelField", "customModelInput",
    "baseUrlInput", "baseUrlHelp", "bedrockAuthField", "bedrockAuthInput",
    "apiKeyInput", "apiKeyHelp", "reasoningInput", "operatingModeInput", "mcpInput",
    "settingsError", "testButton", "systemCard", "approvalModal", "approvalMessage",
    "approveButton", "denyButton", "alwaysApproveButton", "autoApproveFolderButton",
    "approvalScopeNote", "toast", "approvalsButton", "workspaceButton",
    "onboardingWorkspaceButton", "disconnectButton", "refreshDecisionsButton",
    "allApprovalsButton", "decisionSyncStatus", "decisionNotice", "offlineProposalList", "pendingDecisions",
    "recentDecisions", "interruptedTaskList", "updateButton", "privateMemoryList", "privateMemoryEmpty",
    "workDecisionsTab", "workProofTab", "workDecisionTabCount", "workDecisionsPanel", "workProofPanel",
    "memoryClassGrid", "memoryImportButton", "memoryExportButton",
    "workingContinuityCard", "workingContinuityStatus", "workingContinuityDetail",
    "workingContinuityMeta",
    "companyCacheCard", "companyCacheStatus", "companyCacheDetail", "companyCacheMeta",
    "companyCacheRefreshButton", "companyCacheRemoveButton",
    "connectionModal", "connectionForm", "connectionModalTitle", "connectionModalDescription",
    "connectionProviderTagField", "connectionProviderTagInput",
    "connectionBaseUrlField", "connectionBaseUrlInput",
    "connectionAuthSchemeField", "connectionAuthSchemeInput",
    "connectionContextField", "connectionContextLabel", "connectionContextInput",
    "connectionNameInput", "connectionUsernameField", "connectionUsernameLabel",
    "connectionUsernameInput", "connectionCredentialLabel", "connectionCredentialInput",
    "connectionCredentialHelp", "connectionDefaultFromField", "connectionDefaultFromInput",
    "connectionModalError", "connectionCancelButton", "connectionSubmitButton",
    "automationSummary", "automationUnavailable", "automationEmpty", "automationList",
    "refreshAutomationsButton", "buildAutomationButton", "automationEmptyBuildButton",
    "taskSummary", "taskSearchInput", "taskFilterInput", "taskPlatformNotice", "taskEmpty",
    "taskList", "newTaskButton",
    "capsuleModal", "capsulePassphraseForm", "capsuleModalTitle", "capsuleModalMessage",
    "capsulePassphraseInput", "capsuleConfirmField", "capsuleConfirmInput", "capsuleError",
    "capsuleCancelButton", "capsuleContinueButton", "capsulePreview", "capsulePreviewSummary",
    "capsulePreviewItems", "capsulePreviewWarning", "capsulePreviewCancelButton",
    "capsuleImportConfirmButton", "canvasTitle", "canvasSubtitle", "canvasRefreshButton", "canvasSaveButton", "canvasScheduleButton",
    "canvasCloseButton", "canvasSourceBar", "canvasTabs", "canvasEmpty", "canvasEmptyTitle",
    "canvasEmptyMessage", "canvasBlocks", "briefingLibrary", "savedViewList", "briefingTemplateList",
    "canvasStartButton", "scopeNote", "offlineRuntimeStatus", "offlineModelList",
    "offlineRefreshButton", "offlineInstallRuntimeButton", "offlineManifestDigest",
    "offlineSetupSteps", "offlineSetupRuntime", "offlineSetupModel", "offlineSetupActivate",
    "demoBanner", "demoExpiry", "demoConnectButton", "starterActions",
    "connectionCatalogSummary", "connectedSystemList", "availableProviderList", "liveCanvasList",
    "briefingScheduleModal", "briefingScheduleForm", "briefingScheduleTitle",
    "briefingScheduleKind", "briefingScheduleWeekday", "briefingScheduleTime",
    "briefingScheduleInterval", "briefingWeekdayField", "briefingTimeField",
    "briefingIntervalField", "briefingScheduleError", "briefingScheduleCancel",
    "briefingScheduleSubmit",
    "forkTaskModal", "forkTaskForm", "forkTaskTitle", "forkTaskParent",
    "forkTaskParentId", "forkTaskSourceEventId", "forkTaskName", "forkTaskObjective",
    "forkArtifactPicker", "forkArtifactList", "forkTaskPreview", "forkTaskError",
    "forkTaskCancel", "forkTaskSubmit"
  ].map((id) => [id, document.getElementById(id)])
);

initialize().catch(showFatal);

async function initialize() {
  bindActions();
  bindEvents();
  [state, updateState] = await Promise.all([api.state(), api.updateState()]);
  currentTaskId = state.activeTask?.id || null;
  running = Boolean(state.activeTask);
  updateAttachments(state.attachments || []);
  selectedProvider = state.settings.provider;
  canvasSidecarOpen = Boolean(state.activeCanvasId);
  restoreShellPreferences();
  render();
  if (running) setRunning(true);
  restoreConversationFromContinuity();
  elements.loading.classList.add("hidden");
  elements.app.classList.remove("hidden");
  api.refreshOffline()
    .then((offline) => {
      if (!state) return;
      state.offline = offline;
      renderOfflineModels();
    })
    .catch(() => {});
  api.refreshRemote().catch(() => {});
}

function bindActions() {
  for (const button of document.querySelectorAll(".nav-item")) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }
  elements.sidebarToggle.addEventListener("click", toggleSidebar);
  bindContextResize();
  for (const button of document.querySelectorAll("[data-open-settings]")) {
    button.addEventListener("click", () => showView("settings"));
  }
  elements.connectButton.addEventListener("click", connectAmos);
  elements.localModeButton.addEventListener("click", startPersonal);
  elements.demoModeButton.addEventListener("click", startDemo);
  elements.demoConnectButton.addEventListener("click", connectAmos);
  elements.workspaceButton.addEventListener("click", chooseWorkspace);
  elements.localApprovalButton.addEventListener("click", toggleLocalApproval);
  elements.onboardingWorkspaceButton.addEventListener("click", chooseWorkspace);
  elements.enterButton.addEventListener("click", () => {
    sessionStorage.setItem("amos-onboarding-complete", "true");
    render();
    showView("operator");
  });
  elements.promptForm.addEventListener("submit", runTask);
  elements.cancelButton.addEventListener("click", cancelTask);
  elements.promptInput.addEventListener("keydown", (event) => {
    if (shouldSubmitPrompt(event)) {
      event.preventDefault();
      elements.promptForm.requestSubmit();
    }
  });
  elements.promptInput.addEventListener("paste", handlePaste);
  elements.attachButton.addEventListener("click", chooseAttachments);
  elements.promptForm.addEventListener("dragenter", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    elements.promptForm.classList.add("drop-active");
  });
  elements.promptForm.addEventListener("dragover", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  elements.promptForm.addEventListener("dragleave", (event) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) elements.promptForm.classList.remove("drop-active");
  });
  elements.promptForm.addEventListener("drop", handleDrop);
  elements.clearButton.addEventListener("click", clearSession);
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.modelInput.addEventListener("change", syncSelectedModelEndpoint);
  elements.baseUrlInput.addEventListener("change", syncSelectedModelEndpoint);
  elements.bedrockAuthInput.addEventListener("change", () =>
    renderProviderFields(elements.modelInput.value)
  );
  elements.testButton.addEventListener("click", testModel);
  elements.managedConnectButton.addEventListener("click", connectManagedIntelligence);
  elements.disconnectButton.addEventListener("click", disconnectAmos);
  elements.accountMenuButton.addEventListener("click", toggleAccountMenu);
  elements.accountMenuClose.addEventListener("click", closeAccountMenu);
  elements.accountMemoryButton.addEventListener("click", () => {
    closeAccountMenu();
    showView("memory");
  });
  elements.accountIntelligenceButton.addEventListener("click", () => {
    closeAccountMenu();
    showView("settings");
  });
  elements.addAccountButton.addEventListener("click", addAccount);
  elements.signOutAccountButton.addEventListener("click", disconnectAmos);
  elements.accountUpdateButton.addEventListener("click", handleAccountUpdate);
  elements.companySwitcher.addEventListener("change", switchCompany);
  elements.refreshAutomationsButton.addEventListener("click", refreshAutomations);
  elements.buildAutomationButton.addEventListener("click", () => openAutomationTask());
  elements.automationEmptyBuildButton.addEventListener("click", () => openAutomationTask());
  elements.newTaskButton.addEventListener("click", () => createNewConversation(elements.newTaskButton));
  elements.newConversationButton.addEventListener("click", () => createNewConversation(elements.newConversationButton));
  elements.forkConversationButton.addEventListener("click", forkCurrentConversation);
  elements.taskSearchInput.addEventListener("input", renderTasks);
  elements.taskFilterInput.addEventListener("change", renderTasks);
  elements.forkTaskForm.addEventListener("submit", submitTaskFork);
  elements.forkTaskCancel.addEventListener("click", closeTaskForkModal);
  elements.forkTaskModal.addEventListener("click", (event) => {
    if (event.target === elements.forkTaskModal) closeTaskForkModal();
  });
  for (const input of document.querySelectorAll('[name="forkContextScope"], [name="forkWorkspaceMode"]')) {
    input.addEventListener("change", renderTaskForkPreview);
  }
  elements.approvalsButton.addEventListener("click", () => showView("decisions"));
  elements.workDecisionsTab.addEventListener("click", () => showWorkTab("open"));
  elements.workProofTab.addEventListener("click", () => showWorkTab("history"));
  elements.allApprovalsButton.addEventListener("click", () => api.openApprovals());
  elements.refreshDecisionsButton.addEventListener("click", refreshDecisions);
  elements.approveButton.addEventListener("click", () => resolveApproval(true));
  elements.denyButton.addEventListener("click", () => resolveApproval(false));
  elements.alwaysApproveButton.addEventListener("click", () =>
    resolveApproval(true, "kind")
  );
  elements.autoApproveFolderButton.addEventListener("click", () =>
    resolveApproval(true, "workspace")
  );
  elements.updateButton.addEventListener("click", handleUpdate);
  elements.appearanceToggle.addEventListener("change", toggleAppearance);
  elements.localSetupButton.addEventListener("click", () =>
    elements.offlineIntelligenceCard.scrollIntoView({ behavior: "smooth", block: "start" })
  );
  elements.canvasStartButton.addEventListener("click", () => {
    showView("operator");
    elements.promptInput.value = "Show me the most important company metrics and decisions right now.";
    elements.promptInput.focus();
  });
  elements.canvasCloseButton.addEventListener("click", closeCanvasSidecar);
  elements.canvasSaveButton.addEventListener("click", saveActiveBriefing);
  elements.canvasScheduleButton.addEventListener("click", openBriefingScheduleModal);
  elements.briefingScheduleKind.addEventListener("change", renderBriefingScheduleFields);
  elements.briefingScheduleForm.addEventListener("submit", scheduleActiveBriefing);
  elements.briefingScheduleCancel.addEventListener("click", closeBriefingScheduleModal);
  elements.briefingScheduleModal.addEventListener("click", (event) => {
    if (event.target === elements.briefingScheduleModal) closeBriefingScheduleModal();
  });
  elements.offlineRefreshButton.addEventListener("click", refreshOfflineModels);
  elements.offlineInstallRuntimeButton.addEventListener("click", refreshOfflineModels);
  elements.memoryExportButton.addEventListener("click", () => openCapsuleFlow("export"));
  elements.memoryImportButton.addEventListener("click", () => openCapsuleFlow("import"));
  elements.companyCacheRefreshButton.addEventListener("click", refreshCompanyCache);
  elements.companyCacheRemoveButton.addEventListener("click", removeCompanyCache);
  elements.connectionForm.addEventListener("submit", submitSecretConnection);
  elements.connectionCancelButton.addEventListener("click", closeConnectionModal);
  elements.connectionAuthSchemeInput.addEventListener("change", refreshConnectionModalFields);
  elements.capsulePassphraseForm.addEventListener("submit", handleCapsulePassphrase);
  elements.capsuleCancelButton.addEventListener("click", closeCapsuleModal);
  elements.capsulePreviewCancelButton.addEventListener("click", closeCapsuleModal);
  elements.capsuleImportConfirmButton.addEventListener("click", confirmCapsuleImport);
  elements.connectionModal.addEventListener("click", (event) => {
    if (event.target === elements.connectionModal) closeConnectionModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.connectionModal.classList.contains("hidden")) {
      closeConnectionModal();
    }
    if (event.key === "Escape" && !elements.accountMenu.classList.contains("hidden")) {
      closeAccountMenu();
    }
    if (event.key === "Escape" && !elements.forkTaskModal.classList.contains("hidden")) {
      closeTaskForkModal();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (elements.accountMenu.classList.contains("hidden")) return;
    if (elements.accountMenu.contains(event.target) || elements.accountMenuButton.contains(event.target)) return;
    closeAccountMenu();
  });
}

function bindEvents() {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((state?.settings?.appearance || "system") === "system") applyAppearance("system");
  });
  api.on("agent:event", renderLiveEvent);
  api.on("agent:status", (taskStatus) => {
    currentTaskId = taskStatus?.running ? taskStatus.taskId || currentTaskId : null;
    if (!taskStatus?.running && pendingApproval) clearInlineApproval();
    setRunning(Boolean(taskStatus?.running));
  });
  api.on("activity:changed", (activity) => {
    if (state) state.activity = activity;
  });
  api.on("canvas:changed", (canvasState) => {
    if (!state) return;
    state.canvases = canvasState.canvases || [];
    state.activeCanvasId = canvasState.activeCanvasId || null;
    activeCanvasId = state.activeCanvasId;
    if (activeCanvasId) canvasSidecarOpen = true;
    renderCanvas();
  });
  api.on("offline:changed", (offline) => {
    if (!state) return;
    state.offline = offline;
    renderOfflineModels();
  });
  api.on("offline-proposals:changed", (offlineProposals) => {
    if (!state) return;
    state.offlineProposals = offlineProposals || [];
    renderDecisions();
  });
  api.on("task-checkpoints:changed", (taskCheckpoints) => {
    if (!state) return;
    state.taskCheckpoints = taskCheckpoints || [];
    renderDecisions();
  });
  api.on("remote:changed", (remote) => {
    if (!state) return;
    Object.assign(state, remote);
    renderIdentity();
    renderAccountMenu();
    renderCompanySwitcher();
    renderDecisions();
    renderWorkingContinuity();
    renderCompanyCache();
    renderConnections();
    renderAutomations();
    renderTasks();
    renderHistory();
    renderCanvas();
    restoreConversationFromContinuity();
  });
  api.on("update:changed", (nextUpdateState) => {
    updateState = nextUpdateState;
    renderUpdate();
  });
  api.on("approval:requested", (approval) => {
    pendingApproval = approval;
    elements.approvalMessage.textContent = approval.message;
    const label = localApprovalKindLabel(approval.kind);
    elements.alwaysApproveButton.classList.toggle("hidden", !label);
    elements.alwaysApproveButton.textContent = label ? `Always allow ${label}` : "Always allow this kind";
    elements.autoApproveFolderButton.classList.toggle("hidden", !state.settings.workspace);
    elements.approvalScopeNote.textContent = approval.kind === "shell"
      ? "“Always allow local commands” applies to all shell commands started from this workspace, not only this request. Shell commands use a scrubbed environment but are not OS-sandboxed to the folder."
      : label
        ? `“Always allow” applies to all ${label} in this exact workspace, not only this request. “Auto-approve this folder” also covers local commands, file writes, and code patches.`
      : "Auto-approve applies only to local work in the selected folder.";
    elements.messages.append(elements.approvalModal);
    elements.approvalModal.classList.remove("hidden");
    elements.activityStreamTitle.textContent = "AMOS is waiting for you";
    elements.runningIndicator.textContent = "Local approval needed";
    elements.promptInput.placeholder = "Keep typing—your direction will be queued while this approval waits…";
    elements.approvalModal.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  api.on("approval:completed", (outcome) => {
    const encoded = JSON.stringify(outcome?.result, null, 2);
    const result = encoded === undefined
      ? "No structured result was returned."
      : encoded.length <= 40_000
        ? encoded
        : `${encoded.slice(0, 39_900)}\n… [result shortened for display]`;
    addMessage(
      "assistant",
      [
        "### Approved work completed",
        "",
        `**${outcome?.title || humanizeTool(outcome?.verb || "governed operation")}** executed once under the original pending operation.`,
        "",
        "```json",
        result,
        "```",
        outcome?.truncated
          ? "The durable result was truncated; ask AMOS for a bounded or paginated follow-up read if you need more rows."
          : ""
      ].filter(Boolean).join("\n")
    );
    toast("Approved work completed. The original result is now in this task.");
  });
}

function render() {
  applyAppearance(state.settings.appearance || "system");
  const needsOnboarding =
    !sessionStorage.getItem("amos-onboarding-complete") &&
    ((!state.connected && !state.mode?.personal && !state.mode?.offline) ||
      !state.configured ||
      !state.settings.workspace);
  elements.onboardingView.classList.toggle("hidden", !needsOnboarding);
  if (needsOnboarding) {
    elements.operatorView.classList.add("hidden");
    elements.tasksView.classList.add("hidden");
    elements.canvasView.classList.add("hidden");
    elements.memoryView.classList.add("hidden");
    elements.connectionsView.classList.add("hidden");
    elements.automationsView.classList.add("hidden");
    elements.workView.classList.add("hidden");
    elements.settingsView.classList.add("hidden");
  } else {
    showView(currentView);
  }

  elements.connectionDot.classList.toggle("connected", state.connected);
  renderIdentity();
  renderAccountMenu();
  renderCompanySwitcher();
  elements.runtimeBadge.textContent = state.configured
    ? providerStatusLabel()
    : "Intelligence not configured";
  const demo = state.connectionMode === "demo";
  const activeAccount =
    state.connectionMode === "user" && state.accountStatus?.workspaceActive === true;
  elements.modeBadge.textContent = demo
    ? "NORTHWIND DEMO"
    : state.mode?.offline
      ? "LOCAL-ONLY"
      : state.mode?.personal
        ? "PERSONAL WORKSPACE"
        : "ONLINE COMPANY";
  elements.modeBadge.classList.toggle("offline", Boolean(state.mode?.offline));
  elements.demoBanner.classList.toggle("hidden", !demo);
  elements.operatorView.classList.toggle("has-demo-banner", demo);
  if (demo) {
    elements.demoExpiry.textContent =
      `Sample data only · expires ${new Date(state.demo.expiresAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      })}`;
  }
  if (state.mode?.offline) {
    elements.operatorEyebrow.textContent = "WORK OFFLINE";
    elements.readyTitle.textContent = "Local-only is ready.";
    elements.readyDescription.textContent =
      "Work with local code, files, private memory, and any signed company context stored on this computer.";
    elements.promptInput.placeholder =
      "Ask about this project, attach a document, paste a screenshot, or describe offline work…";
  } else if (state.mode?.personal) {
    elements.operatorEyebrow.textContent = "WORK FROM THIS COMPUTER";
    elements.readyTitle.textContent = "Your workspace is ready.";
    elements.readyDescription.textContent =
      "Understand code, research, create, and automate locally. Nothing here receives company authority.";
    elements.promptInput.placeholder =
      "Ask about this project, attach a document, paste a screenshot, or describe work to move forward…";
  } else if (demo) {
    elements.operatorEyebrow.textContent = "OPERATE THE SAMPLE COMPANY";
    elements.readyTitle.textContent = "Northwind Labs is ready.";
    elements.readyDescription.textContent =
      "Explore a live sample company with real AMOS tools, approvals, receipts, and governed actions.";
    elements.promptInput.placeholder =
      "Ask about Northwind, create something, or make a governed sample-company change…";
  } else {
    elements.operatorEyebrow.textContent = "OPERATE THE COMPANY";
    elements.readyTitle.textContent = "AMOS is ready.";
    elements.readyDescription.textContent =
      "Ask about the company, create something new, or make a change. Consequential actions still wait for the right approval.";
    elements.promptInput.placeholder =
      "Ask about the company, attach a document, paste a screenshot, or describe work to move forward…";
  }
  elements.operatorTitle.textContent = "What should move forward?";
  elements.workspaceLabel.textContent = state.settings.workspace || "Choose a folder";
  elements.workspaceLabel.title = state.settings.workspace || "";
  const localAutoApprove = state.settings.localApprovalMode === "workspace" &&
    state.settings.localApprovalWorkspace === state.settings.workspace;
  const localApprovalKinds = state.settings.localApprovalWorkspace === state.settings.workspace
    ? state.settings.localApprovalKinds || []
    : [];
  const localTrustActive = localAutoApprove || localApprovalKinds.length > 0;
  elements.localApprovalButton.classList.toggle("hidden", !state.settings.workspace);
  elements.localApprovalButton.classList.toggle("active", localTrustActive);
  elements.localApprovalButton.setAttribute("aria-pressed", String(localTrustActive));
  elements.localApprovalButton.title = localTrustActive
    ? `Persistent local approval is active for ${state.settings.workspace}. Click to return to ask-first. Company decisions still use AMOS policy.`
    : `Turn on local auto-approve for ${state.settings.workspace}. Company decisions remain separate.`;
  elements.localApprovalLabel.textContent = localAutoApprove
    ? "Auto-approve on"
    : localApprovalKinds.length > 0
      ? `Always allow: ${localApprovalKinds.map(localApprovalKindLabel).join(", ")}`
      : "Auto-approve local work";
  elements.localModeButton.classList.toggle(
    "selected",
    Boolean((state.mode?.personal || state.mode?.offline) && !demo)
  );
  elements.demoModeButton.classList.toggle("selected", demo);
  elements.demoModeButton.classList.toggle("hidden", activeAccount);
  elements.connectButton.classList.toggle(
    "selected",
    Boolean(state.connected && !demo && !state.mode?.personal && !state.mode?.offline)
  );
  const connectKicker = elements.connectButton.querySelector(".start-mode-kicker");
  const connectTitle = elements.connectButton.querySelector("strong");
  const connectDescription = elements.connectButton.querySelector("strong + span");
  const connectAction = elements.connectButton.querySelector("em");
  connectKicker.textContent = activeAccount ? "YOUR ACTIVE AMOS COMPANY" : "YOUR ORGANIZATION";
  connectTitle.textContent = activeAccount
    ? "Build my company brain"
    : state.connected && !demo
      ? "Reconnect my company"
      : "My company";
  connectDescription.textContent = activeAccount
    ? "Connect data, applications, durable memory, authority, and proof for your real organization."
    : "Connect durable memory, applications, policy, approvals, and proof.";
  connectAction.textContent = activeAccount ? "Continue setup →" : "Sign in or create account →";
  elements.boundaryReadinessText.textContent = demo
    ? "Northwind demo"
    : state.connected
      ? "Company connected"
      : state.mode?.offline
        ? "Local-only"
        : state.mode?.personal
          ? "Personal workspace"
          : "Choose a starting point";
  renderStep(elements.connectCheck, state.connected || state.mode?.personal || state.mode?.offline);
  renderStep(elements.providerCheck, state.configured);
  renderStep(elements.workspaceCheck, Boolean(state.settings.workspace));
  elements.onboardingProviderText.textContent = state.configured
    ? providerStatusLabel()
    : state.mode?.personal
      ? "Choose your model"
      : "Choose intelligence";
  elements.enterButton.disabled = !(
    (state.connected || state.mode?.personal || state.mode?.offline) &&
    state.configured &&
    state.settings.workspace &&
    state.mode?.valid !== false
  );
  elements.disconnectButton.classList.toggle("hidden", !state.connected);
  elements.disconnectButton.textContent = state.accounts?.currentAccountId
    ? "Sign out of this account"
    : "Disconnect AMOS";
  elements.approvalsButton.disabled = Boolean(state.mode?.offline || state.mode?.personal || demo);
  elements.approvalsButton.textContent = "Review decisions";
  elements.allApprovalsButton.classList.toggle(
    "hidden",
    state.approvalDecisionMode === "desktop"
  );
  renderRunButtonLabel();
  const scopeDot = elements.scopeNote.querySelector(".status-dot");
  const scopeText = elements.scopeNote.querySelector("span:last-child");
  scopeDot.classList.toggle("green", !state.mode?.offline && !state.mode?.personal);
  scopeText.textContent = state.mode?.offline
    ? state.companyCache?.available
      ? "Local-only · signed company context · no live network"
      : "Local-only · no company or public-network tools"
    : state.mode?.personal
      ? "Personal workspace · local approvals active · no company access"
      : demo
        ? "Northwind sample data · AMOS policy and proof are active"
        : "AMOS policy and proof are active";
  renderUpdate();

  const boundary = {
    amos: "AMOS-managed inference in AWS. Company policy and proof remain in AMOS.",
    "customer-cloud": "Inference runs in the customer's AWS account through Bedrock.",
    local: "Inference runs on this computer; company actions remain governed by AMOS.",
    cloud: "Inference runs with the model provider; AMOS retains company state and authority.",
    custom: "Inference runs at the configured endpoint; AMOS retains company state and authority."
  };
  elements.deploymentSummary.textContent = state.mode?.offline
    ? state.companyCache?.available
      ? "Local-only mode: a server-signed, read-only company briefing is available; live AMOS actions and public-network tools remain absent."
      : "Local-only mode: no live AMOS or public-network tools are exposed to this session."
    : state.mode?.personal
      ? "Personal workspace mode: local tools and allowed web access are active; no AMOS company data or authority is exposed."
      : boundary[state.provider.deployment] || boundary.custom;

  renderSettings();
  renderOfflineModels();
  renderHistory();
  renderDecisions();
  renderAttachments();
  renderPrivateMemory();
  renderWorkingContinuity();
  renderCompanyCache();
  renderConnections();
  renderAutomations();
  renderTasks();
  activeCanvasId = state.activeCanvasId || activeCanvasId;
  renderCanvas();
  renderStarterActions();
  renderConversationChrome();
}

function restoreShellPreferences() {
  let collapsed = false;
  let contextWidth = 0;
  try {
    collapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
    contextWidth = Number(localStorage.getItem(CONTEXT_WIDTH_KEY) || 0);
  } catch {
    // UI preferences are optional and contain no company data.
  }
  setSidebarCollapsed(collapsed);
  if (Number.isFinite(contextWidth) && contextWidth >= 380) {
    elements.operatorGrid.style.setProperty("--context-width", `${contextWidth}px`);
  }
}

function toggleSidebar() {
  setSidebarCollapsed(!elements.app.classList.contains("nav-collapsed"));
}

function setSidebarCollapsed(collapsed) {
  elements.app.classList.toggle("nav-collapsed", collapsed);
  elements.sidebarToggle.textContent = collapsed ? "›" : "‹";
  elements.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  elements.sidebarToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand navigation" : "Collapse navigation"
  );
  elements.sidebarToggle.title = collapsed ? "Expand navigation" : "Collapse navigation";
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, String(collapsed));
  } catch {
    // The shell remains usable when persistence is unavailable.
  }
}

function bindContextResize() {
  let pointerId = null;
  const resize = (clientX) => {
    const bounds = elements.operatorGrid.getBoundingClientRect();
    const width = Math.round(Math.min(Math.max(bounds.right - clientX, 380), bounds.width - 480));
    if (!Number.isFinite(width) || width < 380) return;
    elements.operatorGrid.style.setProperty("--context-width", `${width}px`);
    elements.contextResizeHandle.setAttribute("aria-valuenow", String(width));
    try {
      localStorage.setItem(CONTEXT_WIDTH_KEY, String(width));
    } catch {
      // Resizing does not depend on persistence.
    }
  };
  elements.contextResizeHandle.addEventListener("pointerdown", (event) => {
    pointerId = event.pointerId;
    elements.contextResizeHandle.setPointerCapture(pointerId);
    resize(event.clientX);
  });
  elements.contextResizeHandle.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointerId) resize(event.clientX);
  });
  const release = (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
  };
  elements.contextResizeHandle.addEventListener("pointerup", release);
  elements.contextResizeHandle.addEventListener("pointercancel", release);
  elements.contextResizeHandle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const current = elements.canvasSidecar.getBoundingClientRect().width;
    const next = current + (event.key === "ArrowLeft" ? 24 : -24);
    resize(elements.operatorGrid.getBoundingClientRect().right - next);
  });
}

function showView(view) {
  if (view === "decisions" || view === "activity") {
    showWorkTab(view === "activity" ? "history" : "open");
    view = "work";
  }
  currentView = view;
  const map = {
    operator: elements.operatorView,
    canvas: elements.canvasView,
    memory: elements.memoryView,
    tasks: elements.tasksView,
    connections: elements.connectionsView,
    automations: elements.automationsView,
    work: elements.workView,
    settings: elements.settingsView
  };
  for (const [name, section] of Object.entries(map)) section.classList.toggle("hidden", name !== view);
  elements.onboardingView.classList.add("hidden");
  for (const button of document.querySelectorAll(".nav-item")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  renderCanvas();
}

function showWorkTab(tab) {
  currentWorkTab = ["history", "proof"].includes(tab) ? "history" : "open";
  const decisionsActive = currentWorkTab === "open";
  elements.workDecisionsTab.classList.toggle("active", decisionsActive);
  elements.workDecisionsTab.setAttribute("aria-selected", String(decisionsActive));
  elements.workProofTab.classList.toggle("active", !decisionsActive);
  elements.workProofTab.setAttribute("aria-selected", String(!decisionsActive));
  elements.workDecisionsPanel.classList.toggle("hidden", !decisionsActive);
  elements.workProofPanel.classList.toggle("hidden", decisionsActive);
}

function renderConnections() {
  const catalog = state?.connectionsCatalog || {};
  const connections = Array.isArray(catalog.connections) ? catalog.connections : [];
  const connectedSystems = connections.filter(
    (connection) => connection.status === "connected"
  );
  const providers = Array.isArray(catalog.providers)
    ? catalog.providers
    : [
        ...(Array.isArray(catalog.curated) ? catalog.curated : []),
        ...(Array.isArray(catalog.tenantDefined) ? catalog.tenantDefined : [])
      ];
  const connectionsByProvider = new Map(
    connectedSystems.map((connection) => [connection.provider, connection])
  );
  const availableProviders = providers.filter(
    (provider) => provider.provider === "custom" || !connectionsByProvider.has(provider.provider)
  );
  elements.connectionBadge.textContent = String(connectedSystems.length);
  elements.connectionBadge.classList.toggle("hidden", connectedSystems.length === 0);
  elements.connectionCatalogSummary.textContent = state?.connectionMode === "user"
    ? `${connectedSystems.length} connected system${connectedSystems.length === 1 ? "" : "s"} · ${availableProviders.length} available connection${availableProviders.length === 1 ? "" : "s"}`
    : "Connect your AMOS company to load its credential-free connection catalog.";

  elements.connectedSystemList.replaceChildren();
  if (connectedSystems.length === 0) {
    elements.connectedSystemList.append(connectionCatalogEmpty(
      state?.connectionMode === "user"
        ? "No platform connections are visible to this identity yet."
        : "The live catalog appears after company sign-in."
    ));
  } else {
    for (const connection of connectedSystems) {
      const card = document.createElement("article");
      card.className = "connection-provider-card";
      const top = document.createElement("div");
      const icon = document.createElement("span");
      icon.className = "connection-provider-icon";
      icon.textContent = providerMonogram(connection.provider);
      const status = document.createElement("span");
      status.className = `status-pill ${connection.status === "connected" ? "connected" : "attention"}`;
      status.textContent = connection.status.replaceAll("_", " ").toUpperCase();
      top.append(icon, status);
      const title = document.createElement("strong");
      title.textContent = connection.displayName;
      const detail = document.createElement("p");
      detail.textContent = `${humanizeProvider(connection.provider)} · ${connection.kind.replaceAll("_", " ")} · ${connection.ownership.replaceAll("_", " ")}`;
      const boundary = document.createElement("small");
      boundary.textContent = connection.usable
        ? "Available to this signed-in user through governed platform calls"
        : "Metadata only; this identity cannot use the connection";
      card.append(top, title, detail, boundary);
      elements.connectedSystemList.append(card);
    }
  }

  elements.availableProviderList.replaceChildren();
  if (availableProviders.length === 0) {
    elements.availableProviderList.append(connectionCatalogEmpty(
      providers.length === 0
        ? "No provider definitions were advertised by this AMOS server."
        : "Every advertised provider is already represented under Connected."
    ));
  } else {
    for (const provider of availableProviders) {
      const card = document.createElement("article");
      card.className = "connection-provider-card";
      const top = document.createElement("div");
      const icon = document.createElement("span");
      icon.className = "connection-provider-icon";
      icon.textContent = providerMonogram(provider.provider);
      const status = document.createElement("span");
      const providerState = provider.availability || "setup_required";
      status.className = `status-pill ${
        providerState === "available" ? "available" : "attention"
      }`;
      status.textContent = providerState.replaceAll("_", " ").toUpperCase();
      top.append(icon, status);
      const title = document.createElement("strong");
      title.textContent = provider.label;
      const detail = document.createElement("p");
      detail.textContent = provider.description || (
        provider.source === "platform"
          ? "Curated and governed by the AMOS platform."
          : "Defined for this tenant; credentials remain platform-vaulted."
      );
      const boundary = document.createElement("small");
      const context = [
        provider.group,
        provider.connectionKind.replaceAll("_", " "),
        provider.upstreamStatus ? `upstream ${provider.upstreamStatus}` : "",
        provider.capabilities.length > 0
          ? provider.capabilities.map((item) => item.replaceAll("_", " ")).join(" · ")
          : ""
      ].filter(Boolean);
      boundary.textContent = context.join(" · ") || `Provider key: ${provider.provider}`;
      card.append(top, title, detail, boundary);
      if (
        provider.setupMode === "hosted_oauth" &&
        provider.availability === "available"
      ) {
        const connect = document.createElement("button");
        connect.type = "button";
        connect.className = "button secondary connection-connect-button";
        connect.textContent = "Connect";
        connect.addEventListener("click", async () => {
          connect.disabled = true;
          try {
            await api.connectProvider(provider.provider);
            toast(`Opened secure setup for ${provider.label}`);
          } catch (error) {
            toast(error.message, true);
          } finally {
            connect.disabled = false;
          }
        });
        card.append(connect);
      } else if (
        ["hosted_secret", "governed_upstream_mcp", "advanced"].includes(provider.setupMode) &&
        provider.availability === "available" &&
        provider.credentialForm
      ) {
        const connect = document.createElement("button");
        connect.type = "button";
        connect.className = "button secondary connection-connect-button";
        connect.textContent = "Connect";
        connect.addEventListener("click", () => openConnectionModal(provider));
        card.append(connect);
      }
      elements.availableProviderList.append(card);
    }
  }
}

function renderAutomations() {
  if (!state) return;
  const library = state.automations || {};
  const automations = Array.isArray(library.automations) ? library.automations : [];
  const supported = library.supported === true;
  const active = automations.filter((automation) => automation.status === "active").length;
  const needsAttention = automations.filter(
    (automation) => automation.status !== "active" || automation.stats.failed > 0
  ).length;
  const totalRuns = automations.reduce(
    (sum, automation) => sum + automation.stats.completed,
    0
  );

  elements.automationBadge.textContent = String(active);
  elements.automationBadge.classList.toggle("hidden", active === 0);
  elements.automationSummary.classList.toggle("hidden", !supported);
  elements.automationUnavailable.classList.toggle("hidden", supported);
  elements.automationEmpty.classList.toggle("hidden", !supported || automations.length > 0);
  elements.automationList.classList.toggle("hidden", !supported || automations.length === 0);
  elements.buildAutomationButton.disabled = state.connectionMode !== "user";
  elements.automationEmptyBuildButton.disabled = state.connectionMode !== "user";
  elements.refreshAutomationsButton.disabled = state.connectionMode !== "user";

  elements.automationSummary.replaceChildren();
  for (const [label, value, detail] of [
    ["Live", active, "running under current policy"],
    ["Needs attention", needsAttention, "paused, draft, or reporting failures"],
    ["Completed runs", totalRuns, "bounded outcomes reported by AMOS"]
  ]) {
    const item = document.createElement("article");
    const number = document.createElement("strong");
    number.textContent = new Intl.NumberFormat().format(value);
    const title = document.createElement("span");
    title.textContent = label;
    const copy = document.createElement("small");
    copy.textContent = detail;
    item.append(number, title, copy);
    elements.automationSummary.append(item);
  }

  elements.automationList.replaceChildren();
  for (const automation of automations) {
    const card = document.createElement("article");
    card.className = "automation-card";

    const heading = document.createElement("div");
    heading.className = "automation-card-heading";
    const identity = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = automationTriggerLabel(automation.trigger);
    const title = document.createElement("h2");
    title.textContent = automation.name;
    identity.append(eyebrow, title);
    const status = document.createElement("span");
    status.className = `automation-status ${automation.status}`;
    status.textContent = automation.status.replaceAll("_", " ").toUpperCase();
    heading.append(identity, status);

    const description = document.createElement("p");
    description.className = "automation-card-description";
    description.textContent = automation.liveCopySubject || automationStepSummary(automation.steps);

    const stats = document.createElement("div");
    stats.className = "automation-stats";
    for (const [label, value] of [
      ["Enrolled", automation.stats.enrolled],
      ["Completed", automation.stats.completed],
      ["Pending", automation.stats.pending],
      ["Failed", automation.stats.failed]
    ]) {
      const metric = document.createElement("span");
      const metricValue = document.createElement("strong");
      metricValue.textContent = new Intl.NumberFormat().format(value);
      const metricLabel = document.createElement("small");
      metricLabel.textContent = label;
      metric.append(metricValue, metricLabel);
      stats.append(metric);
    }

    const meta = document.createElement("div");
    meta.className = "automation-meta";
    meta.textContent = [
      `${automation.steps.length} step${automation.steps.length === 1 ? "" : "s"}`,
      automation.updatedAt ? `Updated ${relativeTime(automation.updatedAt)}` : "",
      automation.stats.lastSentAt
        ? `Last delivery ${relativeTime(automation.stats.lastSentAt)}`
        : automation.stats.lastCalendarEventAt
          ? `Last matched ${relativeTime(automation.stats.lastCalendarEventAt)}`
          : "No completed delivery yet"
    ].filter(Boolean).join(" · ");

    const actions = document.createElement("div");
    actions.className = "automation-actions";
    const edit = actionButton("Work on this with AMOS", "secondary");
    edit.addEventListener("click", () => openAutomationTask(automation, edit));
    const nextActive = automation.status !== "active";
    const statusButton = actionButton(nextActive ? "Resume" : "Pause", nextActive ? "primary" : "secondary");
    statusButton.addEventListener("click", () => changeAutomationStatus(automation, nextActive, statusButton));
    actions.append(edit, statusButton);

    card.append(heading, description, stats, meta, actions);
    elements.automationList.append(card);
  }
}

async function refreshAutomations() {
  setButtonBusy(elements.refreshAutomationsButton, true, "Refreshing…");
  try {
    state = await api.refreshRemote();
    renderAutomations();
    toast("Automations refreshed from AMOS Platform.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.refreshAutomationsButton, false, "Refresh");
  }
}

async function changeAutomationStatus(automation, active, button) {
  setButtonBusy(button, true, active ? "Resuming…" : "Pausing…");
  try {
    const response = await api.setAutomationStatus(automation.name, active);
    state.automations = response.automations || state.automations;
    renderAutomations();
    const message = response.result?.message || (
      active
        ? `${automation.name} was submitted for governed resume.`
        : `${automation.name} is paused.`
    );
    toast(message);
  } catch (error) {
    toast(error.message, true);
    renderAutomations();
  }
}

async function openAutomationTask(automation = null, sourceButton = elements.buildAutomationButton) {
  const sourceLabel = sourceButton.textContent;
  const title = automation ? `Improve ${automation.name}` : "Build an automation";
  const objective = automation
    ? `Open the existing AMOS automation named “${automation.name}” in a focused task. Read its current governed definition and live stats first. Help me improve the business outcome, trigger, deterministic steps, exception handling, approvals, and measurement. Do not resume or activate consequential behavior without my explicit approval.`
    : "Help me design and build a governed AMOS automation in this focused task. Start by clarifying the business outcome, trigger, deterministic steps, required connections, exception handling, approval boundaries, and measurable success criteria. Do not activate it until I explicitly approve the final design.";
  setButtonBusy(sourceButton, true, "Opening task…");
  try {
    const response = await api.startNewConversation({
      kind: "automation_builder",
      title,
      objective,
      resource: automation ? { type: "automation", id: automation.id, name: automation.name } : null
    });
    state = response.state;
    currentTaskId = null;
    streamingMessage = null;
    continuityConversationRestored = false;
    resetSessionView();
    render();
    showView("operator");
    elements.promptInput.value = response.launch.objective;
    elements.promptInput.focus();
    toast("Opened a separate automation task. The prior context lane was preserved.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (sourceButton.isConnected) setButtonBusy(sourceButton, false, sourceLabel);
  }
}

function automationTriggerLabel(trigger) {
  const type = String(trigger?.type || trigger?.kind || trigger?.event || "event");
  return `TRIGGER · ${type.replaceAll("_", " ").toUpperCase()}`;
}

function automationStepSummary(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "AMOS has not advertised a step summary for this automation yet.";
  }
  return steps
    .slice(0, 3)
    .map((step) => step.stage || step.subject || humanizeTool(step.action))
    .filter(Boolean)
    .join(" → ");
}

function renderTasks() {
  if (!state) return;
  const library = state.tasks || { supported: false, tasks: [] };
  const tasks = Array.isArray(library.tasks) ? library.tasks : [];
  const query = elements.taskSearchInput.value.trim().toLowerCase();
  const filter = elements.taskFilterInput.value || "current";
  const visible = tasks.filter((task) => {
    const matchesQuery = !query || `${task.title}\n${task.objective}`.toLowerCase().includes(query);
    if (!matchesQuery) return false;
    const archived = Boolean(task.archivedAt || task.archived);
    if (filter === "archived") return archived;
    if (filter === "forks") return !archived && Boolean(task.parentTaskId || task.kind === "fork");
    if (filter === "current") {
      return !archived && ["active", "waiting", "interrupted", "failed"].includes(task.status);
    }
    if (filter === "recent") return !archived;
    return true;
  });
  const current = tasks.filter((task) => !task.archivedAt && !task.archived);
  const waiting = current.filter((task) => task.status === "waiting").length;
  const forks = current.filter((task) => task.parentTaskId || task.kind === "fork").length;
  const active = current.filter((task) => task.status === "active").length;

  elements.taskBadge.textContent = String(waiting || active);
  elements.taskBadge.classList.toggle("hidden", waiting + active === 0);
  elements.taskPlatformNotice.classList.toggle("hidden", library.platformSupported !== false);
  elements.taskEmpty.classList.toggle("hidden", visible.length > 0);
  elements.taskSummary.replaceChildren();
  for (const [label, value, detail] of [
    ["Active", active, "context lanes ready to continue"],
    ["Waiting", waiting, "tasks waiting on a person or external event"],
    ["Forks", forks, "bounded branches with visible lineage"]
  ]) {
    const item = document.createElement("article");
    const number = document.createElement("strong");
    number.textContent = String(value);
    const title = document.createElement("span");
    title.textContent = label;
    const copy = document.createElement("small");
    copy.textContent = detail;
    item.append(number, title, copy);
    elements.taskSummary.append(item);
  }

  elements.taskList.replaceChildren();
  for (const task of visible) elements.taskList.append(taskCard(task));
}

function taskCard(task) {
  const card = document.createElement("article");
  card.className = `task-card${task.active ? " active" : ""}`;
  const heading = document.createElement("div");
  heading.className = "task-card-heading";
  const copy = document.createElement("div");
  const meta = document.createElement("div");
  meta.className = "task-card-kicker";
  const status = document.createElement("span");
  status.className = `task-status ${task.status || "active"}`;
  status.textContent = String(task.status || "active").replaceAll("_", " ").toUpperCase();
  meta.append(status);
  if (task.pinned) {
    const pinned = document.createElement("span");
    pinned.className = "task-lineage-chip";
    pinned.textContent = "PINNED";
    meta.append(pinned);
  }
  if (task.parentTaskId) {
    const fork = document.createElement("span");
    fork.className = "task-lineage-chip fork";
    fork.textContent = "FORK";
    meta.append(fork);
  }
  if (task.active) {
    const current = document.createElement("span");
    current.className = "task-lineage-chip current";
    current.textContent = "OPEN IN OPERATOR";
    meta.append(current);
  }
  const title = document.createElement("h2");
  title.textContent = task.title;
  copy.append(meta, title);
  const updated = document.createElement("time");
  updated.textContent = task.updatedAt ? relativeTime(task.updatedAt) : "Local task";
  heading.append(copy, updated);

  const objective = document.createElement("p");
  objective.className = "task-card-objective";
  objective.textContent = task.objective;

  const details = document.createElement("div");
  details.className = "task-card-details";
  for (const value of [
    task.kind === "automation_builder" ? "Automation build" : humanizeTool(task.kind || "general"),
    taskWorkspaceLabel(task),
    task.parentTaskId ? `From ${shortTaskId(task.parentTaskId)}` : "Root task",
    task.remote ? "Platform + local" : "Encrypted local"
  ]) {
    const chip = document.createElement("span");
    chip.textContent = value;
    details.append(chip);
  }

  const actions = document.createElement("div");
  actions.className = "task-card-actions";
  const archived = Boolean(task.archivedAt || task.archived);
  const open = actionButton(task.active ? "Open in Operator" : "Resume", "primary");
  open.disabled = archived;
  open.addEventListener("click", () => openManagedTask(task, open));
  const fork = actionButton("Fork", "secondary");
  fork.disabled = archived;
  fork.addEventListener("click", () => openTaskForkModal(task));
  const pin = actionButton(task.pinned ? "Unpin" : "Pin", "ghost");
  pin.addEventListener("click", () => updateManagedTask(task, { pinned: !task.pinned }, pin));
  const rename = actionButton("Rename", "ghost");
  rename.addEventListener("click", async () => {
    const next = window.prompt("Task name", task.title);
    if (next?.trim() && next.trim() !== task.title) {
      await updateManagedTask(task, { title: next.trim() }, rename);
    }
  });
  const wait = actionButton(task.status === "waiting" ? "Mark active" : "Mark waiting", "ghost");
  wait.disabled = archived;
  wait.addEventListener("click", () => updateManagedTask(
    task,
    { status: task.status === "waiting" ? "active" : "waiting" },
    wait
  ));
  const archive = actionButton(archived ? "Restore" : "Archive", "ghost");
  archive.addEventListener("click", () => updateManagedTask(task, { archived: !archived }, archive));
  actions.append(open, fork, pin, rename, wait, archive);
  card.append(heading, objective, details, actions);
  return card;
}

async function createNewConversation(sourceButton = elements.newConversationButton) {
  const sourceMarkup = sourceButton.innerHTML;
  setButtonBusy(sourceButton, true, "Opening…");
  try {
    const response = await api.startNewConversation({
      kind: "general"
    });
    adoptOpenedTask(response);
    elements.promptInput.value = "";
    elements.promptInput.focus();
    toast("Started a new conversation. Its context and branches are managed under Tasks.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    sourceButton.disabled = false;
    sourceButton.removeAttribute("aria-busy");
    sourceButton.innerHTML = sourceMarkup;
    renderConversationActions();
  }
}

function forkCurrentConversation() {
  const task = activeDurableTask();
  if (!task) {
    toast("Start a conversation before creating a fork.", true);
    return;
  }
  openTaskForkModal(task, latestTaskEventId(task));
}

async function openManagedTask(task, button) {
  setButtonBusy(button, true, "Opening…");
  try {
    const response = await api.openTask(task.id);
    adoptOpenedTask(response);
    toast("Task restored. AMOS will revalidate current sources and authority before acting.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) setButtonBusy(button, false, task.active ? "Open in Operator" : "Resume");
  }
}

async function updateManagedTask(task, changes, button) {
  const label = button.textContent;
  setButtonBusy(button, true, "Saving…");
  try {
    const response = await api.updateTask(task.id, changes);
    state.tasks = response.tasks || state.tasks;
    renderTasks();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) setButtonBusy(button, false, label);
  }
}

function adoptOpenedTask(response) {
  resetSessionView();
  state = response.state;
  currentTaskId = state.activeTask?.id || null;
  streamingMessage = null;
  continuityConversationRestored = false;
  activeCanvasId = state.activeCanvasId || null;
  canvasSidecarOpen = Boolean(activeCanvasId);
  updateAttachments(state.attachments || []);
  render();
  showView("operator");
  restoreConversationFromContinuity();
}

function openTaskForkModal(task, sourceEventId = "") {
  forkTaskSource = task;
  const exactEventId = sourceEventId || latestTaskEventId(task);
  elements.forkTaskParentId.value = task.id;
  elements.forkTaskSourceEventId.value = exactEventId || task.contextKey || `task:${task.id}`;
  elements.forkTaskParent.textContent = sourceEventId
    ? `Branching from an exact milestone in “${task.title}”.`
    : `Branching from “${task.title}”.`;
  elements.forkTaskName.value = `Branch of ${task.title}`.slice(0, 160);
  elements.forkTaskObjective.value = task.objective;
  const fromHere = document.querySelector('[name="forkContextScope"][value="from_here"]');
  const everything = document.querySelector('[name="forkContextScope"][value="everything"]');
  if (sourceEventId || exactEventId) fromHere.checked = true;
  else everything.checked = true;
  document.querySelector('[name="forkWorkspaceMode"][value="same_directory"]').checked = true;
  elements.forkArtifactList.replaceChildren();
  for (const artifact of taskArtifacts(task)) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = artifact.id;
    input.addEventListener("change", renderTaskForkPreview);
    const copy = document.createElement("span");
    copy.textContent = artifact.label;
    label.append(input, copy);
    elements.forkArtifactList.append(label);
  }
  elements.forkTaskError.textContent = "";
  elements.forkTaskError.classList.add("hidden");
  renderTaskForkPreview();
  elements.forkTaskModal.classList.remove("hidden");
  elements.forkTaskName.focus();
}

function closeTaskForkModal() {
  forkTaskSource = null;
  elements.forkTaskModal.classList.add("hidden");
  elements.forkTaskForm.reset();
  elements.forkTaskError.classList.add("hidden");
}

function renderTaskForkPreview() {
  const contextScope = checkedValue("forkContextScope", "from_here");
  const workspaceMode = checkedValue("forkWorkspaceMode", "same_directory");
  const selected = [...elements.forkArtifactList.querySelectorAll('input[type="checkbox"]:checked')];
  elements.forkArtifactPicker.classList.toggle("hidden", contextScope !== "selected_artifacts");
  const contextCopy = contextScope === "everything"
    ? "Carries the full bounded orientation retained for this task."
    : contextScope === "selected_artifacts"
      ? `Carries ${selected.length} selected artifact${selected.length === 1 ? "" : "s"} and no retained turns.`
      : "Carries bounded orientation only through the selected milestone.";
  const workspaceCopy = workspaceMode === "new_worktree"
    ? "Creates an isolated Git branch at the current commit. Dirty parent changes stay in the parent."
    : workspaceMode === "context_only"
      ? "Carries no local filesystem grant."
      : "Uses the same files; parallel edits can overlap.";
  elements.forkTaskPreview.textContent = `${contextCopy} ${workspaceCopy} Pending operations, approvals, credentials, tokens, and execution authority never carry over.`;
}

async function submitTaskFork(event) {
  event.preventDefault();
  const contextScope = checkedValue("forkContextScope", "from_here");
  const workspaceMode = checkedValue("forkWorkspaceMode", "same_directory");
  const selectedArtifacts = [...elements.forkArtifactList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value);
  if (contextScope === "selected_artifacts" && selectedArtifacts.length === 0) {
    elements.forkTaskError.textContent = "Choose at least one artifact to carry.";
    elements.forkTaskError.classList.remove("hidden");
    return;
  }
  setButtonBusy(elements.forkTaskSubmit, true, workspaceMode === "new_worktree" ? "Creating worktree…" : "Creating fork…");
  try {
    const response = await api.forkTask({
      taskId: elements.forkTaskParentId.value,
      name: elements.forkTaskName.value,
      objective: elements.forkTaskObjective.value,
      sourceEventId: elements.forkTaskSourceEventId.value,
      contextScope,
      workspaceMode,
      selectedArtifacts
    });
    closeTaskForkModal();
    adoptOpenedTask(response);
    toast("Fork created and opened. No model request or tool call was replayed.");
  } catch (error) {
    elements.forkTaskError.textContent = error.message;
    elements.forkTaskError.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.forkTaskSubmit, false, "Create fork");
  }
}

function latestTaskEventId(task) {
  if (task.id !== state.tasks?.activeTaskId) return "";
  return state.sessionContinuity?.turns?.at(-1)?.id || "";
}

function taskArtifacts(task) {
  const values = new Map();
  for (const reference of task.resourceRefs || []) values.set(String(reference), String(reference));
  for (const canvas of task.canvasState?.canvases || []) {
    values.set(String(canvas.id), `Work surface · ${canvas.title}`);
    for (const block of canvas.blocks || []) {
      for (const artifact of block.artifacts || []) {
        if (artifact.path) values.set(String(artifact.path), `Artifact · ${artifact.path}`);
      }
    }
  }
  return [...values].slice(0, 40).map(([id, label]) => ({ id, label }));
}

function checkedValue(name, fallback) {
  return document.querySelector(`[name="${name}"]:checked`)?.value || fallback;
}

function taskWorkspaceLabel(task) {
  if (task.workspaceMode === "context_only") return "Context only";
  if (task.workspaceMode === "new_worktree") return task.workspace?.branch || "Isolated worktree";
  return task.workspace?.label || "Same workspace";
}

function shortTaskId(value) {
  const text = String(value || "");
  return text.length > 10 ? `${text.slice(0, 8)}…` : text;
}

function openConnectionModal(provider) {
  const form = provider?.credentialForm;
  if (!provider || !form) {
    toast("AMOS did not advertise a secure setup form for this provider.", true);
    return;
  }
  connectionSetupProvider = provider;
  elements.connectionModalTitle.textContent = `Connect ${provider.label}`;
  elements.connectionModalDescription.textContent =
    provider.description || "Add this system to your governed AMOS company.";
  elements.connectionNameInput.value = provider.label;
  elements.connectionProviderTagField.classList.toggle("hidden", !form.customProvider);
  elements.connectionProviderTagInput.required = form.customProvider;
  elements.connectionProviderTagInput.value = "";
  elements.connectionBaseUrlField.classList.toggle("hidden", !form.baseUrlEditable);
  elements.connectionBaseUrlInput.required = form.baseUrlEditable;
  elements.connectionBaseUrlInput.value = form.baseUrl || "";
  elements.connectionAuthSchemeField.classList.toggle("hidden", !form.authSchemeEditable);
  elements.connectionAuthSchemeInput.value = form.authScheme || "bearer";
  elements.connectionContextField.classList.toggle("hidden", !form.contextField);
  elements.connectionContextInput.required = Boolean(form.contextField);
  elements.connectionContextInput.type = form.contextField?.type || "text";
  elements.connectionContextInput.min = form.contextField?.type === "number" ? "1" : "";
  elements.connectionContextInput.value = "";
  elements.connectionContextLabel.textContent =
    form.contextField?.label || "Connection identifier";
  elements.connectionContextInput.placeholder = form.contextField?.placeholder || "";
  elements.connectionUsernameInput.value = "";
  elements.connectionCredentialLabel.textContent = form.credentialLabel || "Credential";
  elements.connectionCredentialInput.value = "";
  elements.connectionCredentialInput.placeholder = form.placeholder || "Paste credential";
  elements.connectionCredentialHelp.textContent =
    form.help || "AMOS Platform encrypts this value immediately.";
  elements.connectionDefaultFromField.classList.toggle("hidden", !form.defaultFrom);
  elements.connectionDefaultFromInput.value = "";
  refreshConnectionModalFields();
  elements.connectionModalError.textContent = "";
  elements.connectionModalError.classList.add("hidden");
  elements.connectionSubmitButton.disabled = false;
  elements.connectionSubmitButton.textContent = "Save and connect";
  elements.connectionModal.classList.remove("hidden");
  elements.connectionCredentialInput.focus();
}

function refreshConnectionModalFields() {
  const form = connectionSetupProvider?.credentialForm;
  if (!form) return;
  const needsUsername =
    Boolean(form.usernameLabel) ||
    (form.authSchemeEditable && elements.connectionAuthSchemeInput.value === "basic");
  elements.connectionUsernameField.classList.toggle("hidden", !needsUsername);
  elements.connectionUsernameInput.required = needsUsername;
  elements.connectionUsernameLabel.textContent =
    form.usernameLabel || "Username";
  elements.connectionUsernameInput.placeholder = form.usernamePlaceholder || "";
}

function closeConnectionModal() {
  connectionSetupProvider = null;
  elements.connectionForm.reset();
  elements.connectionCredentialInput.value = "";
  elements.connectionUsernameInput.value = "";
  elements.connectionContextInput.value = "";
  elements.connectionModalError.textContent = "";
  elements.connectionModalError.classList.add("hidden");
  elements.connectionModal.classList.add("hidden");
}

async function submitSecretConnection(event) {
  event.preventDefault();
  if (!connectionSetupProvider) return;
  elements.connectionModalError.textContent = "";
  elements.connectionModalError.classList.add("hidden");
  setButtonBusy(elements.connectionSubmitButton, true, "Saving securely…");
  try {
    await api.connectSecretProvider(connectionSetupProvider.provider, {
      displayName: elements.connectionNameInput.value,
      credential: elements.connectionCredentialInput.value,
      username: elements.connectionUsernameInput.value,
      defaultFrom: elements.connectionDefaultFromInput.value,
      providerTag: elements.connectionProviderTagInput.value,
      baseUrl: elements.connectionBaseUrlInput.value,
      authScheme: elements.connectionAuthSchemeInput.value,
      contextValue: elements.connectionContextInput.value
    });
    const label = connectionSetupProvider.label;
    closeConnectionModal();
    toast(`${label} connected through AMOS Platform.`);
  } catch (error) {
    elements.connectionModalError.textContent = friendlyError(error);
    elements.connectionModalError.classList.remove("hidden");
    elements.connectionSubmitButton.disabled = false;
    elements.connectionSubmitButton.textContent = "Save and connect";
  }
}

function connectionCatalogEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "connection-catalog-empty";
  empty.textContent = message;
  return empty;
}

function providerMonogram(provider) {
  const value = String(provider || "").replaceAll("_", " ").trim();
  const words = value.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "↗";
}

function humanizeProvider(provider) {
  return String(provider || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderCanvas() {
  if (!state) return;
  const canvases = Array.isArray(state.canvases) ? state.canvases : [];
  if (!canvases.some((canvas) => canvas.id === activeCanvasId)) {
    activeCanvasId = state.activeCanvasId || canvases[0]?.id || null;
  }
  const canvas = canvases.find((item) => item.id === activeCanvasId) || null;
  const hasBlocks = Boolean(canvas?.blocks?.length);
  renderBriefingLibrary();
  if (!canvas) canvasSidecarOpen = false;
  const sidecarVisible = Boolean(canvas && canvasSidecarOpen && currentView === "operator");
  elements.operatorGrid.classList.toggle("has-context", sidecarVisible);
  elements.canvasSidecar.classList.toggle("hidden", !sidecarVisible);
  elements.contextResizeHandle.classList.toggle("hidden", !sidecarVisible);

  elements.canvasBadge.textContent = String(canvases.length);
  elements.canvasBadge.classList.toggle("hidden", canvases.length === 0);
  elements.canvasEmpty.classList.toggle("hidden", hasBlocks);
  elements.canvasBlocks.classList.toggle("hidden", !hasBlocks);
  elements.canvasSourceBar.classList.toggle("hidden", !canvas);
  elements.canvasTabs.classList.toggle("hidden", canvases.length < 2);
  const briefing = canvas?.source?.briefing || null;
  const canSave = briefing
    ? !briefing.definitionId
    : Boolean(canvas?.source?.refreshPrompt);
  elements.canvasSaveButton.classList.toggle(
    "hidden",
    !canSave
  );
  elements.canvasScheduleButton.classList.toggle("hidden", !briefing);
  elements.canvasRefreshButton.classList.toggle("hidden", !briefing && !canvas?.source?.refreshPrompt);
  elements.canvasTabs.replaceChildren();
  elements.canvasBlocks.replaceChildren();
  elements.canvasSourceBar.replaceChildren();

  for (const item of canvases) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `canvas-tab${item.id === activeCanvasId ? " active" : ""}`;
    tab.textContent = item.title;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(item.id === activeCanvasId));
    tab.addEventListener("click", () => {
      activeCanvasId = item.id;
      canvasSidecarOpen = true;
      renderCanvas();
    });
    elements.canvasTabs.append(tab);
  }

  if (!canvas) {
    elements.canvasTitle.textContent = "No current work surface";
    elements.canvasSubtitle.textContent =
      "Ask AMOS to compare, analyze, draft, or visualize something and the result can open here beside chat.";
    elements.canvasEmptyTitle.textContent = "Ask AMOS for a work surface";
    elements.canvasEmptyMessage.textContent =
      "The conversation remains the primary interface; durable briefing definitions stay in Briefings.";
    elements.canvasStartButton.classList.add("hidden");
    return;
  }

  elements.canvasTitle.textContent = canvas.title;
  elements.canvasSubtitle.textContent = canvas.subtitle || "A current operating view generated from the sources below.";
  renderCanvasSource(canvas);
  if (!hasBlocks) {
    const copy = canvasStateCopy(canvas.state);
    elements.canvasEmptyTitle.textContent = copy.title;
    elements.canvasEmptyMessage.textContent = copy.message;
    elements.canvasStartButton.classList.toggle("hidden", canvas.state?.kind === "loading");
  }
  for (const block of canvas.blocks) elements.canvasBlocks.append(renderCanvasBlock(block));

  elements.canvasRefreshButton.onclick = () => {
    if (briefing) {
      runPlatformBriefing({
        briefingId: briefing.definitionId || undefined,
        templateKey: briefing.definitionId ? undefined : briefing.templateKey,
        title: briefing.title
      });
      return;
    }
    showView("operator");
    elements.promptInput.value = canvas.source.refreshPrompt;
    elements.promptInput.focus();
  };
}

function renderBriefingLibrary() {
  const localSavedViews = Array.isArray(state.savedViews) ? state.savedViews : [];
  const platformLibrary = state.briefings || {};
  const platformBriefings = Array.isArray(platformLibrary.briefings) ? platformLibrary.briefings : [];
  const templates = Array.isArray(platformLibrary.templates) ? platformLibrary.templates : [];
  const canvases = Array.isArray(state.canvases) ? state.canvases : [];
  elements.liveCanvasList.replaceChildren();
  elements.savedViewList.replaceChildren();
  elements.briefingTemplateList.replaceChildren();

  if (canvases.length === 0) {
    const empty = document.createElement("p");
    empty.className = "briefing-library-empty";
    empty.textContent = "Ask AMOS for a comparison, analysis, draft, or visualization to create a work surface.";
    elements.liveCanvasList.append(empty);
  } else {
    for (const canvas of canvases) {
      elements.liveCanvasList.append(briefingCard({
        title: canvas.title,
        description: `${canvas.blocks?.length || 0} block${canvas.blocks?.length === 1 ? "" : "s"} · ${canvas.source?.label || "AMOS work"}`,
        actionLabel: "Open beside chat",
        onAction: () => openCanvasSidecar(canvas.id),
        onRemove: () => removeCanvas(canvas.id)
      }));
    }
  }

  if (platformBriefings.length === 0 && localSavedViews.length === 0) {
    const empty = document.createElement("p");
    empty.className = "briefing-library-empty";
    empty.textContent = state.connectionMode === "user"
      ? "Save any live briefing to reopen and refresh it here."
      : "Connect your company to save identity-pinned live briefings.";
    elements.savedViewList.append(empty);
  } else {
    for (const view of platformBriefings) {
      const schedules = Array.isArray(view.schedules) ? view.schedules : [];
      const active = schedules.find((schedule) => schedule.status === "active");
      const paused = schedules.find((schedule) => schedule.status === "paused");
      const schedule = active || paused;
      elements.savedViewList.append(briefingCard({
        title: view.title,
        description: briefingDefinitionDescription(view, schedule),
        actionLabel: "Run",
        onAction: () => runPlatformBriefing({ briefingId: view.id, title: view.title }),
        onRemove: () => removeSavedBriefing(view.id),
        extraActions: [
          ...(view.latest_run?.id ? [{
            label: "Open latest",
            onAction: () => openPlatformBriefingRun(view.latest_run.id)
          }] : []),
          ...(schedule ? [{
            label: schedule.status === "active" ? "Pause" : "Resume",
            onAction: () => changeBriefingScheduleStatus(schedule.id, schedule.status !== "active")
          }] : [])
        ]
      }));
    }
    for (const view of localSavedViews) {
      elements.savedViewList.append(briefingCard({
        title: view.title,
        description: `Private local definition updated ${relativeTime(view.updatedAt)} · live data refreshes when opened`,
        actionLabel: "Run",
        onAction: () => stageBriefingPrompt(view.prompt),
        onRemove: () => removeSavedBriefing(view.id)
      }));
    }
  }

  for (const template of templates) {
    elements.briefingTemplateList.append(briefingCard({
      title: template.title,
      description: template.description || template.objective,
      actionLabel: "Create",
      onAction: () => runPlatformBriefing({ templateKey: template.key, title: template.title })
    }));
  }
  if (templates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "briefing-library-empty";
    empty.textContent = platformLibrary.supported === false
      ? "This AMOS server does not yet advertise governed Briefing templates."
      : "No Briefing templates are currently available.";
    elements.briefingTemplateList.append(empty);
  }
}

function briefingCard({ title, description, actionLabel, onAction, onRemove = null, extraActions = [] }) {
  const card = document.createElement("article");
  card.className = "briefing-library-card";
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const detail = document.createElement("p");
  detail.textContent = description;
  copy.append(heading, detail);
  const actions = document.createElement("div");
  const action = document.createElement("button");
  action.type = "button";
  action.className = "text-button";
  action.textContent = `${actionLabel} →`;
  action.addEventListener("click", onAction);
  actions.append(action);
  for (const extraAction of extraActions) {
    const secondary = document.createElement("button");
    secondary.type = "button";
    secondary.className = "text-button";
    secondary.textContent = extraAction.label;
    secondary.addEventListener("click", extraAction.onAction);
    actions.append(secondary);
  }
  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button danger-text";
    remove.textContent = "Remove";
    remove.addEventListener("click", onRemove);
    actions.append(remove);
  }
  card.append(copy, actions);
  return card;
}

function stageBriefingPrompt(prompt) {
  showView("operator");
  elements.promptInput.value = prompt;
  elements.promptInput.focus();
}

async function saveActiveBriefing() {
  if (!activeCanvasId) return;
  setButtonBusy(elements.canvasSaveButton, true, "Saving…");
  try {
    const result = await api.saveCanvasView(activeCanvasId);
    if (result.briefings) state.briefings = result.briefings;
    else if (result.briefing) {
      state.briefings = { ...(state.briefings || {}), briefings: result.savedViews || [] };
    } else state.savedViews = result.savedViews || [];
    renderBriefingLibrary();
    toast(`Saved “${result.savedView.title}”.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.canvasSaveButton, false, "Save briefing");
  }
}

async function removeSavedBriefing(id) {
  try {
    const result = await api.removeSavedView(id);
    if (result.briefings) state.briefings = result.briefings;
    else state.savedViews = result.savedViews || [];
    renderBriefingLibrary();
    toast("Saved briefing removed.");
  } catch (error) {
    toast(error.message, true);
  }
}

async function runPlatformBriefing(input) {
  showView("operator");
  canvasSidecarOpen = true;
  try {
    const result = await api.runBriefing(input);
    state.canvases = result.canvases || state.canvases;
    state.activeCanvasId = result.activeCanvasId || result.canvas?.id || state.activeCanvasId;
    activeCanvasId = state.activeCanvasId;
    renderCanvas();
  } catch (error) {
    toast(error.message, true);
  }
}

async function openPlatformBriefingRun(runId) {
  showView("operator");
  canvasSidecarOpen = true;
  try {
    const result = await api.openBriefingRun(runId);
    state.canvases = result.canvases || state.canvases;
    state.activeCanvasId = result.activeCanvasId || result.canvas?.id || state.activeCanvasId;
    activeCanvasId = state.activeCanvasId;
    renderCanvas();
  } catch (error) {
    toast(error.message, true);
  }
}

function openBriefingScheduleModal() {
  const canvas = (state.canvases || []).find((item) => item.id === activeCanvasId);
  if (!canvas?.source?.briefing) return;
  elements.briefingScheduleTitle.textContent = `Schedule “${canvas.title}”.`;
  elements.briefingScheduleError.classList.add("hidden");
  elements.briefingScheduleError.textContent = "";
  renderBriefingScheduleFields();
  elements.briefingScheduleModal.classList.remove("hidden");
}

function closeBriefingScheduleModal() {
  elements.briefingScheduleModal.classList.add("hidden");
}

function renderBriefingScheduleFields() {
  const kind = elements.briefingScheduleKind.value;
  elements.briefingWeekdayField.classList.toggle("hidden", kind !== "weekly");
  elements.briefingTimeField.classList.toggle("hidden", kind === "interval");
  elements.briefingIntervalField.classList.toggle("hidden", kind !== "interval");
}

async function scheduleActiveBriefing(event) {
  event.preventDefault();
  if (!activeCanvasId) return;
  const kind = elements.briefingScheduleKind.value;
  const [hourUtc, minuteUtc] = elements.briefingScheduleTime.value.split(":").map(Number);
  const cadence = kind === "interval"
    ? { kind, everyMinutes: Number(elements.briefingScheduleInterval.value) }
    : {
        kind,
        hourUtc,
        minuteUtc,
        ...(kind === "weekly" ? { weekday: Number(elements.briefingScheduleWeekday.value) } : {})
      };
  setButtonBusy(elements.briefingScheduleSubmit, true, "Saving…");
  try {
    const response = await api.scheduleCanvasView(activeCanvasId, cadence);
    state.briefings = response.briefings || state.briefings;
    closeBriefingScheduleModal();
    renderBriefingLibrary();
    if (pendingOperationId(response.result)) {
      toast("Schedule saved for governed review. Approve it in Decisions to activate recurring work.");
    } else {
      toast("Briefing schedule is active.");
    }
  } catch (error) {
    elements.briefingScheduleError.textContent = error.message;
    elements.briefingScheduleError.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.briefingScheduleSubmit, false, "Save schedule");
  }
}

async function changeBriefingScheduleStatus(scheduleId, active) {
  try {
    const response = await api.setBriefingScheduleStatus(scheduleId, active);
    state.briefings = response.briefings || state.briefings;
    renderBriefingLibrary();
    toast(pendingOperationId(response.result)
      ? "The schedule change is waiting for governed approval."
      : `Briefing schedule ${active ? "resumed" : "paused"}.`);
  } catch (error) {
    toast(error.message, true);
  }
}

function briefingDefinitionDescription(view, schedule) {
  const updated = relativeTime(view.updated_at || view.updatedAt);
  if (!schedule) return `Definition updated ${updated} · live data refreshes when run`;
  const next = schedule.next_run_at ? ` · next ${relativeTime(schedule.next_run_at)}` : "";
  return `${schedule.status === "active" ? "Scheduled" : "Schedule paused"}${next} · definition updated ${updated}`;
}

function pendingOperationId(value) {
  return value?.pending_id || value?.pendingId || value?.pending_operation?.id || value?.pendingOperation?.id || null;
}

function renderCanvasSource(canvas) {
  const source = canvas.source;
  const live = document.createElement("span");
  live.className = `canvas-source-kind ${source.kind}`;
  live.textContent = source.kind === "live" ? "Live AMOS data" : `${source.kind} data`;
  const label = document.createElement("strong");
  label.textContent = source.label;
  const time = document.createElement("time");
  time.dateTime = source.refreshedAt;
  time.textContent = `Refreshed ${relativeTime(source.refreshedAt)}`;
  const refs = document.createElement("span");
  refs.textContent = `${source.references.length} source${source.references.length === 1 ? "" : "s"}`;
  const stale = Boolean(source.staleAfter) && Date.parse(source.staleAfter) <= Date.now();
  if (stale) {
    live.classList.add("stale");
    live.textContent = "Refresh recommended";
  }
  elements.canvasSourceBar.append(live);
  if (canvas.state?.kind && canvas.state.kind !== "ready") {
    const stateBadge = document.createElement("span");
    stateBadge.className = `canvas-state-kind ${canvas.state.kind}`;
    stateBadge.textContent = canvas.state.kind;
    elements.canvasSourceBar.append(stateBadge);
  }
  elements.canvasSourceBar.append(label, time, refs);
}

function renderCanvasBlock(block) {
  let card;
  if (block.type === "metric") card = renderCanvasMetric(block);
  else if (block.type === "table") card = renderCanvasTable(block);
  else if (block.type === "timeseries") card = renderCanvasTimeseries(block);
  else if (block.type === "markdown") card = renderCanvasMarkdown(block);
  else if (block.type === "code") card = renderCanvasCode(block);
  else if (block.type === "document") card = renderCanvasDocument(block);
  else if (block.type === "link") card = renderCanvasLink(block);
  else if (block.type === "sources") card = renderCanvasSources(block);
  else card = renderCanvasDecision(block);
  card.classList.add(`canvas-source-${block.provenance?.sourceKind || "live"}`);
  renderCanvasProvenance(card, block.provenance);
  return card;
}

function renderCanvasProvenance(card, provenance) {
  if (!provenance) return;
  const footer = document.createElement("footer");
  footer.className = "canvas-block-provenance";
  const parts = [
    provenance.sourceLabel,
    provenance.tenantId ? `tenant ${shortId(provenance.tenantId)}` : "",
    provenance.observedAt ? `observed ${relativeTime(provenance.observedAt)}` : "",
    provenance.uncertainty && provenance.uncertainty !== "none"
      ? `${provenance.uncertainty} evidence`
      : "",
    provenance.receiptId ? `receipt ${shortId(provenance.receiptId)}` : "",
    provenance.approvalId ? `approval ${shortId(provenance.approvalId)}` : ""
  ].filter(Boolean);
  footer.textContent = parts.join(" · ");
  card.append(footer);
}

function canvasStateCopy(state) {
  const message = state?.message;
  return {
    loading: {
      title: "Building this view…",
      message: message || "AMOS is still collecting and adapting the current result."
    },
    empty: {
      title: "No matching company data",
      message: message || "Refresh the source or broaden the question."
    },
    partial: {
      title: "Only part of this view is available",
      message: message || "AMOS preserved the available evidence and marked what is incomplete."
    },
    stale: {
      title: "This view needs a refresh",
      message: message || "The displayed company data is older than its permitted freshness window."
    },
    error: {
      title: "AMOS could not build this view",
      message: message || "Refresh the source or inspect the underlying tool result."
    },
    restricted: {
      title: "Your current role cannot see this view",
      message: message || "AMOS preserved the company boundary instead of exposing unavailable data."
    }
  }[state?.kind] || {
    title: "No displayable blocks",
    message: message || "Ask AMOS to refresh or present this result differently."
  };
}

function renderCanvasMetric(block) {
  const card = document.createElement("article");
  card.className = `canvas-block canvas-metric trend-${block.trend}`;
  const label = document.createElement("span");
  label.className = "canvas-metric-label";
  label.textContent = block.label;
  const value = document.createElement("strong");
  value.className = "canvas-metric-value";
  value.textContent = `${block.value}${block.unit ? ` ${block.unit}` : ""}`;
  card.append(label, value);
  if (block.change) {
    const change = document.createElement("span");
    change.className = "canvas-metric-change";
    change.textContent = `${block.trend === "up" ? "↑" : block.trend === "down" ? "↓" : "→"} ${block.change}`;
    card.append(change);
  }
  if (block.note) {
    const note = document.createElement("p");
    note.textContent = block.note;
    card.append(note);
  }
  return card;
}

function renderCanvasTable(block) {
  const card = canvasCard(block, "canvas-table-block wide");
  if (block.searchable && block.rows.length > 5) {
    const filter = document.createElement("input");
    filter.className = "canvas-filter";
    filter.type = "search";
    filter.placeholder = "Filter this table…";
    filter.setAttribute("aria-label", `Filter ${block.title || "table"}`);
    filter.addEventListener("input", () => renderCanvasTableRows(body, block, filter.value));
    card.append(filter);
  }
  const scroll = document.createElement("div");
  scroll.className = "canvas-table-scroll";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  for (const column of block.columns) {
    const header = document.createElement("th");
    header.textContent = column.label;
    headingRow.append(header);
  }
  head.append(headingRow);
  const body = document.createElement("tbody");
  renderCanvasTableRows(body, block, "");
  table.append(head, body);
  scroll.append(table);
  card.append(scroll);
  return card;
}

function renderCanvasTableRows(body, block, query) {
  const normalized = query.trim().toLowerCase();
  const rows = normalized
    ? block.rows.filter((row) =>
      block.columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(normalized))
    )
    : block.rows;
  body.replaceChildren();
  for (const row of rows) {
    const tableRow = document.createElement("tr");
    for (const column of block.columns) {
      const cell = document.createElement("td");
      cell.textContent = formatCanvasValue(row[column.key], column.format);
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = block.columns.length;
    cell.className = "canvas-table-empty";
    cell.textContent = "No rows match that filter.";
    row.append(cell);
    body.append(row);
  }
}

function renderCanvasTimeseries(block) {
  const card = canvasCard(block, "canvas-chart-block wide");
  const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chart.classList.add("canvas-chart");
  chart.setAttribute("viewBox", "0 0 760 260");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", block.title || "Time series");
  const allPoints = block.series.flatMap((series) => series.points);
  const values = allPoints.map((point) => point.y);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const left = 42;
  const top = 20;
  const width = 690;
  const height = 190;
  const colors = ["#7da2ff", "#45d6a0", "#ff9b73", "#c49bff", "#f2cf5b", "#6cd2f2"];

  for (let index = 0; index < 4; index += 1) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const y = top + (height / 3) * index;
    line.setAttribute("x1", left);
    line.setAttribute("x2", left + width);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.classList.add("canvas-chart-grid");
    chart.append(line);
  }

  block.series.forEach((series, seriesIndex) => {
    if (series.points.length === 0) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", colors[seriesIndex]);
    path.setAttribute("stroke-width", "3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute(
      "points",
      series.points.map((point, pointIndex) => {
        const x = left + (width * pointIndex) / Math.max(1, series.points.length - 1);
        const y = top + height - ((point.y - minimum) / range) * height;
        return `${x},${y}`;
      }).join(" ")
    );
    chart.append(path);
  });
  card.append(chart);
  const legend = document.createElement("div");
  legend.className = "canvas-chart-legend";
  block.series.forEach((series, index) => {
    const item = document.createElement("span");
    const dot = document.createElement("i");
    dot.style.background = colors[index];
    item.append(dot, document.createTextNode(series.name));
    legend.append(item);
  });
  card.append(legend);
  return card;
}

function renderCanvasMarkdown(block) {
  const card = canvasCard(block, "canvas-markdown-block wide");
  const markdown = document.createElement("div");
  markdown.className = "markdown-content";
  renderMarkdown(markdown, block.content);
  card.append(markdown);
  return card;
}

function renderCanvasCode(block) {
  const card = canvasCard(block, "canvas-code-block wide");
  const meta = document.createElement("div");
  meta.className = "canvas-code-meta";
  meta.textContent = [
    block.filename,
    block.language,
    block.startLine > 1 ? `starts at line ${block.startLine}` : ""
  ].filter(Boolean).join(" · ") || "Code";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block.content;
  pre.append(code);
  card.append(meta, pre);
  return card;
}

function renderCanvasDocument(block) {
  const card = canvasCard(block, `canvas-document-block wide document-style-${block.document.style}`);
  const summary = document.createElement("div");
  summary.className = "document-preview-summary";
  const status = document.createElement("span");
  status.className = `document-layout-status ${block.diagnostics.length ? "attention" : "ready"}`;
  status.textContent = block.diagnostics.length
    ? `${block.diagnostics.length} layout ${block.diagnostics.length === 1 ? "note" : "notes"}`
    : "Layout checks passed";
  const estimate = document.createElement("span");
  estimate.textContent = `About ${block.estimatedPages} ${block.estimatedPages === 1 ? "page" : "pages"}`;
  const verification = document.createElement("span");
  verification.textContent = block.artifacts.every((artifact) => artifact.verified)
    ? "Reopened and verified"
    : "Verification incomplete";
  summary.append(status, estimate, verification);
  card.append(summary);

  if (block.diagnostics.length > 0) {
    const diagnostics = document.createElement("div");
    diagnostics.className = "document-diagnostics";
    for (const item of block.diagnostics) {
      const row = document.createElement("div");
      row.className = `document-diagnostic ${item.severity}`;
      const mark = document.createElement("span");
      mark.textContent = item.severity === "error" ? "×" : item.severity === "warning" ? "!" : "i";
      const copy = document.createElement("div");
      const code = document.createElement("strong");
      code.textContent = item.code.replaceAll("-", " ");
      const message = document.createElement("p");
      message.textContent = item.message;
      copy.append(code, message);
      row.append(mark, copy);
      diagnostics.append(row);
    }
    card.append(diagnostics);
  }

  const previewLabel = document.createElement("div");
  previewLabel.className = "document-preview-label";
  previewLabel.textContent = block.previewTruncated
    ? `Structured preview · showing ${block.document.blocks.length} of ${block.totalBlocks} blocks`
    : "Structured preview · final pagination is preserved in the verified files";
  card.append(previewLabel);

  const pages = [[]];
  for (const documentBlock of block.document.blocks) {
    if (documentBlock.type === "page_break") pages.push([]);
    else pages.at(-1).push(documentBlock);
  }
  const deck = document.createElement("div");
  deck.className = "document-page-deck";
  pages.forEach((pageBlocks, pageIndex) => {
    const page = document.createElement("section");
    page.className = "document-preview-page";
    if (pageIndex === 0) {
      const title = document.createElement("h3");
      title.className = "document-preview-title";
      title.textContent = block.document.title;
      page.append(title);
      if (block.document.subtitle) {
        const subtitle = document.createElement("p");
        subtitle.className = "document-preview-subtitle";
        subtitle.textContent = block.document.subtitle;
        page.append(subtitle);
      }
      if (block.document.author) {
        const author = document.createElement("p");
        author.className = "document-preview-author";
        author.textContent = block.document.author;
        page.append(author);
      }
    }
    for (const documentBlock of pageBlocks) {
      page.append(renderDocumentPreviewBlock(documentBlock));
    }
    const pageMarker = document.createElement("footer");
    pageMarker.textContent = pages.length > 1
      ? `Explicit section ${pageIndex + 1} of ${pages.length}`
      : "Document preview";
    page.append(pageMarker);
    deck.append(page);
  });
  card.append(deck);

  const artifacts = document.createElement("div");
  artifacts.className = "document-artifacts";
  for (const artifact of block.artifacts) {
    const row = document.createElement("div");
    row.className = "document-artifact-row";
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = artifact.path;
    const detail = document.createElement("small");
    detail.textContent = `${artifact.format.toUpperCase()} · ${formatBytes(artifact.bytes)} · SHA-256 ${artifact.sha256.slice(0, 12)}…`;
    copy.append(name, detail);
    const actions = document.createElement("div");
    const open = actionButton("Open", "primary");
    open.addEventListener("click", () => openDocumentArtifact(artifact.path, "open", open));
    const reveal = actionButton("Show in folder", "secondary");
    reveal.addEventListener("click", () => openDocumentArtifact(artifact.path, "reveal", reveal));
    actions.append(open, reveal);
    row.append(copy, actions);
    artifacts.append(row);
  }
  const refine = actionButton("Refine with AMOS", "secondary");
  refine.classList.add("document-refine-button");
  refine.addEventListener("click", () => {
    showView("operator");
    elements.promptInput.value = block.diagnostics.length
      ? `Refine “${block.document.title}” using the visible layout diagnostics, then regenerate the same document files.`
      : `Revise “${block.document.title}” and regenerate the same document files. Preserve the verified structure unless I specify a change.`;
    elements.promptInput.focus();
  });
  artifacts.append(refine);
  card.append(artifacts);
  return card;
}

function renderDocumentPreviewBlock(block) {
  if (block.type === "heading") {
    const heading = document.createElement(block.level === 1 ? "h4" : "h5");
    heading.className = `document-preview-heading level-${block.level}`;
    heading.textContent = block.text;
    return heading;
  }
  if (block.type === "paragraph") {
    const paragraph = document.createElement("p");
    paragraph.className = "document-preview-paragraph";
    paragraph.textContent = block.text;
    return paragraph;
  }
  if (block.type === "list") {
    const list = document.createElement(block.style === "numbered" ? "ol" : "ul");
    list.className = "document-preview-list";
    for (const value of block.items) {
      const item = document.createElement("li");
      item.textContent = value;
      list.append(item);
    }
    return list;
  }
  if (block.type === "table") {
    const scroll = document.createElement("div");
    scroll.className = "document-preview-table-scroll";
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const value of block.headers) {
      const header = document.createElement("th");
      header.textContent = value;
      headerRow.append(header);
    }
    head.append(headerRow);
    const body = document.createElement("tbody");
    for (const values of block.rows) {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    scroll.append(table);
    return scroll;
  }
  if (block.type === "callout") {
    const callout = document.createElement("aside");
    callout.className = "document-preview-callout";
    if (block.label) {
      const label = document.createElement("strong");
      label.textContent = `${block.label}: `;
      callout.append(label);
    }
    callout.append(document.createTextNode(block.text));
    return callout;
  }
  const sources = document.createElement("section");
  sources.className = "document-preview-sources";
  const heading = document.createElement("h5");
  heading.textContent = "Sources";
  const list = document.createElement("ol");
  for (const source of block.sources) {
    const item = document.createElement("li");
    item.textContent = `${source.label} — ${source.url || source.source_ref}`;
    list.append(item);
  }
  sources.append(heading, list);
  return sources;
}

async function openDocumentArtifact(path, mode, button) {
  setButtonBusy(button, true, mode === "open" ? "Opening…" : "Finding…");
  try {
    await api.openDocumentArtifact(path, mode);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, mode === "open" ? "Open" : "Show in folder");
  }
}

function renderCanvasLink(block) {
  const card = canvasCard(block, "canvas-link-block");
  const label = document.createElement("strong");
  label.textContent = block.label;
  card.append(label);
  if (block.description) {
    const description = document.createElement("p");
    description.textContent = block.description;
    card.append(description);
  }
  const action = document.createElement("button");
  action.type = "button";
  action.className = "button secondary";
  action.textContent = `${block.actionLabel} ↗`;
  action.addEventListener("click", () => {
    api.openExternal(block.url).catch((error) => toast(error.message, true));
  });
  card.append(action);
  return card;
}

function renderCanvasSources(block) {
  const card = canvasCard(block, "canvas-sources-block");
  const list = document.createElement("ul");
  for (const source of block.items) {
    const item = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = source.label;
    const detail = document.createElement("span");
    detail.textContent = [
      source.type,
      source.id,
      source.observedAt ? `observed ${relativeTime(source.observedAt)}` : ""
    ].filter(Boolean).join(" · ");
    item.append(label, detail);
    list.append(item);
  }
  card.append(list);
  return card;
}

function renderCanvasDecision(block) {
  const card = canvasCard(block, `canvas-decision-block ${block.status}`);
  const status = document.createElement("span");
  status.className = `canvas-decision-status ${block.status}`;
  status.textContent = `${block.kind} · ${block.status}`;
  const summary = document.createElement("p");
  summary.textContent = block.summary;
  card.append(status, summary);
  if (block.details.length > 0) {
    const details = document.createElement("dl");
    for (const detail of block.details) {
      const term = document.createElement("dt");
      term.textContent = detail.label;
      const value = document.createElement("dd");
      value.textContent = String(detail.value ?? "—");
      details.append(term, value);
    }
    card.append(details);
  }
  if (block.kind === "approval" && block.status === "pending" && block.pendingId) {
    const review = document.createElement("button");
    review.type = "button";
    review.className = "button primary";
    review.textContent = approvalActionLabel();
    review.addEventListener("click", () => reviewCanvasApproval(block.pendingId, review));
    card.append(review);
  }
  return card;
}

function canvasCard(block, className) {
  const card = document.createElement("article");
  card.className = `canvas-block ${className}`;
  if (block.title) {
    const title = document.createElement("h2");
    title.textContent = block.title;
    card.append(title);
  }
  return card;
}

function formatCanvasValue(value, format) {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "currency" && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(value));
  }
  if (format === "percent" && Number.isFinite(Number(value))) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value))}%`;
  }
  if (format === "number" && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat().format(Number(value));
  }
  if ((format === "date" || format === "datetime") && !Number.isNaN(Date.parse(value))) {
    return format === "date"
      ? new Date(value).toLocaleDateString()
      : new Date(value).toLocaleString();
  }
  return String(value);
}

function openCanvasSidecar(id = activeCanvasId) {
  if (!id) return;
  activeCanvasId = id;
  state.activeCanvasId = id;
  canvasSidecarOpen = true;
  showView("operator");
  elements.promptInput.focus();
}

function closeCanvasSidecar() {
  canvasSidecarOpen = false;
  renderCanvas();
  elements.promptInput.focus();
}

async function removeCanvas(id) {
  if (!id) return;
  try {
    const result = await api.removeCanvas(id);
    state.canvases = result.canvases;
    state.activeCanvasId = result.activeCanvasId;
    activeCanvasId = result.activeCanvasId;
    if (!activeCanvasId) canvasSidecarOpen = false;
    renderCanvas();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderPrivateMemory() {
  if (!state) return;
  const memories = Array.isArray(state.privateMemory) ? state.privateMemory : [];
  elements.privateMemoryBadge.textContent = String(memories.length);
  elements.privateMemoryBadge.classList.toggle("hidden", memories.length === 0);
  elements.privateMemoryEmpty.classList.toggle("hidden", memories.length > 0);
  elements.memoryExportButton.disabled = memories.length === 0;
  elements.privateMemoryList.replaceChildren();

  for (const memory of memories) {
    const card = document.createElement("article");
    card.className = "private-memory-card";
    const icon = document.createElement("span");
    icon.className = "private-memory-icon";
    icon.textContent = memory.kind === "image" ? "▧" : "≡";
    const content = document.createElement("div");
    content.className = "private-memory-copy";
    const meta = document.createElement("div");
    meta.className = "private-memory-meta";
    const privacy = document.createElement("span");
    privacy.textContent = "Encrypted · private";
    const date = document.createElement("time");
    date.textContent = relativeTime(memory.updatedAt);
    meta.append(privacy, date);
    const title = document.createElement("h2");
    title.textContent = memory.name;
    const detail = document.createElement("p");
    detail.textContent = `${memory.kind === "image" ? "Image" : "Document"} · ${formatBytes(memory.size)}`;
    content.append(meta, title, detail);
    if (memory.promotedAt) {
      const promoted = document.createElement("span");
      promoted.className = "memory-promoted";
      promoted.textContent = `Also in company memory · ${relativeTime(memory.promotedAt)}`;
      content.append(promoted);
    }
    if (memory.lineage?.capsuleId) {
      const lineage = document.createElement("span");
      lineage.className = "memory-lineage";
      lineage.textContent = `Portable lineage · ${shortId(memory.lineage.capsuleId)}`;
      content.append(lineage);
    }

    const actions = document.createElement("div");
    actions.className = "private-memory-actions";
    const use = actionButton("Use in next task", "secondary");
    use.addEventListener("click", async () => {
      setButtonBusy(use, true, "Adding…");
      try {
        const result = await api.usePrivateMemory(memory.id);
        state.privateMemory = result.privateMemory;
        updateAttachments(result.attachments);
        renderPrivateMemory();
        showView("operator");
        elements.promptInput.focus();
        toast(`${memory.name} is attached to the next task.`);
      } catch (error) {
        toast(error.message, true);
      } finally {
        setButtonBusy(use, false, "Use in next task");
      }
    });
    const promote = actionButton(memory.promotedAt ? "Promote again" : "Promote to company", "secondary");
    promote.addEventListener("click", async () => {
      setButtonBusy(promote, true, "Promoting…");
      try {
        const result = await api.promotePrivateMemory(memory.id);
        state.privateMemory = result.privateMemory;
        renderPrivateMemory();
        toast(`${memory.name} was submitted to governed company memory.`);
      } catch (error) {
        toast(error.message, true);
      } finally {
        setButtonBusy(promote, false, memory.promotedAt ? "Promote again" : "Promote to company");
      }
    });
    const exportCapsule = actionButton("Export", "secondary");
    exportCapsule.addEventListener("click", () => openCapsuleFlow("export", [memory.id]));
    const forget = actionButton("Forget", "danger");
    forget.addEventListener("click", async () => {
      if (!window.confirm(`Permanently forget “${memory.name}” on this computer?`)) return;
      setButtonBusy(forget, true, "Forgetting…");
      try {
        const result = await api.forgetPrivateMemory(memory.id);
        state.privateMemory = result.privateMemory;
        renderPrivateMemory();
        toast(`${memory.name} was forgotten.`);
      } catch (error) {
        toast(error.message, true);
      } finally {
        setButtonBusy(forget, false, "Forget");
      }
    });
    actions.append(use, promote, exportCapsule, forget);
    card.append(icon, content, actions);
    elements.privateMemoryList.append(card);
  }

  elements.memoryClassGrid.replaceChildren();
  for (const memoryClass of state.memoryClasses || []) {
    const card = document.createElement("article");
    card.className = `memory-class-card ${memoryClass.id}`;
    const label = document.createElement("span");
    label.textContent = memoryClass.label;
    const authority = document.createElement("small");
    authority.textContent = memoryClass.authority === "amos" ? "AMOS governed" : memoryClass.authority === "user" ? "You control it" : "This session";
    const description = document.createElement("p");
    description.textContent = memoryClass.description;
    card.append(label, authority, description);
    elements.memoryClassGrid.append(card);
  }
}

function renderCompanyCache() {
  if (!state) return;
  const cache = state.companyCache || { status: "missing", available: false };
  const status = cache.status || "missing";
  elements.companyCacheCard.classList.toggle("active", status === "active");
  elements.companyCacheCard.classList.toggle("expired", status === "expired");
  elements.companyCacheCard.classList.toggle("error", status === "error");
  elements.companyCacheRemoveButton.classList.toggle(
    "hidden",
    ["missing", "unavailable"].includes(status)
  );
  elements.companyCacheRefreshButton.disabled =
    state.mode?.offline ||
    !state.connected ||
    state.connectionMode !== "user";
  elements.companyCacheRefreshButton.textContent =
    status === "active" ? "Refresh four hours" : "Make available offline";

  if (status === "active") {
    elements.companyCacheStatus.textContent = `${cache.tenantSlug || "Company"} context is ready offline`;
    elements.companyCacheDetail.textContent =
      "AMOS Desktop can read this verified point-in-time briefing in local-only mode. Every company action still requires a live connection and fresh policy evaluation.";
  } else if (status === "expired") {
    elements.companyCacheStatus.textContent = "Offline company context expired";
    elements.companyCacheDetail.textContent =
      "The briefing is no longer available to the model. Return online and refresh it under your current identity and permissions.";
  } else if (status === "error") {
    elements.companyCacheStatus.textContent = "Offline company context needs attention";
    elements.companyCacheDetail.textContent =
      cache.error || "AMOS Desktop could not validate the encrypted company cache.";
  } else if (status === "unavailable") {
    elements.companyCacheStatus.textContent = "Encrypted company context is unavailable";
    elements.companyCacheDetail.textContent =
      cache.error || "This computer cannot currently protect a local company briefing.";
  } else {
    elements.companyCacheStatus.textContent = "No offline company context";
    elements.companyCacheDetail.textContent =
      "Connect with your personal AMOS sign-in, then explicitly store a four-hour briefing for local-only work. It never includes credentials or action authority.";
  }

  elements.companyCacheMeta.replaceChildren();
  for (const value of [
    cache.issuedAt ? `Captured ${relativeTime(cache.issuedAt)}` : "",
    cache.expiresAt
      ? `${status === "expired" ? "Expired" : "Expires"} ${new Date(cache.expiresAt).toLocaleString()}`
      : "",
    cache.role ? `Role ${cache.role}` : "",
    cache.scopeCount ? `${cache.scopeCount} effective scopes` : "",
    status !== "missing" && status !== "unavailable" ? "Read-only · no credentials" : ""
  ].filter(Boolean)) {
    const item = document.createElement("span");
    item.textContent = value;
    elements.companyCacheMeta.append(item);
  }
}

function renderWorkingContinuity() {
  if (!state || !elements.workingContinuityCard) return;
  const continuity = state.workingContinuity;
  const onlineUser =
    state.mode?.id === "online" && state.connectionMode === "user";
  const paused = !onlineUser || continuity?.supported === false;
  elements.workingContinuityCard.classList.toggle("paused", paused);
  elements.workingContinuityMeta.replaceChildren();

  if (!onlineUser) {
    elements.workingContinuityStatus.textContent = "Cross-client continuity is paused";
    elements.workingContinuityDetail.textContent =
      "It resumes automatically in online company mode with a personal AMOS sign-in. Personal and local-only work stays on this computer.";
  } else if (continuity?.supported === false) {
    elements.workingContinuityStatus.textContent = "Continuity is waiting for the platform update";
    elements.workingContinuityDetail.textContent =
      "This Desktop version is ready, but the connected AMOS server does not yet expose the private continuity lane. Normal work is unaffected.";
  } else if (continuity?.available) {
    elements.workingContinuityStatus.textContent = "Your latest work can follow you";
    elements.workingContinuityDetail.textContent =
      "AMOS saved compact state—not chat—so another compatible client using this same identity and company can continue. It carries no current authority and never becomes company memory automatically.";
  } else if (continuity) {
    elements.workingContinuityStatus.textContent = "Continuity is ready";
    elements.workingContinuityDetail.textContent =
      "After a completed online task, AMOS will quietly save the objective, outcome, decisions, open loops, and safe artifact references for the next compatible client.";
  } else {
    elements.workingContinuityStatus.textContent = "Continuity is preparing";
    elements.workingContinuityDetail.textContent =
      "AMOS is checking for bounded working state from this user and company. You do not need to manage it.";
  }

  const source = String(continuity?.sourceClient || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  for (const value of [
    continuity?.updatedAt ? `Updated ${relativeTime(continuity.updatedAt)}` : "",
    source ? `From ${source}` : "",
    continuity?.revision ? `Revision ${continuity.revision}` : "",
    continuity?.stale ? "Older checkpoint · verify before use" : "",
    continuity?.available ? "State only · no credentials or authority" : ""
  ].filter(Boolean)) {
    const item = document.createElement("span");
    item.textContent = value;
    elements.workingContinuityMeta.append(item);
  }
}

async function refreshCompanyCache() {
  const firstCopy = !state.companyCache || state.companyCache.status === "missing";
  if (
    firstCopy &&
    !window.confirm(
      "Store a server-signed company briefing on this computer for up to four hours? It is encrypted locally, read-only, and contains no credentials."
    )
  ) {
    return;
  }
  setButtonBusy(elements.companyCacheRefreshButton, true, "Verifying…");
  try {
    state = await api.refreshCompanyCache(14_400);
    render();
    toast("Signed company context is available offline for four hours.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(
      elements.companyCacheRefreshButton,
      false,
      state.companyCache?.status === "active" ? "Refresh four hours" : "Make available offline"
    );
  }
}

async function removeCompanyCache() {
  if (!window.confirm("Remove the offline company briefing from this computer?")) return;
  setButtonBusy(elements.companyCacheRemoveButton, true, "Removing…");
  try {
    state = await api.removeCompanyCache();
    render();
    toast("Offline company context was removed.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.companyCacheRemoveButton, false, "Remove");
  }
}

function openCapsuleFlow(mode, ids = null) {
  capsuleFlow = { mode, ids, previewId: null };
  elements.capsulePassphraseForm.classList.remove("hidden");
  elements.capsulePreview.classList.add("hidden");
  elements.capsuleError.classList.add("hidden");
  elements.capsuleError.textContent = "";
  elements.capsulePassphraseInput.value = "";
  elements.capsuleConfirmInput.value = "";
  const exporting = mode === "export";
  elements.capsuleModalTitle.textContent = exporting
    ? ids?.length === 1
      ? "Encrypt this private memory."
      : "Encrypt your private memory."
    : "Unlock a private-memory capsule.";
  elements.capsuleModalMessage.textContent = exporting
    ? "Create a passphrase with at least 12 characters. AMOS cannot recover it, and the capsule never includes your AMOS login, provider keys, or other application credentials."
    : "Enter the capsule passphrase, then choose the .amos-memory file. AMOS validates and previews every item before anything is added to this computer.";
  elements.capsuleConfirmField.classList.toggle("hidden", !exporting);
  elements.capsuleConfirmInput.required = exporting;
  elements.capsuleContinueButton.textContent = exporting
    ? "Choose save location"
    : "Choose and unlock capsule";
  elements.capsuleModal.classList.remove("hidden");
  elements.capsulePassphraseInput.focus();
}

async function handleCapsulePassphrase(event) {
  event.preventDefault();
  if (!capsuleFlow) return;
  const passphrase = elements.capsulePassphraseInput.value;
  elements.capsuleError.classList.add("hidden");
  if (passphrase.length < 12) {
    showCapsuleError("Use at least 12 characters for the capsule passphrase.");
    return;
  }
  if (capsuleFlow.mode === "export" && passphrase !== elements.capsuleConfirmInput.value) {
    showCapsuleError("The capsule passphrases do not match.");
    return;
  }
  setButtonBusy(
    elements.capsuleContinueButton,
    true,
    capsuleFlow.mode === "export" ? "Encrypting…" : "Unlocking…"
  );
  try {
    if (capsuleFlow.mode === "export") {
      const result = await api.exportPrivateMemoryCapsule({
        passphrase,
        ids: capsuleFlow.ids
      });
      clearCapsuleSecrets();
      if (result.canceled) return;
      const summary = result.summary;
      await closeCapsuleModal();
      const lineage = summary.parentCapsuleId ? " with fork lineage preserved" : "";
      toast(`Encrypted ${summary.itemCount} private ${summary.itemCount === 1 ? "memory" : "memories"}${lineage}.`);
      return;
    }
    const result = await api.previewPrivateMemoryCapsule({ passphrase });
    clearCapsuleSecrets();
    if (result.canceled) return;
    capsuleFlow.previewId = result.preview.previewId;
    renderCapsulePreview(result.preview);
  } catch (error) {
    clearCapsuleSecrets();
    showCapsuleError(error.message);
  } finally {
    setButtonBusy(
      elements.capsuleContinueButton,
      false,
      capsuleFlow?.mode === "export" ? "Choose save location" : "Choose and unlock capsule"
    );
  }
}

function renderCapsulePreview(preview) {
  elements.capsulePassphraseForm.classList.add("hidden");
  elements.capsulePreview.classList.remove("hidden");
  elements.capsulePreviewSummary.textContent = [
    `${preview.itemCount} private ${preview.itemCount === 1 ? "memory" : "memories"}`,
    formatBytes(preview.totalBytes),
    preview.parentCapsuleId
      ? `forked from ${shortId(preview.parentCapsuleId)}`
      : `capsule ${shortId(preview.capsuleId)}`
  ].join(" · ");
  elements.capsulePreviewItems.replaceChildren();
  for (const item of preview.items) {
    const row = document.createElement("div");
    row.className = "capsule-preview-item";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const detail = document.createElement("span");
    detail.textContent = `${item.kind === "image" ? "Image" : "Document"} · ${formatBytes(item.size)}`;
    row.append(name, detail);
    elements.capsulePreviewItems.append(row);
  }
  elements.capsulePreviewWarning.classList.toggle("hidden", !preview.subjectMismatch);
  elements.capsulePreviewWarning.textContent = preview.subjectMismatch
    ? "This capsule was exported under a different user identity. Its contents remain private on this computer unless you explicitly promote them to governed company memory."
    : "";
}

async function confirmCapsuleImport() {
  if (!capsuleFlow?.previewId) return;
  setButtonBusy(elements.capsuleImportConfirmButton, true, "Importing…");
  try {
    const previewId = capsuleFlow.previewId;
    const result = await api.importPrivateMemoryCapsule(previewId);
    capsuleFlow.previewId = null;
    state.privateMemory = result.privateMemory;
    renderPrivateMemory();
    await closeCapsuleModal();
    const duplicates = result.duplicateCount
      ? ` ${result.duplicateCount} existing ${result.duplicateCount === 1 ? "item was" : "items were"} skipped.`
      : "";
    toast(`Imported ${result.importedCount} private ${result.importedCount === 1 ? "memory" : "memories"}.${duplicates}`);
  } catch (error) {
    elements.capsulePreviewWarning.textContent = error.message;
    elements.capsulePreviewWarning.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.capsuleImportConfirmButton, false, "Import private memory");
  }
}

async function closeCapsuleModal() {
  const previewId = capsuleFlow?.previewId;
  capsuleFlow = null;
  clearCapsuleSecrets();
  elements.capsuleModal.classList.add("hidden");
  elements.capsulePassphraseForm.classList.remove("hidden");
  elements.capsulePreview.classList.add("hidden");
  if (previewId) await api.cancelPrivateMemoryCapsule(previewId).catch(() => {});
}

function clearCapsuleSecrets() {
  elements.capsulePassphraseInput.value = "";
  elements.capsuleConfirmInput.value = "";
}

function showCapsuleError(message) {
  elements.capsuleError.textContent = message;
  elements.capsuleError.classList.remove("hidden");
}

function shortId(value) {
  const id = String(value || "");
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function actionButton(label, variant) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${variant === "danger" ? "danger" : variant}`;
  button.textContent = label;
  return button;
}

function renderIdentity() {
  if (!state) return;
  const identity = state.identity;
  const user = identity?.user;
  const person = user?.name || user?.email || "";
  const company = identity?.tenant_slug || "";
  const role = identity?.role || "";

  elements.connectionDot.classList.toggle("connected", state.connected && !state.mode?.offline);
  const demo = state.connectionMode === "demo";
  elements.connectionLabel.textContent = demo
    ? "Northwind Labs demo"
    : state.mode?.offline
      ? "Local-only mode"
      : state.mode?.personal
        ? "Personal workspace"
        : person || (state.connected ? "AMOS connected" : "AMOS not connected");
  elements.connectionDetail.textContent = state.mode?.offline
    ? "Live company access paused"
    : state.mode?.personal
      ? "No company data or authority"
      : demo
        ? "Short-lived sample company"
        : state.connected
      ? [company, role].filter(Boolean).join(" · ") || "Company governance active"
      : "Connect your company";
  elements.identityDetail.textContent =
    user?.name && user?.email
      ? user.email
      : state.connectionMode === "api_key"
        ? "Machine credential · reconnect for personal decisions"
        : "";
  elements.identityBadge.textContent = demo
    ? "Northwind · demo"
    : person
    ? `${person}${role ? ` · ${role}` : ""}`
    : "";
  elements.identityBadge.classList.toggle("hidden", !person && !demo);
}

function renderCompanySwitcher() {
  const tenants =
    state?.connectionMode === "user" && Array.isArray(state.companies?.tenants)
      ? state.companies.tenants
      : [];
  const visible = tenants.length > 1;
  elements.companySwitcherControl.classList.toggle("hidden", !visible);
  if (!visible) {
    elements.companySwitcher.replaceChildren();
    return;
  }

  const options = tenants.map((tenant) => {
    const option = document.createElement("option");
    option.value = tenant.tenant_id;
    option.textContent = tenant.parent_tenant_name
      ? `${tenant.tenant_name} · ${tenant.relationship_kind || "unit"} of ${tenant.parent_tenant_name}`
      : tenant.tenant_name;
    option.selected = tenant.tenant_id === state.companies.currentTenantId;
    return option;
  });
  elements.companySwitcher.replaceChildren(...options);
}

function renderAccountMenu() {
  const accounts = Array.isArray(state?.accounts?.accounts) ? state.accounts.accounts : [];
  const currentAccountId = state?.accounts?.currentAccountId || "";
  elements.accountMenuButton.title = state?.connectionMode === "api_key"
    ? "Add a personal AMOS sign-in or manage local accounts"
    : "Switch or add an AMOS account";
  elements.accountList.replaceChildren();

  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "account-privacy";
    empty.textContent = "No personal AMOS account is connected on this computer.";
    elements.accountList.append(empty);
  } else {
    for (const account of accounts) {
      const active = account.id === currentAccountId;
      const activeOnline = active && !state.mode?.personal && !state.mode?.offline;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `account-option${active ? " active" : ""}`;
      button.disabled = activeOnline;
      button.dataset.accountId = account.id;

      const avatar = document.createElement("span");
      avatar.className = "account-avatar";
      avatar.textContent = accountInitial(account);
      const copy = document.createElement("span");
      copy.className = "account-copy";
      const title = document.createElement("strong");
      title.textContent = account.name || account.email || account.label || "AMOS account";
      const detail = document.createElement("small");
      detail.textContent = [account.email, account.tenantSlug, account.role]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .join(" · ") || (account.demo ? "Sample company" : "AMOS account");
      copy.append(title, detail);
      button.append(avatar, copy);
      if (active) {
        const mark = document.createElement("span");
        mark.className = "account-active-mark";
        mark.textContent = activeOnline ? "ACTIVE" : "USE";
        button.append(mark);
      }
      if (!activeOnline) {
        button.addEventListener("click", () => switchAccount(account.id));
      }
      elements.accountList.append(button);
    }
  }

  elements.signOutAccountButton.classList.toggle("hidden", !currentAccountId);
  elements.accountVersion.textContent = updateState?.currentVersion
    ? `AMOS Desktop v${updateState.currentVersion}`
    : "AMOS Desktop";
  const status = updateState?.status;
  elements.accountUpdateButton.disabled = ["checking", "downloading", "installing"].includes(status);
  elements.accountUpdateButton.textContent = status === "available"
    ? `Download v${updateState.availableVersion || "latest"}`
    : status === "downloading"
      ? `Downloading${Number.isFinite(updateState.progress) ? ` ${updateState.progress}%` : "…"}`
      : status === "downloaded"
        ? running ? "Ready after task" : "Restart and install"
        : status === "checking"
          ? "Checking…"
          : status === "installing"
            ? "Installing…"
            : "Check for updates";
}

function accountInitial(account) {
  return String(account.name || account.email || account.tenantSlug || "A")
    .trim()
    .charAt(0)
    .toUpperCase() || "A";
}

function toggleAccountMenu() {
  const open = elements.accountMenu.classList.contains("hidden");
  elements.accountMenu.classList.toggle("hidden", !open);
  elements.accountMenuButton.setAttribute("aria-expanded", String(open));
  if (open) renderAccountMenu();
}

function closeAccountMenu() {
  elements.accountMenu.classList.add("hidden");
  elements.accountMenuButton.setAttribute("aria-expanded", "false");
}

async function addAccount() {
  setButtonBusy(elements.addAccountButton, true, "Waiting for sign-in…");
  try {
    state = await api.addAccount();
    sessionStorage.setItem("amos-onboarding-complete", "true");
    resetSessionView();
    closeAccountMenu();
    render();
    toast(`Connected ${activeCompanyName()}.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.addAccountButton, false, "Add another account");
  }
}

async function switchAccount(accountId) {
  closeAccountMenu();
  try {
    state = await api.switchAccount(accountId);
    resetSessionView();
    render();
    toast(`Switched to ${state.identity?.user?.name || activeCompanyName()}.`);
  } catch (error) {
    render();
    toast(error.message, true);
  }
}

async function handleAccountUpdate() {
  if (["available", "downloaded"].includes(updateState?.status)) {
    await handleUpdate();
    return;
  }
  try {
    await api.checkForUpdates();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderStarterActions() {
  if (!state || !elements.starterActions) return;
  const actions = state.connectionMode === "demo"
    ? [
        ["Brief me on Northwind", "Give me an executive briefing on Northwind Labs: what matters, what needs attention, and what I can safely do next."],
        ["Find a growth opportunity", "Inspect Northwind's current growth signals and propose one useful, governed experiment."],
        ["Create with approval", "Create a useful customer-facing asset for Northwind and walk me through the approval and receipt flow."],
        ["Show the proof trail", "Show me recent Northwind activity and explain how AMOS proves what changed and why."]
      ]
    : state.mode?.personal || state.mode?.offline
      ? [
          ["Brief this project", "Inspect this workspace and give me a concise project briefing: architecture, current state, risks, and the best next task."],
          ["Explain the architecture", "Inspect this workspace and explain how the main components fit together, citing the files you used."],
          ["Find the riskiest code", "Inspect this project for the highest-leverage reliability, security, and maintainability risks. Do not change anything yet."],
          ["Improve something small", "Inspect this workspace, propose one small high-value improvement, and wait for my approval before changing files."]
        ]
      : [
          ["Resume the company", "Resume my company context and tell me what most needs attention right now."],
          ["Show key decisions", "Show me the consequential work waiting for approval and explain the business impact."],
          ["Find an automation", "Inspect the company and propose one repetitive workflow AMOS could safely automate."],
          ["Show recent proof", "Summarize recent company actions, receipts, and what the organization learned from them."]
        ];
  elements.starterActions.replaceChildren();
  for (const [label, prompt] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "starter-action";
    button.textContent = label;
    button.addEventListener("click", () => {
      elements.promptInput.value = prompt;
      elements.promptInput.focus();
    });
    elements.starterActions.append(button);
  }
}

function renderConversationChrome() {
  const hasConversation = Boolean(
    elements.messages.querySelector(".message.user, .message.assistant, .message.error")
  );
  elements.conversation.classList.toggle("has-history", hasConversation);
  elements.conversationHeading.classList.toggle("hidden", hasConversation);
  elements.welcomeMessage.classList.toggle("hidden", hasConversation);
  elements.starterActions.classList.toggle("hidden", hasConversation);
  elements.clearButton.classList.toggle("hidden", !hasConversation);
  renderConversationActions();
}

function renderConversationActions() {
  elements.newConversationButton.disabled = running;
  const active = activeDurableTask();
  elements.forkConversationButton.disabled = running || !active;
  elements.forkConversationButton.title = active
    ? "Create a governed branch from the latest retained milestone"
    : "Start a conversation before creating a fork";
}

function renderDecisions() {
  if (!state) return;
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const proposals = Array.isArray(state.offlineProposals) ? state.offlineProposals : [];
  const checkpoints = Array.isArray(state.taskCheckpoints) ? state.taskCheckpoints : [];
  const pending = approvals.filter((approval) => approval.status === "pending");
  const recent = approvals.filter((approval) => approval.status !== "pending").slice(0, 10);
  const waitingCount = pending.length + proposals.length + checkpoints.length;
  elements.decisionBadge.textContent = String(waitingCount);
  elements.decisionBadge.classList.toggle("hidden", waitingCount === 0);
  elements.workDecisionTabCount.textContent = String(waitingCount);
  elements.workDecisionTabCount.classList.toggle("hidden", waitingCount === 0);

  const sync = state.remoteStatus || {};
  elements.decisionSyncStatus.textContent = sync.paused
    ? "Paused in local-only mode"
    : sync.syncing
      ? "Syncing…"
      : sync.lastSyncedAt
        ? `Synced ${relativeTime(sync.lastSyncedAt)}`
        : "Not synced";
  elements.refreshDecisionsButton.disabled = Boolean(sync.syncing || sync.paused);

  const notice = sync.paused
    ? proposals.length > 0
      ? "Offline drafts remain local. Return online to compare them with the live company; nothing will replay automatically."
      : "Return to online company mode to refresh or decide governed company work."
    : !state.connected
      ? "Connect your AMOS account to receive governed company decisions."
      : state.connectionMode === "api_key"
        ? "Reconnect with your personal AMOS sign-in to receive decisions under your own identity."
        : state.approvalsAvailable === false
          ? "Your current company role does not include approval authority."
          : sync.error
            ? `AMOS could not complete the latest sync: ${sync.error}`
            : "";
  elements.decisionNotice.textContent = notice;
  elements.decisionNotice.classList.toggle("hidden", !notice);

  elements.interruptedTaskList.replaceChildren();
  if (checkpoints.length === 0) {
    elements.interruptedTaskList.append(
      decisionEmpty("No interrupted or failed conversations are waiting to be reopened.")
    );
  } else {
    for (const checkpoint of checkpoints) {
      elements.interruptedTaskList.append(taskCheckpointCard(checkpoint));
    }
  }

  elements.offlineProposalList.replaceChildren();
  if (proposals.length === 0) {
    elements.offlineProposalList.append(
      decisionEmpty("No offline company-work drafts are waiting.")
    );
  } else {
    for (const proposal of proposals) {
      elements.offlineProposalList.append(offlineProposalCard(proposal));
    }
  }

  elements.pendingDecisions.replaceChildren();
  if (pending.length === 0) {
    elements.pendingDecisions.append(
      decisionEmpty(
        sync.syncing ? "Checking for decisions…" : "Nothing is waiting for your approval."
      )
    );
  } else {
    for (const approval of pending) {
      elements.pendingDecisions.append(decisionCard(approval, true));
    }
  }

  elements.recentDecisions.replaceChildren();
  if (recent.length === 0) {
    elements.recentDecisions.append(decisionEmpty("Recent decision outcomes will appear here."));
  } else {
    for (const approval of recent) {
      elements.recentDecisions.append(decisionCard(approval, false));
    }
  }
}

function taskCheckpointCard(checkpoint) {
  const card = document.createElement("article");
  card.className = "decision-card task-checkpoint";
  const content = document.createElement("div");
  content.className = "decision-content";
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  const status = document.createElement("span");
  status.className = `decision-status ${checkpoint.status}`;
  status.textContent = checkpoint.status;
  const time = document.createElement("time");
  time.dateTime = checkpoint.updatedAt;
  time.textContent = checkpoint.updatedAt
    ? `Saved ${new Date(checkpoint.updatedAt).toLocaleString()}`
    : "";
  meta.append(status, time);
  const title = document.createElement("h2");
  title.textContent = checkpoint.title;
  const summary = document.createElement("p");
  summary.textContent = checkpoint.progress?.summary || "Task stopped before completion.";
  const provenance = document.createElement("small");
  provenance.textContent = [
    checkpoint.source?.tenantSlug,
    checkpoint.source?.role,
    "encrypted locally",
    "no tool arguments stored",
    "no automatic replay"
  ].filter(Boolean).join(" · ");
  content.append(meta, title, summary);
  if (checkpoint.progress?.completedSteps?.length) {
    const completed = document.createElement("ul");
    completed.className = "proposal-outcomes";
    for (const step of checkpoint.progress.completedSteps.slice(-5)) {
      const item = document.createElement("li");
      item.textContent = step;
      completed.append(item);
    }
    content.append(completed);
  }
  if (checkpoint.reconciliation) {
    const comparison = document.createElement("div");
    comparison.className = checkpoint.reconciliation.changedSections?.length
      ? "proposal-comparison context_changed"
      : "proposal-comparison no_detected_change";
    comparison.textContent = checkpoint.reconciliation.changedSections?.length
      ? `Live company context changed: ${checkpoint.reconciliation.changedSections.join(", ")}. AMOS will evaluate the task again.`
      : `Identity and company context revalidated. ${checkpoint.reconciliation.pendingApprovalCount} approval${checkpoint.reconciliation.pendingApprovalCount === 1 ? "" : "s"} currently pending.`;
    content.append(comparison);
  }
  content.append(provenance);

  const actions = document.createElement("div");
  actions.className = "decision-card-actions";
  const resume = actionButton(
    state.mode?.offline
      ? "Reconnect to revalidate"
      : state.connectionMode !== "user"
        ? "Personal sign-in required"
        : "Revalidate & reopen →",
    "primary"
  );
  resume.disabled = Boolean(state.mode?.offline || state.connectionMode !== "user" || running);
  resume.addEventListener("click", () => resumeTaskCheckpoint(checkpoint.id, resume));
  const remove = actionButton("Remove checkpoint", "danger");
  remove.disabled = running;
  remove.addEventListener("click", () => removeTaskCheckpoint(checkpoint, remove));
  actions.append(resume, remove);
  card.append(content, actions);
  return card;
}

async function resumeTaskCheckpoint(id, button) {
  setButtonBusy(button, true, "Revalidating…");
  try {
    const result = await api.prepareTaskCheckpoint(id);
    state.taskCheckpoints = result.taskCheckpoints || [];
    elements.promptInput.value = result.prompt;
    resumingCheckpointId = id;
    showView("operator");
    elements.promptInput.focus();
    renderDecisions();
    toast("Context revalidated and reopened. Review the continuation, then press Run.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, "Revalidate & reopen →");
  }
}

async function removeTaskCheckpoint(checkpoint, button) {
  if (!window.confirm(`Remove the checkpoint for “${checkpoint.title}”?`)) return;
  setButtonBusy(button, true, "Removing…");
  try {
    const result = await api.removeTaskCheckpoint(checkpoint.id);
    state.taskCheckpoints = result.taskCheckpoints || [];
    renderDecisions();
    toast("Task checkpoint removed.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, "Remove checkpoint");
  }
}

function offlineProposalCard(proposal) {
  const fresh = proposalReconciliationIsFresh(proposal);
  const card = document.createElement("article");
  card.className = `decision-card offline-proposal ${fresh ? "reconciled" : "draft"}`;

  const content = document.createElement("div");
  content.className = "decision-content";
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  const status = document.createElement("span");
  status.className = `decision-status ${fresh ? "reconciled" : "draft"}`;
  status.textContent = fresh ? "compared with live company" : "local draft";
  const time = document.createElement("time");
  time.dateTime = proposal.createdAt;
  time.textContent = proposal.createdAt
    ? `Drafted ${new Date(proposal.createdAt).toLocaleString()}`
    : "";
  meta.append(status, time);

  const title = document.createElement("h2");
  title.textContent = proposal.title;
  const summary = document.createElement("p");
  summary.textContent = proposal.summary;
  const provenance = document.createElement("small");
  provenance.textContent = [
    proposal.source?.tenantSlug,
    proposal.source?.observedAt
      ? `context captured ${new Date(proposal.source.observedAt).toLocaleString()}`
      : "",
    "encrypted locally",
    "never queued"
  ].filter(Boolean).join(" · ");
  const outcomes = document.createElement("ul");
  outcomes.className = "proposal-outcomes";
  for (const action of proposal.proposedActions || []) {
    const item = document.createElement("li");
    item.textContent = action;
    outcomes.append(item);
  }
  content.append(meta, title, summary, outcomes, provenance);

  if (proposal.reconciliation) {
    const comparison = document.createElement("div");
    comparison.className = `proposal-comparison ${proposal.reconciliation.risk}`;
    const changed = proposal.reconciliation.changedSections || [];
    const missing = proposal.reconciliation.missingSections || [];
    comparison.textContent = fresh
      ? changed.length > 0 || missing.length > 0
        ? `Live context changed: ${[...changed, ...missing].join(", ")}. AMOS must evaluate the draft again.`
        : "No change was detected in the compared sections. AMOS must still evaluate the draft again."
      : "The live comparison is more than 10 minutes old. Compare again before continuing.";
    content.append(comparison);
  }

  const actions = document.createElement("div");
  actions.className = "decision-card-actions proposal-actions";
  if (fresh && !state.mode?.offline && state.connectionMode === "user") {
    const continueButton = actionButton("Continue in Operator →", "primary");
    continueButton.addEventListener("click", () =>
      continueOfflineProposal(proposal.id, continueButton)
    );
    actions.append(continueButton);
  } else {
    const compare = actionButton(
      state.mode?.offline
        ? "Reconnect to compare"
        : state.connectionMode !== "user"
          ? "Personal sign-in required"
          : "Compare with live company",
      "primary"
    );
    compare.disabled = Boolean(state.mode?.offline || state.connectionMode !== "user");
    compare.addEventListener("click", () => compareOfflineProposal(proposal.id, compare));
    actions.append(compare);
  }

  const remove = actionButton("Remove draft", "danger");
  remove.addEventListener("click", () => removeOfflineProposal(proposal, remove));
  actions.append(remove);
  card.append(content, actions);
  return card;
}

function proposalReconciliationIsFresh(proposal) {
  const checkedAt = Date.parse(proposal?.reconciliation?.checkedAt || "");
  const elapsed = Date.now() - checkedAt;
  return (
    proposal?.status === "reconciled" &&
    Number.isFinite(checkedAt) &&
    elapsed >= 0 &&
    elapsed <= 10 * 60_000
  );
}

async function compareOfflineProposal(id, button) {
  setButtonBusy(button, true, "Comparing…");
  try {
    const result = await api.reconcileOfflineProposal(id);
    state.offlineProposals = result.offlineProposals || [];
    renderDecisions();
    toast("Compared with the live company. Nothing was submitted or replayed.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, "Compare with live company");
  }
}

async function continueOfflineProposal(id, button) {
  setButtonBusy(button, true, "Loading…");
  try {
    const result = await api.prepareOfflineProposal(id);
    elements.promptInput.value = result.prompt;
    showView("operator");
    elements.promptInput.focus();
    toast("Draft loaded. Review it, then press Run to explicitly reauthorize current evaluation.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, "Continue in Operator →");
  }
}

async function removeOfflineProposal(proposal, button) {
  if (!window.confirm(`Remove the local draft “${proposal.title}”?`)) return;
  setButtonBusy(button, true, "Removing…");
  try {
    const result = await api.removeOfflineProposal(proposal.id);
    state.offlineProposals = result.offlineProposals || [];
    renderDecisions();
    toast("Offline draft removed.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, "Remove draft");
  }
}

function decisionCard(approval, actionable) {
  const card = document.createElement("article");
  card.className = `decision-card ${approval.status}`;
  card.dataset.approvalId = approval.id;
  const content = document.createElement("div");
  content.className = "decision-content";
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  const status = document.createElement("span");
  status.className = `decision-status ${approval.status}`;
  status.textContent = approval.status.replaceAll("_", " ");
  const time = document.createElement("time");
  const eventTime = actionable ? approval.requested_at : approval.decided_at || approval.requested_at;
  time.dateTime = eventTime;
  time.textContent = eventTime ? new Date(eventTime).toLocaleString() : "";
  meta.append(status, time);
  const title = document.createElement("h2");
  title.textContent = humanizeTool(approval.verb);
  const summary = document.createElement("p");
  summary.textContent = decisionSummary(approval, actionable);
  const provenance = document.createElement("small");
  provenance.textContent = [
    approval.agency_origin === "goal_pursuit" ? "Autonomous goal" : "Requested work",
    !actionable && approval.decided_by ? "Human decision recorded" : "",
    approval.last_error ? `execution error: ${approval.last_error}` : ""
  ].filter(Boolean).join(" · ");
  content.append(meta, title, summary, provenance);

  const actions = document.createElement("div");
  actions.className = "decision-card-actions";
  if (actionable) {
    const review = document.createElement("button");
    review.className = "button primary";
    review.textContent = approvalActionLabel();
    review.addEventListener("click", () => reviewGovernedApproval(approval.id, review));
    actions.append(review);
  }
  const details = document.createElement("details");
  const detailsLabel = document.createElement("summary");
  detailsLabel.textContent = "Exact request";
  const request = document.createElement("pre");
  request.textContent = JSON.stringify(approval.args || {}, null, 2);
  details.append(detailsLabel, request);
  actions.append(details);
  card.append(content, actions);
  return card;
}

function decisionSummary(approval, actionable) {
  const title = humanizeTool(approval.verb);
  const reviewSummary = String(approval.review_summary || title).trim();
  if (actionable) return reviewSummary;
  const structuredTail = reviewSummary.search(/\s+[—–-]\s*[\[{]/);
  const cleanSummary = (structuredTail >= 0 ? reviewSummary.slice(0, structuredTail) : reviewSummary)
    .trim();
  if (cleanSummary && cleanSummary.toLowerCase() !== title.toLowerCase()) return cleanSummary;
  return `This request was ${String(approval.status || "recorded").replaceAll("_", " ")}.`;
}

function approvalActionLabel() {
  return state?.connectionMode === "user" && state?.approvalDecisionMode !== "desktop"
    ? "Enable native approval"
    : "Review securely →";
}

async function reviewGovernedApproval(id, button) {
  const needsEnrollment =
    state?.connectionMode === "user" && state?.approvalDecisionMode !== "desktop";
  const idleLabel = approvalActionLabel();
  if (button) {
    setButtonBusy(button, true, needsEnrollment ? "Waiting for browser…" : "Reviewing…");
  }
  try {
    if (needsEnrollment) {
      state = await api.login();
      render();
      if (state.approvalDecisionMode === "desktop") {
        toast("Native approvals enabled. Review the decision again to approve or deny it.");
      } else {
        toast(
          "This AMOS server did not enable native approvals. Hosted review remains available.",
          true
        );
      }
      return;
    }

    const review = await api.reviewApproval(id);
    if (review?.mode === "hosted") {
      const openHosted = window.confirm(
        "This AMOS server requires its hosted approval ceremony. Open it in your browser?"
      );
      if (openHosted) await api.openApproval(id);
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button?.isConnected) setButtonBusy(button, false, idleLabel);
  }
}

async function reviewCanvasApproval(id, button = null) {
  if (button) setButtonBusy(button, true, "Opening Decisions…");
  try {
    state = await api.refreshRemote();
    render();
    showView("decisions");
    const approval = (Array.isArray(state.approvals) ? state.approvals : [])
      .find((item) => item.id === id);
    focusDecisionCard(id);
    if (!approval || approval.status !== "pending") {
      toast("That approval is no longer pending. Decisions now shows the current state.");
      return;
    }
    if (state.approvalDecisionMode !== "desktop") {
      toast(
        "This server did not advertise native approval. The current governed decision is open in Decisions.",
        true
      );
      return;
    }
    await reviewGovernedApproval(id, null);
  } catch (error) {
    showView("decisions");
    toast(error.message, true);
  } finally {
    if (button?.isConnected) setButtonBusy(button, false, approvalActionLabel());
  }
}

function focusDecisionCard(id) {
  requestAnimationFrame(() => {
    const card = [...elements.pendingDecisions.querySelectorAll(".decision-card")]
      .find((item) => item.dataset.approvalId === id);
    if (!card) return;
    card.classList.add("focused");
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => card.classList.remove("focused"), 2_000);
  });
}

function decisionEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "decision-empty";
  empty.textContent = message;
  return empty;
}

async function refreshDecisions() {
  setButtonBusy(elements.refreshDecisionsButton, true, "Refreshing…");
  try {
    state = await api.refreshRemote();
    render();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.refreshDecisionsButton, false, "Refresh");
  }
}

function relativeTime(value) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function renderStep(element, complete) {
  element.textContent = complete ? "✓" : "—";
  element.classList.toggle("done", complete);
}

function providerStatusLabel() {
  if (state.provider.id === "amos-hosted") {
    return "AMOS Intelligence · Automatic";
  }
  if (state.provider.deployment === "local") {
    return `Local · ${state.provider.model}`;
  }
  return `${state.provider.displayName} · ${state.provider.model}`;
}

function modelCatalog(provider) {
  if (!provider) return [];
  if (provider.id === "ollama") {
    const curated = state.offline?.models || [];
    return curated.map((model) => ({ id: model.id, label: model.name }));
  }
  return Array.isArray(provider.models) ? provider.models : [];
}

function populateModelOptions(catalog, selectedModel) {
  elements.modelInput.replaceChildren();
  const selectedProfile = catalog.find((model) =>
    model.id === selectedModel || model.aliases?.includes(selectedModel)
  );
  const normalizedSelection = selectedProfile?.id || selectedModel;
  const known = new Set(catalog.flatMap((model) => [model.id, ...(model.aliases || [])]));
  if (selectedModel && !known.has(selectedModel)) {
    const current = document.createElement("option");
    current.value = selectedModel;
    current.textContent = `Current · ${selectedModel}`;
    elements.modelInput.append(current);
  }
  for (const model of catalog) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.protocol
      ? `${model.label} · ${modelProtocolLabel(model.protocol)}${
          model.dataRetention?.dataSharedWithProvider ? " · data sharing required" : ""
        }`
      : model.label;
    elements.modelInput.append(option);
  }
  elements.modelInput.value = normalizedSelection || catalog[0]?.id || "";
}

function renderSettings() {
  const settings = state.settings;
  selectedProvider = selectedProvider || settings.provider;
  elements.providerCards.replaceChildren();

  for (const provider of state.providers) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `provider-card${selectedProvider === provider.id ? " selected" : ""}`;
    card.dataset.providerId = provider.id;
    const location = document.createElement("span");
    location.textContent = provider.deployment.replace("-", " ");
    const name = document.createElement("strong");
    name.textContent = provider.displayName;
    const description = document.createElement("p");
    description.textContent = provider.description;
    card.append(location, name, description);
    card.addEventListener("click", () => selectProvider(provider.id));
    elements.providerCards.append(card);
  }

  if (document.activeElement !== elements.customModelInput) {
    elements.customModelInput.value = settings.model || "";
  }
  if (document.activeElement !== elements.baseUrlInput) elements.baseUrlInput.value = settings.baseUrl || "";
  elements.reasoningInput.value = settings.reasoningEffort || "max";
  elements.bedrockAuthInput.value = settings.bedrockAuthMode === "api-key" ||
    (settings.bedrockAuthMode === "auto" && settings.hasApiKey)
    ? "api-key"
    : "sigv4";
  elements.operatingModeInput.value = settings.operatingMode || "online";
  elements.appearanceInput.value = settings.appearance || "system";
  elements.mcpInput.value = settings.amosMcpUrl;
  elements.apiKeyHelp.textContent = settings.hasApiKey
    ? "A credential is stored securely. Leave blank to keep it."
    : (providerDefaults[selectedProvider]?.credential || "Provider credential");
  renderProviderFields(settings.model);
  elements.systemCard.replaceChildren(
    strong(`${state.system.arch.toUpperCase()} · ${state.system.memoryGb} GB memory`),
    text(state.system.localRecommendation)
  );
}

function renderOfflineModels() {
  if (!state?.offline) return;
  const offline = state.offline;
  const runtime = offline.runtime || {};
  const installedCount = (offline.models || []).filter((model) => model.installed).length;
  elements.offlineRuntimeStatus.textContent = runtime.available
    ? installedCount > 0
      ? `Ready · ${installedCount} local ${installedCount === 1 ? "profile" : "profiles"} installed`
      : "AMOS Local is ready · choose a model to install"
    : runtime.status === "starting"
      ? "Preparing AMOS Local runtime…"
      : runtime.error || "AMOS Local runtime is unavailable";
  elements.offlineRuntimeStatus.classList.toggle("ready", Boolean(runtime.available));
  elements.offlineRuntimeStatus.classList.toggle("error", !runtime.available);
  elements.offlineInstallRuntimeButton.classList.toggle("hidden", Boolean(runtime.available));
  elements.offlineInstallRuntimeButton.textContent = "Retry runtime";
  elements.offlineRefreshButton.textContent = runtime.available ? "Refresh" : "Check runtime";
  elements.offlineSetupRuntime.classList.toggle("complete", Boolean(runtime.available));
  elements.offlineSetupRuntime.classList.toggle("active", !runtime.available);
  elements.offlineSetupModel.classList.toggle("complete", installedCount > 0);
  elements.offlineSetupModel.classList.toggle("active", runtime.available && installedCount === 0);
  elements.offlineSetupActivate.classList.toggle("active", installedCount > 0);
  elements.offlineManifestDigest.textContent = offline.manifest?.digest
    ? `sha256:${offline.manifest.digest}`
    : "";
  elements.offlineModelList.replaceChildren();

  for (const model of offline.models || []) {
    const card = document.createElement("article");
    card.className = `offline-model-card${model.recommended ? " recommended" : ""}`;
    const labels = document.createElement("div");
    labels.className = "offline-model-labels";
    const profile = document.createElement("span");
    profile.textContent = model.recommended
      ? "Recommended primary model"
      : model.recommendedFor === "vision"
        ? "Recommended for image tasks"
        : model.id;
    labels.append(profile);
    if (model.installed) {
      const installed = document.createElement("span");
      installed.className = "installed";
      installed.textContent = "Installed";
      labels.append(installed);
    }
    const title = document.createElement("h3");
    title.textContent = model.name;
    const description = document.createElement("p");
    description.textContent = model.description;
    const meta = document.createElement("div");
    meta.className = "offline-model-meta";
    for (const value of [
      `≈ ${formatBytes(model.approximateSizeBytes)}`,
      `${model.recommendedMemoryGb} GB recommended`,
      ...(model.capabilities || []).slice(0, 3)
    ]) {
      const pill = document.createElement("span");
      pill.textContent = value;
      meta.append(pill);
    }
    card.append(labels, title, description, meta);

    if (model.download) {
      const progress = document.createElement("div");
      progress.className = "offline-model-progress";
      const fill = document.createElement("i");
      fill.style.width = `${model.download.percent || 0}%`;
      progress.append(fill);
      const progressLabel = document.createElement("p");
      progressLabel.className = "offline-model-progress-label";
      progressLabel.textContent = model.download.error
        ? `Download failed: ${model.download.error}`
        : `${model.download.status} · ${model.download.percent || 0}%`;
      card.append(progress, progressLabel);
    }

    const actions = document.createElement("div");
    actions.className = "offline-model-actions";
    const active =
      state.settings.provider === "ollama" &&
      state.settings.model === model.id &&
      state.settings.operatingMode === "offline";
    if (!model.installed) {
      const download = actionButton("Install", "primary");
      download.disabled =
        !runtime.available ||
        Boolean(model.download && model.download.status !== "failed") ||
        state.system.memoryGb < model.minimumMemoryGb;
      download.title = state.system.memoryGb < model.minimumMemoryGb
        ? `This profile needs at least ${model.minimumMemoryGb} GB memory`
        : !runtime.available
          ? "AMOS Local is still preparing"
          : "";
      download.addEventListener("click", () => installOfflineModel(model.id));
      actions.append(download);
    } else {
      const currentBoundary = state.mode?.offline
        ? "offline"
        : state.mode?.personal || !state.connected
          ? "personal"
          : "online";
      const useNowActive =
        state.settings.provider === "ollama" &&
        state.settings.model === model.id &&
        state.settings.operatingMode === currentBoundary;
      const activate = actionButton(
        useNowActive
          ? "Active"
          : currentBoundary === "online"
            ? "Use with AMOS"
            : "Use on this computer",
        "primary"
      );
      activate.disabled = useNowActive;
      activate.addEventListener("click", () => activateLocalModel(model.id, currentBoundary));
      const offline = actionButton(active ? "Active offline" : "Use offline", "secondary");
      offline.disabled = active;
      offline.addEventListener("click", () => activateLocalModel(model.id, "offline"));
      const remove = actionButton("Remove", "danger");
      remove.disabled = active;
      remove.addEventListener("click", () => removeOfflineModel(model.id));
      actions.append(activate, offline, remove);
    }
    card.append(actions);
    elements.offlineModelList.append(card);
  }
}

function selectProvider(providerId) {
  const changed = providerId !== selectedProvider;
  selectedProvider = providerId;
  const defaults = providerDefaults[providerId] || {};
  if (changed) {
    elements.customModelInput.value = defaults.model || "";
    elements.baseUrlInput.value = defaults.baseUrl || "";
    elements.apiKeyInput.value = "";
    elements.bedrockAuthInput.value = defaults.authMode || "sigv4";
  }
  renderProviderSelection();
  elements.apiKeyHelp.textContent = defaults.credential || "Provider credential";
  renderProviderFields(defaults.model || "");
}

function renderProviderFields(modelValue = "") {
  const managed = selectedProvider === "amos-hosted";
  const managedConnectionRequired = managed && !state.connected;
  const provider = state.providers.find((item) => item.id === selectedProvider);
  const catalog = modelCatalog(provider);
  const catalogModel = !managed && catalog.length > 0;
  const local = provider?.deployment === "local";
  const bedrock = selectedProvider === "bedrock";
  const bedrockApiKey = bedrock && elements.bedrockAuthInput.value === "api-key";
  elements.managedProfileField.classList.toggle("hidden", !managed);
  if (!managed) elements.advancedInfrastructureDetails.open = true;
  elements.localSetupField.classList.toggle("hidden", selectedProvider !== "ollama");
  elements.modelSelectField.classList.toggle("hidden", !catalogModel);
  elements.customModelField.classList.toggle("hidden", managed || catalogModel);
  elements.baseUrlInput.closest(".field")?.classList.toggle(
    "hidden",
    managed || selectedProvider === "ollama"
  );
  elements.bedrockAuthField.classList.toggle("hidden", !bedrock);
  elements.apiKeyInput.closest(".field")?.classList.toggle(
    "hidden",
    managed || local || (bedrock && !bedrockApiKey)
  );
  elements.reasoningInput.closest(".field")?.classList.toggle("hidden", managed);
  elements.managedConnectionCallout.classList.toggle("hidden", !managedConnectionRequired);
  elements.testButton.textContent = managedConnectionRequired
    ? "Create or connect to test"
    : "Test intelligence";
  if (catalogModel) {
    populateModelOptions(catalog, modelValue || provider?.defaultModel || "");
    syncSelectedModelEndpoint();
  } else if (!managed && document.activeElement !== elements.customModelInput) {
    elements.customModelInput.value = modelValue || provider?.defaultModel || "";
  }
  syncProviderReasoning(provider, providerModelProfile(provider, elements.modelInput.value));
  renderModelEndpointHelp(provider);
}

function syncSelectedModelEndpoint() {
  const provider = state?.providers?.find((item) => item.id === selectedProvider);
  const model = providerModelProfile(provider, elements.modelInput.value);
  syncProviderReasoning(provider, model);
  if (!model?.endpointPath) {
    renderModelEndpointHelp(provider, model);
    return;
  }
  const fallback = providerDefaults[selectedProvider]?.baseUrl || "";
  try {
    const endpoint = new URL(elements.baseUrlInput.value || fallback);
    endpoint.pathname = model.endpointPath;
    endpoint.search = "";
    endpoint.hash = "";
    elements.baseUrlInput.value = endpoint.toString().replace(/\/$/, "");
  } catch {
    // Core validation produces the actionable error when the user saves/tests.
  }
  renderModelEndpointHelp(provider, model);
}

function providerModelProfile(provider, modelId) {
  return provider?.models?.find((model) =>
    model.id === modelId || model.aliases?.includes(modelId)
  ) || null;
}

function renderModelEndpointHelp(provider, selectedModel = null) {
  const model = selectedModel || providerModelProfile(provider, elements.modelInput.value);
  if (provider?.id === "bedrock" && model) {
    const retention = model.dataRetention?.dataSharedWithProvider
      ? ` This model requires the AWS account or project to opt into provider data sharing${
          model.dataRetention.maximumRetentionDays
            ? ` for up to ${model.dataRetention.maximumRetentionDays} days`
            : ""
        }.`
      : "";
    elements.baseUrlHelp.textContent =
      `${modelProtocolLabel(model.protocol)} uses ${model.endpointPath}. Qualified regions: ${model.regions.join(", ")}. AMOS keeps the path aligned with the selected model.${retention}`;
    return;
  }
  elements.baseUrlHelp.textContent = "HTTPS required except for localhost runtimes.";
}

function syncProviderReasoning(provider, model = null) {
  const supported = model?.supportedReasoningEfforts?.length
    ? model.supportedReasoningEfforts
    : provider?.supportedReasoningEfforts;
  for (const option of elements.reasoningInput.options) {
    option.disabled = Boolean(supported?.length && !supported.includes(option.value));
  }
  if (supported?.length && !supported.includes(elements.reasoningInput.value)) {
    elements.reasoningInput.value = model?.defaultReasoningEffort ||
      provider?.defaultReasoningEffort || supported[0];
  }
}

function modelProtocolLabel(protocol) {
  if (protocol === "openai-responses") return "Responses";
  if (protocol === "anthropic-messages") return "Messages";
  return "Chat Completions";
}

function renderProviderSelection() {
  for (const card of elements.providerCards.children) {
    card.classList.toggle("selected", card.dataset.providerId === selectedProvider);
  }
}

async function connectAmos() {
  setButtonBusy(elements.connectButton, true, "Waiting for browser…");
  try {
    state = await api.login();
    toast("AMOS company connected.");
    render();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.connectButton, false, state?.connected ? "Reconnect AMOS" : "Connect AMOS");
  }
}

async function connectManagedIntelligence() {
  elements.settingsError.classList.add("hidden");
  setButtonBusy(elements.managedConnectButton, true, "Waiting for browser…");
  try {
    state = await api.login();
    selectedProvider = "amos-hosted";
    toast("AMOS account connected. Managed intelligence is ready to test.");
    render();
  } catch (error) {
    elements.settingsError.textContent =
      `AMOS account connection did not finish. ${friendlyError(error)}`;
    elements.settingsError.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.managedConnectButton, false, "Create or connect");
  }
}

async function startPersonal() {
  setButtonBusy(elements.localModeButton, true, "Preparing…");
  try {
    state = await api.startPersonal();
    toast("Personal workspace selected. Choose a model and workspace to begin.");
    render();
    if (!state.configured || state.settings.provider === "amos-hosted") showView("settings");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.localModeButton, false, "My workspace");
  }
}

async function startDemo() {
  setButtonBusy(elements.demoModeButton, true, "Opening demo…");
  try {
    state = await api.startDemo();
    sessionStorage.setItem("amos-onboarding-complete", "true");
    toast("Northwind Labs is ready. Everything you see is sample data.");
    render();
    showView("operator");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.demoModeButton, false, "Northwind demo");
  }
}

async function disconnectAmos() {
  try {
    state = await api.logout();
    closeAccountMenu();
    if (state.accounts?.currentAccountId) {
      sessionStorage.setItem("amos-onboarding-complete", "true");
      toast(`Signed out. Switched to ${state.identity?.user?.name || activeCompanyName()}.`);
    } else {
      sessionStorage.removeItem("amos-onboarding-complete");
      toast("AMOS disconnected from this computer.");
    }
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function switchCompany(event) {
  const targetTenantId = event.currentTarget.value;
  event.currentTarget.disabled = true;
  try {
    state = await api.switchCompany(targetTenantId);
    resetSessionView();
    render();
    toast(`Switched to ${activeCompanyName()}.`);
  } catch (error) {
    renderCompanySwitcher();
    toast(error.message, true);
  } finally {
    event.currentTarget.disabled = false;
  }
}

function activeCompanyName() {
  return state?.companies?.tenants?.find(
    (tenant) => tenant.tenant_id === state.companies.currentTenantId
  )?.tenant_name || state?.identity?.tenant_slug || "the selected company";
}

async function chooseWorkspace() {
  try {
    const previousWorkspace = state.settings.workspace;
    state = await api.chooseWorkspace();
    render();
    if (state.settings.workspace && state.settings.workspace !== previousWorkspace) {
      toast("Project folder selected. New tasks will use this workspace; local auto-approve is off.");
    }
  } catch (error) {
    toast(error.message, true);
  }
}

async function toggleLocalApproval() {
  const trustedWorkspace = state.settings.localApprovalWorkspace === state.settings.workspace;
  const enabled = trustedWorkspace && (
    state.settings.localApprovalMode === "workspace" ||
    (state.settings.localApprovalKinds || []).length > 0
  );
  try {
    elements.localApprovalButton.disabled = true;
    state = await api.setLocalApprovalMode(enabled ? "ask" : "workspace");
    render();
    const nowEnabled = state.settings.localApprovalMode === "workspace" &&
      state.settings.localApprovalWorkspace === state.settings.workspace;
    toast(nowEnabled
      ? "Local auto-approve is on for this folder. Company approvals remain governed."
      : "Local auto-approve is off. AMOS will ask before local changes.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.localApprovalButton.disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  elements.settingsError.classList.add("hidden");
  try {
    await persistSettings();
    toast("Intelligence settings saved.");
    render();
  } catch (error) {
    elements.settingsError.textContent = error.message;
    elements.settingsError.classList.remove("hidden");
  }
}

async function persistSettings() {
  const managed = selectedProvider === "amos-hosted";
  const catalogModel = !elements.modelSelectField.classList.contains("hidden");
  const selectedModel = catalogModel ? elements.modelInput.value : elements.customModelInput.value;
  if (selectedProvider === "ollama") {
    const localModel = state.offline?.models?.find((model) => model.id === selectedModel);
    if (!state.offline?.runtime?.available || !localModel?.installed) {
      throw new Error(
        "Finish the guided AMOS Local setup below, then install this model."
      );
    }
  }
  const payload = {
    provider: selectedProvider,
    model: managed
      ? "auto"
      : selectedModel,
    baseUrl: managed ? "" : elements.baseUrlInput.value,
    bedrockAuthMode: selectedProvider === "bedrock"
      ? elements.bedrockAuthInput.value
      : "auto",
    intelligenceProfile: "auto",
    reasoningEffort: managed
      ? ""
      : elements.reasoningInput.value,
    operatingMode: elements.operatingModeInput.value,
    appearance: elements.appearanceInput.value,
    amosMcpUrl: elements.mcpInput.value
  };
  if (elements.apiKeyInput.value) payload.apiKey = elements.apiKeyInput.value;

  state = await api.saveSettings(payload);
  elements.apiKeyInput.value = "";
  return state;
}

async function toggleAppearance(event) {
  const previous = state.settings.appearance || "system";
  const appearance = event.currentTarget.checked ? "dark" : "light";
  applyAppearance(appearance);
  try {
    state = await api.saveSettings({ appearance });
    render();
    toast(`${appearance === "dark" ? "Dark" : "Light"} appearance enabled.`);
  } catch (error) {
    applyAppearance(previous);
    toast(error.message, true);
  }
}

function applyAppearance(preference) {
  const normalized = ["system", "light", "dark"].includes(preference) ? preference : "system";
  if (normalized === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = normalized;
  }
  const effective = normalized === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : normalized;
  elements.appearanceToggle.checked = effective === "dark";
  elements.appearanceToggle.setAttribute(
    "aria-label",
    `Switch to ${effective === "dark" ? "light" : "dark"} appearance${
      normalized === "system" ? " (currently following this computer)" : ""
    }`
  );
  elements.appearanceControl.title =
    normalized === "system"
      ? `Following this computer · currently ${effective}`
      : `${effective[0].toUpperCase()}${effective.slice(1)} override`;
  if (elements.appearanceInput) elements.appearanceInput.value = normalized;
}

async function refreshOfflineModels() {
  setButtonBusy(elements.offlineRefreshButton, true, "Checking…");
  try {
    state.offline = await api.refreshOffline();
    renderOfflineModels();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.offlineRefreshButton, false, "Refresh");
  }
}

async function installOfflineModel(modelId) {
  try {
    await api.installOfflineModel(modelId);
    toast("Offline model installed.");
  } catch (error) {
    toast(error.message, true);
  }
}

async function activateOfflineModel(modelId) {
  return activateLocalModel(modelId, "offline");
}

async function activateLocalModel(modelId, operatingMode) {
  try {
    state = await api.activateLocalModel(modelId, operatingMode);
    selectedProvider = state.settings.provider;
    toast(operatingMode === "offline"
      ? "Local-only mode is active."
      : "Local intelligence is active.");
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function removeOfflineModel(modelId) {
  try {
    state.offline = await api.removeOfflineModel(modelId);
    toast("Offline model removed.");
    renderOfflineModels();
  } catch (error) {
    toast(error.message, true);
  }
}

async function testModel() {
  const needsManagedConnection = selectedProvider === "amos-hosted" && !state.connected;
  setButtonBusy(
    elements.testButton,
    true,
    needsManagedConnection ? "Waiting for browser…" : "Testing…"
  );
  elements.settingsError.classList.add("hidden");
  try {
    if (needsManagedConnection) {
      state = await api.login();
      selectedProvider = "amos-hosted";
      render();
      setButtonBusy(elements.testButton, true, "Testing…");
    }
    await persistSettings();
    const result = await api.testModel();
    toast(result.message || "Intelligence is ready.");
  } catch (error) {
    elements.settingsError.textContent = needsManagedConnection
      ? `AMOS account connection did not finish. ${friendlyError(error)}`
      : friendlyError(error);
    elements.settingsError.classList.remove("hidden");
  } finally {
    const stillNeedsManagedConnection =
      selectedProvider === "amos-hosted" && !state.connected;
    setButtonBusy(
      elements.testButton,
      false,
      stillNeedsManagedConnection ? "Create or connect to test" : "Test intelligence"
    );
  }
}

async function chooseAttachments() {
  if (running) return;
  setButtonBusy(elements.attachButton, true, "Adding…");
  try {
    updateAttachments(await api.chooseAttachments());
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.attachButton, false, "＋ Attach");
  }
}

async function handlePaste(event) {
  if (running) return;
  const images = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (images.length === 0) return;
  event.preventDefault();
  try {
    for (const image of images) {
      const bytes = await image.arrayBuffer();
      updateAttachments(await api.addPastedImage({
        name: image.name || `screenshot-${Date.now()}.png`,
        mime: image.type || "image/png",
        bytes
      }));
    }
    toast(images.length === 1 ? "Screenshot attached." : `${images.length} screenshots attached.`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function handleDrop(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  elements.promptForm.classList.remove("drop-active");
  if (running) return;
  const paths = [...event.dataTransfer.files].map((file) => api.pathForFile(file)).filter(Boolean);
  if (paths.length === 0) return;
  try {
    updateAttachments(await api.addAttachmentPaths(paths));
  } catch (error) {
    toast(error.message, true);
  }
}

function hasDraggedFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

function updateAttachments(next) {
  const previous = new Map(attachments.map((item) => [item.id, item]));
  attachments = (next || []).map((item) => ({
    ...item,
    retention:
      item.memoryStatus === "requested"
        ? "company"
        : previous.get(item.id)?.retention || "task"
  }));
  renderAttachments();
}

function renderAttachments() {
  if (!elements.attachmentList) return;
  elements.attachmentList.replaceChildren();
  elements.attachmentList.classList.toggle("hidden", attachments.length === 0);
  for (const attachment of attachments) {
    const chip = document.createElement("article");
    chip.className = "attachment-chip";
    const icon = document.createElement("span");
    icon.className = "attachment-icon";
    icon.textContent = attachment.kind === "image" ? "▧" : "≡";

    const copy = document.createElement("div");
    copy.className = "attachment-copy";
    const name = document.createElement("strong");
    name.textContent = attachment.name;
    const detail = document.createElement("small");
    detail.textContent = `${attachment.kind === "image" ? "Image" : "Document"} · ${formatBytes(attachment.size)}`;
    const retention = document.createElement("select");
    retention.className = "attachment-memory";
    retention.setAttribute("aria-label", `Retention for ${attachment.name}`);
    retention.append(
      option("task", "Use for this task"),
      option("private", attachment.memoryStatus === "private" ? "Saved privately on this computer" : "Keep in private memory"),
      option("company", attachment.memoryStatus === "requested" ? "Submitted to AMOS memory" : "Add to company memory")
    );
    retention.value = attachment.retention;
    retention.disabled = running || attachment.memoryStatus === "requested";
    retention.addEventListener("change", () => {
      attachment.retention = retention.value;
    });
    copy.append(name, detail, retention);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.textContent = "×";
    remove.disabled = running;
    remove.addEventListener("click", async () => {
      try {
        updateAttachments(await api.removeAttachment(attachment.id));
      } catch (error) {
        toast(error.message, true);
      }
    });
    chip.append(icon, copy, remove);
    elements.attachmentList.append(chip);
  }
}

async function runTask(event) {
  event.preventDefault();
  const prompt = elements.promptInput.value.trim();
  if (running) {
    if (!prompt) return;
    await steerTask(prompt);
    return;
  }
  if (!prompt && attachments.length === 0) return;
  const attachmentSummary = attachments.length > 0
    ? `\n\nAttached: ${attachments.map((item) => item.name).join(", ")}`
    : "";
  addMessage("user", `${prompt || "Review the attached material."}${attachmentSummary}`);
  elements.promptInput.value = "";
  clearTransientTaskMessages();
  beginInlineActivity();
  const pending = addMessage("pending", "AMOS is loading company context and determining the next action…");
  transientTaskMessages.add(pending);
  streamingMessage = pending;
  setRunning(true);

  try {
    const submitted = [...attachments];
    const result = await api.run({
      text: prompt,
      resumeTaskId: resumingCheckpointId,
      attachments: submitted.map((item) => ({ id: item.id, retention: item.retention }))
    });
    resumingCheckpointId = null;
    streamingMessage = null;
    clearTransientTaskMessages();
    addMessage("assistant", result.answer, { eventId: result.taskEventId });
    renderGovernedUiActions();
    state.activity = result.activity;
    state.canvases = result.canvases || state.canvases;
    state.activeCanvasId = result.activeCanvasId || state.activeCanvasId;
    activeCanvasId = state.activeCanvasId || activeCanvasId;
    if (activeCanvasId) canvasSidecarOpen = true;
    state.privateMemory = result.privateMemory || state.privateMemory;
    state.offlineProposals = result.offlineProposals || state.offlineProposals;
    renderHistory();
    renderCanvas();
    renderPrivateMemory();
    renderDecisions();
    for (const attachment of submitted) {
      await api.removeAttachment(attachment.id);
    }
    updateAttachments([]);
    const failures = (result.memory || []).filter((item) => item.status === "failed");
    if (failures.length > 0) {
      toast(`Task completed, but ${failures.length} item${failures.length === 1 ? "" : "s"} could not be added to company memory.`, true);
    }
  } catch (error) {
    resumingCheckpointId = null;
    streamingMessage = null;
    clearTransientTaskMessages();
    addMessage(
      "error",
      error?.code === "AMOS_TASK_CANCELED" || /task canceled/i.test(error.message)
        ? "Task stopped safely. Its encrypted checkpoint is available under Decisions if you want to revalidate and continue."
        : error.message
    );
  } finally {
    try {
      const latest = await api.state();
      state.privateMemory = latest.privateMemory || [];
      state.offlineProposals = latest.offlineProposals || [];
      state.localReceipts = latest.localReceipts || [];
      state.tasks = latest.tasks || state.tasks;
      state.activeTaskRecordId = latest.activeTaskRecordId || state.activeTaskRecordId;
      state.sessionContinuity = latest.sessionContinuity || state.sessionContinuity;
      renderPrivateMemory();
      renderDecisions();
      renderHistory();
      renderTasks();
    } catch {
      // Task completion must not be masked if a local memory refresh fails.
    }
    setRunning(false);
  }
}

async function steerTask(direction) {
  elements.runButton.disabled = true;
  try {
    const result = await api.steerTask(currentTaskId, direction);
    if (!result.queued) {
      toast(result.message || "AMOS could not queue that direction.", true);
      return;
    }
    addMessage("user", direction);
    elements.promptInput.value = "";
    const pending = addMessage("pending", "AMOS is applying your new direction at the next safe boundary…");
    transientTaskMessages.add(pending);
    streamingMessage = pending;
    elements.promptInput.focus();
  } catch (error) {
    toast(error.message, true);
  } finally {
    elements.runButton.disabled = false;
  }
}

function clearTransientTaskMessages() {
  for (const message of transientTaskMessages) message.remove();
  transientTaskMessages.clear();
}

async function cancelTask() {
  if (!running) return;
  elements.cancelButton.disabled = true;
  elements.cancelButton.textContent = "Stopping…";
  try {
    const result = await api.cancelTask(currentTaskId);
    if (!result.canceled) toast(result.message || "No task is running.");
  } catch (error) {
    toast(error.message, true);
  }
}

async function clearSession() {
  elements.clearButton.disabled = true;
  try {
    const result = await api.clear();
    resetSessionView();
    if (result?.sharedContinuity?.error) {
      toast(
        "This computer was cleared, but AMOS could not clear the shared checkpoint. Reconnect and clear again before switching clients.",
        true
      );
    } else if (
      result?.sharedContinuity?.attempted &&
      result.sharedContinuity.supported === false
    ) {
      toast(
        "This computer was cleared. The platform needs its continuity update before shared checkpoints can also be cleared.",
        true
      );
    }
    elements.promptInput.focus();
  } catch (error) {
    toast(error.message || "AMOS could not clear this session.", true);
  } finally {
    elements.clearButton.disabled = false;
  }
}

function resetSessionView() {
  resumingCheckpointId = null;
  continuityConversationRestored = false;
  state.sessionContinuity = null;
  state.workingContinuity = null;
  state.canvases = [];
  state.activeCanvasId = null;
  activeCanvasId = null;
  updateAttachments([]);
  const welcome = elements.messages.querySelector(".welcome-message");
  const starters = elements.messages.querySelector(".starter-actions");
  const activity = elements.activityStream;
  clearInlineApproval();
  elements.messages.replaceChildren();
  if (welcome) elements.messages.append(welcome);
  if (starters) elements.messages.append(starters);
  elements.liveEvents.replaceChildren();
  activity.classList.add("hidden");
  activity.open = false;
  elements.messages.append(activity);
  pendingUiActions = [];
  pendingGenericConnectCalls = 0;
  canvasSidecarOpen = false;
  renderCanvas();
  renderStarterActions();
  renderConversationChrome();
}

function addMessage(role, content, { eventId = "" } = {}) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  if (eventId) message.dataset.eventId = eventId;
  if (role === "assistant") {
    const markdown = document.createElement("div");
    markdown.className = "markdown-content";
    renderMarkdown(markdown, content);
    message.append(markdown);
    const task = activeDurableTask();
    if (eventId && task) {
      const actions = document.createElement("div");
      actions.className = "message-task-actions";
      const fork = document.createElement("button");
      fork.type = "button";
      fork.className = "message-fork-button";
      fork.textContent = "Fork from here";
      fork.addEventListener("click", () => openTaskForkModal(task, eventId));
      actions.append(fork);
      message.append(actions);
    }
  } else {
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    message.append(paragraph);
  }
  elements.messages.append(message);
  renderConversationChrome();
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return message;
}

function restoreConversationFromContinuity() {
  if (continuityConversationRestored) return;
  const continuity = state?.sessionContinuity;
  const activeObjective = state?.activeTask?.objective;
  if (!continuity?.turns?.length && !activeObjective) return;
  if (elements.messages.querySelector(".message.user, .message.assistant")) {
    continuityConversationRestored = true;
    return;
  }
  continuityConversationRestored = true;
  if (continuity?.turns?.length) {
    addMessage(
      "pending",
      `Restored encrypted session continuity for ${continuity.workspace}. AMOS will revalidate live company state and local files before acting.`
    );
    for (const turn of continuity.turns) {
      addMessage("user", turn.objective);
      addMessage("assistant", turn.answer, { eventId: turn.id });
    }
  }
  if (
    activeObjective &&
    activeObjective !== continuity?.turns?.at(-1)?.objective
  ) {
    addMessage("user", activeObjective);
    addMessage("pending", "AMOS is still working on this task. Add direction below to steer it.");
  }
}

function activeDurableTask() {
  return (state?.tasks?.tasks || []).find((task) =>
    task.id === state.tasks?.activeTaskId || task.id === state.activeTaskRecordId
  ) || null;
}

function renderMarkdown(container, source) {
  for (const block of parseMarkdown(source)) {
    if (block.type === "heading") {
      const heading = document.createElement(`h${block.level}`);
      appendInline(heading, block.children);
      container.append(heading);
    } else if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      appendInline(paragraph, block.children);
      container.append(paragraph);
    } else if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      if (block.ordered && block.start !== 1) list.start = block.start;
      for (const item of block.items) {
        const listItem = document.createElement("li");
        appendInline(listItem, item);
        list.append(listItem);
      }
      container.append(list);
    } else if (block.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (block.language) code.dataset.language = block.language;
      code.textContent = block.text;
      pre.append(code);
      container.append(pre);
    } else if (block.type === "quote") {
      const quote = document.createElement("blockquote");
      renderMarkdownBlocks(quote, block.children);
      container.append(quote);
    } else if (block.type === "rule") {
      container.append(document.createElement("hr"));
    } else if (block.type === "table") {
      container.append(renderMarkdownTable(block));
    }
  }
}

function renderMarkdownBlocks(container, blocks) {
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      appendInline(paragraph, block.children);
      container.append(paragraph);
    } else if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const listItem = document.createElement("li");
        appendInline(listItem, item);
        list.append(listItem);
      }
      container.append(list);
    } else if (block.type === "heading") {
      const strong = document.createElement("strong");
      appendInline(strong, block.children);
      container.append(strong);
    } else if (block.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.text;
      pre.append(code);
      container.append(pre);
    }
  }
}

function renderMarkdownTable(block) {
  const scroll = document.createElement("div");
  scroll.className = "markdown-table-scroll";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  for (const cell of block.headers) {
    const header = document.createElement("th");
    appendInline(header, cell);
    headingRow.append(header);
  }
  head.append(headingRow);
  const body = document.createElement("tbody");
  for (const row of block.rows) {
    const tableRow = document.createElement("tr");
    for (const cell of row) {
      const data = document.createElement("td");
      appendInline(data, cell);
      tableRow.append(data);
    }
    body.append(tableRow);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

function appendInline(container, nodes) {
  for (const node of nodes) {
    if (node.type === "text") {
      container.append(document.createTextNode(node.value));
    } else if (node.type === "code") {
      const code = document.createElement("code");
      code.textContent = node.value;
      container.append(code);
    } else if (node.type === "link") {
      const link = document.createElement("a");
      link.href = node.href;
      link.rel = "noreferrer";
      appendInline(link, node.children);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const approvalId = approvalIdFromUrl(node.href);
        if (approvalId) {
          reviewCanvasApproval(approvalId).catch((error) => toast(error.message, true));
        } else {
          api.openExternal(node.href).catch((error) => toast(error.message, true));
        }
      });
      container.append(link);
    } else {
      const tag = node.type === "strong" ? "strong" : node.type === "delete" ? "del" : "em";
      const element = document.createElement(tag);
      appendInline(element, node.children);
      container.append(element);
    }
  }
}

function approvalIdFromUrl(value) {
  try {
    const url = new URL(value);
    const amos = new URL(state?.settings?.amosMcpUrl || "");
    if (url.origin !== amos.origin) return "";
    const match = url.pathname.match(/^\/(?:settings\/)?approvals\/([0-9a-f-]{36})\/?$/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function beginInlineActivity() {
  pendingUiActions = [];
  pendingGenericConnectCalls = 0;
  elements.liveEvents.replaceChildren();
  elements.activityStreamTitle.textContent = "AMOS is working";
  elements.runningIndicator.textContent = "Starting…";
  elements.runningIndicator.classList.add("active");
  elements.activityStream.classList.remove("hidden");
  elements.activityStream.open = true;
  elements.messages.append(elements.activityStream);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function finishInlineActivity() {
  if (elements.activityStream.classList.contains("hidden")) return;
  const count = elements.liveEvents.childElementCount;
  elements.activityStreamTitle.textContent = "Work complete";
  elements.runningIndicator.textContent = `${count} recorded step${count === 1 ? "" : "s"}`;
  elements.runningIndicator.classList.remove("active");
  elements.activityStream.open = false;
}

function captureGovernedUiActions(event) {
  if (
    event?.type === "tool_start" &&
    event.name === "amos_call_engine_tool" &&
    event.args?.engine === "connections" &&
    event.args?.tool === "connect_link"
  ) {
    pendingGenericConnectCalls += 1;
    return;
  }
  const directConnect = ["connect_link", "amos_connections_connect_link"].includes(event?.name);
  const genericConnect = event?.name === "amos_call_engine_tool" && pendingGenericConnectCalls > 0;
  if (event?.type === "tool_error" && genericConnect) {
    pendingGenericConnectCalls -= 1;
    return;
  }
  if (event?.type !== "tool_end" || (!directConnect && !genericConnect)) return;
  if (genericConnect) pendingGenericConnectCalls -= 1;
  const payload = parsePlatformToolResult(event.result);
  const actions = Array.isArray(payload?.ui_actions) ? payload.ui_actions : [];
  for (const action of actions) {
    if (action?.authority !== "amos_platform" || action?.type !== "open_url") continue;
    let url;
    try {
      url = new URL(String(action.url || ""));
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    pendingUiActions.push({
      label: String(action.label || "Continue securely").slice(0, 120),
      description: String(action.description || "Continue in your browser; credentials remain with AMOS Platform.").slice(0, 300),
      url: url.href,
      expiresAt: String(action.expires_at || "")
    });
  }
}

function parsePlatformToolResult(result) {
  for (const candidate of [result, result?.result]) {
    if (candidate && typeof candidate === "object" && Array.isArray(candidate.ui_actions)) {
      return candidate;
    }
    for (const item of Array.isArray(candidate?.content) ? candidate.content : []) {
      if (item?.type !== "text" || typeof item.text !== "string") continue;
      try {
        const parsed = JSON.parse(item.text);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // A normal prose tool result is not a UI action.
      }
    }
    if (typeof candidate?.text === "string") {
      try {
        const parsed = JSON.parse(candidate.text);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Ignore untyped text.
      }
    }
  }
  return null;
}

function renderGovernedUiActions() {
  for (const action of pendingUiActions) {
    const card = document.createElement("div");
    card.className = "message-actions";
    const copy = document.createElement("div");
    copy.className = "message-action-copy";
    const title = document.createElement("strong");
    title.textContent = action.label;
    const detail = document.createElement("span");
    detail.textContent = action.expiresAt
      ? `${action.description} · Short-lived link`
      : action.description;
    copy.append(title, detail);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button primary message-action-button";
    button.textContent = `${action.label} →`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api.openExternal(action.url);
      } catch (error) {
        toast(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    card.append(copy, button);
    elements.messages.append(card);
  }
  pendingUiActions = [];
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderLiveEvent(event) {
  if (event.type === "assistant_delta") {
    if (streamingMessage) {
      streamingMessage.className = "message assistant streaming";
      streamingMessage.replaceChildren();
      const markdown = document.createElement("div");
      markdown.className = "markdown-content";
      renderMarkdown(markdown, event.text || "");
      streamingMessage.append(markdown);
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }
    return;
  }
  captureGovernedUiActions(event);
  const card = document.createElement("div");
  card.className = `event-card${event.type === "tool_error" ? " error" : ""}${event.type === "phase" ? " phase" : ""}${event.type === "workflow" ? " workflow" : ""}`;
  const title = document.createElement("strong");
  title.textContent =
    event.type === "workflow"
      ? `◇ ${event.title}`
      : event.type === "phase"
      ? `◌ ${event.phase}`
      : event.type === "tool_start"
      ? `→ ${event.name}`
      : event.type === "tool_error"
        ? `× ${event.name}`
        : `✓ ${event.name}`;
  const detail = document.createElement("span");
  detail.textContent =
    event.type === "workflow"
      ? `${event.steps?.join(" → ") || event.summary}${event.doneWhen ? ` · Done when: ${event.doneWhen}` : ""}`
      : event.type === "phase"
      ? event.summary
      : event.type === "tool_error"
      ? event.error
      : event.type === "tool_start"
        ? humanizeTool(event.name)
        : "Completed with a recorded result";
  card.append(title, detail);
  elements.liveEvents.append(card);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

const CONSEQUENTIAL_RECEIPT_STATES = new Set([
  "executed",
  "failed",
  "denied",
  "expired",
  "measured",
  "reverted",
  "rolled_back",
  "canceled",
  "cancelled"
]);

function renderHistory() {
  if (!state) return;
  elements.activityList.replaceChildren();
  const companyReceipts = (Array.isArray(state.companyReceipts) ? state.companyReceipts : [])
    .filter(isConsequentialReceipt)
    .slice(0, 25);
  if (companyReceipts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "Consequential company outcomes will appear here.";
    elements.activityList.append(empty);
    return;
  }
  for (const receipt of companyReceipts) {
    const row = document.createElement("article");
    row.className = "history-outcome-card";
    const content = document.createElement("div");
    content.className = "history-outcome-content";
    const meta = document.createElement("div");
    meta.className = "decision-meta";
    const status = document.createElement("span");
    status.className = `decision-status ${receipt.lifecycleState || "recorded"}`;
    status.textContent = historyOutcomeStatus(receipt);
    const verification = document.createElement("span");
    verification.className = `history-verification ${receipt.verified ? "verified" : "recorded"}`;
    verification.textContent = receipt.verified ? "Verified" : "Receipt recorded";
    meta.append(status, verification);
    const title = document.createElement("h3");
    title.textContent = humanizeOperation(receipt.operation);
    const summary = document.createElement("p");
    summary.textContent = receipt.summary || "AMOS recorded the outcome of this company action.";
    content.append(meta, title, summary);
    const time = document.createElement("time");
    time.className = "history-outcome-time";
    time.dateTime = receipt.createdAt;
    time.textContent = receipt.createdAt
      ? new Date(receipt.createdAt).toLocaleString()
      : "";
    row.append(content, time);
    elements.activityList.append(row);
  }
}

function isConsequentialReceipt(receipt) {
  const lifecycleState = String(receipt?.lifecycleState || "").toLowerCase();
  return Boolean(
    receipt?.effectApplied === true ||
    CONSEQUENTIAL_RECEIPT_STATES.has(lifecycleState)
  );
}

function historyOutcomeStatus(receipt) {
  const lifecycleState = String(receipt?.lifecycleState || "recorded").toLowerCase();
  if (lifecycleState === "executed" && receipt.effectApplied === true) return "Applied";
  if (lifecycleState === "measured") return "Measured";
  return lifecycleState.replaceAll("_", " ");
}

function humanizeOperation(operation) {
  const value = String(operation || "Company action").replace(/^amos_/, "").replaceAll("_", " ");
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function setRunning(value) {
  running = value;
  elements.runButton.disabled = false;
  renderRunButtonLabel();
  elements.cancelButton.classList.toggle("hidden", !value);
  elements.cancelButton.disabled = false;
  elements.cancelButton.textContent = "Stop safely";
  elements.attachButton.disabled = value;
  elements.promptInput.disabled = false;
  elements.promptInput.placeholder = value
    ? "Add direction while AMOS works…"
    : idlePromptPlaceholder();
  elements.runningIndicator.textContent = value ? "Working · steer or stop" : "Idle";
  elements.runningIndicator.classList.toggle("active", value);
  if (value) {
    elements.activityStreamTitle.textContent = "AMOS is working";
  } else {
    finishInlineActivity();
  }
  renderAttachments();
  renderUpdate();
  renderConversationActions();
}

function renderRunButtonLabel() {
  const label = running
    ? "Steer AMOS "
    : state?.mode?.offline
      ? "Run locally "
      : state?.mode?.personal
        ? "Run privately "
        : state?.connectionMode === "demo"
          ? "Run in demo "
          : "Run with AMOS ";
  elements.runButton.replaceChildren(document.createTextNode(label), text("→"));
}

function idlePromptPlaceholder() {
  if (state?.mode?.offline) {
    return "Ask about this project, attach a document, paste a screenshot, or describe offline work…";
  }
  if (state?.mode?.personal) {
    return "Ask about this project, attach a document, paste a screenshot, or describe work to move forward…";
  }
  if (state?.connectionMode === "demo") {
    return "Ask about Northwind, create something, or make a governed sample-company change…";
  }
  return "Ask about the company, attach a document, paste a screenshot, or describe work to move forward…";
}

function renderUpdate() {
  const status = updateState?.status;
  const visible = ["available", "downloading", "downloaded", "installing"].includes(status);
  elements.updateButton.classList.toggle("hidden", !visible);
  elements.updateButton.classList.toggle("ready", status === "downloaded");
  elements.updateButton.disabled =
    ["downloading", "installing"].includes(status) || (status === "downloaded" && running);
  if (status === "available") {
    elements.updateButton.textContent = updateState.availableVersion
      ? `Download v${updateState.availableVersion}`
      : "Download update";
  } else if (status === "downloading") {
    elements.updateButton.textContent = Number.isFinite(updateState.progress)
      ? `Downloading… ${updateState.progress}%`
      : "Downloading update…";
  } else if (status === "downloaded") {
    elements.updateButton.textContent = running ? "Update ready after task" : "Restart and install";
  } else if (status === "installing") {
    elements.updateButton.textContent = "Restarting to update…";
  }
  elements.updateButton.title = updateState?.message || "";
  renderAccountMenu();
}

async function handleUpdate() {
  try {
    if (updateState?.status === "available") {
      await api.downloadUpdate();
    } else if (updateState?.status === "downloaded") {
      if (running) {
        toast("Wait for the current AMOS task to finish before restarting.", true);
        return;
      }
      await api.installUpdate();
    }
  } catch (error) {
    toast(error.message, true);
  }
}

async function resolveApproval(approved, persistence = "once") {
  if (!pendingApproval) return;
  const approval = pendingApproval;
  try {
    if (approved && persistence === "kind") {
      state = await api.allowLocalApprovalKind(approval.kind);
    } else if (approved && persistence === "workspace") {
      state = await api.setLocalApprovalMode("workspace");
      const enabled = state.settings.localApprovalMode === "workspace" &&
        state.settings.localApprovalWorkspace === state.settings.workspace;
      if (!enabled) {
        toast("Local auto-approve was not enabled. The current request is still waiting.");
        return;
      }
    }
    await api.resolveApproval(approval.id, approved);
    clearInlineApproval();
    if (!approved) {
      toast("Action denied.");
    } else if (persistence === "kind") {
      toast(`Approved. AMOS will always allow ${localApprovalKindLabel(approval.kind)} in this folder.`);
    } else if (persistence === "workspace") {
      toast("Approved. Local auto-approve is on for this folder; company approvals remain governed.");
    } else {
      toast("Approved once.");
    }
    pendingApproval = null;
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

function clearInlineApproval() {
  elements.approvalModal.classList.add("hidden");
  pendingApproval = null;
  if (running) {
    elements.promptInput.placeholder = "Add direction while AMOS works…";
    elements.activityStreamTitle.textContent = "AMOS is working";
    elements.runningIndicator.textContent = "Working · steer or stop";
  }
}

function localApprovalKindLabel(kind) {
  return {
    shell: "local commands",
    "file-write": "file writes",
    "code-patch": "code patches"
  }[kind] || "";
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  if (button.classList.contains("start-mode-card")) {
    button.classList.toggle("busy", busy);
    button.setAttribute("aria-busy", String(busy));
    return;
  }
  button.textContent = label;
}

function toast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.style.borderColor = error ? "rgba(255,117,87,.5)" : "";
  elements.toast.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => elements.toast.classList.add("hidden"), 4200);
}

function friendlyError(error) {
  return String(error?.message || error || "Something went wrong")
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, "")
    .trim();
}

function showFatal(error) {
  elements.loading.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "AMOS Desktop could not start";
  const detail = document.createElement("p");
  detail.textContent = error.message;
  elements.loading.append(title, detail);
}

function humanizeTool(name) {
  return name.replace(/^amos_/, "").replaceAll("_", " ");
}

function strong(value) {
  const element = document.createElement("strong");
  element.textContent = value;
  return element;
}

function text(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element;
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${Math.round(bytes / 1_024)} KB`;
  return `${Math.round((bytes / 1_024 ** 2) * 10) / 10} MB`;
}
