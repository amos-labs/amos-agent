import { shouldSubmitPrompt } from "../../src/desktop/input.js";
import { parseMarkdown } from "../../src/desktop/markdown.js";
import {
  AUTOMATION_SETUP_PHASES,
  compileAutomationMappings,
  mappingRowsForOperation,
  previewAutomationMappings
} from "../../src/desktop/automationSetup.js";
import {
  AMOS_SAVINGS_AUDIT_PROMPT,
  selectJourneyStarterActions
} from "../../src/desktop/journeyStarterActions.js";

const api = window.amosDesktop;

applyPlatformShell();

const providerDefaults = {
  kimi: {
    model: "kimi-k3",
    baseUrl: "https://api.moonshot.ai/v1",
    credential: "Moonshot API key"
  },
  xai: {
    model: "grok-4.6",
    baseUrl: "https://api.x.ai/v1",
    credential: "xAI API key"
  },
  "amos-hosted": {
    model: "auto",
    baseUrl: "",
    credential: "AMOS company subscription required. Uses your AMOS sign-in—no second key. Included credits apply first; additional use is metered."
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

const LIVE_EVENT_VISIBLE_COUNT = 20;
const INLINE_LIVE_STEP_LIMIT = 8;
const LIST_PAGE_SIZE = 15;
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
let lastThoughtPaintAt = 0;
let pendingThoughtText = "";
let thoughtPaintTimer = null;
let canvasSidecarOpen = false;
let panelUserClosed = false;
let currentPanelTab = "activity";
let runTerminalState = "idle";
let activeUiRunToken = 0;
let pendingUiActions = [];
let pendingGenericConnectCalls = 0;
let continuityConversationRestored = false;
const transientTaskMessages = new Set();
const decisionInputDrafts = new Map();
let forkTaskSource = null;
let automationSetupDraft = null;
let automationSetupOperations = null;
let automationSetupBusy = false;
let selectedProjectId = "";
let taskStatusFilter = "all";
const listPages = { tasks: 1, projects: 1, briefings: 1 };
const listQueryKeys = { tasks: "", projects: "", briefings: "" };
const expandedProjectAccordions = new Set();
const projectActivityFilters = new Map();
let onboardingDoor = "hosted";
const NAV_COLLAPSED_KEY = "amos.desktop.nav-collapsed.v1";
const CONTEXT_WIDTH_KEY = "amos.desktop.context-width.v1";
const elements = Object.fromEntries(
  [
    "loading", "app", "onboardingView", "operatorView", "workView", "settingsView",
    "memoryView", "projectsView", "tasksView", "canvasView", "connectionsView", "automationsView",
    "connectionDot", "connectionLabel", "connectionDetail", "runtimeBadge", "modeBadge", "workspaceLabel",
    "localApprovalButton", "localApprovalLabel",
    "identityDetail", "identityBadge", "accountMenuButton", "accountMenu", "accountMenuClose",
    "accountList", "addAccountButton", "signOutAccountButton", "accountVersion", "accountUpdateButton",
    "accountMemoryButton", "accountIntelligenceButton",
    "companySwitcherControl", "companySwitcher",
    "decisionBadge", "privateMemoryBadge", "projectBadge", "taskBadge", "canvasBadge", "connectionBadge", "automationBadge",
    "operatorEyebrow", "operatorTitle", "readyTitle", "readyDescription",
    "appearanceControl", "appearanceToggle", "appearanceInput",
    "connectButton", "localModeButton", "demoModeButton", "onboardHostedButton", "onboardByokButton", "connectCheck",
    "onboardingPicker", "onboardingPickerLabel", "onboardingModelSelect", "onboardingKeyField", "onboardingByokKey",
    "northwindIntelligenceChoice", "northwindUsageSummary", "northwindCurrentIntelligence",
    "demoHostedIntelligenceButton", "demoLocalIntelligenceButton", "demoByokIntelligenceButton",
    "providerCheck", "onboardingProviderText", "onboardingIntelligenceHint",
    "workspaceCheck", "onboardingWorkspaceText", "onboardingWorkspaceHint", "enterButton", "boundaryReadinessText",
    "onboardingGateModal", "onboardingGateTitle", "onboardingGateMessage", "onboardingGateClose",
    "personalIntelligenceCallout",
    "telemetryConsent", "telemetryConsentText", "telemetryAllowButton", "telemetryDeclineButton", "telemetryInput",
    "conversation", "conversationHeading", "welcomeMessage",
    "connectSystemsPush", "connectSystemsPushButton", "savingsAuditButton",
    "messages", "promptForm", "promptInput", "runButton", "cancelButton", "clearButton", "liveEvents",
    "chatRunStatus", "chatRunStatusText", "chatRunThoughtSnippet", "chatRunActivityButton",
    "newConversationButton", "forkConversationButton", "composerProjectChip",
    "sidebarToggle", "operatorGrid", "activityStream", "activityStreamTitle",
    "canvasSidecar", "contextResizeHandle", "panelActivityTab", "panelCanvasTab",
    "panelActivityCount", "panelCanvasCount", "panelStateBadge",
    "attachmentList", "attachButton",
    "runningIndicator", "deploymentSummary", "activityList", "providerCards", "settingsForm",
    "managedProfileField", "advancedInfrastructureDetails",
    "hybridRoutingEnabled", "hybridRoutingControls", "hybridLocalModelInput",
    "hybridFrontierInput", "hybridRoutineStrategyInput", "hybridBalancedStrategyInput",
    "hybridDeepStrategyInput", "hybridFrontierStrategyInput", "hybridRoutingStatus",
    "managedConnectionCallout", "managedConnectButton",
    "localSetupField", "localSetupButton", "offlineIntelligenceCard",
    "modelSelectField", "modelInput", "customModelField", "customModelInput",
    "baseUrlInput", "baseUrlHelp", "bedrockAuthField", "bedrockAuthInput",
    "bedrockRetentionField", "bedrockRetentionConsent", "bedrockRetentionButton", "bedrockRetentionStatus",
    "intelligenceRolesField", "intelligenceRolesEnabled", "intelligenceRoleControls", "plannerRoleInput",
    "implementerRoleInput", "checkerRoleInput",
    "apiKeyInput", "apiKeyHelp", "reasoningInput", "operatingModeInput", "mcpInput",
    "autonomousCheckpointInput",
    "taskRoleBar", "plannerRoleButton", "implementerRoleButton", "checkerRoleButton",
    "taskUsageLine",
    "settingsBackButton", "settingsError", "intelligenceTestStatus", "intelligenceTestIcon",
    "intelligenceTestTitle", "intelligenceTestDetail", "collaborationProfileCard", "collaborationProfileFields",
    "resetCollaborationProfileButton",
    "testButton", "systemCard", "approvalModal", "approvalMessage",
    "approveButton", "denyButton", "taskApproveButton", "alwaysApproveButton", "autoApproveFolderButton", "approvalPersistence",
    "approvalScopeNote", "toast", "approvalsButton", "workspaceButton",
    "onboardingWorkspaceButton", "disconnectButton", "refreshDecisionsButton",
    "allApprovalsButton", "decisionSyncStatus", "decisionNotice", "offlineProposalList", "pendingDecisions",
    "recentDecisions", "updateButton", "privateMemoryList", "privateMemoryEmpty",
    "workDecisionsTab", "workProofTab", "workDecisionTabCount", "workDecisionsPanel", "workProofPanel",
    "exportEvidencePackButton",
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
    "automationOperationsCenter", "automationOperationsContract", "automationSimulation",
    "automationFailureList", "automationRunHistory", "automationRunCount", "automationRunList",
    "automationSetupSurface", "automationSetupTitle", "automationSetupSubtitle",
    "automationSetupPhases", "automationSetupBody", "automationSetupError",
    "automationSetupBack", "automationSetupNext", "automationSetupClose", "canvasSurface",
    "taskSummary", "taskSearchInput", "taskProjectFilterInput", "taskStatusFilters", "taskPlatformNotice", "taskEmpty",
    "taskList", "taskPager", "newTaskButton", "conversationRecovery", "conversationRecoveryList",
    "projectUnavailable", "projectSearchInput", "projectEmpty", "projectList", "projectPager",
    "refreshProjectsButton", "newProjectButton", "projectModal", "projectForm",
    "projectModalTitle", "projectModalClose", "projectIdInput", "projectNameInput",
    "projectInstructionsInput", "projectCostInput", "projectModalError", "projectCancelButton",
    "projectSubmitButton",
    "goalModal", "goalForm", "goalModalTitle", "goalModalClose", "goalProjectIdInput",
    "goalProjectName", "goalObjectiveInput", "goalCheckpointInput", "goalModalError", "goalCancelButton",
    "goalSubmitButton",
    "capsuleModal", "capsulePassphraseForm", "capsuleModalTitle", "capsuleModalMessage",
    "capsulePassphraseInput", "capsuleConfirmField", "capsuleConfirmInput", "capsuleError",
    "capsuleCancelButton", "capsuleContinueButton", "capsulePreview", "capsulePreviewSummary",
    "capsulePreviewItems", "capsulePreviewWarning", "capsulePreviewCancelButton",
    "capsuleImportConfirmButton", "canvasTitle", "canvasSubtitle", "canvasRefreshButton", "canvasSaveButton", "canvasScheduleButton",
    "canvasCloseButton", "canvasToggleButton", "canvasSourceBar", "canvasTabs", "canvasEmpty", "canvasEmptyTitle",
    "canvasEmptyMessage", "canvasBlocks", "briefingSearchInput", "briefingLibrary", "savedViewList", "briefingPager", "briefingTemplateList",
    "newBriefingButton",
    "canvasStartButton", "scopeNote", "offlineRuntimeStatus", "offlineModelList",
    "offlineRefreshButton", "offlineInstallRuntimeButton", "offlineManifestDigest",
    "offlineSetupSteps", "offlineSetupRuntime", "offlineSetupModel", "offlineSetupActivate",
    "demoBanner", "demoExpiry", "demoConnectButton", "demoChangeIntelligenceButton",
    "demoLeaveButton", "starterActions",
    "connectionCatalogSummary", "connectedSystemList", "availableProviderList", "liveCanvasList",
    "briefingScheduleModal", "briefingScheduleForm", "briefingScheduleTitle",
    "briefingScheduleKind", "briefingScheduleWeekday", "briefingScheduleTime",
    "briefingScheduleInterval", "briefingWeekdayField", "briefingTimeField",
    "briefingIntervalField", "briefingScheduleError", "briefingScheduleCancel",
    "briefingScheduleSubmit",
    "forkTaskModal", "forkTaskForm", "forkTaskTitle", "forkTaskParent",
    "forkTaskParentId", "forkTaskSourceEventId", "forkTaskName", "forkTaskObjective", "forkAdvancedOptions",
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
  if (state.activeCanvasId) currentPanelTab = "canvas";
  syncAutomationSetup(state.automationSetup);
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
    button.addEventListener("click", () => {
      if (firstRunNeeded()) {
        explainOnboardingGate();
        return;
      }
      showView(button.dataset.view);
    });
  }
  elements.sidebarToggle.addEventListener("click", toggleSidebar);
  bindContextResize();
  for (const button of document.querySelectorAll("[data-open-settings]")) {
    button.addEventListener("click", openIntelligenceSettings);
  }
  elements.settingsBackButton.addEventListener("click", returnFromIntelligenceSettings);
  elements.connectButton.addEventListener("click", startConnectApplications);
  elements.onboardHostedButton.addEventListener("click", chooseHostedIntelligence);
  elements.localModeButton.addEventListener("click", () => chooseOnboardingDoor("local"));
  elements.onboardByokButton.addEventListener("click", () => chooseOnboardingDoor("byok"));
  elements.onboardingModelSelect.addEventListener("change", commitOnboardingPicker);
  elements.onboardingByokKey.addEventListener("change", commitOnboardingPicker);
  elements.demoModeButton.addEventListener("click", startDemo);
  elements.demoConnectButton.addEventListener("click", connectAmos);
  elements.demoHostedIntelligenceButton.addEventListener("click", useDemoHostedIntelligence);
  elements.demoLocalIntelligenceButton.addEventListener("click", () => openDemoIntelligenceSettings("ollama"));
  elements.demoByokIntelligenceButton.addEventListener("click", () => openDemoIntelligenceSettings("openai"));
  elements.demoChangeIntelligenceButton.addEventListener("click", () => openDemoIntelligenceSettings());
  elements.demoLeaveButton.addEventListener("click", leaveDemo);
  elements.workspaceButton.addEventListener("click", chooseWorkspace);
  elements.localApprovalButton.addEventListener("click", toggleLocalApproval);
  elements.onboardingWorkspaceButton.addEventListener("click", chooseWorkspace);
  elements.telemetryAllowButton.addEventListener("click", () => setTelemetryPreference(true));
  elements.telemetryDeclineButton.addEventListener("click", () => setTelemetryPreference(false));
  elements.telemetryInput.addEventListener("change", () => {
    const value = elements.telemetryInput.value;
    if (value === "true") setTelemetryPreference(true);
    else if (value === "false") setTelemetryPreference(false);
    else renderTelemetryPreference();
  });
  elements.enterButton.addEventListener("click", () => {
    completeOnboarding().catch((error) => toast(error.message, true));
  });
  elements.onboardingGateClose.addEventListener("click", closeOnboardingGate);
  elements.onboardingGateModal.addEventListener("click", (event) => {
    if (event.target === elements.onboardingGateModal) closeOnboardingGate();
  });
  elements.connectSystemsPushButton.addEventListener("click", pushConnectSystems);
  elements.savingsAuditButton.addEventListener("click", runSavingsAudit);
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
  elements.resetCollaborationProfileButton.addEventListener("click", async () => {
    try {
      state.relationshipProfile = await api.resetRelationshipProfile({
        expectedRevision: state.relationshipProfile?.profile?.revision ?? 0
      });
      renderCollaborationProfile();
    } catch (error) {
      toast(error.message, true);
    }
  });
  elements.modelInput.addEventListener("change", syncSelectedModelEndpoint);
  elements.intelligenceRolesEnabled.addEventListener("change", () => {
    renderIntelligenceRoleControls();
  });
  elements.hybridRoutingEnabled.addEventListener("change", renderHybridRoutingControls);
  for (const button of [elements.plannerRoleButton, elements.implementerRoleButton, elements.checkerRoleButton]) {
    button.addEventListener("click", () => switchIntelligenceRole(button.dataset.role));
  }
  elements.baseUrlInput.addEventListener("change", syncSelectedModelEndpoint);
  elements.bedrockAuthInput.addEventListener("change", () =>
    renderProviderFields(elements.modelInput.value)
  );
  elements.bedrockRetentionConsent.addEventListener("change", () => {
    elements.bedrockRetentionButton.disabled = !elements.bedrockRetentionConsent.checked;
  });
  elements.bedrockRetentionButton.addEventListener("click", configureBedrockDataRetention);
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
    openIntelligenceSettings();
  });
  elements.addAccountButton.addEventListener("click", addAccount);
  elements.signOutAccountButton.addEventListener("click", disconnectAmos);
  elements.accountUpdateButton.addEventListener("click", handleAccountUpdate);
  elements.companySwitcher.addEventListener("change", switchCompany);
  elements.refreshAutomationsButton.addEventListener("click", refreshAutomations);
  elements.buildAutomationButton.addEventListener("click", () => openAutomationTask(null, elements.buildAutomationButton, true));
  elements.automationEmptyBuildButton.addEventListener("click", () => openAutomationTask(null, elements.automationEmptyBuildButton, true));
  elements.automationSetupBack.addEventListener("click", automationSetupBack);
  elements.automationSetupNext.addEventListener("click", automationSetupNext);
  elements.automationSetupClose.addEventListener("click", closeAutomationSetup);
  elements.newTaskButton.addEventListener("click", () => createNewConversation(elements.newTaskButton));
  elements.newConversationButton.addEventListener("click", () => createNewConversation(elements.newConversationButton));
  elements.forkConversationButton.addEventListener("click", forkCurrentConversation);
  elements.taskSearchInput.addEventListener("input", () => {
    listPages.tasks = 1;
    renderTasks();
  });
  elements.taskProjectFilterInput.addEventListener("change", () => {
    listPages.tasks = 1;
    renderTasks();
  });
  elements.projectSearchInput.addEventListener("input", () => {
    listPages.projects = 1;
    renderProjects();
  });
  elements.briefingSearchInput.addEventListener("input", () => {
    listPages.briefings = 1;
    renderBriefingLibrary();
  });
  elements.newBriefingButton.addEventListener("click", startNewBriefingFromScratch);
  elements.refreshProjectsButton.addEventListener("click", refreshProjects);
  elements.newProjectButton.addEventListener("click", () => openProjectModal());
  elements.projectForm.addEventListener("submit", submitProject);
  elements.projectModalClose.addEventListener("click", closeProjectModal);
  elements.projectCancelButton.addEventListener("click", closeProjectModal);
  elements.projectModal.addEventListener("click", (event) => {
    if (event.target === elements.projectModal) closeProjectModal();
  });
  elements.goalForm.addEventListener("submit", submitAutonomousGoal);
  elements.goalModalClose.addEventListener("click", closeGoalModal);
  elements.goalCancelButton.addEventListener("click", closeGoalModal);
  elements.goalModal.addEventListener("click", (event) => {
    if (event.target === elements.goalModal) closeGoalModal();
  });
  elements.forkTaskForm.addEventListener("submit", submitTaskFork);
  elements.forkTaskCancel.addEventListener("click", closeTaskForkModal);
  elements.forkTaskModal.addEventListener("click", (event) => {
    if (event.target === elements.forkTaskModal) closeTaskForkModal();
  });
  for (const input of document.querySelectorAll('[name="forkContextScope"], [name="forkWorkspaceMode"]')) {
    input.addEventListener("change", renderTaskForkPreview);
  }
  elements.approvalsButton.addEventListener("click", () => showView("decisions"));
  elements.chatRunActivityButton.addEventListener("click", () => openPanel("activity"));
  elements.panelActivityTab.addEventListener("click", () => openPanel("activity"));
  elements.panelCanvasTab.addEventListener("click", () => openPanel("canvas"));
  elements.workDecisionsTab.addEventListener("click", () => showWorkTab("open"));
  elements.workProofTab.addEventListener("click", () => showWorkTab("history"));
  elements.exportEvidencePackButton.addEventListener("click", exportEvidencePack);
  elements.allApprovalsButton.addEventListener("click", () => api.openApprovals());
  elements.refreshDecisionsButton.addEventListener("click", refreshDecisions);
  elements.approveButton.addEventListener("click", () => resolveApproval(true));
  elements.denyButton.addEventListener("click", () => resolveApproval(false));
  elements.alwaysApproveButton.addEventListener("click", () =>
    resolveApproval(true, "kind")
  );
  elements.taskApproveButton.addEventListener("click", () =>
    resolveApproval(true, "task")
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
  elements.canvasToggleButton.addEventListener("click", toggleCanvasSidecar);
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
    if (event.key === "Escape" && !elements.projectModal.classList.contains("hidden")) {
      closeProjectModal();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (elements.accountMenu.classList.contains("hidden")) return;
    if (elements.accountMenu.contains(event.target) || elements.accountMenuButton.contains(event.target)) return;
    closeAccountMenu();
  });
  window.addEventListener("resize", () => {
    if (!elements.accountMenu.classList.contains("hidden")) placeAccountMenu();
  });
}

function bindEvents() {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((state?.settings?.appearance || "system") === "system") applyAppearance("system");
  });
  api.on("agent:event", (event) => {
    if (!eventMatchesActiveTask(event)) return;
    if (event.type === "usage") {
      state.activeTask = {
        ...(state.activeTask || {}),
        usage: accumulateRendererUsage(state.activeTask?.usage, event)
      };
      renderTaskUsage();
    }
    if (event.type === "intelligence") {
      state.intelligenceRole = event.role;
      state.activeTask = {
        ...(state.activeTask || {}),
        intelligenceRole: event.role,
        intelligence: { provider: event.provider, model: event.model, role: event.role }
      };
      renderTaskRoles();
    }
    if (event.type === "coding_lifecycle") {
      state.activeTask = {
        ...(state.activeTask || {}),
        codingLifecycle: event.state || null
      };
    }
    renderLiveEvent(event);
  });
  api.on("agent:status", (taskStatus) => {
    if (!eventMatchesActiveTask(taskStatus)) return;
    currentTaskId = taskStatus?.running ? taskStatus.taskId || currentTaskId : null;
    if (!taskStatus?.running && pendingApproval) clearInlineApproval();
    if (!taskStatus?.running && taskStatus?.reason === "user_cancelled") {
      finishCanceledRunInUi(taskStatus.taskId);
      return;
    }
    setRunning(Boolean(taskStatus?.running));
  });
  api.on("desktop-runs:changed", (runs) => {
    if (!state) return;
    const interaction = captureInteractiveState();
    state.activeRuns = Array.isArray(runs) ? runs : [];
    renderProjects();
    renderTasks();
    restoreInteractiveState(interaction);
  });
  api.on("activity:changed", (activity) => {
    const envelope = Array.isArray(activity) ? { items: activity } : activity || {};
    if (state && eventMatchesActiveTask(envelope)) state.activity = envelope.items || [];
  });
  api.on("canvas:changed", (canvasState) => {
    if (!state || !eventMatchesActiveTask(canvasState)) return;
    state.canvases = canvasState.canvases || [];
    state.activeCanvasId = canvasState.activeCanvasId || null;
    activeCanvasId = state.activeCanvasId;
    if (activeCanvasId && !panelUserClosed) {
      canvasSidecarOpen = true;
      currentPanelTab = "canvas";
      setPanelBadge("artifact");
    }
    renderCanvas();
  });
  api.on("automation-setup:requested", (setup) => {
    if (!state || !eventMatchesActiveTask(setup)) return;
    state.automationSetup = setup;
    syncAutomationSetup(setup);
    showView("operator");
  });
  api.on("offline:changed", (offline) => {
    if (!state) return;
    state.offline = offline;
    renderOfflineModels();
    if (onboardingDoor === "local") {
      const recommended = recommendedOnboardingLocalModel();
      if (
        recommended?.installed &&
        !(state.settings.provider === "ollama" && state.settings.model)
      ) {
        activateRecommendedOnboardingLocal().then(() => render()).catch((error) => toast(error.message, true));
        return;
      }
      renderOnboardingPicker();
    }
  });
  api.on("offline-proposals:changed", (offlineProposals) => {
    if (!state) return;
    state.offlineProposals = offlineProposals || [];
    renderDecisions();
  });
  api.on("task-checkpoints:changed", (taskCheckpoints) => {
    if (!state) return;
    state.taskCheckpoints = taskCheckpoints || [];
    renderTasks();
    renderProjects();
    renderDecisions();
    renderStarterActions();
  });
  api.on("remote:changed", (remote) => {
    if (!state) return;
    const interaction = captureInteractiveState();
    const next = { ...remote };
    if (!eventMatchesActiveTask(remote)) {
      delete next.activeContextKey;
      delete next.activeTaskRecordId;
      delete next.workingContinuity;
      delete next.automationSetup;
    }
    Object.assign(state, next);
    if (eventMatchesActiveTask(remote)) syncAutomationSetup(remote.automationSetup);
    renderIdentity();
    renderAccountMenu();
    renderCompanySwitcher();
    renderDecisions();
    renderWorkingContinuity();
    renderCompanyCache();
    renderConnections();
    renderAutomations();
    renderProjects();
    renderTasks();
    renderHistory();
    renderCanvas();
    renderStarterActions();
    restoreConversationFromContinuity();
    restoreInteractiveState(interaction);
  });
  api.on("update:changed", (nextUpdateState) => {
    updateState = nextUpdateState;
    renderUpdate();
  });
  api.on("desktop:navigate", (navigation) => {
    if (navigation?.destination === "settings") {
      openIntelligenceSettings();
    } else if (navigation?.destination === "memory") {
      showView("memory");
    } else if (navigation?.destination === "choose-workspace") {
      chooseWorkspace();
    } else if (navigation?.destination === "check-updates") {
      handleAccountUpdate();
    }
  });
  api.on("approval:requested", (approval) => {
    if (approval?.kind === "decision-input") {
      if (!state) return;
      const pending = Array.isArray(state.pendingInputs) ? state.pendingInputs : [];
      if (!pending.some((item) => item.id === approval.id)) {
        state.pendingInputs = [...pending, approval];
      }
      renderDecisions();
      renderInlineDecisionRequest(approval, { focus: true });
      updateChatRunStatus(approval.message || "AMOS needs your input to continue.", "waiting");
      setPanelBadge("waiting");
      return;
    }
    if (!eventMatchesActiveTask(approval)) {
      toast("A background run needs local approval. Open its Conversation to review.");
      return;
    }
    pendingApproval = approval;
    elements.approvalMessage.textContent = approval.message;
    const label = localApprovalKindLabel(approval.kind);
    elements.alwaysApproveButton.classList.toggle("hidden", !label);
    elements.taskApproveButton.classList.toggle("hidden", !label);
    elements.approvalPersistence.classList.toggle("hidden", !label);
    elements.alwaysApproveButton.textContent = label ? `Always allow ${label}` : "Always allow this kind";
    const browserAction = approval.kind === "browser-action";
    elements.autoApproveFolderButton.classList.toggle("hidden", !state.settings.workspace || browserAction);
    elements.approvalScopeNote.textContent = browserAction
      ? "Browser approval applies once to the exact origin, page revision, target, and payload shown above. It can never be made persistent or covered by local workspace auto-approval."
      : approval.kind === "shell"
        ? "“Allow for this task” also covers bounded file writes and code patches in this workspace. Shell commands start here with a scrubbed environment but are not OS-sandboxed to the folder."
        : label
          ? `“Allow for this task” covers local commands, file writes, and code patches in this exact workspace until you switch or clear the task. Persistent options remain available when you want them.`
          : "Auto-approve applies only to local work in the selected folder.";
    elements.messages.append(elements.approvalModal);
    elements.approvalModal.classList.remove("hidden");
    elements.activityStreamTitle.textContent = "AMOS is waiting for you";
    elements.runningIndicator.textContent = "Local approval needed";
    updateChatRunStatus("AMOS needs your approval to continue.", "waiting");
    setPanelBadge("waiting");
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
  const needsOnboarding = firstRunNeeded(state);
  elements.onboardingView.classList.toggle("hidden", !needsOnboarding);
  if (needsOnboarding) {
    elements.operatorView.classList.add("hidden");
    elements.projectsView.classList.add("hidden");
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
  renderTaskRoles();
  renderTaskUsage();
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
    const usage = northwindUsageLabel(state.accountStatus?.demo);
    elements.demoExpiry.textContent =
      `Sample data only · expires ${new Date(state.demo.expiresAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      })}${usage ? ` · ${usage}` : ""}`;
  }
  renderNorthwindIntelligenceChoice(demo);
  if (state.mode?.offline) {
    elements.operatorEyebrow.textContent = "WORK OFFLINE";
    elements.readyTitle.textContent = "Local-only is ready.";
    elements.readyDescription.textContent =
      "Work with local code, files, private memory, and any signed company context stored on this computer.";
    elements.promptInput.placeholder =
      "Ask about this project, attach a document, paste a screenshot, or describe offline work…";
  } else if (state.mode?.personal) {
    elements.operatorEyebrow.textContent = "WORK FROM THIS COMPUTER";
    elements.readyTitle.textContent = shouldPushConnectSystems()
      ? "Chat is ready. Connect your company next."
      : "Your workspace is ready.";
    elements.readyDescription.textContent = shouldPushConnectSystems()
      ? "Local chat and coding work now. Connecting the company — then automating app-to-app on a schedule or ad hoc — is the single biggest reason a customer stays."
      : "Understand code, research, create, and automate locally. Nothing here receives company authority.";
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
    elements.readyTitle.textContent = shouldPushConnectSystems()
      ? "Connect your company. That is the product."
      : "AMOS is ready.";
    elements.readyDescription.textContent = shouldPushConnectSystems()
      ? "Ask anything now. AMOS becomes the company OS after it can see your apps and run work on a schedule, ad hoc, or app-to-app — and that is when people stay."
      : "Ask about the company, create something new, or make a change. Consequential actions still wait for the right approval.";
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
  const taskLocalApproval = state.localTaskGrant?.active === true &&
    state.localTaskGrant?.scope?.workspace === state.settings.workspace;
  const localTrustActive = localAutoApprove || localApprovalKinds.length > 0 || taskLocalApproval;
  elements.localApprovalButton.classList.toggle("hidden", !state.settings.workspace);
  elements.localApprovalButton.classList.toggle("active", localTrustActive);
  elements.localApprovalButton.setAttribute("aria-pressed", String(localTrustActive));
  elements.localApprovalButton.title = taskLocalApproval && !localAutoApprove && localApprovalKinds.length === 0
    ? `Bounded local work is allowed for this task in ${state.settings.workspace}. Click to revoke it. Company decisions still use AMOS policy.`
    : localTrustActive
      ? `Persistent local approval is active for ${state.settings.workspace}. Click to return to ask-first. Company decisions still use AMOS policy.`
    : `Turn on local auto-approve for ${state.settings.workspace}. Company decisions remain separate.`;
  elements.localApprovalLabel.textContent = localAutoApprove
    ? "Auto-approve on"
    : localApprovalKinds.length > 0
      ? `Always allow: ${localApprovalKinds.map(localApprovalKindLabel).join(", ")}`
      : taskLocalApproval
        ? "Local work allowed for task"
        : "Auto-approve local work";
  const personalLocal = Boolean(
    (state.mode?.personal || state.mode?.offline) &&
    ["ollama", "llama-cpp"].includes(state.settings.provider)
  );
  const personalByok = Boolean(
    state.mode?.personal &&
    !demo &&
    !["amos-hosted", "ollama", "llama-cpp"].includes(state.settings.provider)
  );
  if (["ollama", "llama-cpp"].includes(state.settings.provider)) onboardingDoor = "local";
  else if (state.mode?.personal && !["amos-hosted", "ollama", "llama-cpp"].includes(state.settings.provider)) {
    onboardingDoor = "byok";
  } else if (state.settings.provider === "amos-hosted" && !state.mode?.personal && !state.mode?.offline) {
    onboardingDoor = "hosted";
  }
  elements.onboardHostedButton.classList.toggle("selected", onboardingDoor === "hosted" && !demo);
  elements.localModeButton.classList.toggle("selected", onboardingDoor === "local" && !demo);
  elements.onboardByokButton.classList.toggle("selected", onboardingDoor === "byok" && !demo);
  renderOnboardingPicker();
  elements.demoModeButton.classList.toggle("selected", demo);
  elements.demoModeButton.disabled = demo;
  elements.demoModeButton.classList.toggle("hidden", activeAccount);
  elements.connectButton.classList.toggle(
    "selected",
    Boolean(state.connected && !demo && !state.mode?.personal && !state.mode?.offline)
  );
  const connectKicker = elements.connectButton.querySelector(".start-mode-kicker");
  const connectTitle = elements.connectButton.querySelector("strong");
  const connectDescription = elements.connectButton.querySelector("strong + span");
  const connectPlan = elements.connectButton.querySelector(".company-plan");
  const connectAction = elements.connectButton.querySelector("em");
  connectKicker.textContent = activeAccount
    ? "YOUR APPLICATIONS · CONNECT NEXT"
    : "THE PRODUCT · 14-DAY TRIAL";
  connectTitle.textContent = activeAccount
    ? `Connect ${activeCompanyName()}`
    : "Connect your company";
  connectDescription.textContent = activeAccount
    ? "Attach the apps this company already runs, then automate them on a schedule or ad hoc — app to app. AMOS is guessing from chat until those systems are connected."
    : "Sign in, attach the apps the business already runs, then let AMOS move work between them on a schedule or when you ask.";
  connectPlan.textContent = activeAccount
    ? "Signed in · connect the company to stay"
    : "14-day free trial · Plans start at $99/month";
  connectAction.textContent = "Connect your company →";
  elements.connectButton.disabled = false;
  elements.boundaryReadinessText.textContent = demo
    ? "Northwind sample is connected. Real retention starts when you connect your own applications."
    : state.connected
      ? "Signed in. Connect your company now — that is the single biggest reason customers stay."
      : state.mode?.offline
        ? "Local-only. You can chat. Connecting applications is how AMOS becomes the company OS."
        : state.mode?.personal
          ? "This computer works for chat and code. Connecting applications is how a trial becomes a customer."
          : "You can enter without this. Chat without applications is a trial. Connecting apps is the product.";
  const startingPointSelected = Boolean(
    state.connected || state.mode?.personal || state.mode?.offline
  );
  const hostedReady = Boolean(
    state.settings.provider === "amos-hosted" && !state.mode?.personal && !state.mode?.offline
  );
  const intelligenceReady = Boolean(
    hostedReady || (startingPointSelected && state.configured) || (demo && state.configured)
  );
  renderStep(elements.connectCheck, startingPointSelected);
  renderStep(elements.providerCheck, intelligenceReady);
  renderStep(elements.workspaceCheck, Boolean(state.settings.workspace));
  elements.onboardingWorkspaceText.textContent = state.settings.workspace
    ? workspaceFolderName(state.settings.workspace)
    : "Choose a folder AMOS may work in";
  elements.onboardingWorkspaceButton.title = state.settings.workspace ||
    "A workspace is optional. Chat works without one.";
  const personalNeedsIntelligence = Boolean(
    state.mode?.personal && !state.connected && !state.configured
  );
  elements.settingsBackButton.textContent = firstRunNeeded(state)
    ? "← Back to setup"
    : "← Back to AMOS";
  elements.enterButton.disabled = !(intelligenceReady && state.mode?.valid !== false);
  elements.enterButton.textContent = onboardingEnterLabel();
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
  renderProjects();
  renderTasks();
  activeCanvasId = state.activeCanvasId || activeCanvasId;
  renderCanvas();
  renderStarterActions();
  renderConversationChrome();
}

function applyPlatformShell() {
  const ua = navigator.userAgent || "";
  const platform = /Windows/i.test(ua)
    ? "win32"
    : /Mac OS X|Macintosh/i.test(ua)
      ? "darwin"
      : "linux";
  document.documentElement.dataset.platform = platform;
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

function firstRunNeeded(current = state) {
  if (!current) return true;
  return (
    current.connectionMode === "demo_expired" ||
    !current.settings?.onboardingCompletedAt
  );
}

function explainOnboardingGate() {
  const ready = elements.enterButton && !elements.enterButton.disabled;
  elements.onboardingGateMessage.textContent = ready
    ? "Operator, Connections, and the rest of the sidebar unlock after you enter AMOS Desktop. Intelligence is already selected — use Enter AMOS Desktop on this screen."
    : "Operator, Connections, and the rest of the sidebar unlock after setup. Finish choosing intelligence on this screen, then enter AMOS Desktop.";
  elements.onboardingGateModal.classList.remove("hidden");
  elements.onboardingGateClose.focus();
}

function closeOnboardingGate() {
  elements.onboardingGateModal.classList.add("hidden");
  elements.enterButton?.scrollIntoView?.({ block: "nearest" });
  elements.enterButton?.focus?.();
}

function openIntelligenceSettings() {
  showView("settings");
}

function returnFromIntelligenceSettings() {
  showView("operator");
}

function showView(view) {
  if (view === "decisions" || view === "activity") {
    showWorkTab(view === "activity" ? "history" : "open");
    view = "work";
  }
  currentView = view;
  const map = {
    operator: elements.operatorView,
    projects: elements.projectsView,
    canvas: elements.canvasView,
    memory: elements.memoryView,
    tasks: elements.tasksView,
    connections: elements.connectionsView,
    automations: elements.automationsView,
    work: elements.workView,
    settings: elements.settingsView
  };
  const keepOnboarding = view !== "settings" && firstRunNeeded();
  for (const [name, section] of Object.entries(map)) {
    section.classList.toggle("hidden", keepOnboarding || name !== view);
  }
  elements.onboardingView.classList.toggle("hidden", !keepOnboarding);
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
      if (connection.usable && connection.id) {
        const disconnect = document.createElement("button");
        disconnect.type = "button";
        disconnect.className = "button danger connection-disconnect-button";
        disconnect.textContent = "Disconnect";
        disconnect.addEventListener("click", () =>
          disconnectConnectedSystem(connection, disconnect)
        );
        card.append(disconnect);
      }
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

async function disconnectConnectedSystem(connection, button) {
  const confirmed = window.confirm(
    `Disconnect ${connection.displayName}?\n\nAMOS will remove its vaulted credential and stop new governed calls through this connection. Existing Automations that depend on it may need attention.`
  );
  if (!confirmed) return;
  setButtonBusy(button, true, "Disconnecting…");
  try {
    const response = await api.disconnectConnection(connection.id);
    state.connectionsCatalog = response.connectionsCatalog || state.connectionsCatalog;
    state.approvals = response.approvals || state.approvals;
    renderConnections();
    renderDecisions();
    renderStarterActions();
    toast(pendingOperationId(response.result)
      ? `Disconnecting ${connection.displayName} is waiting for governed approval in Decisions.`
      : `${connection.displayName} disconnected. Its vaulted credential was removed.`);
  } catch (error) {
    toast(friendlyError(error), true);
    if (button.isConnected) setButtonBusy(button, false, "Disconnect");
  }
}

function renderAutomations() {
  if (!state) return;
  const library = state.automations || {};
  const automations = Array.isArray(library.automations) ? library.automations : [];
  const grants = Array.isArray(library.grants) ? library.grants : [];
  const failures = Array.isArray(library.failures) ? library.failures : [];
  const runs = Array.isArray(library.runs) ? library.runs : [];
  const activeGrants = grants.filter((grant) => grant.status === "active").length;
  const recipeLibrary = state.browserRecipes || {};
  const recipes = Array.isArray(recipeLibrary.recipes) ? recipeLibrary.recipes : [];
  const supported = library.supported === true || recipeLibrary.supported === true;
  const active = automations.filter((automation) => automation.status === "active").length +
    recipes.filter((recipe) => recipe.status === "ready").length;
  const needsAttention = failures.length + automations.filter((automation) =>
    automation.status !== "active" ||
    Number(automation.stats?.toolRunsParked || 0) > 0
  ).length + recipes.filter((recipe) =>
    recipe.status !== "ready" || Number(recipe.runStats?.failed || 0) > 0
  ).length;
  const totalRuns = automations.reduce(
    (sum, automation) => sum + Number(automation.stats?.completed || 0),
    recipes.reduce((sum, recipe) => sum + Number(recipe.runStats?.completed || 0), 0)
  );
  const itemCount = automations.length + recipes.length;

  elements.automationBadge.textContent = String(active);
  elements.automationBadge.classList.toggle("hidden", active === 0);
  elements.automationSummary.classList.toggle("hidden", !supported);
  elements.automationUnavailable.classList.toggle("hidden", supported);
  elements.automationEmpty.classList.toggle("hidden", !supported || itemCount > 0);
  elements.automationList.classList.toggle("hidden", !supported || itemCount === 0);
  const canBuild = state.settings?.operatingMode !== "offline";
  elements.buildAutomationButton.disabled = !canBuild;
  elements.automationEmptyBuildButton.disabled = !canBuild;
  elements.refreshAutomationsButton.disabled = state.connectionMode !== "user";
  renderAutomationOperations(library, failures, runs);

  elements.automationSummary.replaceChildren();
  for (const [label, value, detail] of [
    ["Ready", active, `${activeGrants} exact bounded write grant${activeGrants === 1 ? "" : "s"} currently active`],
    ["Needs attention", needsAttention, `${failures.length} open production failure${failures.length === 1 ? "" : "s"}`],
    ["Completed runs", totalRuns, "bounded deterministic outcomes reported by AMOS"]
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
  for (const recipe of recipes) renderBrowserRecipeCard(recipe);
  for (const automation of automations) {
    const automationGrants = grants.filter((grant) => grant.automationId === automation.id);
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
      ["Enrolled", Number(automation.stats?.enrolled || 0)],
      ["Completed", Number(automation.stats?.completed || 0)],
      ["Parked", Number(automation.stats?.toolRunsParked || 0)],
      ["Failed", Math.max(
        Number(automation.stats?.failed || 0),
        Number(automation.stats?.toolRunsFailed || 0)
      )]
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
      automation.templateKey
        ? `${humanizeTool(automation.blueprintKey || "blueprint")} · ${humanizeTool(automation.templateKey)} v${automation.templateVersion || 1}`
        : "",
      automation.updatedAt ? `Updated ${relativeTime(automation.updatedAt)}` : "",
      automation.stats?.lastToolRunAt
        ? `Last deterministic run ${relativeTime(automation.stats.lastToolRunAt)}`
        : automation.stats?.lastSentAt
        ? `Last delivery ${relativeTime(automation.stats.lastSentAt)}`
        : automation.stats?.lastCalendarEventAt
          ? `Last matched ${relativeTime(automation.stats.lastCalendarEventAt)}`
          : "No completed delivery yet"
    ].filter(Boolean).join(" · ");

    const actions = document.createElement("div");
    actions.className = "automation-actions";
    const edit = actionButton("Work on this with AMOS", "secondary");
    edit.addEventListener("click", () => openAutomationTask(automation, edit));
    const simulate = actionButton("Simulate", "secondary");
    simulate.disabled = library.operationsSupported !== true;
    simulate.addEventListener("click", () => simulateAutomation(automation, simulate));
    const nextActive = automation.status !== "active";
    const statusButton = actionButton(nextActive ? "Resume" : "Pause", nextActive ? "primary" : "secondary");
    statusButton.addEventListener("click", () => changeAutomationStatus(automation, nextActive, statusButton));
    actions.append(edit, simulate, statusButton);

    card.append(heading, description, stats, meta);
    if (library.grantsSupported === true) {
      const authority = document.createElement("section");
      authority.className = "automation-authority";
      const authorityHeading = document.createElement("div");
      const authorityTitle = document.createElement("strong");
      authorityTitle.textContent = "Continuous write authority";
      const authorityCopy = document.createElement("small");
      authorityCopy.textContent = automationGrants.length > 0
        ? "Exact grants are independently bounded, monitored, and revocable."
        : "No standing grant. Connected writes use per-run approval.";
      authorityHeading.append(authorityTitle, authorityCopy);
      authority.append(authorityHeading);
      for (const grant of automationGrants) authority.append(renderAutomationGrant(grant));
      card.append(authority);
    }
    card.append(actions);
    elements.automationList.append(card);
  }
}

function renderAutomationOperations(library, failures, runs) {
  const supported = library.operationsSupported === true;
  elements.automationOperationsCenter.classList.toggle("hidden", !supported);
  elements.automationFailureList.replaceChildren();
  elements.automationRunList.replaceChildren();
  elements.automationRunCount.textContent = new Intl.NumberFormat().format(runs.length);
  if (!supported) return;

  const contract = library.operationsContract || {};
  elements.automationOperationsContract.textContent = contract.external_dispatch === "at_most_once"
    ? "AT-MOST-ONCE DISPATCH"
    : "GOVERNED DISPATCH";

  if (failures.length === 0) {
    const empty = document.createElement("div");
    empty.className = "automation-operations-empty";
    empty.innerHTML = "<strong>No open Automation failures</strong><span>Every current run is settled or still moving.</span>";
    elements.automationFailureList.append(empty);
  }
  for (const failure of failures) {
    const card = document.createElement("article");
    card.className = `automation-failure-card ${failure.failureKind}`;
    const heading = document.createElement("div");
    heading.className = "automation-failure-heading";
    const identity = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = failure.automationName;
    const step = document.createElement("span");
    step.textContent = `${failure.stepKey || `Step ${failure.stepPosition + 1}`} · ${humanizeTool(failure.failureKind)}`;
    identity.append(title, step);
    const safety = document.createElement("span");
    safety.className = `automation-replay-safety ${failure.replaySafe ? "safe" : "ambiguous"}`;
    safety.textContent = failure.replaySafe ? "SAFE TO RETRY" : "EFFECT UNKNOWN";
    heading.append(identity, safety);

    const error = document.createElement("p");
    error.className = "automation-failure-error";
    error.textContent = failure.error;
    const meta = document.createElement("small");
    meta.className = "automation-failure-meta";
    meta.textContent = [
      `Run ${shortId(failure.enrollmentId)}`,
      `definition v${failure.definitionVersion}`,
      failure.lastFailedAt ? `failed ${relativeTime(failure.lastFailedAt)}` : "",
      failure.occurrenceCount > 1 ? `${failure.occurrenceCount} observations` : "",
      `notification ${humanizeTool(failure.notificationState)}`
    ].filter(Boolean).join(" · ");
    const note = document.createElement("textarea");
    note.className = "automation-repair-note";
    note.rows = 2;
    note.maxLength = 1000;
    note.placeholder = failure.replaySafe
      ? "Required: what changed or why this retry is appropriate"
      : "Required: how you verified whether the provider applied the effect";
    const actions = document.createElement("div");
    actions.className = "automation-repair-actions";
    if (failure.replaySafe) {
      const retry = actionButton("Retry exact step", "primary");
      retry.addEventListener("click", () => repairAutomationIncident(
        failure, { action: "retry", externalEffectState: "not_applied" }, note, retry
      ));
      actions.append(retry);
    } else {
      const retry = actionButton("Not applied — retry", "primary");
      retry.addEventListener("click", () => repairAutomationIncident(
        failure, { action: "retry", externalEffectState: "not_applied" }, note, retry
      ));
      const settle = actionButton("Applied — settle", "secondary");
      settle.addEventListener("click", () => repairAutomationIncident(
        failure,
        {
          action: "settle_applied",
          externalEffectState: "applied",
          result: { evidence: "human_attestation_from_automation_operations_center" }
        },
        note,
        settle
      ));
      actions.append(retry, settle);
    }
    const dismiss = actionButton("Dismiss run", "secondary");
    dismiss.addEventListener("click", () => repairAutomationIncident(
      failure, { action: "dismiss", externalEffectState: "unknown" }, note, dismiss
    ));
    actions.append(dismiss);
    card.append(heading, error, meta, note, actions);
    elements.automationFailureList.append(card);
  }

  if (runs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "automation-run-empty";
    empty.textContent = "No deterministic run history yet.";
    elements.automationRunList.append(empty);
  }
  for (const run of runs.slice(0, 30)) {
    const row = document.createElement("article");
    row.className = `automation-run-row ${run.status}`;
    const status = document.createElement("span");
    status.className = "automation-run-state";
    status.textContent = humanizeTool(run.status);
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = run.automationName;
    const detail = document.createElement("small");
    detail.textContent = [
      run.step.key ? `step ${run.step.key}` : `position ${run.currentPosition + 1}`,
      run.subjectKey ? `subject ${run.subjectKey}` : "",
      run.updatedAt ? relativeTime(run.updatedAt) : "",
      run.exitReason
    ].filter(Boolean).join(" · ");
    copy.append(title, detail);
    row.append(status, copy);
    elements.automationRunList.append(row);
  }
}

async function simulateAutomation(automation, button) {
  setButtonBusy(button, true, "Simulating…");
  try {
    const response = await api.simulateAutomation(automation.id, null);
    renderAutomationSimulation(response.simulation, automation.name);
    elements.automationOperationsCenter.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Simulation completed with zero provider calls and zero mutations.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, "Simulate");
  }
}

function renderAutomationSimulation(simulation, fallbackName) {
  elements.automationSimulation.replaceChildren();
  elements.automationSimulation.classList.remove("hidden");
  const cases = Array.isArray(simulation?.simulations) ? simulation.simulations : [];
  const valid = cases.length > 0 && cases.every((item) => item?.valid === true);
  const heading = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${simulation?.automation?.name || fallbackName} · ${valid ? "simulation passed" : "needs attention"}`;
  const proof = document.createElement("span");
  proof.textContent = `${Number(simulation?.provider_calls || 0)} provider calls · ${Number(simulation?.mutations_performed || 0)} mutations`;
  heading.append(title, proof);
  const detail = document.createElement("pre");
  detail.textContent = JSON.stringify(cases, null, 2);
  elements.automationSimulation.append(heading, detail);
}

async function repairAutomationIncident(failure, resolution, noteField, button) {
  const note = noteField.value.trim();
  if (!note) {
    noteField.focus();
    toast("Add the required verification or repair note first.", true);
    return;
  }
  const consequence = resolution.action === "retry"
    ? "The exact failed step will become eligible for the next runner pass."
    : resolution.action === "settle_applied"
      ? "AMOS will advance this step without contacting the provider again."
      : "AMOS will stop this failed run without replaying it.";
  if (!window.confirm(`${consequence}\n\nAutomation: ${failure.automationName}\nStep: ${failure.stepKey}\nYour note: ${note}`)) return;
  setButtonBusy(button, true, "Submitting…");
  try {
    const response = await api.repairAutomationFailure(failure.id, { ...resolution, note });
    state.automations = response.automations || state.automations;
    if (Array.isArray(response.approvals)) state.companyApprovals = response.approvals;
    renderAutomations();
    renderWork();
    const parked = Boolean(response.result?.pending_id || response.result?.status === "pending");
    toast(parked
      ? "Resolution is waiting in Work for final human approval."
      : response.result?.message || "Automation failure resolved without an implicit replay.");
  } catch (error) {
    toast(error.message, true);
    renderAutomations();
  }
}

function renderAutomationGrant(grant) {
  const row = document.createElement("article");
  row.className = `automation-grant ${grant.status}`;
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${humanizeTool(grant.operationKey)} · ${grant.status.replaceAll("_", " ")}`;
  const detail = document.createElement("small");
  detail.textContent = [
    `${new Intl.NumberFormat().format(grant.windowRuns)} / ${new Intl.NumberFormat().format(grant.maxRunsPerWindow)} this ${grant.window}`,
    `${new Intl.NumberFormat().format(grant.totalRuns)} / ${new Intl.NumberFormat().format(grant.maxTotalRuns)} lifetime`,
    `failure cutoff ${grant.consecutiveFailures} / ${grant.maxConsecutiveFailures}`,
    grant.expiresAt ? `expires ${new Date(grant.expiresAt).toLocaleDateString()}` : "",
    grant.statusReason
  ].filter(Boolean).join(" · ");
  copy.append(title, detail);
  row.append(copy);
  if (["active", "suspended"].includes(grant.status)) {
    const revoke = actionButton("Revoke", "secondary");
    revoke.addEventListener("click", () => revokeAutomationGrant(grant, revoke));
    row.append(revoke);
  }
  return row;
}

async function revokeAutomationGrant(grant, button) {
  if (!window.confirm(
    `Revoke continuous write authority for “${humanizeTool(grant.operationKey)}”?\n\nFuture exact writes will return to per-run approval. An external call already claimed at this instant may still settle and remain visible in receipts.`
  )) return;
  setButtonBusy(button, true, "Revoking…");
  try {
    const response = await api.revokeAutomationGrant(
      grant.id,
      "Revoked by an authorized user from AMOS Desktop"
    );
    state.automations = response.automations || state.automations;
    renderAutomations();
    toast("Continuous Automation authority revoked. Future writes require approval.");
  } catch (error) {
    toast(error.message, true);
    renderAutomations();
  }
}

function renderBrowserRecipeCard(recipe) {
  const card = document.createElement("article");
  card.className = "automation-card browser-recipe-card";

  const heading = document.createElement("div");
  heading.className = "automation-card-heading";
  const identity = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  const origins = Array.isArray(recipe.origins) ? recipe.origins : [];
  eyebrow.textContent = `LOCAL BROWSER RECIPE${origins[0] ? ` · ${origins[0]}` : ""}`;
  const title = document.createElement("h2");
  title.textContent = recipe.name;
  identity.append(eyebrow, title);
  const status = document.createElement("span");
  status.className = `automation-status ${recipe.status}`;
  status.textContent = String(recipe.status || "ready").replaceAll("_", " ").toUpperCase();
  heading.append(identity, status);

  const description = document.createElement("p");
  description.className = "automation-card-description";
  description.textContent = recipe.description ||
    "A deterministic semantic browser state machine. No model is needed while it runs.";

  const stats = document.createElement("div");
  stats.className = "automation-stats";
  for (const [label, value] of [
    ["Inputs", Array.isArray(recipe.inputs) ? recipe.inputs.length : 0],
    ["Steps", Array.isArray(recipe.steps) ? recipe.steps.length : 0],
    ["Completed", Number(recipe.runStats?.completed || 0)],
    ["Drift", Number(recipe.runStats?.drifted || 0)]
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
    "Encrypted on this computer",
    origins.slice(1).join(", "),
    recipe.updatedAt ? `Updated ${relativeTime(recipe.updatedAt)}` : "",
    recipe.runStats?.lastRunAt
      ? `Last run ${relativeTime(recipe.runStats.lastRunAt)} · ${recipe.runStats.lastStatus}`
      : "No completed run yet"
  ].filter(Boolean).join(" · ");

  const actions = document.createElement("div");
  actions.className = "automation-actions";
  const edit = actionButton("Work on this with AMOS", "secondary");
  edit.addEventListener("click", () => openAutomationTask(recipe, edit));
  const remove = actionButton("Remove", "secondary");
  remove.addEventListener("click", () => removeBrowserRecipe(recipe, remove));
  actions.append(edit, remove);

  card.append(heading, description, stats, meta, actions);
  elements.automationList.append(card);
}

async function refreshAutomations() {
  setButtonBusy(elements.refreshAutomationsButton, true, "Refreshing…");
  try {
    state = await api.refreshRemote();
    renderAutomations();
    renderStarterActions();
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
    renderStarterActions();
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

async function removeBrowserRecipe(recipe, button) {
  if (!window.confirm(`Remove the local browser recipe “${recipe.name}”?\n\nThis affects only this AMOS identity on this computer.`)) {
    return;
  }
  setButtonBusy(button, true, "Removing…");
  try {
    const response = await api.removeBrowserRecipe(recipe.id);
    state.browserRecipes = response.browserRecipes || state.browserRecipes;
    renderAutomations();
    toast(`Removed ${recipe.name}.`);
  } catch (error) {
    toast(error.message, true);
    renderAutomations();
  }
}

async function openAutomationTask(
  automation = null,
  sourceButton = elements.buildAutomationButton,
  guided = false
) {
  const sourceLabel = sourceButton.textContent;
  const title = automation ? `Improve ${automation.name}` : "Build an automation";
  const objective = automation
    ? automation.kind === "browser_recipe"
      ? `Open the local deterministic browser recipe named “${automation.name}” in a focused task. List and inspect its typed semantic contract and run history first. Help me test or repair target drift, inputs, checkpoints, exception handling, approvals, and measurement. Use a live browser session to record verified replacement steps when repair is necessary. Never replace semantic contracts with model-authored selectors, and do not run consequential steps without fresh exact approval.`
      : `Open the existing AMOS automation named “${automation.name}” in a focused task. Read its current governed definition and live stats first. Help me improve the business outcome, trigger, deterministic steps, exception handling, approvals, and measurement. Do not resume or activate consequential behavior without my explicit approval.`
    : "Help me design and build a governed AMOS automation in this focused task. Start by clarifying the business outcome, trigger, deterministic steps, required connections, exception handling, approval boundaries, and measurable success criteria. Do not activate it until I explicitly approve the final design.";
  setButtonBusy(sourceButton, true, "Opening task…");
  try {
    const response = await api.startNewConversation({
      kind: "automation_builder",
      title,
      objective,
      resource: automation
        ? { type: automation.kind === "browser_recipe" ? "browser_recipe" : "automation", id: automation.id, name: automation.name }
        : null
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
    if (guided && !automation) {
      elements.promptInput.value = "";
      try {
        await api.beginAutomationSetup({ intent: objective });
        toast("Opened guided Automation setup beside a separate conversation.");
      } catch (error) {
        toast(`Opened the Automation conversation. ${friendlyError(error)}`, true);
      }
    } else {
      toast("Opened a separate automation task. The prior context lane was preserved.");
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (sourceButton.isConnected) setButtonBusy(sourceButton, false, sourceLabel);
  }
}

function syncAutomationSetup(setup) {
  if (!setup) {
    automationSetupDraft = null;
    automationSetupOperations = null;
    if (state) renderCanvas();
    return;
  }
  if (automationSetupDraft?.setupId === setup.id) {
    automationSetupDraft.installation = setup.installation || automationSetupDraft.installation;
    automationSetupDraft.activation = setup.activation || automationSetupDraft.activation;
    if (setup.installation) automationSetupDraft.phaseIndex = 5;
  } else {
    const sourceConnection = setup.sourceConnection || preferredVisibleAutomationConnection(setup.sourceProvider);
    const destinationConnection = setup.destinationConnection || preferredVisibleAutomationConnection(
      setup.destinationProvider,
      sourceConnection
    );
    automationSetupDraft = {
      setupId: setup.id,
      intent: setup.intent || "",
      templateKey: setup.templateKey || "",
      name: "",
      sourceProvider: setup.sourceProvider || "",
      destinationProvider: setup.destinationProvider || "",
      sourceConnection,
      destinationConnection,
      connection: destinationConnection || "",
      operation: setup.operationKey || "",
      triggerEvents: setup.triggerEvent || "",
      showAllTemplates: false,
      showAllConnections: false,
      mappings: [],
      cadence: { kind: "weekly", weekday: 0, hour_utc: 6, minute_utc: 0 },
      webhook: setup.sourceProvider ? `${providerSlug(setup.sourceProvider)}-events` : "",
      collection: "",
      filter: "",
      backfill: false,
      approvalMode: "per_run",
      grantWindow: "day",
      grantMaxRunsPerWindow: 1_000,
      grantMaxTotalRuns: 100_000,
      grantMaxConsecutiveFailures: 5,
      grantExpiresOn: defaultAutomationGrantExpiry(),
      metricKeys: "",
      unitKey: "",
      sampleContext: JSON.stringify({ trigger: { payload: {} } }, null, 2),
      sampleResult: null,
      phaseIndex: Math.max(0, AUTOMATION_SETUP_PHASES.indexOf(setup.phase || "intent")),
      installation: setup.installation || null,
      activation: setup.activation || null
    };
    automationSetupOperations = null;
    currentPanelTab = "canvas";
  }
  canvasSidecarOpen = true;
  if (state) renderCanvas();
}

function renderAutomationSetup() {
  const draft = automationSetupDraft;
  if (!draft) return;
  const template = selectedAutomationTemplate();
  const phase = AUTOMATION_SETUP_PHASES[draft.phaseIndex] || "intent";
  elements.automationSetupTitle.textContent = template?.title || "Build an Automation.";
  elements.automationSetupSubtitle.textContent = draft.intent ||
    "AMOS will establish the outcome in conversation, then use this surface to review the exact systems, mappings, trigger, and governed activation.";
  elements.automationSetupPhases.replaceChildren();
  for (const [index, key] of AUTOMATION_SETUP_PHASES.entries()) {
    const item = document.createElement("li");
    item.className = index < draft.phaseIndex ? "done" : index === draft.phaseIndex ? "active" : "";
    item.textContent = key === "connections" ? "Connect" : key;
    elements.automationSetupPhases.append(item);
  }
  elements.automationSetupError.textContent = "";
  elements.automationSetupError.classList.add("hidden");
  elements.automationSetupBody.replaceChildren();
  if (phase === "intent") renderAutomationIntentStep();
  if (phase === "connections") renderAutomationConnectionStep(template);
  if (phase === "mapping") renderAutomationMappingStep(template);
  if (phase === "trigger") renderAutomationTriggerStep(template);
  if (phase === "preview") renderAutomationPreviewStep(template);
  if (phase === "activate") renderAutomationActivationStep(template);

  elements.automationSetupBack.classList.toggle("hidden", draft.phaseIndex === 0 || Boolean(draft.installation));
  elements.automationSetupBack.disabled = automationSetupBusy;
  elements.automationSetupNext.disabled = automationSetupBusy;
  elements.automationSetupNext.classList.toggle("hidden", false);
  elements.automationSetupNext.innerHTML = automationSetupNextLabel(phase);
}

function renderAutomationIntentStep() {
  const body = elements.automationSetupBody;
  body.append(automationStepCopy(
    "What should happen?",
    "Confirm the business outcome, then choose the closest Platform-owned starting point. Templates remove the blank page; they do not hide the final definition."
  ));
  const intent = setupField("Outcome", "textarea", automationSetupDraft.intent);
  intent.control.id = "automationSetupIntent";
  intent.control.rows = 3;
  intent.control.maxLength = 2_000;
  body.append(intent.label);

  const name = setupField(
    "Automation name",
    "text",
    automationSetupDraft.name
  );
  name.control.id = "automationSetupName";
  name.control.maxLength = 120;
  name.control.placeholder = "Choose a template to use its suggested name";
  body.append(name.label);

  const templates = automationTemplateSuggestions();
  const heading = automationStepCopy(
    automationSetupDraft.templateKey ? "Matched workflow" : "Suggested starting points",
    automationSetupDraft.templateKey
      ? "AMOS matched this from the source, destination, trigger, and outcome established in chat."
      : "AMOS filtered the Platform catalog to the few starting points most relevant to this outcome."
  );
  body.append(heading);
  const grid = document.createElement("div");
  grid.className = "automation-template-grid";
  for (const template of templates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `automation-template-card${template.key === automationSetupDraft.templateKey ? " selected" : ""}`;
    button.disabled = !template.installable;
    const meta = document.createElement("small");
    meta.textContent = template.installable
      ? `${template.triggerModes.join(" / ") || "guided"} · model-free runtime`
      : "Guided custom build";
    const name = document.createElement("strong");
    name.textContent = template.title;
    const copy = document.createElement("span");
    copy.textContent = template.installable ? template.description : template.whyGuided;
    button.append(meta, name, copy);
    button.addEventListener("click", () => {
      captureAutomationSetupFields("intent");
      automationSetupDraft.templateKey = template.key;
      automationSetupDraft.name = automationSetupDraft.name || template.title;
      automationSetupDraft.mappings = [];
      automationSetupOperations = null;
      renderAutomationSetup();
    });
    grid.append(button);
  }
  body.append(grid);
  const totalTemplates = state.automationTemplates?.templates?.length || 0;
  if (!automationSetupDraft.showAllTemplates && templates.length < totalTemplates) {
    const showAll = actionButton("Choose a different starting point", "secondary");
    showAll.addEventListener("click", () => {
      automationSetupDraft.showAllTemplates = true;
      renderAutomationSetup();
    });
    body.append(showAll);
  }
}

function renderAutomationConnectionStep(template) {
  const body = elements.automationSetupBody;
  const needsConnection = template?.requiredParameters?.includes("connection");
  const needsSource = template?.requiredParameters?.includes("source_connection");
  const needsDestination = template?.requiredParameters?.includes("destination_connection");
  body.append(automationStepCopy(
    needsSource && needsDestination ? "Confirm the source and destination." : "Confirm the system this workflow needs.",
    needsSource && needsDestination
      ? "AMOS matched each connected account to its role from the conversation. The source produces the event; only the destination performs the typed operation."
      : needsConnection
        ? "Confirm the connected account that will perform the typed operation. Add a missing app here without placing credentials in chat."
      : "This template runs against governed AMOS data and does not require an external application connection."
  ));
  if (!needsConnection && !needsSource && !needsDestination) {
    body.append(automationBoundary(
      "No external credential is needed. AMOS will still revalidate the current company identity and scopes on every run."
    ));
    return;
  }
  const connections = (state.connectionsCatalog?.connections || []).filter(
    (connection) => connection.status === "connected" && connection.usable === true
  );
  if (needsSource && needsDestination) {
    body.append(automationConnectionRole({
      title: "Source system",
      detail: "Produces the signed event and payload.",
      role: "source",
      providerHint: automationSetupDraft.sourceProvider,
      connections
    }));
    body.append(automationConnectionRole({
      title: "Destination system",
      detail: "Receives the governed typed operation.",
      role: "destination",
      providerHint: automationSetupDraft.destinationProvider,
      connections
    }));
  } else {
    body.append(automationConnectionRole({
      title: "Connected system",
      detail: "Performs the governed typed operation.",
      role: "connection",
      providerHint: automationSetupDraft.destinationProvider,
      connections
    }));
  }
  if (connections.length === 0) {
    body.append(automationBoundary("No usable app connection is visible to this identity yet."));
  }
  const available = state.connectionsCatalog?.providers || [];
  const connectedProviders = new Set(connections.map((item) => item.provider));
  const connectable = available.filter(
    (provider) => provider.availability === "available" && !connectedProviders.has(provider.provider)
  );
  if (connectable.length > 0) {
    const note = document.createElement("div");
    note.className = "automation-step-copy";
    const title = document.createElement("h3");
    title.textContent = "Connect another app";
    const copy = document.createElement("p");
    copy.textContent = "Secure setup opens from this flow. Credentials remain vaulted by AMOS Platform and are never returned to Desktop.";
    note.append(title, copy);
    body.append(note);
    const grid = document.createElement("div");
    grid.className = "automation-connect-grid";
    for (const provider of connectable) {
      const button = actionButton(`Connect ${provider.label}`, "secondary");
      button.addEventListener("click", () => connectProviderFromAutomation(provider, button));
      grid.append(button);
    }
    body.append(grid);
  }
}

function automationConnectionRole({ title, detail, role, providerHint, connections }) {
  const wrapper = document.createElement("section");
  wrapper.className = "automation-connection-role";
  wrapper.append(automationStepCopy(title, detail));
  const selectedKey = role === "source"
    ? "sourceConnection"
    : role === "destination" ? "destinationConnection" : "connection";
  const selected = automationSetupDraft[selectedKey];
  const relevant = automationSetupDraft.showAllConnections || !providerHint
    ? connections
    : connections.filter((connection) => automationConnectionMatches(connection, providerHint));
  const visible = relevant.length > 0 ? relevant : connections;
  const list = document.createElement("div");
  list.className = "automation-connection-list";
  for (const connection of visible) {
    const value = connection.id || connection.provider;
    list.append(automationChoice({
      name: `automation${role}Connection`,
      value,
      checked: selected === value,
      title: connection.displayName,
      detail: `${humanizeProvider(connection.provider)} · ${connection.ownership.replaceAll("_", " ")}`,
      badge: "Connected",
      onChange: () => {
        automationSetupDraft[selectedKey] = value;
        if (role !== "source") {
          automationSetupDraft.connection = value;
          automationSetupDraft.destinationConnection = value;
          automationSetupDraft.operation = "";
          automationSetupDraft.mappings = [];
          automationSetupOperations = null;
        }
      }
    }));
  }
  wrapper.append(list);
  if (!automationSetupDraft.showAllConnections && visible.length < connections.length) {
    const showAll = actionButton("Show other connected accounts", "secondary");
    showAll.addEventListener("click", () => {
      automationSetupDraft.showAllConnections = true;
      renderAutomationSetup();
    });
    wrapper.append(showAll);
  }
  return wrapper;
}

function renderAutomationMappingStep(template) {
  const body = elements.automationSetupBody;
  const needsOperation = template?.requiredParameters?.includes("operation");
  body.append(automationStepCopy(
    needsOperation ? "Choose the operation and map its fields." : "Configure the deterministic inputs.",
    needsOperation
      ? "AMOS shows only active, human-reviewed operation contracts. Every destination field stays visible and inspectable."
      : "These values become data in the durable definition; the model is not required when it runs."
  ));
  if (needsOperation) {
    if (!automationSetupOperations) {
      body.append(automationBoundary("Loading active operation contracts from AMOS Platform…"));
      return;
    }
    const list = document.createElement("div");
    list.className = "automation-operation-list";
    for (const contract of automationSetupOperations.contracts || []) {
      list.append(automationChoice({
        name: "automationOperation",
        value: contract.operationKey,
        checked: automationSetupDraft.operation === contract.operationKey,
        title: contract.displayName,
        detail: `${contract.method} ${contract.pathTemplate}`,
        badge: contract.consequence,
        onChange: () => {
          chooseAutomationOperation(contract, template);
          renderAutomationSetup();
        }
      }));
    }
    if ((automationSetupOperations.contracts || []).length === 0) {
      list.append(automationBoundary(
        "The destination has no active typed operation contract for this outcome. AMOS needs to derive the smallest safe contract, ask only the accounting or business questions that materially change it, and obtain human activation before mapping can continue."
      ));
      const continueInChat = actionButton("Resolve this in conversation", "primary");
      continueInChat.addEventListener("click", continueAutomationSetupInConversation);
      list.append(continueInChat);
    }
    body.append(list);
    if (automationSetupDraft.operation) renderAutomationMappingRows(body);
  }
  if (template?.requiredParameters?.includes("metric_keys")) {
    const field = setupField("Initiative metric keys (comma separated)", "input", automationSetupDraft.metricKeys);
    field.control.id = "automationMetricKeys";
    field.control.placeholder = "revenue_growth, customer_satisfaction, labor_efficiency";
    body.append(field.label);
  }
  if (template?.optionalParameters?.includes("unit_key")) {
    const field = setupField("Operating unit key (optional)", "input", automationSetupDraft.unitKey);
    field.control.id = "automationUnitKey";
    field.control.placeholder = "All units when left blank";
    body.append(field.label);
  }
}

function renderAutomationMappingRows(body) {
  const list = document.createElement("div");
  list.className = "automation-mapping-list";
  for (const [index, row] of automationSetupDraft.mappings.entries()) {
    const wrapper = document.createElement("div");
    wrapper.className = "automation-mapping-row";
    const destination = document.createElement("div");
    destination.className = "automation-mapping-destination";
    const label = document.createElement("strong");
    label.textContent = `${row.label}${row.required ? " *" : ""}`;
    const path = document.createElement("code");
    path.textContent = `${row.destination} · ${row.type}`;
    destination.append(label, path);
    const mode = document.createElement("select");
    mode.dataset.mappingMode = String(index);
    for (const [value, copy] of [["reference", "Source field"], ["constant", "Constant"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = copy;
      option.selected = row.mode === value;
      mode.append(option);
    }
    mode.addEventListener("change", () => {
      automationSetupDraft.mappings[index].mode = mode.value;
      renderAutomationSetup();
    });
    const value = document.createElement("input");
    value.dataset.mappingValue = String(index);
    value.value = row.value;
    value.placeholder = row.mode === "reference"
      ? "trigger.payload.customer.id"
      : "JSON value or plain text";
    value.addEventListener("input", () => {
      automationSetupDraft.mappings[index].value = value.value;
    });
    wrapper.append(destination, mode, value);
    list.append(wrapper);
  }
  if (automationSetupDraft.mappings.length === 0) {
    list.append(automationBoundary("This operation does not advertise any path, query, or body fields."));
  }
  body.append(list);
}

function renderAutomationTriggerStep(template) {
  const body = elements.automationSetupBody;
  const mode = template?.triggerModes?.[0] || "schedule";
  body.append(automationStepCopy(
    "When should it run?",
    mode === "schedule"
      ? "Choose the durable UTC schedule. A delayed poll runs the latest due occurrence without replaying an unbounded backlog."
      : mode === "webhook"
        ? "Name the signed inbound event that should create one deterministic run."
        : "Choose the AMOS collection and whether existing records should be included."
  ));
  if (mode === "schedule") {
    const kind = setupField("Cadence", "select", automationSetupDraft.cadence.kind, [
      ["interval", "Every few hours"], ["daily", "Daily"], ["weekly", "Weekly"]
    ]);
    kind.control.id = "automationCadenceKind";
    kind.control.addEventListener("change", () => {
      automationSetupDraft.cadence.kind = kind.control.value;
      renderAutomationSetup();
    });
    body.append(kind.label);
    if (automationSetupDraft.cadence.kind === "interval") {
      const interval = setupField("Repeat every", "select", automationSetupDraft.cadence.every_minutes || 60, [
        [60, "1 hour"], [240, "4 hours"], [480, "8 hours"], [720, "12 hours"], [1440, "24 hours"], [10080, "7 days"]
      ]);
      interval.control.id = "automationIntervalMinutes";
      body.append(interval.label);
    } else {
      if (automationSetupDraft.cadence.kind === "weekly") {
        const weekday = setupField("Weekday", "select", automationSetupDraft.cadence.weekday ?? 0, [
          [0, "Monday"], [1, "Tuesday"], [2, "Wednesday"], [3, "Thursday"], [4, "Friday"], [5, "Saturday"], [6, "Sunday"]
        ]);
        weekday.control.id = "automationWeekday";
        body.append(weekday.label);
      }
      const time = setupField(
        "Time (UTC)",
        "time",
        `${String(automationSetupDraft.cadence.hour_utc ?? 6).padStart(2, "0")}:${String(automationSetupDraft.cadence.minute_utc ?? 0).padStart(2, "0")}`
      );
      time.control.id = "automationScheduleTime";
      body.append(time.label);
    }
  } else if (mode === "webhook") {
    const crossSystem = isCrossSystemAutomationTemplate(template);
    if (crossSystem) {
      const events = setupField("Source event types", "input", automationSetupDraft.triggerEvents);
      events.control.id = "automationTriggerEvents";
      events.control.placeholder = "invoice.finalized, invoice.paid";
      body.append(events.label);
    }
    const field = setupField("Signed webhook channel", "input", automationSetupDraft.webhook);
    field.control.id = "automationWebhook";
    field.control.placeholder = "stripe-events";
    body.append(field.label);
    body.append(automationBoundary(
      crossSystem
        ? "The source connection and event allowlist become visible trigger metadata. The webhook channel still uses the tenant-signed endpoint; provider-side webhook provisioning remains a separate governed setup action."
        : "This selects an existing signed tenant-webhook event. Provider-side webhook provisioning is not performed by this draft installer."
    ));
  } else {
    const collection = setupField("AMOS collection", "input", automationSetupDraft.collection);
    collection.control.id = "automationCollection";
    collection.control.placeholder = "invoices";
    const filter = setupField("Equality filter (optional JSON)", "textarea", automationSetupDraft.filter);
    filter.control.id = "automationFilter";
    filter.control.rows = 3;
    filter.control.placeholder = '{"status":"paid"}';
    const backfill = document.createElement("label");
    backfill.className = "automation-choice";
    const checkbox = document.createElement("input");
    checkbox.id = "automationBackfill";
    checkbox.type = "checkbox";
    checkbox.checked = automationSetupDraft.backfill;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = "Include existing matching records";
    const detail = document.createElement("small");
    detail.textContent = "Otherwise, only records created or changed after activation are eligible.";
    copy.append(title, detail);
    backfill.append(checkbox, copy);
    body.append(collection.label, filter.label, backfill);
  }
  renderAutomationAuthorityStep(body, template);
}

function renderAutomationAuthorityStep(body, template) {
  const contract = selectedAutomationOperation();
  if (!contract || contract.consequence !== "write") return;
  const supported = template?.optionalParameters?.includes("standing_grant") &&
    state?.automationTemplates?.standingGrantContract?.supported === true;
  const heading = automationStepCopy(
    "How should repeat writes be approved?",
    supported
      ? "Per-run approval remains the default. Bounded continuous authority permits only this exact trigger, mapping, connection, and immutable operation contract within the limits below."
      : "This Platform contract currently requires a governed company decision for every connected write."
  );
  body.append(heading);
  if (!supported) {
    automationSetupDraft.approvalMode = "per_run";
    body.append(automationBoundary(
      state?.automationTemplates?.standingGrantContract?.fallback ||
      "Each connected write will park for an authorized human before it reaches the provider."
    ));
    return;
  }
  const choices = document.createElement("div");
  choices.className = "automation-connection-list";
  choices.append(
    automationChoice({
      name: "automationApprovalMode",
      value: "per_run",
      checked: automationSetupDraft.approvalMode !== "standing_grant",
      title: "Approve every write",
      detail: "Best for low-volume or unusually consequential operations.",
      badge: "Default",
      onChange: () => {
        automationSetupDraft.approvalMode = "per_run";
        renderAutomationSetup();
      }
    }),
    automationChoice({
      name: "automationApprovalMode",
      value: "standing_grant",
      checked: automationSetupDraft.approvalMode === "standing_grant",
      title: "Approve bounded continuous operation",
      detail: "One human approval, then exact deterministic writes run until a bound is reached or authority is revoked.",
      badge: "Exact + revocable",
      onChange: () => {
        automationSetupDraft.approvalMode = "standing_grant";
        renderAutomationSetup();
      }
    })
  );
  body.append(choices);
  if (automationSetupDraft.approvalMode !== "standing_grant") return;

  const grid = document.createElement("div");
  grid.className = "automation-grant-grid";
  const window = setupField("Rate window", "select", automationSetupDraft.grantWindow, [
    ["hour", "Per hour"], ["day", "Per day"]
  ]);
  window.control.id = "automationGrantWindow";
  const maxWindow = setupField("Maximum writes per window", "number", automationSetupDraft.grantMaxRunsPerWindow);
  maxWindow.control.id = "automationGrantMaxWindow";
  maxWindow.control.min = "1";
  maxWindow.control.max = "1000000";
  const maxTotal = setupField("Lifetime write ceiling", "number", automationSetupDraft.grantMaxTotalRuns);
  maxTotal.control.id = "automationGrantMaxTotal";
  maxTotal.control.min = "1";
  maxTotal.control.max = "1000000000";
  const failures = setupField("Pause after consecutive failures", "number", automationSetupDraft.grantMaxConsecutiveFailures);
  failures.control.id = "automationGrantMaxFailures";
  failures.control.min = "1";
  failures.control.max = "100";
  const expiry = setupField("Authority expires after this UTC date", "date", automationSetupDraft.grantExpiresOn);
  expiry.control.id = "automationGrantExpiresOn";
  expiry.control.min = automationGrantDateFromNow(1);
  expiry.control.max = automationGrantDateFromNow(365);
  grid.append(window.label, maxWindow.label, maxTotal.label, failures.label, expiry.label);
  body.append(grid, automationBoundary(
    "Pause stops claims immediately. Revocation blocks every future claim. Editing the trigger, filters, mappings, connection, operation contract, or Automation definition requires a new human approval."
  ));
}

function renderAutomationPreviewStep(template) {
  const body = elements.automationSetupBody;
  body.append(automationStepCopy(
    "Review the compiled definition.",
    "Nothing below has been activated. Installing creates an inert draft and a proof receipt."
  ));
  let preview;
  try {
    preview = automationSetupPreview(template);
  } catch (error) {
    body.append(automationBoundary(error.message));
    return;
  }
  body.append(reviewCard("Outcome", automationSetupDraft.intent));
  body.append(reviewCard("Template and name", `${template.title}\n${automationSetupDraft.name}`));
  body.append(reviewCard("Trigger", JSON.stringify(preview.trigger, null, 2), true));
  body.append(reviewCard("Deterministic parameters and mappings", JSON.stringify(preview.parameters, null, 2), true));
  if (containsAutomationReference(preview.parameters.arguments)) {
    const sample = setupField("Representative trigger context (JSON)", "textarea", automationSetupDraft.sampleContext);
    sample.control.id = "automationSampleContext";
    sample.control.rows = 6;
    body.append(sample.label);
    const previewButton = actionButton("Preview mapped payload", "secondary");
    previewButton.addEventListener("click", previewMappedAutomationPayload);
    body.append(previewButton);
    if (automationSetupDraft.sampleResult) {
      body.append(reviewCard("Mapped operation payload", JSON.stringify(automationSetupDraft.sampleResult, null, 2), true));
    }
  }
  body.append(automationBoundary(
    automationSetupDraft.approvalMode === "standing_grant" && preview.parameters.standing_grant
      ? "Definition preview performs no external call. Activation requests one exact bounded standing grant; every write still revalidates identity, RBAC, company policy, subscription, definition, contract, and atomic limits without requiring a model."
      : "Definition preview performs no external call. Runs remain deterministic without a model. Connected writes pause for the governed company decision on each run."
  ));
}

function renderAutomationActivationStep(template) {
  const body = elements.automationSetupBody;
  const installation = automationSetupDraft.installation;
  const activation = automationSetupDraft.activation;
  if (!installation) {
    body.append(automationBoundary("The Automation draft has not been installed yet."));
    return;
  }
  body.append(automationStepCopy(
    activation ? "Activation submitted." : "Draft installed. Activate when ready.",
    activation
      ? activation.message
      : "AMOS installed the exact reviewed definition as an inert draft. Activation re-enters current identity, RBAC, policy, approval, and proof."
  ));
  body.append(reviewCard("Draft", [
    installation.automation.name,
    `${template?.title || installation.automation.templateKey} · v${installation.automation.templateVersion || 1}`,
    `Status: ${installation.automation.status}`,
    installation.receiptId ? `Receipt: ${installation.receiptId}` : ""
  ].filter(Boolean).join("\n")));
  body.append(reviewCard(
    "Installed trigger",
    JSON.stringify(installation.activation.preview.trigger, null, 2),
    true
  ));
  body.append(reviewCard(
    "Installed deterministic steps",
    JSON.stringify(installation.activation.preview.steps, null, 2),
    true
  ));
  body.append(automationBoundary(
    activation?.pendingApproval
      ? "The activation request is parked for an authorized human. Desktop cannot self-approve it; review the exact pending company decision."
      : activation
        ? "AMOS accepted the activation request. The Automation page is the durable management surface."
        : installation.activation.note
  ));
}

async function automationSetupNext() {
  if (!automationSetupDraft || automationSetupBusy) return;
  const phase = AUTOMATION_SETUP_PHASES[automationSetupDraft.phaseIndex];
  captureAutomationSetupFields(phase);
  setAutomationSetupBusy(true);
  try {
    const template = selectedAutomationTemplate();
    if (phase === "intent") {
      if (!automationSetupDraft.intent) throw new Error("Describe the business outcome first");
      if (!template) throw new Error("Choose an Automation template");
      automationSetupDraft.name ||= template.title;
      automationSetupDraft.phaseIndex = 1;
    } else if (phase === "connections") {
      if (isCrossSystemAutomationTemplate(template)) {
        if (!automationSetupDraft.sourceConnection) throw new Error("Choose or connect the source system");
        if (!automationSetupDraft.destinationConnection) throw new Error("Choose or connect the destination system");
        if (automationSetupDraft.sourceConnection === automationSetupDraft.destinationConnection) {
          throw new Error("Choose different connected systems for the source and destination");
        }
        automationSetupOperations = await api.automationOperations(automationSetupDraft.destinationConnection);
      } else if (template.requiredParameters.includes("connection")) {
        if (!automationSetupDraft.connection) throw new Error("Choose or connect the system this Automation will operate");
        automationSetupOperations = await api.automationOperations(automationSetupDraft.connection);
      }
      const requestedOperation = (automationSetupOperations?.contracts || []).find(
        (contract) => contract.operationKey === automationSetupDraft.operation
      );
      if (requestedOperation) chooseAutomationOperation(requestedOperation, template);
      automationSetupDraft.phaseIndex = 2;
    } else if (phase === "mapping") {
      validateAutomationMappingStep(template);
      automationSetupDraft.phaseIndex = 3;
    } else if (phase === "trigger") {
      automationSetupPreview(template);
      automationSetupDraft.phaseIndex = 4;
    } else if (phase === "preview") {
      const preview = automationSetupPreview(template);
      const response = await api.installAutomationSetup({
        setupId: automationSetupDraft.setupId,
        templateKey: template.key,
        name: automationSetupDraft.name,
        parameters: preview.parameters
      });
      automationSetupDraft.installation = response.installation;
      automationSetupDraft.phaseIndex = 5;
      if (state) state.automations = response.automations || state.automations;
      toast(`${response.installation.automation.name} was installed as a draft.`);
    } else if (phase === "activate") {
      if (!automationSetupDraft.activation) {
        const response = await api.activateAutomationSetup(automationSetupDraft.setupId);
        automationSetupDraft.activation = response.activation;
        if (state) {
          state.automations = response.automations || state.automations;
          state.approvals = response.approvals || state.approvals;
        }
        toast(response.activation.message);
      } else if (automationSetupDraft.activation.pendingApproval) {
        showView("work");
        showWorkTab("open");
      } else {
        showView("automations");
      }
    }
    renderCanvas();
  } catch (error) {
    showAutomationSetupError(friendlyError(error));
  } finally {
    setAutomationSetupBusy(false);
  }
}

function automationSetupBack() {
  if (!automationSetupDraft || automationSetupBusy || automationSetupDraft.installation) return;
  captureAutomationSetupFields(AUTOMATION_SETUP_PHASES[automationSetupDraft.phaseIndex]);
  automationSetupDraft.phaseIndex = Math.max(0, automationSetupDraft.phaseIndex - 1);
  renderCanvas();
}

async function closeAutomationSetup() {
  const setupId = automationSetupDraft?.setupId;
  automationSetupDraft = null;
  automationSetupOperations = null;
  if (state) state.automationSetup = null;
  if (!activeCanvasId) currentPanelTab = "activity";
  renderCanvas();
  if (setupId) await api.dismissAutomationSetup(setupId).catch(() => {});
  elements.promptInput.focus();
}

function captureAutomationSetupFields(phase) {
  if (!automationSetupDraft) return;
  if (phase === "intent") {
    const intent = document.getElementById("automationSetupIntent");
    const name = document.getElementById("automationSetupName");
    if (intent) automationSetupDraft.intent = intent.value.trim();
    if (name) automationSetupDraft.name = name.value.trim();
  }
  if (phase === "mapping") {
    const metrics = document.getElementById("automationMetricKeys");
    const unit = document.getElementById("automationUnitKey");
    if (metrics) automationSetupDraft.metricKeys = metrics.value;
    if (unit) automationSetupDraft.unitKey = unit.value.trim();
    for (const [index, row] of automationSetupDraft.mappings.entries()) {
      row.mode = document.querySelector(`[data-mapping-mode="${index}"]`)?.value || row.mode;
      row.value = document.querySelector(`[data-mapping-value="${index}"]`)?.value || row.value;
    }
  }
  if (phase === "trigger") {
    const kind = document.getElementById("automationCadenceKind")?.value;
    if (kind) {
      automationSetupDraft.cadence.kind = kind;
      if (kind === "interval") {
        automationSetupDraft.cadence.every_minutes = Number(
          document.getElementById("automationIntervalMinutes")?.value || 60
        );
      } else {
        const [hour, minute] = String(document.getElementById("automationScheduleTime")?.value || "06:00")
          .split(":").map(Number);
        automationSetupDraft.cadence.hour_utc = hour;
        automationSetupDraft.cadence.minute_utc = minute;
        if (kind === "weekly") {
          automationSetupDraft.cadence.weekday = Number(document.getElementById("automationWeekday")?.value || 0);
        }
      }
    }
    const webhook = document.getElementById("automationWebhook");
    const triggerEvents = document.getElementById("automationTriggerEvents");
    const collection = document.getElementById("automationCollection");
    const filter = document.getElementById("automationFilter");
    if (webhook) automationSetupDraft.webhook = webhook.value.trim();
    if (triggerEvents) automationSetupDraft.triggerEvents = triggerEvents.value.trim();
    if (collection) automationSetupDraft.collection = collection.value.trim();
    if (filter) automationSetupDraft.filter = filter.value.trim();
    automationSetupDraft.backfill = document.getElementById("automationBackfill")?.checked || false;
    const approval = document.querySelector('input[name="automationApprovalMode"]:checked');
    if (approval) automationSetupDraft.approvalMode = approval.value;
    const grantWindow = document.getElementById("automationGrantWindow");
    if (grantWindow) automationSetupDraft.grantWindow = grantWindow.value;
    const grantMaxWindow = document.getElementById("automationGrantMaxWindow");
    if (grantMaxWindow) automationSetupDraft.grantMaxRunsPerWindow = Number(grantMaxWindow.value);
    const grantMaxTotal = document.getElementById("automationGrantMaxTotal");
    if (grantMaxTotal) automationSetupDraft.grantMaxTotalRuns = Number(grantMaxTotal.value);
    const grantFailures = document.getElementById("automationGrantMaxFailures");
    if (grantFailures) automationSetupDraft.grantMaxConsecutiveFailures = Number(grantFailures.value);
    const grantExpiry = document.getElementById("automationGrantExpiresOn");
    if (grantExpiry) automationSetupDraft.grantExpiresOn = grantExpiry.value;
  }
  if (phase === "preview") {
    const sample = document.getElementById("automationSampleContext");
    if (sample) automationSetupDraft.sampleContext = sample.value;
  }
}

function validateAutomationMappingStep(template) {
  if (template.requiredParameters.includes("operation")) {
    if (!automationSetupDraft.operation) throw new Error("Choose an active operation contract");
    for (const row of automationSetupDraft.mappings) {
      if (row.required && !String(row.value || "").trim()) {
        throw new Error(`Map the required destination field '${row.destination}'`);
      }
    }
    compileAutomationMappings(
      automationSetupDraft.mappings.filter((row) => String(row.value || "").trim())
    );
  }
  if (template.requiredParameters.includes("metric_keys") && !automationSetupDraft.metricKeys.trim()) {
    throw new Error("Choose at least one initiative metric key");
  }
}

function automationSetupPreview(template) {
  if (!template) throw new Error("Choose an Automation template");
  validateAutomationMappingStep(template);
  const parameters = {};
  if (template.requiredParameters.includes("connection")) parameters.connection = automationSetupDraft.connection;
  if (template.requiredParameters.includes("source_connection")) {
    parameters.source_connection = automationSetupDraft.sourceConnection;
  }
  if (template.requiredParameters.includes("destination_connection")) {
    parameters.destination_connection = automationSetupDraft.destinationConnection;
  }
  if (template.requiredParameters.includes("operation")) {
    parameters.operation = automationSetupDraft.operation;
    const populated = automationSetupDraft.mappings.filter((row) => String(row.value || "").trim());
    parameters.arguments = compileAutomationMappings(populated);
    const operation = selectedAutomationOperation();
    if (
      operation?.consequence === "write" &&
      template.optionalParameters.includes("standing_grant") &&
      automationSetupDraft.approvalMode === "standing_grant"
    ) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(automationSetupDraft.grantExpiresOn)) {
        throw new Error("Choose a valid UTC expiry date for bounded authority");
      }
      parameters.standing_grant = {
        window: automationSetupDraft.grantWindow,
        max_runs_per_window: automationSetupDraft.grantMaxRunsPerWindow,
        max_total_runs: automationSetupDraft.grantMaxTotalRuns,
        max_consecutive_failures: automationSetupDraft.grantMaxConsecutiveFailures,
        expires_at: new Date(`${automationSetupDraft.grantExpiresOn}T23:59:59.000Z`).toISOString()
      };
    }
  }
  if (template.requiredParameters.includes("metric_keys")) {
    parameters.metric_keys = automationSetupDraft.metricKeys.split(",").map((value) => value.trim()).filter(Boolean);
  }
  if (template.optionalParameters.includes("unit_key") && automationSetupDraft.unitKey) {
    parameters.unit_key = automationSetupDraft.unitKey;
  }
  const mode = template.triggerModes[0] || "schedule";
  let trigger;
  if (mode === "schedule") {
    parameters.cadence = structuredClone(automationSetupDraft.cadence);
    trigger = { kind: "schedule", cadence: parameters.cadence };
  } else if (mode === "webhook") {
    if (!automationSetupDraft.webhook) throw new Error("Name the signed webhook event");
    parameters.webhook = automationSetupDraft.webhook;
    if (template.optionalParameters.includes("event_types")) {
      parameters.event_types = automationSetupDraft.triggerEvents
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (parameters.event_types.length === 0) throw new Error("Name at least one source event type");
    }
    trigger = {
      kind: "webhook",
      webhook: parameters.webhook,
      ...(parameters.source_connection
        ? { source: { connection: parameters.source_connection } }
        : {}),
      ...(parameters.event_types ? { event_types: parameters.event_types } : {})
    };
  } else {
    if (!automationSetupDraft.collection) throw new Error("Name the AMOS collection to watch");
    parameters.collection = automationSetupDraft.collection;
    parameters.backfill = automationSetupDraft.backfill;
    if (automationSetupDraft.filter) {
      try {
        parameters.filter = JSON.parse(automationSetupDraft.filter);
      } catch {
        throw new Error("Record filter must be valid JSON");
      }
    }
    trigger = {
      kind: "record_change",
      collection: parameters.collection,
      backfill: parameters.backfill,
      ...(parameters.filter ? { filter: parameters.filter } : {})
    };
  }
  return { trigger, parameters };
}

function selectedAutomationOperation() {
  return (automationSetupOperations?.contracts || []).find(
    (contract) => contract.operationKey === automationSetupDraft?.operation
  ) || null;
}

function defaultAutomationGrantExpiry() {
  return automationGrantDateFromNow(90);
}

function automationGrantDateFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previewMappedAutomationPayload() {
  try {
    captureAutomationSetupFields("preview");
    const context = JSON.parse(automationSetupDraft.sampleContext);
    const preview = automationSetupPreview(selectedAutomationTemplate());
    automationSetupDraft.sampleResult = previewAutomationMappings(
      preview.parameters.arguments || {},
      context
    );
    renderAutomationSetup();
  } catch (error) {
    showAutomationSetupError(friendlyError(error));
  }
}

async function connectProviderFromAutomation(provider, button) {
  setButtonBusy(button, true, "Opening…");
  try {
    if (provider.setupMode === "hosted_oauth") {
      await api.connectProvider(provider.provider);
      toast(`Opened secure setup for ${provider.label}`);
    } else if (provider.credentialForm) {
      openConnectionModal(provider);
    } else {
      throw new Error("This provider does not advertise a supported secure setup flow");
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) setButtonBusy(button, false, `Connect ${provider.label}`);
  }
}

function continueAutomationSetupInConversation() {
  const destination = automationConnectionLabel(automationSetupDraft.destinationConnection || automationSetupDraft.connection);
  elements.promptInput.value = [
    `The ${destination || "destination"} connection has no active typed operation contract for this Automation.`,
    `Please derive the smallest safe contract needed to accomplish: ${automationSetupDraft.intent}`,
    "Ask me only questions that materially change the accounting or business behavior, obtain human activation for the exact contract, and then reopen this mapping review."
  ].join(" ");
  openPanel("activity");
  elements.promptInput.focus();
  toast("The exact contract boundary is ready to resolve in chat.");
}

function chooseAutomationOperation(contract, template) {
  automationSetupDraft.operation = contract.operationKey;
  if (contract.consequence !== "write") automationSetupDraft.approvalMode = "per_run";
  automationSetupDraft.mappings = mappingRowsForOperation(contract).map((row) => ({
    ...row,
    mode: template.triggerModes.includes("schedule") ? "constant" : "reference",
    value: ""
  }));
}

function isCrossSystemAutomationTemplate(template) {
  return template?.requiredParameters?.includes("source_connection") &&
    template.requiredParameters.includes("destination_connection");
}

function automationTemplateSuggestions() {
  const templates = state?.automationTemplates?.templates || [];
  if (automationSetupDraft.showAllTemplates) return templates;
  const selected = templates.find((template) => template.key === automationSetupDraft.templateKey);
  if (selected) return [selected];
  const intent = [
    automationSetupDraft.intent,
    automationSetupDraft.sourceProvider,
    automationSetupDraft.destinationProvider
  ].join(" ").toLowerCase();
  const connectedIntent = /sync|integrat|webhook|stripe|quickbooks|qbo|invoice|email|calendar|crm|connected/.test(intent);
  const words = new Set(intent.split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  return templates
    .map((template) => {
      const searchable = `${template.key} ${template.title} ${template.description}`.toLowerCase();
      let score = connectedIntent && template.blueprintKey === "connected_operations" ? 10 : 0;
      if (/source|destination|into|from/.test(intent) && template.key === "cross_system_event_sync") score += 20;
      for (const word of words) if (searchable.includes(word)) score += 1;
      return { template, score };
    })
    .sort((left, right) => right.score - left.score || left.template.title.localeCompare(right.template.title))
    .slice(0, 3)
    .map(({ template }) => template);
}

function preferredVisibleAutomationConnection(providerHint, excluded = "") {
  const matches = (state?.connectionsCatalog?.connections || [])
    .filter((connection) => connection.status === "connected" && connection.usable === true)
    .filter((connection) => (connection.id || connection.provider) !== excluded)
    .filter((connection) => automationConnectionMatches(connection, providerHint))
    .sort((left, right) => {
      const preferred = (connection) => /connection[_ -]?call[_ -]?ready|platform account/i.test(
        String(connection.displayName || "")
      ) ? 1 : 0;
      return preferred(right) - preferred(left) ||
        String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
    });
  return matches[0]?.id || matches[0]?.provider || "";
}

function automationConnectionMatches(connection, providerHint) {
  const hint = String(providerHint || "").trim().toLowerCase();
  if (!hint) return true;
  const provider = String(connection?.provider || "").toLowerCase();
  const name = String(connection?.displayName || "").toLowerCase();
  return provider === hint || provider.includes(hint) || hint.includes(provider) || name.includes(hint);
}

function automationConnectionLabel(connectionId) {
  const connection = (state?.connectionsCatalog?.connections || []).find(
    (item) => (item.id || item.provider) === connectionId
  );
  return connection?.displayName || humanizeProvider(automationSetupDraft.destinationProvider || "");
}

function providerSlug(value) {
  return String(value || "provider")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider";
}

function selectedAutomationTemplate() {
  return (state?.automationTemplates?.templates || []).find(
    (template) => template.key === automationSetupDraft?.templateKey
  ) || null;
}

function automationSetupNextLabel(phase) {
  if (automationSetupBusy) return "Working…";
  if (phase === "preview") return "Install draft <span>→</span>";
  if (phase === "activate") {
    if (!automationSetupDraft.installation) return "Return to preview";
    if (!automationSetupDraft.activation) return "Request activation <span>→</span>";
    return automationSetupDraft.activation.pendingApproval
      ? "Review decision <span>→</span>"
      : "View in Automations <span>→</span>";
  }
  return "Continue <span>→</span>";
}

function setAutomationSetupBusy(busy) {
  automationSetupBusy = busy;
  elements.automationSetupBack.disabled = busy;
  elements.automationSetupNext.disabled = busy;
  if (automationSetupDraft) {
    const phase = AUTOMATION_SETUP_PHASES[automationSetupDraft.phaseIndex] || "intent";
    elements.automationSetupNext.innerHTML = automationSetupNextLabel(phase);
  }
}

function showAutomationSetupError(message) {
  elements.automationSetupError.textContent = message;
  elements.automationSetupError.classList.remove("hidden");
}

function automationStepCopy(titleText, copyText) {
  const wrapper = document.createElement("div");
  wrapper.className = "automation-step-copy";
  const title = document.createElement("h3");
  title.textContent = titleText;
  const copy = document.createElement("p");
  copy.textContent = copyText;
  wrapper.append(title, copy);
  return wrapper;
}

function setupField(labelText, type, value, options = []) {
  const label = document.createElement("label");
  label.className = type === "textarea" ? "automation-intent-field" : "automation-setup-field";
  const title = document.createElement("span");
  title.textContent = labelText;
  let control;
  if (type === "textarea") control = document.createElement("textarea");
  else if (type === "select") {
    control = document.createElement("select");
    for (const [optionValue, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = String(optionValue);
      option.textContent = optionLabel;
      option.selected = String(optionValue) === String(value);
      control.append(option);
    }
  } else {
    control = document.createElement("input");
    control.type = type;
  }
  if (type !== "select") control.value = String(value ?? "");
  label.append(title, control);
  return { label, control };
}

function automationChoice({ name, value, checked, title, detail, badge, onChange }) {
  const label = document.createElement("label");
  label.className = "automation-choice";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener("change", onChange);
  const copy = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = detail;
  copy.append(strong, small);
  const status = document.createElement("em");
  status.textContent = badge;
  label.append(input, copy, status);
  return label;
}

function automationBoundary(text) {
  const note = document.createElement("div");
  note.className = "automation-boundary-note";
  note.textContent = text;
  return note;
}

function reviewCard(titleText, content, code = false) {
  const card = document.createElement("div");
  card.className = "automation-review-card";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const value = document.createElement(code ? "pre" : "div");
  value.textContent = content;
  card.append(title, value);
  return card;
}

function containsAutomationReference(value) {
  if (Array.isArray(value)) return value.some(containsAutomationReference);
  if (!value || typeof value !== "object") return false;
  if (typeof value.$ref === "string") return true;
  return Object.values(value).some(containsAutomationReference);
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
    .map((step) => step.stage || step.subject || step.verb || humanizeTool(step.action))
    .filter(Boolean)
    .join(" → ");
}

function conversationProject(task) {
  if (!task?.projectId) return null;
  return (state?.projects?.projects || []).find((item) => item.id === task.projectId) || null;
}

function conversationProjectName(task) {
  return conversationProject(task)?.name || "";
}

function conversationStatusBucket(task) {
  const archived = Boolean(task.archivedAt || task.archived);
  if (archived) return "archived";
  const activeRun = (state?.activeRuns || []).find((run) =>
    run.taskRecordId === task.id || (task.remoteId && run.remoteTaskId === task.remoteId)
  );
  if (task.running || activeRun || ["running", "scheduled"].includes(task.status)) return "running";
  if (["failed", "interrupted", "blocked", "cancel_requested"].includes(task.status)) return "failed";
  if (["completed", "cancelled"].includes(task.status)) return "completed";
  return "active";
}

function paginateItems(items, key, pageSize = LIST_PAGE_SIZE) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const current = Math.min(Math.max(1, Number(listPages[key]) || 1), pageCount);
  listPages[key] = current;
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    total,
    start: total === 0 ? 0 : start + 1,
    end: Math.min(start + pageSize, total)
  };
}

function renderListPager(host, page, onPage) {
  if (!host) return;
  host.replaceChildren();
  if (!page || page.total <= LIST_PAGE_SIZE) {
    host.classList.add("hidden");
    return;
  }
  host.classList.remove("hidden");
  const summary = document.createElement("span");
  summary.textContent = `${page.start}–${page.end} of ${page.total}`;
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "button ghost";
  previous.textContent = "Previous";
  previous.disabled = page.page <= 1;
  previous.addEventListener("click", () => onPage(page.page - 1));
  const next = document.createElement("button");
  next.type = "button";
  next.className = "button ghost";
  next.textContent = "Next";
  next.disabled = page.page >= page.pageCount;
  next.addEventListener("click", () => onPage(page.page + 1));
  host.append(summary, previous, next);
}

function resetListPageIfQueryChanged(key, query) {
  if (listQueryKeys[key] !== query) {
    listQueryKeys[key] = query;
    listPages[key] = 1;
  }
}

function renderProjects() {
  if (!state) return;
  const library = state.projects || { supported: false, projects: [], inbox: [] };
  const projects = Array.isArray(library.projects) ? library.projects : [];
  const inbox = Array.isArray(library.inbox) ? library.inbox : [];
  const conversations = Array.isArray(state.tasks?.tasks)
    ? state.tasks.tasks.filter((task) => task.projectId && !task.archivedAt && !task.archived)
    : [];
  const query = elements.projectSearchInput.value.trim().toLowerCase();
  resetListPageIfQueryChanged("projects", query);
  const matchingProjects = projects.filter((project) => {
    if (!query) return true;
    if (`${project.name}\n${project.instructions}`.toLowerCase().includes(query)) return true;
    return conversations.some((task) =>
      task.projectId === project.id &&
      `${task.title}\n${task.objective}`.toLowerCase().includes(query)
    );
  });
  const page = paginateItems(matchingProjects, "projects");
  const visibleProjects = page.items;
  if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
    selectedProjectId = "";
  }
  const attentionStatuses = new Set(["waiting", "blocked", "cancel_requested", "failed"]);
  const activeStatuses = new Set(["scheduled", "running", "waiting", "blocked", "cancel_requested"]);
  const activeRuns = inbox.filter((run) => activeStatuses.has(run.status));
  const attentionRuns = inbox.filter((run) => run.stalled || attentionStatuses.has(run.status));
  const waitingDecisions = projectDecisionItems().length;

  elements.projectUnavailable.classList.toggle("hidden", library.supported === true);
  elements.newProjectButton.disabled = library.supported !== true || state.connectionMode !== "user";
  elements.refreshProjectsButton.disabled = state.connectionMode !== "user";
  const badgeCount = attentionRuns.length || waitingDecisions || activeRuns.length;
  elements.projectBadge.textContent = String(badgeCount);
  elements.projectBadge.classList.toggle(
    "hidden",
    attentionRuns.length + waitingDecisions + activeRuns.length === 0
  );
  elements.projectEmpty.classList.toggle("hidden", page.total > 0);

  elements.projectList.replaceChildren();
  for (const project of visibleProjects) {
    elements.projectList.append(projectCard(
      project,
      conversations.filter((task) => task.projectId === project.id),
      inbox.filter((run) => run.projectId === project.id)
    ));
  }
  renderListPager(elements.projectPager, page, (next) => {
    listPages.projects = next;
    renderProjects();
  });
}

function projectDecisionItems(project = null) {
  const conversations = Array.isArray(state?.tasks?.tasks) ? state.tasks.tasks : [];
  const inbox = Array.isArray(state?.projects?.inbox) ? state.projects.inbox : [];
  const relatedProjectId = (taskId = "", contextKey = "") => {
    const task = conversations.find((item) =>
      item.id === taskId ||
      item.remoteId === taskId ||
      (contextKey && item.contextKey === contextKey)
    );
    if (task?.projectId) return task.projectId;
    const run = inbox.find((item) => item.taskId === taskId || item.id === taskId);
    return run?.projectId || "";
  };
  const belongsHere = (taskId = "", contextKey = "", explicitProjectId = "") => {
    const projectId = explicitProjectId || relatedProjectId(taskId, contextKey);
    if (!projectId) return false;
    return !project || projectId === project.id;
  };
  const inputs = (Array.isArray(state?.pendingInputs) ? state.pendingInputs : [])
    .filter((request) => belongsHere(request.taskRecordId || request.runId, request.contextKey))
    .map((request) => ({
      kind: "input",
      id: request.id,
      title: request.title || "AMOS needs your input",
      summary: request.message || ""
    }));
  const approvals = (Array.isArray(state?.approvals) ? state.approvals : [])
    .filter((approval) => approval.status === "pending")
    .filter((approval) => {
      const args = approval.args && typeof approval.args === "object" ? approval.args : {};
      return belongsHere(
        args.task_id || args.taskId || "",
        approval.contextKey || "",
        args.project_id || args.projectId || ""
      );
    })
    .map((approval) => ({
      kind: "approval",
      id: approval.id,
      title: humanizeTool(approval.verb),
      summary: decisionSummary(approval, true)
    }));
  return [...inputs, ...approvals];
}

function projectAccordionKey(projectId, section) {
  return `${projectId}:${section}`;
}

function projectAccordionOpen(projectId, section, fallback = false) {
  const key = projectAccordionKey(projectId, section);
  return expandedProjectAccordions.has(key) ||
    (!expandedProjectAccordions.has(`${key}:closed`) && fallback);
}

function bindProjectAccordion(details, projectId, section) {
  const key = projectAccordionKey(projectId, section);
  details.addEventListener("toggle", () => {
    if (details.open) {
      expandedProjectAccordions.add(key);
      expandedProjectAccordions.delete(`${key}:closed`);
    } else {
      expandedProjectAccordions.delete(key);
      expandedProjectAccordions.add(`${key}:closed`);
    }
  });
}

function projectCard(project, conversations, runs) {
  const card = document.createElement("article");
  const selected = project.id === selectedProjectId;
  card.className = `project-card${selected ? " selected" : ""}${project.archived ? " archived" : ""}`;
  const heading = document.createElement("div");
  heading.className = "project-card-heading";
  const copy = document.createElement("div");
  const kicker = document.createElement("div");
  kicker.className = "task-card-kicker";
  const status = document.createElement("span");
  status.className = `task-status ${project.status}`;
  status.textContent = project.archived ? "ARCHIVED" : project.status.toUpperCase();
  kicker.append(status);
  if (project.pinned) {
    const pinned = document.createElement("span");
    pinned.className = "task-lineage-chip";
    pinned.textContent = "PINNED";
    kicker.append(pinned);
  }
  const attentionCount = runs.filter((run) =>
    run.stalled || ["waiting", "blocked", "cancel_requested", "failed"].includes(run.status)
  ).length;
  const decisionItems = projectDecisionItems(project);
  if (attentionCount > 0) {
    const attention = document.createElement("span");
    attention.className = "task-lineage-chip fork";
    attention.textContent = `${attentionCount} NEED${attentionCount === 1 ? "S" : ""} ATTENTION`;
    kicker.append(attention);
  }
  if (decisionItems.length > 0) {
    const waiting = document.createElement("span");
    waiting.className = "task-lineage-chip fork";
    waiting.textContent = `${decisionItems.length} DECISION${decisionItems.length === 1 ? "" : "S"}`;
    kicker.append(waiting);
  }
  const title = document.createElement("h2");
  title.textContent = project.name;
  copy.append(kicker, title);
  const updated = document.createElement("time");
  updated.textContent = project.updatedAt ? relativeTime(project.updatedAt) : "Project";
  heading.append(copy, updated);

  const instructions = document.createElement("p");
  instructions.className = "project-card-instructions";
  instructions.textContent = project.instructions || "No shared Project instructions yet.";
  const details = document.createElement("div");
  details.className = "task-card-details";
  const used = runs.reduce((total, run) => total + Number(run.usage?.costUsedMicrousd || 0), 0);
  const cap = project.defaultBudget?.costLimitMicrousd;
  for (const value of [
    `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`,
    `${formatUsdMicros(used)} used · ${formatUsdMicros(cap)} cap`
  ]) {
    const chip = document.createElement("span");
    chip.textContent = value;
    details.append(chip);
  }

  const actions = document.createElement("div");
  actions.className = "task-card-actions project-card-actions";
  const talk = actionButton("Talk", "primary");
  talk.disabled = project.archived || project.status !== "active";
  talk.addEventListener("click", () => createTaskInProject(project, talk));
  const giveGoal = actionButton("Leave a goal", "secondary");
  giveGoal.disabled = project.archived || project.status !== "active";
  giveGoal.addEventListener("click", () => openGoalModal(project));
  actions.append(talk, giveGoal, projectSettingsMenu(project));

  card.append(heading, instructions, details, actions);
  if (conversations.length > 0) {
    card.append(projectAccordion(
      project.id,
      "conversations",
      `Conversations · ${conversations.length}`,
      projectConversationList(project.id, conversations),
      true
    ));
  }
  if (runs.length > 0) {
    card.append(projectAccordion(
      project.id,
      "activity",
      `Activity · ${runs.length}`,
      projectActivityList(project.id, runs),
      false
    ));
  }
  if (decisionItems.length > 0) {
    card.append(projectAccordion(
      project.id,
      "decisions",
      `Decisions · ${decisionItems.length}`,
      projectDecisionList(decisionItems),
      true
    ));
  }
  return card;
}

function projectSettingsMenu(project) {
  const wrap = document.createElement("details");
  wrap.className = "project-settings";
  const summary = document.createElement("summary");
  summary.textContent = "More";
  const menu = document.createElement("div");
  menu.className = "project-settings-menu";
  const edit = actionButton("Edit", "ghost");
  edit.disabled = project.archived;
  edit.addEventListener("click", () => openProjectModal(project));
  const pin = actionButton(project.pinned ? "Unpin" : "Pin", "ghost");
  pin.addEventListener("click", () => updateProject(project, { pinned: !project.pinned }, pin));
  const pause = actionButton(project.status === "paused" ? "Resume" : "Pause", "ghost");
  pause.disabled = project.archived || project.status === "completed";
  pause.addEventListener("click", () => updateProject(
    project,
    { status: project.status === "paused" ? "active" : "paused" },
    pause
  ));
  const archive = actionButton(project.archived ? "Restore" : "Archive", "ghost");
  archive.addEventListener("click", () => updateProject(project, { archived: !project.archived }, archive));
  menu.append(edit, pin, pause, archive);
  wrap.append(summary, menu);
  return wrap;
}

function projectAccordion(projectId, section, label, body, fallbackOpen = false) {
  const details = document.createElement("details");
  details.className = "project-accordion";
  details.open = projectAccordionOpen(projectId, section, fallbackOpen);
  bindProjectAccordion(details, projectId, section);
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary, body);
  return details;
}

function projectConversationList(projectId, conversations) {
  const section = document.createElement("section");
  section.className = "project-conversations";
  if (conversations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "project-conversations-empty";
    empty.textContent = "No conversations in this workspace yet.";
    section.append(empty);
    return section;
  }
  const pageKey = `project-conversations:${projectId}`;
  if (!Object.hasOwn(listPages, pageKey)) listPages[pageKey] = 1;
  const page = paginateItems(conversations, pageKey);
  const list = document.createElement("div");
  list.className = "project-conversation-list";
  for (const task of page.items) {
    const row = document.createElement("article");
    row.className = "project-conversation-row";
    const copy = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "project-conversation-meta";
    const status = document.createElement("span");
    status.className = `task-status ${task.status || "active"}`;
    status.textContent = String(task.status || "active").replaceAll("_", " ").toUpperCase();
    const updated = document.createElement("time");
    updated.textContent = task.updatedAt ? relativeTime(task.updatedAt) : "Conversation";
    meta.append(status, updated);
    const title = document.createElement("strong");
    title.textContent = task.title;
    copy.append(meta, title);
    if (task.kind === "goal_pursuit") {
      const goal = document.createElement("span");
      goal.className = "task-lineage-chip";
      goal.textContent = "GOAL";
      meta.append(goal);
    }
    const rowActions = document.createElement("div");
    rowActions.className = "project-conversation-actions";
    const open = actionButton(task.active ? "Open" : "Continue", "ghost");
    open.addEventListener("click", () => openManagedTask(task, open));
    const browse = actionButton("In Conversations", "ghost");
    browse.addEventListener("click", () => {
      elements.taskSearchInput.value = "";
      elements.taskProjectFilterInput.value = projectId;
      taskStatusFilter = "all";
      listPages.tasks = 1;
      renderTasks();
      showView("tasks");
    });
    rowActions.append(open, browse);
    row.append(copy, rowActions);
    list.append(row);
  }
  const pager = document.createElement("div");
  pager.className = "list-pager compact";
  renderListPager(pager, page, (next) => {
    listPages[pageKey] = next;
    renderProjects();
  });
  section.append(list, pager);
  return section;
}

function projectActivityOutcome(run) {
  if (run.stalled || ["failed", "blocked", "cancel_requested"].includes(run.status)) {
    return "failed";
  }
  if (["completed", "cancelled", "interrupted"].includes(run.status)) {
    return "succeeded";
  }
  return "active";
}

function projectActivityList(projectId, runs) {
  const section = document.createElement("section");
  section.className = "project-activity";
  if (runs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "project-conversations-empty";
    empty.textContent = "No background work yet. Leave a goal when you want AMOS to keep going.";
    section.append(empty);
    return section;
  }
  const selected = projectActivityFilters.get(projectId) || "all";
  const failedCount = runs.filter((run) => projectActivityOutcome(run) === "failed").length;
  const succeededCount = runs.filter((run) => projectActivityOutcome(run) === "succeeded").length;
  const filters = document.createElement("div");
  filters.className = "project-activity-filters";
  filters.setAttribute("role", "tablist");
  filters.setAttribute("aria-label", "Filter Project activity");
  const list = document.createElement("div");
  list.className = "project-activity-list";
  const pager = document.createElement("div");
  pager.className = "list-pager compact";
  const empty = document.createElement("p");
  empty.className = "project-conversations-empty";
  const renderFiltered = (next) => {
    projectActivityFilters.set(projectId, next);
    for (const button of filters.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.filter === next);
    }
    const visible = runs.filter((run) => next === "all" || projectActivityOutcome(run) === next);
    const pageKey = `project-activity:${projectId}:${next}`;
    if (!Object.hasOwn(listPages, pageKey)) listPages[pageKey] = 1;
    const page = paginateItems(visible, pageKey);
    list.replaceChildren();
    for (const run of page.items) list.append(activityRunCard(run));
    empty.textContent = next === "failed"
      ? "No failed work in this Project."
      : next === "succeeded"
        ? "No succeeded work in this Project."
        : "No background work yet. Leave a goal when you want AMOS to keep going.";
    empty.classList.toggle("hidden", page.total > 0);
    renderListPager(pager, page, (pageNumber) => {
      listPages[pageKey] = pageNumber;
      renderFiltered(next);
    });
  };
  for (const option of [
    { id: "all", label: `All · ${runs.length}` },
    { id: "failed", label: `Failed · ${failedCount}` },
    { id: "succeeded", label: `Succeeded · ${succeededCount}` }
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-activity-filter";
    button.dataset.filter = option.id;
    button.textContent = option.label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      renderFiltered(option.id);
    });
    filters.append(button);
  }
  section.append(filters, list, pager, empty);
  renderFiltered(selected);
  return section;
}

function projectDecisionList(items) {
  const section = document.createElement("section");
  section.className = "project-decisions";
  const list = document.createElement("div");
  list.className = "project-decision-list";
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "project-conversation-row";
    const copy = document.createElement("div");
    const meta = document.createElement("div");
    meta.className = "project-conversation-meta";
    const status = document.createElement("span");
    status.className = "task-status waiting";
    status.textContent = item.kind === "input" ? "NEEDS INPUT" : "NEEDS APPROVAL";
    meta.append(status);
    const title = document.createElement("strong");
    title.textContent = item.title;
    copy.append(meta, title);
    if (item.summary) {
      const summary = document.createElement("p");
      summary.className = "project-conversations-empty";
      summary.textContent = item.summary;
      copy.append(summary);
    }
    const open = actionButton("Answer", "ghost");
    open.addEventListener("click", () => {
      showView("decisions");
      if (item.kind === "approval") focusDecisionCard(item.id);
    });
    const actions = document.createElement("div");
    actions.className = "project-conversation-actions";
    actions.append(open);
    row.append(copy, actions);
    list.append(row);
  }
  section.append(list);
  return section;
}

function activityRunCard(run) {
  const card = document.createElement("article");
  card.className = `activity-run-card ${run.status}${run.stalled ? " stalled" : ""}`;
  const heading = document.createElement("div");
  heading.className = "activity-run-heading";
  const copy = document.createElement("div");
  const status = document.createElement("span");
  status.className = `task-status ${run.stalled ? "stalled" : run.status}`;
  status.textContent = run.stalled ? "STALLED" : run.status.replaceAll("_", " ").toUpperCase();
  const title = document.createElement("h3");
  title.textContent = run.taskTitle || `Work ${shortTaskId(run.taskId)}`;
  copy.append(status, title);
  const when = document.createElement("time");
  when.textContent = relativeTime(run.updatedAt || run.heartbeatAt || run.createdAt);
  heading.append(copy, when);
  const progress = document.createElement("p");
  progress.textContent = run.progressSummary || run.resultSummary || run.stopReason ||
    "Waiting for the first progress report.";
  const usage = document.createElement("div");
  usage.className = "task-card-details activity-run-usage";
  const used = formatUsdMicros(run.usage?.costUsedMicrousd);
  const cap = formatUsdMicros(run.budget?.costLimitMicrousd);
  const chip = document.createElement("span");
  chip.textContent = `${used} / ${cap}`;
  usage.append(chip);
  const actions = document.createElement("div");
  actions.className = "task-card-actions";
  const task = (state.tasks?.tasks || []).find((item) =>
    item.id === run.taskId || item.remoteId === run.taskId
  );
  if (task) {
    const open = actionButton("Open", "secondary");
    open.addEventListener("click", () => openManagedTask(task, open));
    actions.append(open);
  }
  if (!["completed", "failed", "cancelled", "interrupted", "cancel_requested"].includes(run.status)) {
    const stop = actionButton("Stop", "ghost");
    stop.addEventListener("click", () => cancelSupervisedRun(run, stop));
    actions.append(stop);
  }
  card.append(heading, progress, usage, actions);
  return card;
}

async function refreshProjects() {
  setButtonBusy(elements.refreshProjectsButton, true, "Refreshing…");
  try {
    state.projects = await api.refreshProjects();
    renderProjects();
    renderTasks();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.refreshProjectsButton, false, "Refresh");
  }
}

function openProjectModal(project = null) {
  const budget = project?.defaultBudget || {};
  elements.projectIdInput.value = project?.id || "";
  elements.projectModalTitle.textContent = project ? "Edit Project" : "Create a Project";
  elements.projectNameInput.value = project?.name || "";
  elements.projectInstructionsInput.value = project?.instructions || "";
  elements.projectCostInput.value = String((budget.costLimitMicrousd || 50_000_000) / 1_000_000);
  elements.projectModalError.textContent = "";
  elements.projectModalError.classList.add("hidden");
  elements.projectModal.classList.remove("hidden");
  elements.projectNameInput.focus();
}

function closeProjectModal() {
  elements.projectModal.classList.add("hidden");
  elements.projectForm.reset();
  elements.projectIdInput.value = "";
  elements.projectModalError.textContent = "";
  elements.projectModalError.classList.add("hidden");
}

async function submitProject(event) {
  event.preventDefault();
  const projectId = elements.projectIdInput.value;
  const input = {
    name: elements.projectNameInput.value.trim(),
    instructions: elements.projectInstructionsInput.value.trim(),
    costLimitMicrousd: Math.round(Number(elements.projectCostInput.value) * 1_000_000)
  };
  setButtonBusy(elements.projectSubmitButton, true, "Saving…");
  try {
    const response = projectId
      ? await api.updateProject(projectId, input)
      : await api.createProject(input);
    state.projects = response.projects;
    selectedProjectId = response.project.id;
    closeProjectModal();
    renderProjects();
    toast(projectId ? "Project updated." : "Project created.");
  } catch (error) {
    elements.projectModalError.textContent = error.message;
    elements.projectModalError.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.projectSubmitButton, false, "Save Project →");
  }
}

async function updateProject(project, changes, button) {
  const label = button.textContent;
  setButtonBusy(button, true, "Saving…");
  try {
    const response = await api.updateProject(project.id, changes);
    state.projects = response.projects;
    if (changes.archived === true && selectedProjectId === project.id) selectedProjectId = "";
    renderProjects();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) setButtonBusy(button, false, label);
  }
}

function openGoalModal(project) {
  elements.goalProjectIdInput.value = project.id;
  elements.goalProjectName.textContent = `Project: ${project.name}`;
  elements.goalObjectiveInput.value = "";
  elements.goalCheckpointInput.value = String(state?.settings?.autonomousCheckpointMinutes ?? 0);
  elements.goalModalError.textContent = "";
  elements.goalModalError.classList.add("hidden");
  elements.goalModal.classList.remove("hidden");
  elements.goalObjectiveInput.focus();
}

function closeGoalModal() {
  elements.goalModal.classList.add("hidden");
  elements.goalForm.reset();
  elements.goalProjectIdInput.value = "";
  elements.goalModalError.textContent = "";
  elements.goalModalError.classList.add("hidden");
}

async function submitAutonomousGoal(event) {
  event.preventDefault();
  const projectId = elements.goalProjectIdInput.value;
  const objective = elements.goalObjectiveInput.value.trim();
  const researchCheckpointMinutes = Number(elements.goalCheckpointInput.value);
  setButtonBusy(elements.goalSubmitButton, true, "Starting…");
  try {
    const response = await api.startAutonomousGoal({
      projectId,
      objective,
      researchCheckpointMinutes
    });
    state.projects = response.projects || state.projects;
    state.tasks = response.tasks || state.tasks;
    selectedProjectId = projectId;
    closeGoalModal();
    renderProjects();
    renderTasks();
    showView("projects");
    toast("AMOS is pursuing that goal. Progress lives on the Project card; questions land in Decisions.");
  } catch (error) {
    elements.goalModalError.textContent = error.message;
    elements.goalModalError.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.goalSubmitButton, false, "Start and leave →");
  }
}

async function createTaskInProject(project, button) {
  setButtonBusy(button, true, "Opening…");
  try {
    const response = await api.startNewConversation({
      kind: "general",
      projectId: project.id,
      title: `Talk in ${project.name}`,
      objective: `Start a conversation in the ${project.name} Project.`
    });
    adoptOpenedTask(response);
    elements.promptInput.value = "";
    elements.promptInput.focus();
    toast(`Opened Talk in ${project.name}. This conversation stays with that Project.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) setButtonBusy(button, false, "Talk");
  }
}

async function cancelSupervisedRun(run, button) {
  if (!window.confirm(`Request a cooperative stop for “${run.taskTitle || "this task"}”?`)) return;
  setButtonBusy(button, true, "Stopping…");
  try {
    const response = await api.cancelSupervisedRun(run.id, "Stopped by the AMOS Desktop operator");
    state.projects = response.projects;
    renderProjects();
    toast("Stop requested. The worker must acknowledge it at the next heartbeat.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) setButtonBusy(button, false, "Stop");
  }
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}m`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(number);
}

function formatUsdMicros(value) {
  const amount = Number(value || 0) / 1_000_000;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount < 1 ? 2 : 0
  }).format(amount);
}

function renderTaskProjectFilterOptions(tasks) {
  const selected = elements.taskProjectFilterInput.value || "all";
  const known = new Map();
  for (const project of state.projects?.projects || []) {
    known.set(project.id, project.name);
  }
  for (const task of tasks) {
    if (task.projectId && !known.has(task.projectId)) {
      known.set(task.projectId, conversationProjectName(task) || "Project");
    }
  }
  elements.taskProjectFilterInput.replaceChildren();
  const options = [
    ["all", "All conversations"],
    ["in_project", "In a Project"],
    ["none", "No Project"],
    ...[...known.entries()].map(([id, name]) => [id, name])
  ];
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    elements.taskProjectFilterInput.append(option);
  }
  elements.taskProjectFilterInput.value = options.some(([value]) => value === selected) ? selected : "all";
}

function renderTaskStatusFilters(tasks) {
  const counts = {
    all: tasks.length,
    running: tasks.filter((task) => conversationStatusBucket(task) === "running").length,
    failed: tasks.filter((task) => conversationStatusBucket(task) === "failed").length,
    completed: tasks.filter((task) => conversationStatusBucket(task) === "completed").length,
    archived: tasks.filter((task) => conversationStatusBucket(task) === "archived").length
  };
  if (!Object.hasOwn(counts, taskStatusFilter)) taskStatusFilter = "all";
  elements.taskStatusFilters.replaceChildren();
  for (const option of [
    { id: "all", label: `All · ${counts.all}` },
    { id: "running", label: `Running · ${counts.running}` },
    { id: "failed", label: `Failed · ${counts.failed}` },
    { id: "completed", label: `Completed · ${counts.completed}` },
    { id: "archived", label: `Archived · ${counts.archived}` }
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-activity-filter";
    button.dataset.filter = option.id;
    button.classList.toggle("active", taskStatusFilter === option.id);
    button.textContent = option.label;
    button.addEventListener("click", () => {
      taskStatusFilter = option.id;
      listPages.tasks = 1;
      renderTasks();
    });
    elements.taskStatusFilters.append(button);
  }
}

function renderTasks() {
  if (!state) return;
  const library = state.tasks || { supported: false, tasks: [] };
  const tasks = Array.isArray(library.tasks) ? library.tasks : [];
  const checkpoints = Array.isArray(state.taskCheckpoints) ? state.taskCheckpoints : [];
  const query = elements.taskSearchInput.value.trim().toLowerCase();
  resetListPageIfQueryChanged("tasks", `${query}|${elements.taskProjectFilterInput.value}|${taskStatusFilter}`);
  renderTaskProjectFilterOptions(tasks);
  const projectFilter = elements.taskProjectFilterInput.value || "all";
  const matching = tasks.filter((task) => {
    const projectName = conversationProjectName(task);
    const haystack = `${task.title}\n${task.objective}\n${projectName}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (projectFilter === "none") return !task.projectId;
    if (projectFilter === "in_project") return Boolean(task.projectId);
    if (projectFilter !== "all") return task.projectId === projectFilter;
    return true;
  });
  renderTaskStatusFilters(matching);
  const visible = matching.filter((task) => (
    taskStatusFilter === "all" || conversationStatusBucket(task) === taskStatusFilter
  ));
  const page = paginateItems(visible, "tasks");
  const current = tasks.filter((task) => !task.archivedAt && !task.archived);
  const waiting = current.filter((task) => task.status === "waiting").length;
  const inProject = current.filter((task) => task.projectId).length;
  const running = current.filter((task) => conversationStatusBucket(task) === "running").length;
  const visibleCheckpoints = taskStatusFilter === "all" || taskStatusFilter === "failed"
    ? checkpoints.filter((checkpoint) => (
        !query || `${checkpoint.title}\n${checkpoint.objective}`.toLowerCase().includes(query)
      ))
    : [];

  elements.taskBadge.textContent = String(waiting + checkpoints.length || running);
  elements.taskBadge.classList.toggle("hidden", waiting + running + checkpoints.length === 0);
  elements.taskPlatformNotice.classList.toggle("hidden", library.platformSupported !== false);
  elements.taskEmpty.classList.toggle("hidden", page.total + visibleCheckpoints.length > 0);
  elements.conversationRecovery.classList.toggle("hidden", visibleCheckpoints.length === 0);
  elements.conversationRecoveryList.replaceChildren();
  for (const checkpoint of visibleCheckpoints) {
    elements.conversationRecoveryList.append(taskCheckpointCard(checkpoint));
  }
  elements.taskSummary.replaceChildren();
  for (const [label, value, detail] of [
    ["Open", current.length, "durable conversations you can continue"],
    ["In a Project", inProject, "threads that belong to a named workspace"],
    ["Running", running + checkpoints.length, "live work or conversations waiting for attention"]
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
  for (const task of page.items) elements.taskList.append(taskCard(task));
  renderListPager(elements.taskPager, page, (next) => {
    listPages.tasks = next;
    renderTasks();
  });
}

function taskCard(task) {
  const activeRun = (state.activeRuns || []).find((run) =>
    run.taskRecordId === task.id || (task.remoteId && run.remoteTaskId === task.remoteId)
  );
  const taskRunning = task.running || Boolean(activeRun);
  const taskRunPhase = activeRun?.phase || task.runPhase || "";
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
  const project = conversationProject(task);
  if (project || task.projectId) {
    const projectChip = document.createElement("span");
    projectChip.className = "task-lineage-chip project";
    projectChip.textContent = `PROJECT · ${(project?.name || "Assigned").toUpperCase()}`;
    meta.append(projectChip);
    card.classList.add("in-project");
  } else {
    const standalone = document.createElement("span");
    standalone.className = "task-lineage-chip";
    standalone.textContent = "NO PROJECT";
    meta.append(standalone);
  }
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
  if (taskRunning) {
    const worker = document.createElement("span");
    worker.className = "task-lineage-chip current";
    worker.textContent = taskRunPhase
      ? `RUNNING · ${String(taskRunPhase).replaceAll("_", " ").toUpperCase()}`
      : "RUNNING";
    meta.append(worker);
  }
  const title = document.createElement("h2");
  title.textContent = task.title;
  copy.append(meta, title);
  const updated = document.createElement("time");
  updated.textContent = task.updatedAt ? relativeTime(task.updatedAt) : "Local conversation";
  heading.append(copy, updated);

  const objective = document.createElement("p");
  objective.className = "task-card-objective";
  objective.textContent = task.objective;

  const details = document.createElement("div");
  details.className = "task-card-details";
  for (const value of [
    project
      ? `Project · ${project.name}`
      : task.projectId ? "Assigned to a Project" : "Standalone conversation",
    task.kind === "goal_pursuit"
      ? "Autonomous goal"
      : task.kind === "automation_builder" ? "Automation build" : humanizeTool(task.kind || "general"),
    taskWorkspaceLabel(task),
    task.parentTaskId ? `From ${shortTaskId(task.parentTaskId)}` : "Root conversation",
    task.remote ? "Platform + local" : "Encrypted local"
  ]) {
    const chip = document.createElement("span");
    chip.textContent = value;
    details.append(chip);
  }

  const actions = document.createElement("div");
  actions.className = "task-card-actions";
  const archived = Boolean(task.archivedAt || task.archived);
  const open = actionButton(task.active || taskRunning ? "Open in Operator" : "Continue", "primary");
  open.disabled = archived;
  open.addEventListener("click", () => openManagedTask(task, open));
  const fork = actionButton("Fork", "secondary");
  const forkCapability = task.forkCapability || { canFork: false, reason: "no_persisted_milestone" };
  fork.disabled = archived || !forkCapability.canFork;
  fork.title = conversationForkCapabilityMessage(forkCapability);
  fork.addEventListener("click", () => openTaskForkModal(task, forkCapability.latestMilestoneId));
  const pin = actionButton(task.pinned ? "Unpin" : "Pin", "ghost");
  pin.addEventListener("click", () => updateManagedTask(task, { pinned: !task.pinned }, pin));
  const rename = actionButton("Rename", "ghost");
  rename.addEventListener("click", async () => {
    const next = window.prompt("Conversation name", task.title);
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
  const assignment = document.createElement("label");
  assignment.className = "task-project-assignment";
  const assignmentLabel = document.createElement("span");
  assignmentLabel.textContent = "Project";
  const projectSelect = document.createElement("select");
  projectSelect.disabled = archived || state.projects?.supported !== true;
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No Project";
  projectSelect.append(none);
  for (const project of state.projects?.projects || []) {
    if (project.archived) continue;
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.append(option);
  }
  projectSelect.value = task.projectId || "";
  projectSelect.addEventListener("change", () => assignTaskProject(task, projectSelect));
  assignment.append(assignmentLabel, projectSelect);
  actions.append(open, fork, assignment, pin, rename, wait, archive);
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
    toast("Started a new conversation. Continue or manage its branches under Conversations.");
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
  const capability = state?.conversationCapabilities || task?.forkCapability || {
    canFork: false,
    reason: "no_conversation"
  };
  if (!task || !capability.canFork) {
    toast(conversationForkCapabilityMessage(capability), true);
    return;
  }
  openTaskForkModal(task, capability.latestMilestoneId);
}

async function openManagedTask(task, button) {
  setButtonBusy(button, true, "Opening…");
  try {
    const response = await api.openTask(task.id);
    adoptOpenedTask(response);
    toast("Conversation opened. AMOS will revalidate current sources and authority before acting.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button.isConnected) setButtonBusy(button, false, task.active ? "Open in Operator" : "Continue");
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

async function assignTaskProject(task, select) {
  const previous = task.projectId || "";
  select.disabled = true;
  try {
    const response = await api.assignTaskProject(
      task.remoteId || task.id,
      select.value || null
    );
    state.tasks = response.tasks || state.tasks;
    state.projects = response.projects || state.projects;
    renderProjects();
    renderTasks();
    const project = (state.projects?.projects || []).find((item) => item.id === select.value);
    toast(project ? `Task assigned to ${project.name}.` : "Task removed from its Project.");
  } catch (error) {
    select.value = previous;
    select.disabled = false;
    toast(error.message, true);
  }
}

function adoptOpenedTask(response) {
  resetSessionView();
  state = response.state;
  currentTaskId = state.activeTask?.id || null;
  running = Boolean(state.activeTask);
  streamingMessage = null;
  continuityConversationRestored = false;
  activeCanvasId = state.activeCanvasId || null;
  canvasSidecarOpen = Boolean(activeCanvasId);
  updateAttachments(state.attachments || []);
  render();
  setRunning(running);
  showView("operator");
  restoreConversationFromContinuity();
}

function openTaskForkModal(task, sourceEventId = "") {
  const capability = task?.forkCapability || (
    task?.id === state?.tasks?.activeTaskId ? state?.conversationCapabilities : null
  );
  const exactEventId = sourceEventId || capability?.latestMilestoneId || "";
  if (!task || !capability?.canFork || !exactEventId) {
    toast(conversationForkCapabilityMessage(capability), true);
    return;
  }
  forkTaskSource = task;
  elements.forkTaskParentId.value = task.id;
  elements.forkTaskSourceEventId.value = exactEventId;
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
  elements.forkAdvancedOptions.open = false;
  renderTaskForkPreview();
  elements.forkTaskModal.classList.remove("hidden");
  elements.forkTaskName.focus();
}

function closeTaskForkModal() {
  forkTaskSource = null;
  elements.forkTaskModal.classList.add("hidden");
  elements.forkTaskForm.reset();
  elements.forkAdvancedOptions.open = false;
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
    toast(response.continuedInBackground
      ? "Fork created and opened. The original run is still working in the background; nothing was replayed."
      : "Fork created and opened. No model request or tool call was replayed.");
  } catch (error) {
    elements.forkTaskError.textContent = error.message;
    elements.forkTaskError.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.forkTaskSubmit, false, "Create fork");
  }
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
  const setupVisible = Boolean(automationSetupDraft && currentView === "operator");
  renderBriefingLibrary();
  if (setupVisible && !panelUserClosed) {
    canvasSidecarOpen = true;
  }
  const sidecarVisible = Boolean(canvasSidecarOpen && currentView === "operator");
  elements.operatorGrid.classList.toggle("has-context", sidecarVisible);
  elements.canvasSidecar.classList.toggle("hidden", !sidecarVisible);
  elements.canvasToggleButton.classList.toggle("hidden", currentView !== "operator");
  elements.canvasToggleButton.setAttribute("aria-pressed", sidecarVisible ? "true" : "false");
  elements.canvasToggleButton.classList.toggle("active", sidecarVisible);
  elements.contextResizeHandle.classList.toggle("hidden", !sidecarVisible);
  const activityVisible = sidecarVisible && currentPanelTab === "activity";
  const canvasVisible = sidecarVisible && currentPanelTab === "canvas";
  elements.panelActivityTab.classList.toggle("active", currentPanelTab === "activity");
  elements.panelActivityTab.setAttribute("aria-selected", String(currentPanelTab === "activity"));
  elements.panelCanvasTab.classList.toggle("active", currentPanelTab === "canvas");
  elements.panelCanvasTab.setAttribute("aria-selected", String(currentPanelTab === "canvas"));
  elements.activityStream.classList.toggle("hidden", !activityVisible);
  elements.automationSetupSurface.classList.toggle("hidden", !(canvasVisible && setupVisible));
  elements.canvasSurface.classList.toggle("hidden", !canvasVisible || setupVisible);

  elements.canvasBadge.textContent = String(canvases.length);
  elements.canvasBadge.classList.toggle("hidden", canvases.length === 0);
  elements.panelCanvasCount.textContent = String(canvases.length);
  if (setupVisible && canvasVisible) {
    renderAutomationSetup();
    return;
  }
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
  const query = (elements.briefingSearchInput?.value || "").trim().toLowerCase();
  resetListPageIfQueryChanged("briefings", query);
  const saved = [
    ...platformBriefings.map((view) => ({ kind: "platform", view })),
    ...localSavedViews.map((view) => ({ kind: "local", view }))
  ].filter((item) => {
    if (!query) return true;
    const view = item.view;
    return `${view.title || ""}\n${view.objective || ""}\n${view.prompt || ""}\n${view.description || ""}`.toLowerCase().includes(query);
  });
  const page = paginateItems(saved, "briefings");
  elements.liveCanvasList.replaceChildren();
  elements.savedViewList.replaceChildren();
  elements.briefingTemplateList.replaceChildren();

  const openNow = elements.liveCanvasList.closest(".briefing-open-now");
  if (openNow) openNow.classList.toggle("hidden", canvases.length === 0);
  if (canvases.length > 0) {
    for (const canvas of canvases) {
      elements.liveCanvasList.append(briefingCard({
        title: canvas.title,
        description: `${canvas.blocks?.length || 0} block${canvas.blocks?.length === 1 ? "" : "s"} · ${canvas.source?.label || "AMOS work"}`,
        actionLabel: "Open now",
        onAction: () => openCanvasSidecar(canvas.id),
        onRemove: () => removeCanvas(canvas.id)
      }));
    }
  }

  if (page.total === 0) {
    const empty = document.createElement("p");
    empty.className = "briefing-library-empty";
    empty.textContent = query
      ? "No Briefings match that search."
      : state.connectionMode === "user"
        ? "Save any live briefing to reopen and refresh it here."
        : "Connect your company to save identity-pinned live briefings.";
    elements.savedViewList.append(empty);
  } else {
    for (const item of page.items) {
      const view = item.view;
      if (item.kind === "platform") {
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
        continue;
      }
      elements.savedViewList.append(briefingCard({
        title: view.title,
        description: `Private local definition updated ${relativeTime(view.updatedAt)} · live data refreshes when opened`,
        actionLabel: "Run",
        onAction: () => stageBriefingPrompt(view.prompt),
        onRemove: () => removeSavedBriefing(view.id)
      }));
    }
  }
  renderListPager(elements.briefingPager, page, (next) => {
    listPages.briefings = next;
    renderBriefingLibrary();
  });

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
  actions.className = "briefing-card-actions";
  const action = actionButton(actionLabel, "primary");
  action.addEventListener("click", onAction);
  actions.append(action);
  const overflow = extraActions.slice();
  if (onRemove) overflow.push({ label: "Remove", onAction: onRemove, danger: true });
  if (overflow.length > 0) actions.append(briefingSettingsMenu(overflow));
  card.append(copy, actions);
  return card;
}

function briefingSettingsMenu(items) {
  const wrap = document.createElement("details");
  wrap.className = "briefing-settings";
  const summary = document.createElement("summary");
  summary.textContent = "More";
  const menu = document.createElement("div");
  menu.className = "briefing-settings-menu";
  for (const item of items) {
    const button = actionButton(item.label, item.danger ? "danger" : "ghost");
    button.addEventListener("click", item.onAction);
    menu.append(button);
  }
  wrap.append(summary, menu);
  return wrap;
}

function stageBriefingPrompt(prompt) {
  showView("operator");
  elements.promptInput.value = prompt;
  elements.promptInput.focus();
}

function startNewBriefingFromScratch() {
  stageBriefingPrompt(
    "Create a reusable Briefing from scratch. I will describe the operating question; do not force a template if none fits."
  );
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
  else if (block.type === "file_tree") card = renderCanvasFileTree(block);
  else if (block.type === "diff") card = renderCanvasDiff(block);
  else if (block.type === "document") card = renderCanvasDocument(block);
  else if (block.type === "spreadsheet") card = renderCanvasSpreadsheet(block);
  else if (block.type === "presentation") card = renderCanvasPresentation(block);
  else if (block.type === "browser") card = renderCanvasBrowser(block);
  else if (block.type === "link") card = renderCanvasLink(block);
  else if (block.type === "sources") card = renderCanvasSources(block);
  else if (block.type === "operating_plan") card = renderCanvasOperatingPlan(block);
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

function renderCanvasFileTree(block) {
  const card = canvasCard(block, "canvas-file-tree-block wide");
  const summary = document.createElement("div");
  summary.className = "canvas-file-tree-summary";
  summary.textContent = `${block.rootLabel} · ${block.nodes.length} visible item${block.nodes.length === 1 ? "" : "s"}${block.truncated ? " · bounded view" : ""}`;
  card.append(summary);

  const tree = document.createElement("div");
  tree.className = "canvas-file-tree";
  tree.setAttribute("role", "tree");
  const collapsed = new Set();
  const rows = [];
  const refreshVisibility = () => {
    for (const row of rows) {
      const hidden = [...collapsed].some((path) => row.node.path.startsWith(`${path}/`));
      row.element.classList.toggle("hidden", hidden);
      if (row.toggle) {
        row.toggle.textContent = collapsed.has(row.node.path) ? "▸" : "▾";
        row.toggle.setAttribute("aria-expanded", String(!collapsed.has(row.node.path)));
      }
    }
  };
  for (const node of block.nodes) {
    const row = document.createElement("div");
    row.className = `canvas-file-tree-row ${node.kind}`;
    row.style.paddingLeft = `${16 + (node.depth * 17)}px`;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(node.depth + 1));
    row.title = node.path;
    let toggle = null;
    if (node.kind === "directory") {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "canvas-tree-toggle";
      toggle.textContent = "▾";
      toggle.setAttribute("aria-label", `Collapse ${node.path}`);
      toggle.setAttribute("aria-expanded", "true");
      toggle.addEventListener("click", () => {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        toggle.setAttribute(
          "aria-label",
          `${collapsed.has(node.path) ? "Expand" : "Collapse"} ${node.path}`
        );
        refreshVisibility();
      });
      row.append(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "canvas-tree-spacer";
      spacer.textContent = "·";
      row.append(spacer);
    }
    const icon = document.createElement("span");
    icon.className = "canvas-tree-icon";
    icon.textContent = node.kind === "directory" ? "□" : "–";
    const name = document.createElement("span");
    name.className = "canvas-tree-name";
    name.textContent = node.name;
    row.append(icon, name);
    if (node.status !== "none") {
      const status = document.createElement("span");
      status.className = `canvas-tree-status ${node.status}`;
      status.textContent = node.status;
      row.append(status);
    }
    rows.push({ node, element: row, toggle });
    tree.append(row);
  }
  if (block.nodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "canvas-file-tree-empty";
    empty.textContent = "No displayable files are present in this workspace.";
    tree.append(empty);
  }
  card.append(tree);
  return card;
}

function renderCanvasDiff(block) {
  const card = canvasCard(block, "canvas-diff-block wide");
  const additions = block.files.reduce((total, file) => total + file.additions, 0);
  const deletions = block.files.reduce((total, file) => total + file.deletions, 0);
  const summary = document.createElement("div");
  summary.className = "canvas-diff-summary";
  const scope = document.createElement("strong");
  scope.textContent = block.scope === "staged" ? "Staged" : block.scope === "untracked" ? "Untracked" : "Working tree";
  const files = document.createElement("span");
  files.textContent = `${block.files.length} file${block.files.length === 1 ? "" : "s"}`;
  const plus = document.createElement("span");
  plus.className = "canvas-diff-additions";
  plus.textContent = `+${additions}`;
  const minus = document.createElement("span");
  minus.className = "canvas-diff-deletions";
  minus.textContent = `−${deletions}`;
  summary.append(scope, files, plus, minus);
  if (block.truncated) {
    const bounded = document.createElement("span");
    bounded.className = "canvas-diff-bounded";
    bounded.textContent = "bounded view";
    summary.append(bounded);
  }
  card.append(summary);

  const body = document.createElement("div");
  body.className = "canvas-diff-files";
  for (const file of block.files) {
    const section = document.createElement("section");
    section.className = "canvas-diff-file";
    const header = document.createElement("header");
    const path = document.createElement("strong");
    path.textContent = file.path;
    path.title = file.path;
    const metadata = document.createElement("span");
    metadata.textContent = `${file.status} · +${file.additions} −${file.deletions}`;
    header.append(path, metadata);
    if (file.oldPath && file.oldPath !== file.path) {
      const previous = document.createElement("small");
      previous.textContent = `from ${file.oldPath}`;
      header.append(previous);
    }
    section.append(header);
    if (file.hunks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "canvas-diff-empty";
      empty.textContent = file.status === "binary"
        ? "Binary change — no text diff is rendered."
        : "No text hunk is available for this change.";
      section.append(empty);
    }
    for (const hunk of file.hunks) {
      const hunkElement = document.createElement("div");
      hunkElement.className = "canvas-diff-hunk";
      const hunkHeader = document.createElement("div");
      hunkHeader.className = "canvas-diff-hunk-header";
      hunkHeader.textContent = hunk.header;
      hunkElement.append(hunkHeader);
      for (const line of hunk.lines) {
        const row = document.createElement("div");
        row.className = `canvas-diff-line ${line.kind}`;
        const oldNumber = document.createElement("span");
        oldNumber.className = "canvas-diff-line-number";
        oldNumber.textContent = line.oldLine ?? "";
        const newNumber = document.createElement("span");
        newNumber.className = "canvas-diff-line-number";
        newNumber.textContent = line.newLine ?? "";
        const marker = document.createElement("span");
        marker.className = "canvas-diff-marker";
        marker.textContent = line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " ";
        const code = document.createElement("code");
        code.textContent = line.text;
        row.append(oldNumber, newNumber, marker, code);
        hunkElement.append(row);
      }
      section.append(hunkElement);
    }
    body.append(section);
  }
  if (block.files.length === 0) {
    const empty = document.createElement("p");
    empty.className = "canvas-diff-empty";
    empty.textContent = "No matching changes.";
    body.append(empty);
  }
  card.append(body);
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
  previewLabel.textContent = block.pagePreview?.pages?.length
    ? `Rendered page preview · ${block.pagePreview.pages.length} of ${block.pagePreview.pageCount} pages`
    : block.previewTruncated
      ? `Structured preview · showing ${block.document.blocks.length} of ${block.totalBlocks} blocks`
      : "Structured preview · final pagination is preserved in the verified files";
  card.append(previewLabel);

  const deck = document.createElement("div");
  deck.className = "document-page-deck";
  if (block.pagePreview?.pages?.length) {
    for (const preview of block.pagePreview.pages) {
      const page = document.createElement("section");
      page.className = "document-preview-page rendered";
      const image = document.createElement("img");
      image.className = "document-preview-thumbnail";
      image.alt = `Rendered preview of page ${preview.page}`;
      image.width = preview.width;
      image.height = preview.height;
      image.addEventListener("error", () => page.classList.add("load-error"), { once: true });
      api.readDocumentPreview(preview.path).then((result) => {
        image.src = `data:${result.mime};base64,${result.base64}`;
      }).catch(() => page.classList.add("load-error"));
      const pageMarker = document.createElement("footer");
      pageMarker.textContent = `Rendered page ${preview.page} of ${block.pagePreview.pageCount}`;
      page.append(image, pageMarker);
      deck.append(page);
    }
  } else {
    const pages = [[]];
    for (const documentBlock of block.document.blocks) {
      if (documentBlock.type === "page_break") pages.push([]);
      else pages.at(-1).push(documentBlock);
    }
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
  }
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

function renderCanvasSpreadsheet(block) {
  const card = canvasCard(block, "canvas-spreadsheet-block wide");
  const summary = document.createElement("div");
  summary.className = "spreadsheet-preview-summary";
  const verified = document.createElement("span");
  verified.className = `spreadsheet-verification-status ${block.verification.verified ? "ready" : "attention"}`;
  verified.textContent = block.verification.verified ? "Reopened and verified" : "Verification incomplete";
  const sheets = document.createElement("span");
  sheets.textContent = `${block.verification.sheetCount} ${block.verification.sheetCount === 1 ? "sheet" : "sheets"}`;
  const formulas = document.createElement("span");
  formulas.textContent = `${block.verification.formulaCount} formulas checked`;
  const checks = document.createElement("span");
  checks.textContent = block.verification.checkCount
    ? `${block.verification.checksPassed}/${block.verification.checkCount} checks passed`
    : "No explicit checks";
  summary.append(verified, sheets, formulas, checks);
  card.append(summary);

  if (block.sheetNames.length > 0) {
    const sheetList = document.createElement("div");
    sheetList.className = "spreadsheet-sheet-list";
    for (const name of block.sheetNames) {
      const chip = document.createElement("span");
      chip.textContent = name;
      sheetList.append(chip);
    }
    card.append(sheetList);
  }

  const failed = block.checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    const diagnostics = document.createElement("div");
    diagnostics.className = "spreadsheet-checks";
    for (const check of failed.slice(0, 10)) {
      const item = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = check.label;
      const note = document.createElement("span");
      note.textContent = check.note || "This spreadsheet check did not pass.";
      item.append(label, note);
      diagnostics.append(item);
    }
    card.append(diagnostics);
  }

  const artifactRow = document.createElement("div");
  artifactRow.className = "document-artifacts spreadsheet-artifacts";
  const row = document.createElement("div");
  row.className = "document-artifact-row";
  const copy = document.createElement("div");
  const name = document.createElement("button");
  name.type = "button";
  name.className = "spreadsheet-artifact-link";
  name.textContent = block.artifact.path;
  name.title = "Open this Excel workbook";
  name.addEventListener("click", () =>
    openDocumentArtifact(block.artifact.path, "open", name, block.artifact.path)
  );
  const detail = document.createElement("small");
  detail.textContent = `XLSX · ${formatBytes(block.artifact.bytes)} · SHA-256 ${block.artifact.sha256.slice(0, 12)}…`;
  copy.append(name, detail);
  const actions = document.createElement("div");
  const open = actionButton("Open in Excel", "primary");
  open.addEventListener("click", () => openDocumentArtifact(block.artifact.path, "open", open));
  const reveal = actionButton("Show in folder", "secondary");
  reveal.addEventListener("click", () => openDocumentArtifact(block.artifact.path, "reveal", reveal));
  actions.append(open, reveal);
  row.append(copy, actions);
  artifactRow.append(row);
  const refine = actionButton("Refine with AMOS", "secondary");
  refine.classList.add("document-refine-button");
  refine.addEventListener("click", () => {
    showView("operator");
    elements.promptInput.value = `Revise “${block.artifact.path}” and regenerate the verified Excel workbook. Preserve its current assumptions, formulas, and required checks unless I specify a change.`;
    elements.promptInput.focus();
  });
  artifactRow.append(refine);
  card.append(artifactRow);
  return card;
}

function renderCanvasPresentation(block) {
  const card = canvasCard(block, `canvas-presentation-block wide presentation-style-${block.style || "business"}`);
  const summary = document.createElement("div");
  summary.className = "presentation-preview-summary";
  const verified = document.createElement("span");
  verified.className = `presentation-verification-status ${block.verification.verified ? "ready" : "attention"}`;
  verified.textContent = block.verification.verified ? "Reopened and verified" : "Verification incomplete";
  const slides = document.createElement("span");
  slides.textContent = `${block.verification.slideCount} ${block.verification.slideCount === 1 ? "slide" : "slides"}`;
  const kind = document.createElement("span");
  kind.textContent = (block.kind || "general").replaceAll("_", " ");
  const status = document.createElement("span");
  status.className = `document-layout-status ${block.diagnostics.length ? "attention" : "ready"}`;
  status.textContent = block.diagnostics.length
    ? `${block.diagnostics.length} layout ${block.diagnostics.length === 1 ? "note" : "notes"}`
    : "Layout checks passed";
  summary.append(verified, slides, kind, status);
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
      message.textContent = item.slideIndex == null
        ? item.message
        : `Slide ${item.slideIndex + 1}: ${item.message}`;
      copy.append(code, message);
      row.append(mark, copy);
      diagnostics.append(row);
    }
    card.append(diagnostics);
  }

  const previewLabel = document.createElement("div");
  previewLabel.className = "document-preview-label";
  previewLabel.textContent = block.slidePreview?.slides?.length
    ? `Rendered slide preview · ${block.slidePreview.slides.length} of ${block.slidePreview.slideCount} slides`
    : "Open the verified PowerPoint file to inspect the deck";
  card.append(previewLabel);

  const deck = document.createElement("div");
  deck.className = "presentation-slide-deck";
  if (block.slidePreview?.slides?.length) {
    for (const preview of block.slidePreview.slides) {
      const page = document.createElement("section");
      page.className = "presentation-preview-slide rendered";
      const image = document.createElement("img");
      image.className = "presentation-preview-thumbnail";
      image.alt = preview.title
        ? `Rendered preview of slide ${preview.slide}: ${preview.title}`
        : `Rendered preview of slide ${preview.slide}`;
      image.width = preview.width;
      image.height = preview.height;
      image.addEventListener("error", () => page.classList.add("load-error"), { once: true });
      api.readDocumentPreview(preview.path).then((result) => {
        image.src = `data:${result.mime};base64,${result.base64}`;
      }).catch(() => page.classList.add("load-error"));
      const pageMarker = document.createElement("footer");
      pageMarker.textContent = preview.title
        ? `Slide ${preview.slide} of ${block.slidePreview.slideCount} · ${preview.title}`
        : `Slide ${preview.slide} of ${block.slidePreview.slideCount}`;
      page.append(image, pageMarker);
      deck.append(page);
    }
  } else {
    const empty = document.createElement("div");
    empty.className = "presentation-preview-empty";
    empty.textContent = "Slide preview is unavailable. Open the verified PPTX to inspect the deck.";
    deck.append(empty);
  }
  card.append(deck);

  const artifactRow = document.createElement("div");
  artifactRow.className = "document-artifacts presentation-artifacts";
  const row = document.createElement("div");
  row.className = "document-artifact-row";
  const copy = document.createElement("div");
  const name = document.createElement("button");
  name.type = "button";
  name.className = "presentation-artifact-link";
  name.textContent = block.artifact.path;
  name.title = "Open this PowerPoint deck";
  name.addEventListener("click", () =>
    openDocumentArtifact(block.artifact.path, "open", name, block.artifact.path)
  );
  const detail = document.createElement("small");
  detail.textContent = `PPTX · ${formatBytes(block.artifact.bytes)} · SHA-256 ${block.artifact.sha256.slice(0, 12)}…`;
  copy.append(name, detail);
  const actions = document.createElement("div");
  const open = actionButton("Open in PowerPoint", "primary");
  open.addEventListener("click", () => openDocumentArtifact(block.artifact.path, "open", open));
  const reveal = actionButton("Show in folder", "secondary");
  reveal.addEventListener("click", () => openDocumentArtifact(block.artifact.path, "reveal", reveal));
  actions.append(open, reveal);
  row.append(copy, actions);
  artifactRow.append(row);
  const refine = actionButton("Refine with AMOS", "secondary");
  refine.classList.add("document-refine-button");
  refine.addEventListener("click", () => {
    showView("operator");
    elements.promptInput.value = block.diagnostics.length
      ? `Refine “${block.artifact.path}” using the visible slide diagnostics, then regenerate the same PowerPoint file.`
      : `Revise “${block.artifact.path}” and regenerate the verified PowerPoint deck. Preserve the current slide argument unless I specify a change.`;
    elements.promptInput.focus();
  });
  artifactRow.append(refine);
  card.append(artifactRow);
  return card;
}

function renderCanvasBrowser(block) {
  const card = canvasCard(block, "canvas-browser-block wide");
  const chrome = document.createElement("div");
  chrome.className = "canvas-browser-chrome";
  const status = document.createElement("span");
  status.className = `canvas-browser-status ${block.status}`;
  status.textContent = block.status === "ready" ? "Observed" : block.status;
  const origin = document.createElement("span");
  origin.className = "canvas-browser-origin";
  try {
    origin.textContent = new URL(block.url).origin;
  } catch {
    origin.textContent = block.url;
  }
  const revision = document.createElement("span");
  revision.textContent = `page ${block.pageRevision} · ${block.elementCount} semantic elements${block.visualFallback ? " · visual fallback" : ""}`;
  chrome.append(status, origin, revision);
  card.append(chrome);

  const frame = document.createElement("div");
  frame.className = `canvas-browser-frame${block.frameId ? "" : " unavailable"}`;
  if (block.frameId && block.status !== "closed") {
    const image = document.createElement("img");
    image.alt = `Local browser observation of ${block.title || block.url}`;
    image.width = block.viewport.width;
    image.height = block.viewport.height;
    api.readBrowserFrame(block.sessionId, block.frameId).then((result) => {
      image.src = `data:${result.mime};base64,${result.base64}`;
    }).catch(() => frame.classList.add("load-error"));
    frame.append(image);
  } else {
    const message = document.createElement("p");
    message.textContent = block.status === "closed"
      ? "This browser session is closed and its local frame was revoked."
      : "The current local browser frame is unavailable.";
    frame.append(message);
  }
  card.append(frame);

  const footer = document.createElement("div");
  footer.className = "canvas-browser-actions";
  const copy = document.createElement("div");
  copy.className = "canvas-browser-copy";
  const summary = document.createElement("p");
  summary.textContent = block.summary || "Public page inspected in the task-isolated AMOS browser.";
  if (block.visualFallback && block.visualTarget) {
    const visualTarget = document.createElement("p");
    visualTarget.className = "canvas-browser-visual-target";
    visualTarget.textContent = `Vision target: ${block.visualTarget}${block.frameSha256 ? ` · frame ${block.frameSha256.slice(0, 12)}…` : ""}`;
    copy.append(summary, visualTarget);
  } else {
    copy.append(summary);
  }
  const safety = document.createElement("p");
  safety.className = "canvas-browser-safety";
  safety.textContent = block.visualFallback
    ? "Editable values are masked. Coordinates expire on any pixel or page change; authentication still requires direct control."
    : "Passwords, MFA codes, tokens, and cookies stay inside the isolated browser and are never returned to AMOS.";
  copy.append(safety);
  if (block.download) {
    const download = document.createElement("div");
    download.className = "canvas-browser-download";
    const detail = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = block.download.name;
    const proof = document.createElement("small");
    proof.textContent = `${formatBytes(block.download.size)} · SHA-256 ${block.download.sha256.slice(0, 12)}…`;
    detail.append(name, proof);
    const save = actionButton("Save copy…", "secondary");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const result = await api.saveBrowserDownload(block.download.attachmentId);
        if (!result.canceled) toast(`Saved verified copy of ${result.name}.`);
      } catch (error) {
        toast(error.message, true);
      } finally {
        save.disabled = false;
      }
    });
    download.append(detail, save);
    copy.append(download);
  }
  footer.append(copy);
  if (block.status !== "closed") {
    const controls = document.createElement("div");
    controls.className = "canvas-browser-controls";
    const takeover = actionButton(
      block.takeoverActive ? "Return to AMOS & refresh" : "Take control for login",
      block.takeoverActive ? "primary" : "secondary"
    );
    takeover.addEventListener("click", async () => {
      takeover.disabled = true;
      try {
        if (block.takeoverActive) {
          await api.finishBrowserTakeover(block.sessionId);
          toast("Direct browser control ended and the page was refreshed.");
        } else {
          await api.startBrowserTakeover(block.sessionId);
          toast("Secure browser control is open. Complete login there, then return control to AMOS.");
        }
      } catch (error) {
        takeover.disabled = false;
        toast(error.message, true);
      }
    });
    const open = actionButton("Open in system browser ↗", "secondary");
    open.addEventListener("click", () => {
      api.openExternal(block.url).catch((error) => toast(error.message, true));
    });
    controls.append(takeover, open);
    footer.append(controls);
  }
  card.append(footer);
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
  if (["image", "chart"].includes(block.type)) {
    const figure = document.createElement("figure");
    figure.className = "document-preview-visual-placeholder";
    const label = document.createElement("strong");
    label.textContent = block.type === "chart" ? block.title : block.alt_text;
    const detail = document.createElement("span");
    detail.textContent = block.type === "chart"
      ? `${block.chart_type} chart · ${block.series.length} ${block.series.length === 1 ? "series" : "series"}`
      : block.path;
    figure.append(label, detail);
    if (block.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = block.caption;
      figure.append(caption);
    }
    return figure;
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

async function openDocumentArtifact(path, mode, button, idleLabel = "") {
  setButtonBusy(button, true, mode === "open" ? "Opening…" : "Finding…");
  try {
    await api.openDocumentArtifact(path, mode);
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, idleLabel || (mode === "open" ? "Open" : "Show in folder"));
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

function renderCanvasOperatingPlan(block) {
  const card = canvasCard(block, "canvas-operating-plan-block");
  const lane = document.createElement("span");
  lane.className = `canvas-plan-lane ${block.status || "active"}`;
  lane.textContent = block.status || "active";
  card.append(lane);
  for (const section of block.sections || []) {
    const region = document.createElement("section");
    region.className = "canvas-plan-section";
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    region.append(heading);
    const list = document.createElement("ul");
    for (const item of section.items || []) {
      list.append(renderOperatingPlanItem(item));
    }
    region.append(list);
    card.append(region);
  }
  return card;
}

function renderOperatingPlanItem(item) {
  const row = document.createElement("li");
  row.className = `canvas-plan-item status-${item.status}`;
  const meta = document.createElement("div");
  meta.className = "canvas-plan-item-meta";
  const status = document.createElement("span");
  status.className = `canvas-plan-status ${item.status}`;
  status.textContent = item.status;
  const kind = document.createElement("span");
  kind.className = "canvas-plan-kind";
  kind.textContent = item.kind;
  meta.append(status, kind);
  if (item.status === "inferred" && item.confidence != null) {
    const confidence = document.createElement("span");
    confidence.className = "canvas-plan-confidence";
    confidence.textContent = `${Math.round(Number(item.confidence) * 100)}%`;
    meta.append(confidence);
  }
  const statement = document.createElement("p");
  statement.textContent = item.statement;
  row.append(meta, statement);
  const actions = Array.isArray(item.actions) ? item.actions : [];
  if (actions.length > 0) {
    const controls = document.createElement("div");
    controls.className = "canvas-plan-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "confirm" ? "button primary" : "button ghost";
      button.textContent = planActionLabel(action);
      button.addEventListener("click", () => applyOperatingPlanAction(action, item, button));
      controls.append(button);
    }
    row.append(controls);
  }
  return row;
}

function planActionLabel(action) {
  if (action === "confirm") return "Confirm";
  if (action === "correct") return "Correct";
  if (action === "reject") return "Reject";
  if (action === "reopen") return "Reopen";
  return action;
}

async function applyOperatingPlanAction(action, item, button) {
  button.disabled = true;
  try {
    if (action === "confirm") {
      await api.confirmConsultativeAssertion({ assertionId: item.id });
    } else if (action === "correct") {
      const statement = window.prompt("Correct this understanding", item.statement);
      if (!statement || statement.trim() === item.statement) return;
      await api.correctConsultativeAssertion({ assertionId: item.id, statement });
    } else if (action === "reject") {
      await api.rejectConsultativeAssertion({ assertionId: item.id });
    } else if (action === "reopen") {
      await api.reopenConsultativeAssertion({ assertionId: item.id });
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
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
  if (id) {
    activeCanvasId = id;
    state.activeCanvasId = id;
  }
  openPanel("canvas");
}

function openPanel(tab = currentPanelTab) {
  currentPanelTab = tab === "canvas" ? "canvas" : "activity";
  canvasSidecarOpen = true;
  panelUserClosed = false;
  showView("operator");
  renderCanvas();
}

function closeCanvasSidecar() {
  canvasSidecarOpen = false;
  panelUserClosed = true;
  renderCanvas();
  elements.promptInput.focus();
}

function toggleCanvasSidecar() {
  canvasSidecarOpen = !canvasSidecarOpen;
  panelUserClosed = !canvasSidecarOpen;
  if (canvasSidecarOpen && !activeCanvasId) currentPanelTab = "activity";
  renderCanvas();
  if (!canvasSidecarOpen) elements.promptInput.focus();
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
  if (open) {
    renderAccountMenu();
    placeAccountMenu();
  }
  elements.accountMenu.classList.toggle("hidden", !open);
  elements.accountMenuButton.setAttribute("aria-expanded", String(open));
}

function placeAccountMenu() {
  const button = elements.accountMenuButton.getBoundingClientRect();
  const menu = elements.accountMenu;
  const width = Math.min(390, Math.max(280, window.innerWidth - 24));
  let left = button.right + 12;
  if (left + width > window.innerWidth - 12) {
    left = Math.max(12, button.left - 12 - width);
  }
  const bottom = Math.max(12, window.innerHeight - button.bottom);
  menu.style.position = "fixed";
  menu.style.left = `${Math.round(left)}px`;
  menu.style.right = "auto";
  menu.style.top = "auto";
  menu.style.bottom = `${Math.round(bottom)}px`;
  menu.style.width = `${Math.round(width)}px`;
}

function closeAccountMenu() {
  elements.accountMenu.classList.add("hidden");
  elements.accountMenuButton.setAttribute("aria-expanded", "false");
}

async function addAccount() {
  setButtonBusy(elements.addAccountButton, true, "Waiting for sign-in…");
  try {
    state = await api.addAccount();
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
  toast("Checking for AMOS Desktop updates…");
  try {
    const next = await api.checkForUpdates();
    if (next) updateState = next;
    renderUpdate();
    if (!["available", "downloading", "downloaded", "installing"].includes(updateState?.status)) {
      toast(updateState?.message || "AMOS Desktop is up to date.");
    }
  } catch (error) {
    toast(error.message, true);
  }
}

function connectedCompanySystems() {
  return (state?.connectionsCatalog?.connections || []).filter(
    (item) => item.status === "connected" && item.usable !== false
  );
}

function shouldPushConnectSystems() {
  return Boolean(state) &&
    state.connectionMode !== "demo" &&
    connectedCompanySystems().length === 0;
}

function renderConnectSystemsPush({ hasConversation = false } = {}) {
  const visible = shouldPushConnectSystems() && !hasConversation;
  elements.connectSystemsPush.classList.toggle("hidden", !visible);
  elements.connectSystemsPushButton.textContent = "Connect your company";
}

async function startConnectApplications() {
  if (state.connected && state.connectionMode !== "demo") {
    if (firstRunNeeded()) {
      await completeOnboarding().catch((error) => toast(error.message, true));
    }
    showView("connections");
    return;
  }
  await connectAmos();
  if (state.connected) showView("connections");
}

async function pushConnectSystems() {
  await startConnectApplications();
}

async function runSavingsAudit() {
  await runTask(null, {
    privateAction: true,
    prompt: AMOS_SAVINGS_AUDIT_PROMPT,
    displayText: "See what AMOS could replace"
  });
}

function renderStarterActions() {
  if (!state || !elements.starterActions) return;
  const actions = selectJourneyStarterActions(state);
  elements.starterActions.replaceChildren();
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "starter-action";
    button.dataset.actionId = action.id;
    button.textContent = action.label;
    button.addEventListener("click", () => executeStarterAction(action, button));
    elements.starterActions.append(button);
  }
}

async function executeStarterAction(action, button) {
  if (running) return;
  if (action.type === "view") {
    showView(action.view);
    return;
  }
  if (action.type === "connect_platform") {
    await pushConnectSystems();
    return;
  }
  if (action.type === "resume") {
    await resumeTaskCheckpoint(action.checkpointId, button);
    return;
  }
  if (action.type === "automation_builder") {
    await openAutomationTask(null, button, true);
    return;
  }
  if (action.type !== "run") {
    toast("That quick action is not available in this version of AMOS.", true);
    return;
  }
  await runTask(null, {
    privateAction: true,
    prompt: action.prompt,
    displayText: action.label
  });
}

function activeConversationProject() {
  const task = activeDurableTask();
  if (!task?.projectId) return null;
  return (state?.projects?.projects || []).find((item) => item.id === task.projectId) || null;
}

function renderConversationChrome() {
  const hasConversation = Boolean(
    elements.messages.querySelector(".message.user, .message.assistant, .message.error")
  );
  const project = activeConversationProject();
  elements.conversation.classList.toggle("has-history", hasConversation);
  elements.conversation.classList.toggle("has-project", Boolean(project));
  elements.conversationHeading.classList.toggle("hidden", hasConversation || Boolean(project));
  elements.welcomeMessage.classList.toggle("hidden", hasConversation);
  renderConnectSystemsPush({ hasConversation });
  elements.starterActions.classList.toggle("hidden", hasConversation || Boolean(project));
  elements.clearButton.classList.toggle("hidden", !hasConversation);
  if (project) {
    elements.readyTitle.textContent = `Talking in ${project.name}.`;
    elements.readyDescription.textContent = project.instructions
      ? `This conversation stays with ${project.name}. Shared Project instructions orient AMOS; they do not grant extra authority.`
      : `This conversation stays with ${project.name}. Ask, attach work, or leave a next step.`;
    elements.promptInput.placeholder = `Talk in ${project.name}…`;
  }
  renderConversationActions();
}

function renderConversationActions() {
  elements.newConversationButton.disabled = false;
  const capability = state?.conversationCapabilities || activeDurableTask()?.forkCapability || {
    canFork: false,
    reason: "no_conversation"
  };
  elements.forkConversationButton.disabled = !capability.canFork;
  elements.forkConversationButton.title = conversationForkCapabilityMessage(capability);
  renderComposerProjectChip();
}

function renderComposerProjectChip() {
  const chip = elements.composerProjectChip;
  if (!chip) return;
  const project = activeConversationProject();
  if (!project) {
    chip.textContent = "";
    chip.classList.add("hidden");
    return;
  }
  chip.textContent = `PROJECT · ${project.name.toUpperCase()}`;
  chip.title = `This conversation stays with ${project.name}.`;
  chip.classList.remove("hidden");
}

function renderDecisions() {
  if (!state) return;
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const proposals = Array.isArray(state.offlineProposals) ? state.offlineProposals : [];
  const pendingInputs = Array.isArray(state.pendingInputs) ? state.pendingInputs : [];
  const pending = approvals.filter((approval) => approval.status === "pending");
  const recent = approvals.filter((approval) => approval.status !== "pending").slice(0, 10);
  const waitingCount = pending.length + proposals.length + pendingInputs.length;
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
  if (pending.length === 0 && pendingInputs.length === 0) {
    elements.pendingDecisions.append(
      decisionEmpty(
        sync.syncing ? "Checking for decisions…" : "Nothing is waiting for your decision."
      )
    );
  } else {
    for (const request of pendingInputs) {
      elements.pendingDecisions.append(decisionInputCard(request));
    }
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
  const pendingIds = new Set(pendingInputs.map((request) => request.id));
  for (const card of elements.messages.querySelectorAll(".decision-card.inline-decision")) {
    if (!pendingIds.has(card.dataset.inputId)) card.remove();
  }
  if (running) {
    for (const request of pendingInputs) renderInlineDecisionRequest(request);
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
  summary.textContent = checkpoint.progress?.summary || "Conversation run stopped before completion.";
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
    if (result.state) adoptOpenedTask(result);
    else state.taskCheckpoints = result.taskCheckpoints || [];
    elements.promptInput.value = "";
    showView("operator");
    renderTasks();
    renderProjects();
    renderDecisions();
    toast(
      result.conversationRecovery?.isolated
        ? "This older checkpoint had no durable conversation link, so AMOS opened a separate recovery conversation and is resuming it safely."
        : "Context revalidated. AMOS is safely continuing the selected conversation."
    );
    await runTask(null, {
      automaticResume: true,
      prompt: result.prompt,
      resumeTaskId: id
    });
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
    renderTasks();
    renderProjects();
    renderDecisions();
    toast("Conversation checkpoint removed.");
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

function decisionInputCard(request) {
  const researchCheckpoint = request.decisionType === "research-checkpoint";
  const card = document.createElement("article");
  card.className = `decision-card pending decision-input${researchCheckpoint ? " research-checkpoint" : ""}`;
  card.dataset.inputId = request.id;
  const content = document.createElement("div");
  content.className = "decision-content";
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  const status = document.createElement("span");
  status.className = "decision-status pending";
  status.textContent = researchCheckpoint ? "research check-in" : "needs input";
  const time = document.createElement("time");
  time.dateTime = request.requestedAt || "";
  time.textContent = request.requestedAt ? new Date(request.requestedAt).toLocaleString() : "";
  meta.append(status, time);
  const title = document.createElement("h2");
  title.textContent = request.title || "AMOS needs your input";
  const summary = document.createElement("p");
  summary.textContent = request.message || "";
  content.append(meta, title, summary);
  if (request.context) {
    const context = document.createElement("small");
    context.textContent = request.context;
    content.append(context);
  }

  const actions = document.createElement("div");
  actions.className = "decision-card-actions";
  const form = document.createElement("form");
  form.className = "decision-input-form";
  const field = document.createElement("label");
  field.className = "decision-input-field";
  const fieldLabel = document.createElement("span");
  fieldLabel.textContent = researchCheckpoint ? "Or give AMOS different direction" : "Your answer";
  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.maxLength = 8000;
  textarea.required = true;
  textarea.placeholder = researchCheckpoint
    ? "For example: research another hour, focusing on partner economics…"
    : "Type the answer AMOS needs to continue…";
  textarea.value = decisionInputDrafts.get(request.id) || "";
  textarea.addEventListener("input", () => {
    decisionInputDrafts.set(request.id, textarea.value);
  });
  field.append(fieldLabel, textarea);
  form.append(field);
  if (Array.isArray(request.options) && request.options.length > 0) {
    const chips = document.createElement("div");
    chips.className = "decision-input-options";
    for (const option of request.options) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "button ghost compact-button";
      chip.textContent = option;
      chip.addEventListener("click", () => {
        if (researchCheckpoint) {
          resolveDecisionInput(request, option, chip, true);
        } else {
          textarea.value = option;
          textarea.focus();
        }
      });
      chips.append(chip);
    }
    form.append(chips);
  }
  const buttons = document.createElement("div");
  buttons.className = "decision-input-actions";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "button secondary";
  skip.textContent = researchCheckpoint ? "Keep working" : "Skip";
  skip.addEventListener("click", () => resolveDecisionInput(request, "", skip, false));
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button primary";
  submit.textContent = researchCheckpoint ? "Send direction" : "Send answer";
  buttons.append(skip, submit);
  form.append(buttons);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    resolveDecisionInput(request, textarea.value, submit, true);
  });
  actions.append(form);
  card.append(content, actions);
  return card;
}

function renderInlineDecisionRequest(request, { focus = false } = {}) {
  if (!request?.id || !eventMatchesActiveTask(request)) return null;
  const existing = Array.from(
    elements.messages.querySelectorAll(".decision-card.inline-decision")
  ).find((card) => card.dataset.inputId === request.id);
  if (existing) {
    if (focus) existing.querySelector("textarea")?.focus();
    return existing;
  }
  const card = decisionInputCard(request);
  card.classList.add("inline-decision");
  showView("operator");
  elements.messages.append(card);
  renderConversationChrome();
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (focus) window.setTimeout(() => card.querySelector("textarea")?.focus(), 0);
  return card;
}

function removeInlineDecisionRequest(id) {
  for (const card of elements.messages.querySelectorAll(".decision-card.inline-decision")) {
    if (card.dataset.inputId === id) card.remove();
  }
}

async function resolveDecisionInput(request, answer, button, answered) {
  const label = button?.textContent || "Send answer";
  if (button) setButtonBusy(button, true, answered ? "Sending…" : "Skipping…");
  try {
    const result = await api.resolveDecisionInput(request.id, {
      answered,
      answer
    });
    if (!result?.resolved) throw new Error("That question is no longer waiting.");
    if (state) {
      state.pendingInputs = (Array.isArray(state.pendingInputs) ? state.pendingInputs : [])
        .filter((item) => item.id !== request.id);
    }
    decisionInputDrafts.delete(request.id);
    removeInlineDecisionRequest(request.id);
    renderDecisions();
    if (request.decisionType === "research-checkpoint") {
      addMessage("assistant", researchCheckpointAcknowledgement(answer, answered));
    }
    if (running) {
      updateChatRunStatus(answered ? "Using your answer and continuing…" : "Continuing without that answer…", "active");
      setPanelBadge("working");
    }
    toast(answered ? "Answer sent. AMOS can continue." : "Skipped. AMOS will continue without that answer.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button?.isConnected) setButtonBusy(button, false, label);
  }
}

function researchCheckpointAcknowledgement(answer, answered) {
  const normalized = String(answer || "").trim().toLowerCase();
  if (answered && /synthesi[sz]e|answer now|finish now|report now/.test(normalized)) {
    return "Got it — I’m synthesizing the strongest supported answer now. Completed work remains intact.";
  }
  if (!answered || /autonomous|without (?:another )?(?:check|interrupt)|do not ask|don['’]t ask|keep working$/.test(normalized)) {
    return "Got it — I’m continuing autonomously. Completed actions will not be replayed.";
  }
  return "Got it — I’m continuing with your direction and preserving all completed work.";
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

function northwindUsageLabel(demoStatus) {
  const limit = Number(demoStatus?.messageLimit);
  const remaining = Number(demoStatus?.messagesRemaining);
  if (Number.isSafeInteger(limit) && limit >= 0 && Number.isSafeInteger(remaining) && remaining >= 0) {
    return `${remaining} of ${limit} hosted turns remaining`;
  }
  if (Number.isSafeInteger(limit) && limit > 0) return `Up to ${limit} hosted turns included`;
  return "Limited hosted turns included";
}

function renderNorthwindIntelligenceChoice(demo) {
  elements.northwindIntelligenceChoice.classList.toggle("hidden", !demo);
  if (!demo) return;
  const provider = state.settings.provider;
  elements.demoHostedIntelligenceButton.classList.toggle("selected", provider === "amos-hosted");
  elements.demoLocalIntelligenceButton.classList.toggle("selected", provider === "ollama");
  elements.demoByokIntelligenceButton.classList.toggle(
    "selected",
    !["amos-hosted", "ollama"].includes(provider)
  );
  elements.northwindUsageSummary.textContent = northwindUsageLabel(state.accountStatus?.demo);
  elements.northwindCurrentIntelligence.textContent = state.configured
    ? `Current intelligence: ${providerStatusLabel()}. You can change this now or anytime from the Northwind banner.`
    : "Choose and finish intelligence setup before entering Northwind.";
}

function onboardingEnterLabel() {
  if (state?.connectionMode === "demo") return "Enter Northwind demo";
  if (state?.mode?.personal || state?.mode?.offline) return "Start local workspace";
  if (state?.connected) return `Continue with ${activeCompanyName()}`;
  return "Enter AMOS Desktop";
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
    description.textContent = provider.id === "amos-hosted"
      ? state.mode?.personal && !state.connected
        ? "AMOS company subscription required for ongoing use. Northwind includes limited hosted demo turns."
        : "Included with an AMOS company subscription. Included credits apply first; additional use is metered."
      : provider.description;
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

  elements.autonomousCheckpointInput.value = String(settings.autonomousCheckpointMinutes ?? 0);
  elements.appearanceInput.value = settings.appearance || "system";
  elements.mcpInput.value = settings.amosMcpUrl;
  renderTelemetryPreference();
  elements.apiKeyHelp.textContent = settings.hasApiKey
    ? "A credential is stored securely. Leave blank to keep it."
    : (providerDefaults[selectedProvider]?.credential || "Provider credential");
  renderProviderFields(settings.model);
  renderIntelligenceRoles();
  renderHybridRouting();
  const personalNeedsIntelligence = Boolean(
    state.mode?.personal && !state.connected && !state.configured
  );
  elements.personalIntelligenceCallout.classList.toggle("hidden", !personalNeedsIntelligence);
  if (personalNeedsIntelligence) elements.advancedInfrastructureDetails.open = true;
  elements.systemCard.replaceChildren(
    strong(`${state.system.arch.toUpperCase()} · ${state.system.memoryGb} GB memory`),
    text(state.system.localRecommendation)
  );
  renderCollaborationProfile();
}

function renderCollaborationProfile() {
  if (!elements.collaborationProfileFields) return;
  const catalog = state.relationshipProfile?.catalog || [];
  const selected = new Map(
    (state.relationshipProfile?.profile?.explicitPreferences || [])
      .map((item) => [item.key, item.value])
  );
  const labels = {
    response_structure: "Answer shape",
    detail: "Level of detail",
    challenge: "Directness",
    alternatives: "Recommendations",
    collaboration: "Work style",
    initiative: "Initiative"
  };
  elements.collaborationProfileFields.replaceChildren();
  for (const item of catalog) {
    const field = document.createElement("div");
    field.className = "field";
    const label = document.createElement("label");
    label.setAttribute("for", `collaboration-${item.key}`);
    label.textContent = labels[item.key] || item.key;
    const select = document.createElement("select");
    select.id = `collaboration-${item.key}`;
    select.dataset.preferenceKey = item.key;
    const unset = document.createElement("option");
    unset.value = "";
    unset.textContent = "Use AMOS default";
    select.append(unset);
    for (const value of item.values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.replaceAll("_", " ");
      if (selected.get(item.key) === value) option.selected = true;
      select.append(option);
    }
    if (!selected.has(item.key)) unset.selected = true;
    select.addEventListener("change", () => saveCollaborationPreference(item.key, select.value));
    field.append(label, select);
    elements.collaborationProfileFields.append(field);
  }
}

async function saveCollaborationPreference(key, value) {
  try {
    const result = value
      ? await api.setRelationshipPreference({
          key,
          value,
          expectedRevision: state.relationshipProfile?.profile?.revision ?? 0
        })
      : await api.clearRelationshipPreference({
          key,
          expectedRevision: state.relationshipProfile?.profile?.revision ?? 0
        });
    state.relationshipProfile = result;
    renderCollaborationProfile();
  } catch (error) {
    toast(error.message, true);
  }
}

function offlineCatalogBadge(model) {
  if (model.retired) {
    return { className: "retired", label: "Retired — replace with Qwen 3.8" };
  }
  if (model.experimental || model.qualification?.status === "experimental") {
    return { className: "experimental", label: "Experimental" };
  }
  const status = model.qualification?.status;
  if (status === "conditional") {
    return { className: "conditional", label: "Conditional" };
  }
  if (status === "unmeasured" || status === "unqualified" || !model.qualification) {
    return { className: "unmeasured", label: "Unmeasured — not for governed work" };
  }
  return null;
}

function offlineCatalogFailures(model) {
  const named = [
    ...(model.qualification?.failed || []),
    ...((model.capabilityContract?.failures || []).map((item) => item?.scenario))
  ];
  return [...new Set(named.filter(Boolean))];
}

function renderIntelligenceRoles() {
  const pairing = state.settings.intelligenceRoles || {};
  const options = state.roleOptions || [];
  elements.intelligenceRolesField.classList.toggle("hidden", selectedProvider !== "amos-hosted");
  elements.intelligenceRolesEnabled.checked = pairing.enabled === true;
  for (const [select, key] of [
    [elements.plannerRoleInput, "planner"],
    [elements.implementerRoleInput, "implementer"],
    [elements.checkerRoleInput, "checker"]
  ]) {
    const selected = pairing[key]
      ? `${pairing[key].provider}:${pairing[key].model}`
      : "";
    select.replaceChildren();
    for (const option of options) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      if (option.value === selected) item.selected = true;
      select.append(item);
    }
  }
  renderIntelligenceRoleControls();
}

function renderIntelligenceRoleControls() {
  const enabled = selectedProvider === "amos-hosted" && elements.intelligenceRolesEnabled.checked;
  elements.intelligenceRoleControls.classList.toggle("hidden", !enabled);
  for (const select of [
    elements.plannerRoleInput,
    elements.implementerRoleInput,
    elements.checkerRoleInput
  ]) {
    select.disabled = !enabled;
  }
}

function collectIntelligenceRoles() {
  return {
    enabled: selectedProvider === "amos-hosted" && elements.intelligenceRolesEnabled.checked,
    scope: "coding",
    planner: decodeRoleValue(elements.plannerRoleInput.value),
    implementer: decodeRoleValue(elements.implementerRoleInput.value),
    checker: decodeRoleValue(elements.checkerRoleInput.value)
  };
}

const hybridStrategyOptions = [
  ["managed", "AMOS automatic"],
  ["local", "Local primary · frontier then AMOS fallback"],
  ["frontier", "Frontier primary · AMOS fallback"],
  ["local-review", "Local draft + frontier review"]
];

function renderHybridRouting() {
  const policy = state.settings.hybridRouting || {};
  elements.hybridRoutingEnabled.checked = selectedProvider === "amos-hosted" && policy.enabled === true;

  const installed = (state.offline?.models || []).filter((model) =>
    model.installed === true &&
    model.retired !== true &&
    ["qualified", "conditional"].includes(model.capabilityContract?.status)
  );
  elements.hybridLocalModelInput.replaceChildren();
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = installed.length > 0
    ? "Automatic · best qualified model installed"
    : "Automatic · install a qualified local model below";
  elements.hybridLocalModelInput.append(automatic);
  for (const model of installed) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.modelDisplayName || model.id} · ${model.capabilityContract.status}`;
    elements.hybridLocalModelInput.append(option);
  }
  elements.hybridLocalModelInput.value = installed.some((model) => model.id === policy.localModel)
    ? policy.localModel
    : "";

  elements.hybridFrontierInput.replaceChildren();
  const hosted = document.createElement("option");
  hosted.value = "amos-hosted:auto";
  hosted.textContent = "AMOS Intelligence · automatic";
  elements.hybridFrontierInput.append(hosted);
  const cloudProviders = new Set(
    (state.providers || [])
      .filter((provider) => !["local", "amos"].includes(provider.deployment))
      .map((provider) => provider.id)
  );
  for (const option of state.roleOptions || []) {
    if (!cloudProviders.has(option.provider)) continue;
    const item = document.createElement("option");
    item.value = option.value;
    const stored = state.settings.storedCredentialProviders?.includes(option.provider);
    item.textContent = `${option.label}${stored ? " · ready" : " · credential needed"}`;
    elements.hybridFrontierInput.append(item);
  }
  const frontierValue = `${policy.frontier?.provider || "amos-hosted"}:${policy.frontier?.model || "auto"}`;
  elements.hybridFrontierInput.value = [...elements.hybridFrontierInput.options]
    .some((option) => option.value === frontierValue)
      ? frontierValue
      : "amos-hosted:auto";

  const defaults = {
    routine: "local",
    balanced: "local",
    deep: "local-review",
    frontier: "frontier"
  };
  for (const [select, minimumClass] of [
    [elements.hybridRoutineStrategyInput, "routine"],
    [elements.hybridBalancedStrategyInput, "balanced"],
    [elements.hybridDeepStrategyInput, "deep"],
    [elements.hybridFrontierStrategyInput, "frontier"]
  ]) {
    select.replaceChildren();
    for (const [value, label] of hybridStrategyOptions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    select.value = policy.strategies?.[minimumClass] || defaults[minimumClass];
  }
  renderHybridRoutingControls();
}

function renderHybridRoutingControls() {
  const enabled = selectedProvider === "amos-hosted" && elements.hybridRoutingEnabled.checked;
  for (const control of elements.hybridRoutingControls.querySelectorAll("select")) {
    control.disabled = !enabled;
  }
  elements.hybridRoutingControls.classList.toggle("disabled", !enabled);
  const installed = state.offline?.runtime?.available === true &&
    (state.offline?.models || []).some((model) =>
    model.installed === true &&
    model.retired !== true &&
    ["qualified", "conditional"].includes(model.capabilityContract?.status)
    );
  elements.hybridRoutingStatus.textContent = enabled
    ? installed
      ? "Hybrid routing is opt-in. Every failure returns to AMOS Hosted; routes are recorded in receipts."
      : "No qualified local model is installed yet. Until one is available, recipes fall through to your frontier and AMOS Hosted."
    : "AMOS Hosted automatic routing remains the active, known-good path.";
}

function collectHybridRouting() {
  const [frontierProvider, ...frontierModelParts] = elements.hybridFrontierInput.value.split(":");
  return {
    enabled: selectedProvider === "amos-hosted" && elements.hybridRoutingEnabled.checked,
    localModel: elements.hybridLocalModelInput.value,
    frontier: {
      provider: frontierProvider || "amos-hosted",
      model: frontierModelParts.join(":") || "auto"
    },
    strategies: {
      routine: elements.hybridRoutineStrategyInput.value,
      balanced: elements.hybridBalancedStrategyInput.value,
      deep: elements.hybridDeepStrategyInput.value,
      frontier: elements.hybridFrontierStrategyInput.value
    }
  };
}

function decodeRoleValue(value) {
  const index = String(value || "").indexOf(":");
  if (index <= 0) return { provider: "kimi", model: "kimi-k3" };
  return { provider: value.slice(0, index), model: value.slice(index + 1) };
}

function renderTaskRoles() {
  const pairingOn = state?.settings?.intelligenceRoles?.enabled === true;
  elements.taskRoleBar.classList.toggle("hidden", !pairingOn);
  if (!pairingOn) return;
  const current = state.activeTask?.intelligenceRole || state.intelligenceRole || "planner";
  for (const button of [elements.plannerRoleButton, elements.implementerRoleButton, elements.checkerRoleButton]) {
    button.classList.toggle("active", button.dataset.role === current);
  }
}

function renderTaskUsage() {
  const usage = state.activeTask?.usage;
  if (!usage?.totalTokens && !usage?.costUsedMicrousd) {
    elements.taskUsageLine.classList.add("hidden");
    return;
  }
  const dollars = ((usage.costUsedMicrousd || 0) / 1_000_000).toFixed(4);
  elements.taskUsageLine.classList.remove("hidden");
  elements.taskUsageLine.textContent = `${usage.totalTokens || 0} tokens · $${dollars}${usage.estimated ? " est." : ""}`;
}

function accumulateRendererUsage(current = {}, event = {}) {
  return {
    inputTokens: Number(current.inputTokens || 0) + Number(event.inputTokens || 0),
    outputTokens: Number(current.outputTokens || 0) + Number(event.outputTokens || 0),
    totalTokens: Number(current.totalTokens || 0) + Number(event.totalTokens || 0),
    costUsedMicrousd: Number(current.costUsedMicrousd || 0) + Number(event.costUsedMicrousd || 0),
    estimated: current.estimated === true || event.estimated === true
  };
}

async function switchIntelligenceRole(role) {
  try {
    const result = await api.switchIntelligenceRole({ role });
    state.intelligenceRole = result.role;
    state.activeTask = {
      ...(state.activeTask || {}),
      intelligenceRole: result.role,
      intelligence: result
    };
    renderTaskRoles();
    toast(`${result.role} · ${result.provider} · ${result.model}`);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderOfflineModels() {
  if (!state?.offline) return;
  const offline = state.offline;
  const runtime = offline.runtime || {};
  const accelerator = offline.accelerator || null;
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
    const qualificationStatus = model.qualification?.status || "unqualified";
    const measured = qualificationStatus === "conditional" || qualificationStatus === "qualified";
    const profile = document.createElement("span");
    profile.textContent = model.recommended && measured
      ? "Recommended primary model"
      : model.recommendedFor === "vision" && measured
        ? "Recommended for image tasks"
        : model.id;
    labels.append(profile);
    const badge = offlineCatalogBadge(model);
    if (badge) {
      const status = document.createElement("span");
      status.className = badge.className;
      status.textContent = badge.label;
      labels.append(status);
    }
    if (model.installed) {
      const installed = document.createElement("span");
      installed.className = "installed";
      installed.textContent = "Installed";
      labels.append(installed);
    }
    const title = document.createElement("h3");
    title.textContent = model.name;
    const identity = document.createElement("p");
    identity.className = "offline-model-identity";
    identity.textContent = `Model · ${model.modelDisplayName || model.id}`;
    const description = document.createElement("p");
    description.textContent = model.description;
    const meta = document.createElement("div");
    meta.className = "offline-model-meta";
    const mtplxEligible = accelerator?.sourceModelId === model.id;
    for (const value of [
      `≈ ${formatBytes(model.approximateSizeBytes)}`,
      `${model.recommendedMemoryGb} GB recommended`,
      ...(model.capabilities || []).slice(0, 3),
      ...(mtplxEligible
        ? [accelerator.status === "ready"
            ? `MTPLX ${accelerator.version || accelerator.requiredVersion} active · native MTP`
            : accelerator.status === "failed"
              ? "MTPLX Preview failed · Ollama fallback"
              : accelerator.available
                ? `MTPLX ${accelerator.requiredVersion} installed · native MTP`
                : "MTPLX Preview unavailable"]
        : []),
      ...(model.integrity?.status === "verified"
        ? ["Release digest verified"]
        : model.integrity?.status === "mismatch"
          ? ["Failed: release digest mismatch"]
          : []),
      ...offlineCatalogFailures(model).map((scenario) => `Failed: ${scenario}`)
    ]) {
      const pill = document.createElement("span");
      if (value.startsWith("Failed: ")) pill.className = "failed";
      pill.textContent = value;
      meta.append(pill);
    }
    card.append(labels, title, identity, description, meta);

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
      const preferredRuntime = mtplxEligible && accelerator.available
        ? "mtplx"
        : "ollama";
      const useNowActive =
        state.settings.provider === "ollama" &&
        state.settings.model === model.id &&
        state.settings.operatingMode === currentBoundary &&
        state.settings.localRuntime === preferredRuntime;
      const activate = actionButton(
        useNowActive
          ? "Active"
          : currentBoundary === "online"
            ? "Use with company"
            : currentBoundary === "personal"
              ? "Use in personal workspace"
              : "Use local-only",
        "primary"
      );
      activate.disabled = useNowActive;
      activate.title = currentBoundary === "offline"
        ? `Select ${model.modelDisplayName || model.id}, switch Intelligence to AMOS Local, and use local-only mode`
        : `Select ${model.modelDisplayName || model.id} and switch Intelligence to AMOS Local without changing your ${currentBoundary === "online" ? "company" : "personal workspace"} boundary`;
      activate.addEventListener("click", () => activateLocalModel(model.id, currentBoundary, preferredRuntime));
      const remove = actionButton("Remove", "danger");
      remove.disabled = active;
      remove.addEventListener("click", () => removeOfflineModel(model.id));
      actions.append(activate);
      if (currentBoundary !== "offline") {
        const offline = actionButton(active ? "Active local-only" : "Use local-only", "secondary");
        offline.disabled = active;
        offline.title = `Select ${model.modelDisplayName || model.id}, switch Intelligence to AMOS Local, and disable company and public-network tools`;
        offline.addEventListener("click", () => activateLocalModel(model.id, "offline", preferredRuntime));
        actions.append(offline);
      }
      if (mtplxEligible) {
        const mtplxActive =
          state.settings.provider === "ollama" &&
          state.settings.model === model.id &&
          state.settings.operatingMode === currentBoundary &&
          state.settings.localRuntime === "mtplx";
        const runtimeChoice = actionButton(
          mtplxActive ? "Use Ollama instead" : "Use MTPLX Preview",
          "secondary"
        );
        runtimeChoice.disabled = !mtplxActive && !accelerator.available;
        runtimeChoice.title = mtplxActive
          ? "Switch this model to the qualified Ollama runtime"
          : accelerator.status === "failed"
            ? accelerator.error || "MTPLX failed and AMOS used Ollama"
            : accelerator.available
              ? "Use native multi-token prediction, persistent prompt sessions, and automatic Ollama fallback"
              : accelerator.error || "Install the MTPLX runtime and optimized Qwen artifact first";
        runtimeChoice.addEventListener("click", () => activateLocalModel(
          model.id,
          currentBoundary,
          mtplxActive ? "ollama" : "mtplx"
        ));
        actions.append(runtimeChoice);
      }
      actions.append(remove);
    }
    card.append(actions);
    elements.offlineModelList.append(card);
  }
  renderHybridRouting();
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
  elements.apiKeyHelp.textContent = selectedProviderHasStoredCredential()
    ? "A credential is stored securely for this provider. Leave blank to keep it."
    : (defaults.credential || "Provider credential");
  renderProviderFields(defaults.model || "");
  renderHybridRouting();
}

function selectedProviderHasStoredCredential() {
  return Boolean(
    (state?.settings?.provider === selectedProvider && state.settings.hasApiKey) ||
    state?.settings?.storedCredentialProviders?.includes(selectedProvider)
  );
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
  const managedTitle = elements.managedConnectionCallout.querySelector("strong");
  const managedBody = elements.managedConnectionCallout.querySelector("span");
  if (managedTitle && managedBody) {
    if (state.mode?.personal && !state.connected) {
      managedTitle.textContent = "AMOS Intelligence needs a sign-in";
      managedBody.textContent =
        "Choose a local profile or your own key for My workspace. Hosted auto is available after Northwind or My company.";
    } else {
      managedTitle.textContent = "Create or connect your AMOS account";
      managedBody.textContent =
        "AMOS Hosted includes managed intelligence, but it needs an account to protect your credits and company access. You can create one in the browser, then return here automatically.";
    }
  }
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
  renderBedrockRetentionControl(provider, model);
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

function renderBedrockRetentionControl(provider, model) {
  const required = provider?.id === "bedrock" &&
    model?.dataRetention?.requiredMode === "provider_data_share";
  elements.bedrockRetentionField.classList.toggle("hidden", !required);
  if (!required) {
    elements.bedrockRetentionConsent.checked = false;
    elements.bedrockRetentionButton.disabled = true;
    elements.bedrockRetentionStatus.textContent = "AMOS will never enable this automatically.";
  }
}

async function configureBedrockDataRetention() {
  if (!elements.bedrockRetentionConsent.checked) return;
  setButtonBusy(elements.bedrockRetentionButton, true, "Enabling…");
  elements.settingsError.classList.add("hidden");
  try {
    await persistSettings();
    const result = await api.configureBedrockDataRetention({ confirmed: true });
    elements.bedrockRetentionStatus.textContent = result.message;
    elements.bedrockRetentionConsent.checked = false;
    toast(result.message);
  } catch (error) {
    const message = friendlyError(error);
    elements.settingsError.textContent = message;
    elements.settingsError.classList.remove("hidden");
    elements.bedrockRetentionStatus.textContent = message;
  } finally {
    setButtonBusy(elements.bedrockRetentionButton, false, "Enable provider data sharing");
    elements.bedrockRetentionButton.disabled = !elements.bedrockRetentionConsent.checked;
  }
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
    if (state?.connectionMode === "user" && state?.accountStatus?.workspaceActive === true) {
      elements.connectButton.disabled = true;
    }
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

async function completeOnboarding() {
  const boundary = onboardingBoundaryFromState(state);
  setButtonBusy(elements.enterButton, true, "Entering…");
  try {
    state = await api.completeOnboarding({ boundary });
    render();
    showView("operator");
  } finally {
    setButtonBusy(elements.enterButton, false, onboardingEnterLabel());
  }
}

function onboardingBoundaryFromState(current) {
  if (current?.connectionMode === "demo") return "northwind";
  if (current?.mode?.personal || current?.mode?.offline) return "personal";
  if (current?.connected) return "company";
  return current?.settings?.onboardingBoundary || "";
}

async function chooseOnboardingDoor(door) {
  onboardingDoor = door;
  renderOnboardingPicker();
  if (door === "hosted") {
    await chooseHostedIntelligence();
    return;
  }
  const button = door === "byok" ? elements.onboardByokButton : elements.localModeButton;
  setButtonBusy(button, true, "Preparing…");
  try {
    state = await api.startPersonal();
    if (door === "local") {
      if (!state.offline) state.offline = await api.refreshOffline();
      await activateRecommendedOnboardingLocal();
    }
    render();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false, door === "byok" ? "Bring my own key" : "AMOS Local");
  }
}

async function chooseHostedIntelligence() {
  onboardingDoor = "hosted";
  setButtonBusy(elements.onboardHostedButton, true, "Selecting…");
  try {
    state = await api.saveSettings({
      provider: "amos-hosted",
      model: "auto",
      baseUrl: "",
      intelligenceProfile: "auto",
      reasoningEffort: "",
      operatingMode: "online"
    });
    selectedProvider = "amos-hosted";
    render();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.onboardHostedButton, false, "AMOS Intelligence");
  }
}

function recommendedOnboardingLocalModel() {
  const models = state.offline?.models || [];
  return models.find((model) => model.recommended) ||
    models.find((model) =>
      model.installed && ["qualified", "conditional"].includes(model.qualification?.status)
    ) ||
    null;
}

function preferredOnboardingLocalRuntime(model) {
  const accelerator = state.offline?.accelerator || null;
  return accelerator?.sourceModelId === model?.id && accelerator.available ? "mtplx" : "ollama";
}

async function activateRecommendedOnboardingLocal() {
  const recommended = recommendedOnboardingLocalModel();
  if (!recommended?.installed) return;
  state = await api.activateLocalModel(
    recommended.id,
    "personal",
    preferredOnboardingLocalRuntime(recommended)
  );
  selectedProvider = "ollama";
}

function byokOnboardingOptions() {
  const allowed = new Set(["anthropic", "openai", "xai", "kimi"]);
  const options = [];
  for (const provider of state.providers || []) {
    if (!allowed.has(provider.id)) continue;
    const models = Array.isArray(provider.models) && provider.models.length > 0
      ? provider.models
      : [{ id: provider.defaultModel, label: provider.defaultModel }];
    for (const model of models) {
      options.push({
        value: `${provider.id}::${model.id}`,
        label: `${model.label || model.id} · ${provider.displayName}`
      });
    }
  }
  return options;
}

function renderOnboardingPicker() {
  const select = elements.onboardingModelSelect;
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  select.disabled = false;
  elements.onboardingKeyField.classList.toggle("hidden", onboardingDoor !== "byok");
  if (onboardingDoor === "hosted") {
    elements.onboardingPickerLabel.textContent = "Model";
    select.append(option("hosted", "AMOS Intelligence · Hosted"));
    select.value = "hosted";
    select.disabled = true;
    elements.onboardingProviderText.textContent = "AMOS Hosted is selected. Connect Platform later if you want company systems.";
    return;
  }
  if (onboardingDoor === "local") {
    elements.onboardingPickerLabel.textContent = "Local model";
    const models = state.offline?.models || [];
    const recommended = recommendedOnboardingLocalModel();
    const activeId = state.settings.provider === "ollama"
      ? state.settings.model
      : recommended?.id;
    if (models.length === 0) {
      select.append(option("", "Preparing local models…"));
      select.disabled = true;
      elements.onboardingProviderText.textContent = "AMOS Local is preparing model choices for this computer.";
      return;
    }
    for (const model of models) {
      const suffix = model.recommended
        ? " · recommended"
        : model.installed
          ? ""
          : " · install needed";
      select.append(option(model.id, `${model.name}${suffix}`));
    }
    select.value = models.some((model) => model.id === activeId)
      ? activeId
      : models.some((model) => model.id === previous)
        ? previous
        : recommended?.id || models[0].id;
    elements.onboardingProviderText.textContent = "The recommended local model is selected. Change it here without leaving setup.";
    return;
  }
  elements.onboardingPickerLabel.textContent = "Model";
  const options = byokOnboardingOptions();
  const current = `${state.settings.provider}::${state.settings.model}`;
  for (const item of options) select.append(option(item.value, item.label));
  select.value = options.some((item) => item.value === current)
    ? current
    : options.some((item) => item.value === previous)
      ? previous
      : options[0]?.value || "";
  elements.onboardingProviderText.textContent = "Choose a model, then enter its API key. Stay on this screen.";
}

async function commitOnboardingPicker() {
  if (onboardingDoor === "hosted") return;
  if (onboardingDoor === "local") {
    const model = (state.offline?.models || []).find((item) =>
      item.id === elements.onboardingModelSelect.value
    );
    if (model) await chooseOnboardingLocalModel(model);
    return;
  }
  const [providerId, modelId] = String(elements.onboardingModelSelect.value || "").split("::");
  const apiKey = elements.onboardingByokKey.value.trim();
  if (!providerId || !modelId || !apiKey) return;
  const provider = (state.providers || []).find((item) => item.id === providerId);
  const defaults = providerDefaults[providerId] || {};
  try {
    if (!state.mode?.personal) state = await api.startPersonal();
    state = await api.saveSettings({
      provider: providerId,
      model: modelId,
      baseUrl: provider?.defaultBaseUrl || defaults.baseUrl || "",
      apiKey,
      operatingMode: "personal"
    });
    selectedProvider = providerId;
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function chooseOnboardingLocalModel(model) {
  try {
    if (!model.installed) {
      await api.installOfflineModel(model.id);
      toast(`Installing ${model.name}…`);
      return;
    }
    if (!state.mode?.personal) state = await api.startPersonal();
    state = await api.activateLocalModel(
      model.id,
      "personal",
      preferredOnboardingLocalRuntime(model)
    );
    selectedProvider = "ollama";
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function startDemo() {
  setButtonBusy(elements.demoModeButton, true, "Opening demo…");
  try {
    state = await api.startDemo();
    selectedProvider = state.settings.provider;
    toast("Northwind Labs is connected. Stay here to choose intelligence, then enter.");
    render();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.demoModeButton, false, "Explore the Northwind demo");
    if (state?.connectionMode === "demo") elements.demoModeButton.disabled = true;
  }
}

async function useDemoHostedIntelligence() {
  setButtonBusy(elements.demoHostedIntelligenceButton, true, "Selecting…");
  try {
    state = await api.saveSettings({
      provider: "amos-hosted",
      model: "auto",
      baseUrl: "",
      intelligenceProfile: "auto",
      reasoningEffort: "",
      operatingMode: "online"
    });
    selectedProvider = "amos-hosted";
    render();
    toast("AMOS Intelligence will power this Northwind demo.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.demoHostedIntelligenceButton, false, "AMOS Intelligence");
  }
}

function openDemoIntelligenceSettings(providerId = "") {
  const current = state.settings.provider;
  const target = providerId === "openai" && !["amos-hosted", "ollama"].includes(current)
    ? current
    : providerId || current;
  selectedProvider = target;
  showView("settings");
  renderSettings();
  selectProvider(target);
  elements.advancedInfrastructureDetails.open = target !== "amos-hosted";
  requestAnimationFrame(() => {
    const destination = target === "ollama" ? elements.offlineIntelligenceCard : elements.providerCards;
    destination?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  });
}

async function leaveDemo() {
  setButtonBusy(elements.demoLeaveButton, true, "Leaving…");
  try {
    state = await api.logout();
    selectedProvider = state.settings.provider;
    resetSessionView();
    render();
    showView("operator");
    toast("Northwind was closed. Choose the experience you want to use next.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(elements.demoLeaveButton, false, "Leave demo");
  }
}

async function disconnectAmos() {
  try {
    state = await api.logout();
    closeAccountMenu();
    if (state.accounts?.currentAccountId) {
      toast(`Signed out. Switched to ${state.identity?.user?.name || activeCompanyName()}.`);
    } else {
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

function workspaceFolderName(path) {
  const parts = String(path || "").split(/[/\\]/).filter(Boolean);
  return parts.at(-1) || String(path || "");
}

async function chooseWorkspace() {
  const buttons = [elements.onboardingWorkspaceButton, elements.workspaceButton];
  for (const button of buttons) button.disabled = true;
  try {
    const previousWorkspace = state.settings.workspace;
    state = await api.chooseWorkspace();
    render();
    if (state.settings.workspace && state.settings.workspace !== previousWorkspace) {
      toast("Project folder selected. New tasks will use this workspace; local auto-approve is off.");
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    for (const button of buttons) button.disabled = false;
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
    const taskGrantActive = state.localTaskGrant?.active === true &&
      state.localTaskGrant?.scope?.workspace === state.settings.workspace;
    state = taskGrantActive && !enabled
      ? await api.clearTaskLocalWork()
      : await api.setLocalApprovalMode(enabled ? "ask" : "workspace");
    render();
    const nowEnabled = state.settings.localApprovalMode === "workspace" &&
      state.settings.localApprovalWorkspace === state.settings.workspace;
    toast(nowEnabled
      ? "Local auto-approve is on for this folder. Company approvals remain governed."
      : taskGrantActive
        ? "Task-scoped local work is off. AMOS will ask before local changes."
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
    showView("settings");
  } catch (error) {
    elements.settingsError.textContent = error.message;
    elements.settingsError.classList.remove("hidden");
  }
}

function telemetryPreferenceLabel(value) {
  if (value === true) {
    return "Thanks — anonymous product signals are helping us improve AMOS. Prompts, responses, files, and company data are never included.";
  }
  if (value === false) {
    return "Not now. No product usage events leave this computer. You can change this anytime in Settings.";
  }
  return "Share anonymous product signals so we can find broken flows and improve Desktop faster. We never send prompts, responses, files, company data, credentials, or tokens. Change this anytime in Settings.";
}

function renderTelemetryPreference() {
  const value = state?.settings?.telemetryEnabled;
  const pending = value !== true && value !== false;
  elements.telemetryConsentText.textContent = telemetryPreferenceLabel(value);
  elements.telemetryAllowButton.setAttribute("aria-pressed", String(value === true));
  elements.telemetryDeclineButton.setAttribute("aria-pressed", String(value === false));
  elements.telemetryConsent.classList.toggle("hidden", !pending);
  if (pending && elements.onboardingView.classList.contains("hidden")) {
    elements.operatorView.prepend(elements.telemetryConsent);
  } else if (pending && elements.enterButton) {
    elements.enterButton.before(elements.telemetryConsent);
  }
  if (document.activeElement !== elements.telemetryInput) {
    elements.telemetryInput.value = value === true ? "true" : value === false ? "false" : "";
  }
}

async function setTelemetryPreference(enabled) {
  try {
    const result = await api.setTelemetryPreference({ enabled });
    if (state?.settings) state.settings.telemetryEnabled = result.telemetryEnabled;
    renderTelemetryPreference();
    toast(enabled
      ? "Thanks — anonymous product signals will help us improve AMOS."
      : "No product usage events will be sent.");
  } catch (error) {
    toast(error.message, true);
    renderTelemetryPreference();
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
    intelligenceRoles: collectIntelligenceRoles(),
    hybridRouting: collectHybridRouting(),
    reasoningEffort: managed
      ? ""
      : elements.reasoningInput.value,
    operatingMode: elements.operatingModeInput.value,
    researchCheckpointMinutes: 0,
    autonomousCheckpointMinutes: Number(elements.autonomousCheckpointInput.value),
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

async function activateLocalModel(modelId, operatingMode, localRuntime = "auto") {
  try {
    const modelName = state.offline?.models?.find((model) => model.id === modelId)?.modelDisplayName || modelId;
    state = await api.activateLocalModel(modelId, operatingMode, localRuntime);
    selectedProvider = state.settings.provider;
    const selectedRuntime = state.offline?.accelerator?.status === "ready" && localRuntime === "mtplx"
      ? "MTPLX Preview"
      : "AMOS Local";
    toast(operatingMode === "offline"
      ? `${modelName} is active in local-only mode through ${selectedRuntime}.`
      : `${modelName} is active through ${selectedRuntime}.`);
    render();
    if (!firstRunNeeded()) showView("settings");
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
  showIntelligenceTestStatus(
    "testing",
    needsManagedConnection ? "Waiting for AMOS sign-in…" : "Testing intelligence…",
    needsManagedConnection
      ? "Finish the browser connection and AMOS will run the test automatically."
      : `Sending a bounded connection test to ${selectedIntelligenceLabel()}.`
  );
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
    showIntelligenceTestStatus(
      "success",
      `${providerStatusLabel()} is connected`,
      `Verified just now. ${result.message || "AMOS intelligence ready."}`
    );
    toast(result.message || "Intelligence is ready.");
  } catch (error) {
    const message = needsManagedConnection
      ? `AMOS account connection did not finish. ${friendlyError(error)}`
      : friendlyError(error);
    elements.settingsError.textContent = message;
    elements.settingsError.classList.remove("hidden");
    showIntelligenceTestStatus(
      "error",
      "Intelligence test failed",
      message
    );
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

function selectedIntelligenceLabel() {
  const provider = state?.providers?.find((item) => item.id === selectedProvider);
  if (selectedProvider === "amos-hosted") return "AMOS Intelligence";
  const model = selectedProvider === "ollama"
    ? state?.offline?.models?.find((item) => item.id === state?.settings?.model)?.modelDisplayName
    : elements.modelInput.value || elements.customModelInput.value;
  return [provider?.label || selectedProvider, model].filter(Boolean).join(" · ");
}

function showIntelligenceTestStatus(status, title, detail) {
  elements.intelligenceTestStatus.className = `intelligence-test-status ${status}`;
  elements.intelligenceTestStatus.classList.remove("hidden");
  elements.intelligenceTestIcon.textContent = status === "success" ? "✓" : status === "error" ? "!" : "…";
  elements.intelligenceTestTitle.textContent = title;
  elements.intelligenceTestDetail.textContent = detail;
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

async function runTask(event, options = {}) {
  event?.preventDefault?.();
  const automaticResume = options.automaticResume === true;
  const privateAction = options.privateAction === true;
  const usesPrivatePrompt = automaticResume || privateAction;
  const prompt = usesPrivatePrompt
    ? String(options.prompt || "").trim()
    : elements.promptInput.value.trim();
  const resumeTaskId = automaticResume
    ? String(options.resumeTaskId || "").trim()
    : null;
  if (running) {
    if (usesPrivatePrompt) {
      throw new Error("Finish or stop the current run before starting this action");
    }
    if (!prompt) return;
    await steerTask(prompt);
    return;
  }
  if (!prompt && attachments.length === 0) return;
  const uiRunToken = ++activeUiRunToken;
  const submittedTask = {
    taskRecordId: String(state?.activeTaskRecordId || state?.tasks?.activeTaskId || ""),
    contextKey: String(state?.activeContextKey || "active")
  };
  const isStillVisible = () => (
    uiRunToken === activeUiRunToken && eventMatchesActiveTask(submittedTask)
  );
  const attachmentSummary = attachments.length > 0
    ? `\n\nAttached: ${attachments.map((item) => item.name).join(", ")}`
    : "";
  if (!automaticResume) {
    const visibleRequest = privateAction
      ? String(options.displayText || "Run quick action").trim()
      : prompt || "Review the attached material.";
    addMessage("user", `${visibleRequest}${attachmentSummary}`);
  }
  elements.promptInput.value = "";
  clearTransientTaskMessages();
  beginInlineActivity();
  const pending = addMessage(
    "pending",
    automaticResume
      ? "AMOS is revalidating current context and continuing only the work that remains…"
      : privateAction
        ? "AMOS is starting that request…"
        : "AMOS is starting…"
  );
  transientTaskMessages.add(pending);
  streamingMessage = pending;
  setInlineLiveStatus(
    automaticResume
      ? "Revalidating context…"
      : privateAction
        ? "Starting that request…"
        : "Starting…"
  );
  setRunning(true);

  try {
    const submitted = [...attachments];
    const result = await api.run({
      text: prompt,
      resumeTaskId,
      attachments: submitted.map((item) => ({ id: item.id, retention: item.retention }))
    });
    if (!submittedTask.taskRecordId && result.taskRecordId) {
      state.activeTaskRecordId = result.taskRecordId;
      state.activeContextKey = result.contextKey || state.activeContextKey;
      submittedTask.taskRecordId = result.taskRecordId;
      submittedTask.contextKey = result.contextKey || submittedTask.contextKey;
      const materialized = await api.state().catch(() => null);
      state.tasks = materialized?.tasks || state.tasks;
      state.conversationCapabilities = materialized?.conversationCapabilities || state.conversationCapabilities;
      state.sessionContinuity = materialized?.sessionContinuity || state.sessionContinuity;
    }
    if (!isStillVisible() || !eventMatchesActiveTask(result)) {
      toast("A background run completed. Open its Conversation or Project to review the result.");
      return;
    }
    streamingMessage = null;
    clearTransientTaskMessages();
    addMessage("assistant", result.answer, { eventId: result.taskEventId });
    if (result.interrupted) {
      runTerminalState = "interrupted";
      toast("The model timed out after making progress. Completed work is intact; continue here to verify and finish the remainder.", true);
    } else {
      runTerminalState = "completed";
    }
    renderGovernedUiActions();
    state.activity = result.activity;
    state.canvases = result.canvases || state.canvases;
    state.activeCanvasId = result.activeCanvasId || state.activeCanvasId;
    activeCanvasId = state.activeCanvasId || activeCanvasId;
    if (activeCanvasId) {
      canvasSidecarOpen = true;
      currentPanelTab = "canvas";
    }
    state.privateMemory = result.privateMemory || state.privateMemory;
    state.offlineProposals = result.offlineProposals || state.offlineProposals;
    renderHistory();
    renderCanvas();
    renderPrivateMemory();
    renderDecisions();
    const submittedIds = new Set(submitted.map((attachment) => attachment.id));
    for (const attachment of submitted) {
      await api.removeAttachment(attachment.id);
    }
    updateAttachments((result.attachments || []).filter((attachment) => !submittedIds.has(attachment.id)));
    const failures = (result.memory || []).filter((item) => item.status === "failed");
    if (failures.length > 0) {
      toast(`Task completed, but ${failures.length} item${failures.length === 1 ? "" : "s"} could not be added to company memory.`, true);
    }
  } catch (error) {
    runTerminalState = error?.code === "AMOS_TASK_CANCELED" || /task canceled/i.test(error.message)
      ? "interrupted"
      : "failed";
    if (!isStillVisible()) {
      toast(`A background task stopped: ${error.message}`, true);
      return;
    }
    streamingMessage = null;
    clearTransientTaskMessages();
    addMessage(
      "error",
      error?.code === "AMOS_TASK_CANCELED" || /task canceled/i.test(error.message)
        ? "Run stopped safely. Its encrypted checkpoint is available under Conversations if you want to revalidate and continue."
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
      state.activeContextKey = latest.activeContextKey || state.activeContextKey;
      state.conversationCapabilities = latest.conversationCapabilities || state.conversationCapabilities;
      state.sessionContinuity = latest.sessionContinuity || state.sessionContinuity;
      renderPrivateMemory();
      renderDecisions();
      renderHistory();
      renderTasks();
      renderConversationActions();
      renderStarterActions();
    } catch {
      // Task completion must not be masked if a local memory refresh fails.
    }
    if (isStillVisible()) setRunning(false);
  }
}

async function steerTask(direction) {
  elements.runButton.disabled = true;
  try {
    const result = await api.steerTask(currentTaskId, direction);
    if (result.resolvedInput) {
      addMessage("user", direction);
      elements.promptInput.value = "";
      decisionInputDrafts.delete(result.inputId);
      if (state) {
        state.pendingInputs = (Array.isArray(state.pendingInputs) ? state.pendingInputs : [])
          .filter((item) => item.id !== result.inputId);
      }
      removeInlineDecisionRequest(result.inputId);
      renderDecisions();
      clearTransientTaskMessages();
      const pending = addMessage("pending", "AMOS received your answer and is continuing now…");
      transientTaskMessages.add(pending);
      streamingMessage = pending;
      setInlineLiveStatus("Using your answer and continuing…");
      updateChatRunStatus("Using your answer and continuing…", "active");
      elements.promptInput.focus();
      return;
    }
    if (!result.queued) {
      toast(result.message || "AMOS could not queue that direction.", true);
      return;
    }
    addMessage("user", direction);
    elements.promptInput.value = "";
    const pending = addMessage("pending", "AMOS is applying your new direction at the next safe boundary…");
    transientTaskMessages.add(pending);
    streamingMessage = pending;
    setInlineLiveStatus("Applying your direction…");
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
  hideInlineThoughtSnippet();
}

async function cancelTask() {
  if (!running) return;
  elements.cancelButton.disabled = true;
  elements.cancelButton.textContent = "Stopping…";
  try {
    const result = await api.cancelTask(currentTaskId);
    if (!result.canceled) toast(result.message || "No task is running.");
    else if (result.detached) finishCanceledRunInUi(result.taskId);
  } catch (error) {
    toast(error.message, true);
  }
}

function finishCanceledRunInUi(canceledRunId = "") {
  if (runTerminalState === "interrupted" && !running) return;
  activeUiRunToken += 1;
  runTerminalState = "interrupted";
  currentTaskId = null;
  streamingMessage = null;
  clearTransientTaskMessages();
  const pendingInputs = Array.isArray(state?.pendingInputs) ? state.pendingInputs : [];
  const canceledInputs = pendingInputs.filter((request) => (
    !canceledRunId || !request.runId || request.runId === canceledRunId
  ));
  for (const request of canceledInputs) {
    decisionInputDrafts.delete(request.id);
    removeInlineDecisionRequest(request.id);
  }
  if (state) {
    const canceledIds = new Set(canceledInputs.map((request) => request.id));
    state.pendingInputs = pendingInputs.filter((request) => !canceledIds.has(request.id));
  }
  addMessage(
    "assistant",
    "Run stopped. Completed work remains intact, and AMOS is ready for your next message without restarting the app."
  );
  renderDecisions();
  setRunning(false);
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
  continuityConversationRestored = false;
  state.sessionContinuity = null;
  state.workingContinuity = null;
  state.canvases = [];
  state.activeCanvasId = null;
  activeCanvasId = null;
  updateAttachments([]);
  const welcome = elements.messages.querySelector(".welcome-message");
  const starters = elements.messages.querySelector(".starter-actions");
  clearInlineApproval();
  elements.messages.replaceChildren();
  if (welcome) elements.messages.append(welcome);
  if (starters) elements.messages.append(starters);
  elements.liveEvents.replaceChildren();
  elements.chatRunStatus.classList.add("hidden");
  elements.panelActivityCount.textContent = "0";
  pendingUiActions = [];
  pendingGenericConnectCalls = 0;
  canvasSidecarOpen = false;
  panelUserClosed = false;
  currentPanelTab = "activity";
  runTerminalState = "idle";
  setPanelBadge("");
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
    const actions = document.createElement("div");
    actions.className = "message-task-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "message-copy-button";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      try {
        await api.copyText(content);
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1_500);
      } catch (error) {
        toast(error.message, true);
      } finally {
        copy.disabled = false;
      }
    });
    actions.append(copy);
    const task = activeDurableTask();
    if (eventId && task) {
      const fork = document.createElement("button");
      fork.type = "button";
      fork.className = "message-fork-button";
      fork.textContent = "Fork from here";
      fork.addEventListener("click", () => openTaskForkModal(task, eventId));
      actions.append(fork);
    }
    message.append(actions);
  } else {
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    message.append(paragraph);
  }
  const anchor = elements.chatRunStatus;
  if (anchor?.parentNode === elements.messages) elements.messages.insertBefore(message, anchor);
  else elements.messages.append(message);
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

function conversationForkCapabilityMessage(capability = {}) {
  if (capability.canFork) {
    return "Create a governed branch from the latest persisted conversation milestone";
  }
  if (capability.reason === "archived") return "Restore this conversation before forking it";
  if (capability.reason === "no_persisted_milestone") {
    return "Complete the first exchange before forking this conversation";
  }
  return "Start a conversation before creating a fork";
}

function eventMatchesActiveTask(value = {}) {
  const runId = String(value?.runId || "");
  if (runId && currentTaskId && runId === currentTaskId) return true;
  const taskRecordId = String(value?.taskRecordId || "");
  const contextKey = String(value?.contextKey || "");
  if (!taskRecordId && !contextKey) return true;
  const activeTaskId = String(state?.activeTaskRecordId || state?.tasks?.activeTaskId || "");
  const activeContext = String(state?.activeContextKey || "active");
  return Boolean(
    (taskRecordId && (taskRecordId === activeTaskId || (!activeTaskId && taskRecordId === activeContext))) ||
    (contextKey && contextKey === activeContext)
  );
}

function captureInteractiveState() {
  const active = document.activeElement;
  const editable = active?.matches?.("input, textarea, select") ? active : null;
  const requestId = editable?.closest?.("[data-input-id]")?.dataset?.inputId || "";
  return {
    openModalIds: [...document.querySelectorAll(".modal-backdrop:not(.hidden)")]
      .map((modal) => modal.id)
      .filter(Boolean),
    control: editable ? {
      id: editable.id || "",
      requestId,
      tagName: editable.tagName,
      type: editable.type || "",
      name: editable.name || "",
      value: editable.value,
      checked: editable.checked,
      selectionStart: editable.selectionStart,
      selectionEnd: editable.selectionEnd
    } : null
  };
}

function restoreInteractiveState(snapshot) {
  if (!snapshot) return;
  for (const id of snapshot.openModalIds || []) {
    document.getElementById(id)?.classList.remove("hidden");
  }
  const saved = snapshot.control;
  if (!saved) return;
  let control = saved.id ? document.getElementById(saved.id) : null;
  if (!control && saved.requestId) {
    const card = [...document.querySelectorAll("[data-input-id]")]
      .find((item) => item.dataset.inputId === saved.requestId);
    control = [...(card?.querySelectorAll("input, textarea, select") || [])]
      .find((item) => (
        item.tagName === saved.tagName &&
        (!saved.name || item.name === saved.name)
      )) || null;
  }
  if (!control) return;
  if (["checkbox", "radio"].includes(saved.type)) control.checked = saved.checked;
  else control.value = saved.value;
  control.focus({ preventScroll: true });
  if (
    typeof control.setSelectionRange === "function" &&
    Number.isInteger(saved.selectionStart) &&
    Number.isInteger(saved.selectionEnd)
  ) {
    control.setSelectionRange(saved.selectionStart, saved.selectionEnd);
  }
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
  runTerminalState = "running";
  currentPanelTab = "activity";
  elements.liveEvents.replaceChildren();
  elements.panelActivityCount.textContent = "0";
  elements.activityStreamTitle.textContent = "Live activity";
  elements.runningIndicator.textContent = "Starting…";
  elements.runningIndicator.classList.add("active");
  updateChatRunStatus("Preparing the task…", "active");
  setPanelBadge("working");
  renderCanvas();
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function finishInlineActivity(status = runTerminalState) {
  const count = elements.liveEvents.querySelectorAll(".event-card").length;
  const failed = status === "failed";
  const interrupted = status === "interrupted";
  elements.activityStreamTitle.textContent = failed
    ? "Run stopped"
    : interrupted
      ? "Run interrupted"
      : "Activity";
  elements.runningIndicator.textContent = `${count} recorded event${count === 1 ? "" : "s"}`;
  elements.runningIndicator.classList.remove("active");
  updateChatRunStatus(
    failed
      ? `Run stopped · ${count} recorded event${count === 1 ? "" : "s"}`
      : interrupted
        ? `Run interrupted safely · ${count} recorded event${count === 1 ? "" : "s"}`
        : `Completed · ${count} recorded event${count === 1 ? "" : "s"}`,
    failed ? "failed" : "completed"
  );
  setPanelBadge(failed ? "error" : activeCanvasId ? "artifact" : "");
}

function updateStreamingDraft(text) {
  if (!ensureStreamingMessage()) return;
  streamingMessage.className = "message assistant streaming live-run";
  hideInlinePlaceholder();
  hideInlineThoughtSnippet();
  let markdown = streamingMessage.querySelector(".markdown-content");
  if (!markdown) {
    markdown = document.createElement("div");
    markdown.className = "markdown-content";
    streamingMessage.append(markdown);
  }
  renderMarkdown(markdown, text);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function updateStreamingThought(text) {
  pendingThoughtText = String(text || "");
  const now = Date.now();
  if (now - lastThoughtPaintAt < 80 && pendingThoughtText.length > 0) {
    if (!thoughtPaintTimer) {
      thoughtPaintTimer = setTimeout(() => {
        thoughtPaintTimer = null;
        paintStreamingThought(pendingThoughtText);
      }, 80);
    }
    return;
  }
  paintStreamingThought(pendingThoughtText);
}

function paintStreamingThought(text) {
  if (!text || !ensureStreamingMessage()) return;
  lastThoughtPaintAt = Date.now();
  hideInlinePlaceholder();
  streamingMessage.classList.add("live-run", "streaming");
  const liveStatus = streamingMessage.querySelector(".message-live-status");
  if (liveStatus) liveStatus.classList.add("hidden");
  const collapsed = collapseThoughtStream(text);
  let thought = streamingMessage.querySelector(".message-thought");
  if (!thought) {
    thought = document.createElement("div");
    thought.className = "message-thought";
    const header = document.createElement("button");
    header.type = "button";
    header.className = "message-thought-toggle";
    const dots = document.createElement("span");
    dots.className = "message-live-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) dots.append(document.createElement("i"));
    const label = document.createElement("span");
    label.className = "message-thought-label";
    label.textContent = "Thinking";
    const expand = document.createElement("span");
    expand.className = "message-thought-expand";
    expand.textContent = "Expand";
    header.append(dots, label, expand);
    header.addEventListener("click", () => {
      const open = thought.classList.toggle("expanded");
      expand.textContent = open ? "Show less" : "Expand";
      header.setAttribute("aria-expanded", open ? "true" : "false");
      scrollThoughtStream(thought);
    });
    const stream = document.createElement("div");
    stream.className = "message-thought-stream";
    const body = document.createElement("p");
    body.className = "message-thought-body";
    stream.append(body);
    thought.append(header, stream);
    streamingMessage.prepend(thought);
  }
  thought.querySelector(".message-thought-body").textContent = collapsed;
  const snippet = thoughtTickerSnippet(collapsed);
  if (elements.chatRunThoughtSnippet) {
    elements.chatRunThoughtSnippet.textContent = snippet;
    elements.chatRunThoughtSnippet.classList.toggle("hidden", !snippet);
  }
  requestAnimationFrame(() => scrollThoughtStream(thought));
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function collapseThoughtStream(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  const normalize = (value) => value.replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim();
  return lines.reduce((merged, line) => {
    if (!merged) return line;
    const previous = normalize(merged);
    const next = normalize(line);
    if (next.startsWith(previous) || previous.startsWith(next)) {
      return next.length >= previous.length ? line : merged;
    }
    return merged + line;
  }, "");
}

function thoughtTickerSnippet(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 140 ? compact.slice(-140) : compact;
}

function scrollThoughtStream(thought) {
  const stream = thought?.querySelector(".message-thought-stream");
  if (!stream) return;
  if (thought.classList.contains("expanded")) stream.scrollTop = stream.scrollHeight;
  else stream.scrollLeft = stream.scrollWidth;
}

function hideInlineThoughtSnippet() {
  streamingMessage?.querySelector(".message-thought")?.remove();
  if (elements.chatRunThoughtSnippet) {
    elements.chatRunThoughtSnippet.textContent = "";
    elements.chatRunThoughtSnippet.classList.add("hidden");
  }
}

function ensureStreamingMessage() {
  if (streamingMessage) return streamingMessage;
  const pending = addMessage("pending", "AMOS is working…");
  transientTaskMessages.add(pending);
  streamingMessage = pending;
  return streamingMessage;
}

function hideInlinePlaceholder() {
  if (!streamingMessage) return;
  for (const paragraph of streamingMessage.querySelectorAll(":scope > p")) {
    if (paragraph.classList.contains("message-live-status")) continue;
    if (paragraph.classList.contains("message-thought-body")) continue;
    paragraph.remove();
  }
}

function setInlineLiveStatus(text) {
  if (!ensureStreamingMessage()) return;
  hideInlinePlaceholder();
  streamingMessage.className = "message pending streaming live-run";
  let status = streamingMessage.querySelector(".message-live-status");
  if (!status) {
    status = document.createElement("p");
    status.className = "message-live-status";
    const dots = document.createElement("span");
    dots.className = "message-live-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) dots.append(document.createElement("i"));
    const label = document.createElement("span");
    label.className = "message-live-status-text";
    status.append(dots, label);
    streamingMessage.prepend(status);
  }
  status.querySelector(".message-live-status-text").textContent = String(text || "AMOS is working…");
}

function appendInlineLiveStep(title, detail) {
  if (!ensureStreamingMessage()) return;
  hideInlinePlaceholder();
  streamingMessage.classList.add("live-run");
  streamingMessage.querySelector(".message-live-status")?.classList.remove("hidden");
  let list = streamingMessage.querySelector(".message-live-steps");
  if (!list) {
    list = document.createElement("ol");
    list.className = "message-live-steps";
    streamingMessage.append(list);
  }
  const label = String(title || "").trim();
  if (!label) return;
  const last = list.querySelector("li:last-child");
  if (last?.dataset.title === label) {
    const meta = last.querySelector("small");
    if (detail && meta) meta.textContent = detail;
    last.classList.add("current");
    for (const item of list.querySelectorAll("li")) {
      if (item !== last) item.classList.remove("current");
    }
    return;
  }
  for (const item of list.querySelectorAll("li")) item.classList.remove("current");
  const item = document.createElement("li");
  item.className = "current";
  item.dataset.title = label;
  const name = document.createElement("span");
  name.textContent = label;
  item.append(name);
  if (detail) {
    const meta = document.createElement("small");
    meta.textContent = detail;
    item.append(meta);
  }
  list.append(item);
  while (list.children.length > INLINE_LIVE_STEP_LIMIT) list.firstChild.remove();
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function updateChatRunStatus(message, status = "active") {
  elements.chatRunStatus.classList.remove("hidden", "active", "waiting", "failed", "completed");
  elements.chatRunStatus.classList.add(status);
  elements.chatRunStatusText.textContent = String(message || "AMOS is working…");
  if (status === "completed" || status === "failed") hideInlineThoughtSnippet();
}

function setPanelBadge(status = "") {
  elements.panelStateBadge.classList.remove("working", "waiting", "error", "artifact");
  elements.panelStateBadge.classList.toggle("hidden", !status);
  if (status) elements.panelStateBadge.classList.add(status);
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
    const channel = event.channel || "text";
    if (channel === "thinking") {
      updateChatRunStatus("Thinking…", "active");
      updateStreamingThought(event.thinking || event.delta || "");
      updateLiveThinkingCard(event.thinking || event.delta || "");
      return;
    }
    if (channel === "tool" && event.toolName) {
      const preparing = `Preparing ${humanizeTool(event.toolName)}…`;
      updateChatRunStatus(preparing, "active");
      setInlineLiveStatus(preparing);
      appendInlineLiveStep(humanizeTool(event.toolName), "Preparing the tool call");
      return;
    }
    updateChatRunStatus("Writing the response…", "active");
    setInlineLiveStatus("Writing the response…");
    updateStreamingDraft(event.text || "");
    return;
  }
  captureGovernedUiActions(event);
  const transientStatus = chatStatusForEvent(event);
  if (transientStatus) {
    updateChatRunStatus(transientStatus.message, transientStatus.status);
    setInlineLiveStatus(transientStatus.message);
  }
  if (event.type === "tool_error") setPanelBadge("error");
  else if (running) setPanelBadge("working");
  if (event.type === "context_compiled") {
    // Compiling context is instantaneous next to the model wait. Keep the
    // conversation on "waiting for the model" instead of appearing stuck.
    return;
  }
  const copy = liveEventCopy(event);
  if (copy.inline) appendInlineLiveStep(copy.title, copy.detail);
  if (copy.skipCard) return;
  const card = document.createElement("div");
  card.className = [
    "event-card",
    event.type === "tool_error" ? "error" : "",
    event.type === "phase" ? "phase" : "",
    event.type === "workflow" ? "workflow" : "",
    event.type === "coding_lifecycle" ? "coding-lifecycle" : "",
    event.type === "usage" ? "usage" : ""
  ].filter(Boolean).join(" ");
  const title = document.createElement("strong");
  title.textContent = copy.title;
  const detail = document.createElement("span");
  detail.textContent = copy.detail;
  card.append(title, detail);
  const thinkingCard = elements.liveEvents.querySelector(".event-card.thinking-live");
  if (thinkingCard) thinkingCard.classList.remove("thinking-live");
  elements.liveEvents.append(card);
  elements.panelActivityCount.textContent = String(
    elements.liveEvents.querySelectorAll(".event-card").length
  );
  trimLiveEvents();
  if (canvasSidecarOpen && currentPanelTab === "activity") {
    elements.activityStream.scrollTop = elements.activityStream.scrollHeight;
  }
}

function liveEventCopy(event) {
  if (event.type === "workflow") {
    return {
      title: event.title || "Plan",
      detail: `${event.steps?.join(" → ") || event.summary || ""}${event.doneWhen ? ` · Done when: ${event.doneWhen}` : ""}`.trim(),
      inline: true
    };
  }
  if (event.type === "coding_lifecycle") {
    return {
      title: `Coding · ${humanizeTool(event.state?.role || event.phase || "workflow")}`,
      detail: event.summary || "",
      inline: true
    };
  }
  if (event.type === "phase") {
    const waitingForModel = /waiting for the model/i.test(event.summary || "");
    return {
      title: waitingForModel ? "Waiting for the model" : humanizeTool(event.phase || "working"),
      detail: event.summary || "",
      inline: true
    };
  }
  if (event.type === "tool_error") {
    return {
      title: humanizeTool(event.name || "tool"),
      detail: event.error || "Tool returned an error",
      inline: true
    };
  }
  if (event.type === "tool_start") {
    return {
      title: humanizeTool(event.name || "tool"),
      detail: liveToolArgSummary(event.args) || "Started",
      inline: true
    };
  }
  if (event.type === "tool_end") {
    return {
      title: humanizeTool(event.name || "tool"),
      detail: "Finished with a recorded result",
      inline: true
    };
  }
  if (event.type === "usage") {
    return {
      title: event.model || event.runtime || "Model turn",
      detail: liveUsageSummary(event),
      inline: false
    };
  }
  if (event.type === "routing") {
    return {
      title: "Routing",
      detail: event.summary || [
        event.selectedProvider,
        event.selectedModel,
        event.minimumClass
      ].filter(Boolean).join(" · "),
      inline: true
    };
  }
  const fallback = event.name || event.title || event.summary || humanizeTool(String(event.type || "event"));
  return {
    title: event.name ? humanizeTool(event.name) : fallback,
    detail: event.summary && event.summary !== fallback ? event.summary : "",
    inline: Boolean(event.summary || event.name)
  };
}

function liveUsageSummary(event) {
  const tokens = Number(event.totalTokens || 0)
    || (Number(event.inputTokens || 0) + Number(event.outputTokens || 0));
  const ms = Number(event.latencyMs || 0);
  const parts = [];
  if (ms > 0) parts.push(ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
  if (tokens > 0) parts.push(`${tokens.toLocaleString()} tokens`);
  if (Number(event.outputTokens || 0) > 0) {
    parts.push(`${Number(event.outputTokens).toLocaleString()} out`);
  }
  if (event.generationTokensPerSecond) {
    parts.push(`${Number(event.generationTokensPerSecond).toFixed(1)} tok/s`);
  }
  return parts.join(" · ") || "Turn usage recorded";
}

function liveToolArgSummary(args) {
  if (!args || typeof args !== "object") return "";
  const skip = new Set(["auth", "token", "secret", "password", "apiKey", "api_key"]);
  const parts = [];
  for (const [key, value] of Object.entries(args)) {
    if (skip.has(key) || value == null || value === "") continue;
    const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
    if (!text) continue;
    parts.push(`${key} ${text.length > 80 ? `${text.slice(0, 77)}…` : text}`);
    if (parts.length >= 2) break;
  }
  return parts.join(" · ");
}

function updateLiveThinkingCard(text) {
  const snippet = String(text || "").trim();
  if (!snippet) return;
  let card = elements.liveEvents.querySelector(".event-card.thinking-live");
  if (!card) {
    card = document.createElement("div");
    card.className = "event-card phase thinking-live";
    card.append(document.createElement("strong"), document.createElement("span"));
    elements.liveEvents.append(card);
    elements.panelActivityCount.textContent = String(
      elements.liveEvents.querySelectorAll(".event-card").length
    );
  }
  card.querySelector("strong").textContent = "Thinking";
  const clipped = snippet.length > 240 ? snippet.slice(-240) : snippet;
  card.querySelector("span").textContent = clipped;
  trimLiveEvents();
}

function chatStatusForEvent(event) {
  if (event.type === "research_checkpoint") {
    if (event.action === "synthesize") {
      return { message: "Direction received — synthesizing the supported answer…", status: "active" };
    }
    return {
      message: event.action === "autonomous"
        ? "Direction received — continuing autonomously…"
        : "Direction received — continuing the research…",
      status: "active"
    };
  }
  if (event.type === "phase") {
    if (event.phase === "waiting") {
      return { message: event.summary || "AMOS needs your input to continue.", status: "waiting" };
    }
    if (["completed", "interrupted", "failed"].includes(event.phase)) return null;
    if (/waiting for the model/i.test(event.summary || "")) {
      return { message: event.summary, status: "active" };
    }
    return { message: event.summary || humanizeTool(event.phase || "Working"), status: "active" };
  }
  if (event.type === "workflow") {
    return { message: event.title || "Planning the work…", status: "active" };
  }
  if (event.type === "tool_start") {
    return { message: `Working with ${humanizeTool(event.name || "the selected tool")}…`, status: "active" };
  }
  if (event.type === "tool_error") {
    return { message: "AMOS encountered a tool issue and is correcting it…", status: "active" };
  }
  if (event.type === "routing") {
    return { message: "Choosing the right intelligence for this step…", status: "active" };
  }
  if (event.type === "context_compiled") {
    return { message: "Context is ready. Waiting for the model…", status: "active" };
  }
  return null;
}

// Default the sidebar stream to the most recent steps. Older cards stay in
// the DOM (hidden) so expand reveals them. The toggle stays at the top so
// new cards cannot bury it.
function trimLiveEvents() {
  const container = elements.liveEvents;
  if (!container) return;
  const cards = Array.from(container.querySelectorAll(".event-card"));
  const expanded = container.classList.contains("expanded");
  const overflow = Math.max(0, cards.length - LIVE_EVENT_VISIBLE_COUNT);
  cards.forEach((card, index) => {
    card.classList.toggle("event-card-trimmed", !expanded && index < overflow);
  });
  let toggle = container.querySelector(".live-events-toggle");
  if (cards.length <= LIVE_EVENT_VISIBLE_COUNT) {
    toggle?.remove();
    return;
  }
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "live-events-toggle";
    toggle.addEventListener("click", () => {
      const nowExpanded = container.classList.toggle("expanded");
      trimLiveEvents();
      if (nowExpanded) {
        container.scrollIntoView({ block: "nearest" });
      } else {
        elements.activityStream.scrollTop = elements.activityStream.scrollHeight;
      }
    });
  }
  container.prepend(toggle);
  toggle.textContent = expanded
    ? `Show latest ${LIVE_EVENT_VISIBLE_COUNT}`
    : `Show ${overflow} earlier event${overflow === 1 ? "" : "s"}`;
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

async function exportEvidencePack() {
  setButtonBusy(elements.exportEvidencePackButton, true, "Exporting…");
  try {
    const result = await api.exportEvidencePack();
    if (result.canceled) return;
    const count = result.summary?.itemCount || 0;
    toast(`Saved a read-only evidence pack with ${count} ${count === 1 ? "item" : "items"}.`);
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    setButtonBusy(elements.exportEvidencePackButton, false, "Export evidence pack…");
  }
}

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
    if (runTerminalState === "idle") runTerminalState = "running";
    elements.activityStreamTitle.textContent = "Live activity";
    if (elements.chatRunStatus.classList.contains("hidden")) {
      updateChatRunStatus("AMOS is working…", "active");
    }
    setPanelBadge("working");
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
    } else if (approved && persistence === "task") {
      state = await api.allowTaskLocalWork();
      if (state.localTaskGrant?.active !== true) {
        toast("Task-scoped local work was not enabled. The current request is still waiting.");
        return;
      }
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
    } else if (persistence === "task") {
      toast("Approved. AMOS can complete bounded local work for this task without asking again.");
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
    elements.activityStreamTitle.textContent = "Live activity";
    elements.runningIndicator.textContent = "Working · steer or stop";
    updateChatRunStatus("Continuing the task…", "active");
    setPanelBadge("working");
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
  if (
    button.classList.contains("start-mode-card") ||
    button.classList.contains("intelligence-choice-card")
  ) {
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
