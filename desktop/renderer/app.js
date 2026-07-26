import { shouldSubmitPrompt } from "../../src/desktop/input.js";

const api = window.amosDesktop;

const providerDefaults = {
  kimi: {
    model: "kimi-k3",
    baseUrl: "https://api.moonshot.ai/v1",
    credential: "Moonshot API key"
  },
  "amos-hosted": {
    model: "kimi-k3",
    baseUrl: "",
    credential: "Uses your AMOS sign-in—no second key"
  },
  bedrock: {
    model: "openai.gpt-oss-120b",
    baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
    credential: "Amazon Bedrock API key"
  },
  ollama: {
    model: "gpt-oss:20b",
    baseUrl: "http://127.0.0.1:11434/v1",
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
let selectedProvider = "kimi";
let pendingApproval = null;
let running = false;
let attachments = [];
let dragDepth = 0;

const elements = Object.fromEntries(
  [
    "loading", "app", "onboardingView", "operatorView", "activityView", "settingsView",
    "decisionsView",
    "connectionDot", "connectionLabel", "connectionDetail", "runtimeBadge", "workspaceLabel",
    "identityDetail", "identityBadge", "decisionBadge",
    "connectButton", "connectCheck", "providerCheck", "workspaceCheck", "enterButton",
    "messages", "promptForm", "promptInput", "runButton", "clearButton", "liveEvents",
    "attachmentList", "attachButton",
    "runningIndicator", "deploymentSummary", "activityList", "providerCards", "settingsForm",
    "modelInput", "baseUrlInput", "apiKeyInput", "apiKeyHelp", "reasoningInput", "mcpInput",
    "settingsError", "testButton", "systemCard", "approvalModal", "approvalMessage",
    "approveButton", "denyButton", "toast", "approvalsButton", "workspaceButton",
    "onboardingWorkspaceButton", "disconnectButton", "refreshDecisionsButton",
    "allApprovalsButton", "decisionSyncStatus", "decisionNotice", "pendingDecisions",
    "recentDecisions"
  ].map((id) => [id, document.getElementById(id)])
);

initialize().catch(showFatal);

async function initialize() {
  bindActions();
  bindEvents();
  state = await api.state();
  updateAttachments(state.attachments || []);
  selectedProvider = state.settings.provider;
  render();
  elements.loading.classList.add("hidden");
  elements.app.classList.remove("hidden");
  api.refreshRemote().catch(() => {});
}

function bindActions() {
  for (const button of document.querySelectorAll(".nav-item")) {
    button.addEventListener("click", () => showView(button.dataset.view));
  }
  for (const button of document.querySelectorAll("[data-open-settings]")) {
    button.addEventListener("click", () => showView("settings"));
  }
  elements.connectButton.addEventListener("click", connectAmos);
  elements.workspaceButton.addEventListener("click", chooseWorkspace);
  elements.onboardingWorkspaceButton.addEventListener("click", chooseWorkspace);
  elements.enterButton.addEventListener("click", () => {
    sessionStorage.setItem("amos-onboarding-complete", "true");
    render();
    showView("operator");
  });
  elements.promptForm.addEventListener("submit", runTask);
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
  elements.testButton.addEventListener("click", testModel);
  elements.disconnectButton.addEventListener("click", disconnectAmos);
  elements.approvalsButton.addEventListener("click", () => api.openApprovals());
  elements.allApprovalsButton.addEventListener("click", () => api.openApprovals());
  elements.refreshDecisionsButton.addEventListener("click", refreshDecisions);
  elements.approveButton.addEventListener("click", () => resolveApproval(true));
  elements.denyButton.addEventListener("click", () => resolveApproval(false));
}

function bindEvents() {
  api.on("agent:event", renderLiveEvent);
  api.on("agent:status", ({ running: isRunning }) => setRunning(isRunning));
  api.on("activity:changed", (activity) => {
    if (state) state.activity = activity;
    renderActivity();
  });
  api.on("remote:changed", (remote) => {
    if (!state) return;
    Object.assign(state, remote);
    renderIdentity();
    renderDecisions();
  });
  api.on("approval:requested", (approval) => {
    pendingApproval = approval;
    elements.approvalMessage.textContent = approval.message;
    elements.approvalModal.classList.remove("hidden");
  });
}

function render() {
  const needsOnboarding =
    !sessionStorage.getItem("amos-onboarding-complete") &&
    (!state.connected || !state.configured || !state.settings.workspace);
  elements.onboardingView.classList.toggle("hidden", !needsOnboarding);
  if (needsOnboarding) {
    elements.operatorView.classList.add("hidden");
    elements.decisionsView.classList.add("hidden");
    elements.activityView.classList.add("hidden");
    elements.settingsView.classList.add("hidden");
  } else {
    showView(currentView);
  }

  elements.connectionDot.classList.toggle("connected", state.connected);
  renderIdentity();
  elements.runtimeBadge.textContent = state.configured
    ? `${state.provider.displayName} · ${state.provider.model}`
    : "Intelligence not configured";
  elements.workspaceLabel.textContent = state.settings.workspace || "Choose a folder";
  elements.connectButton.textContent = state.connected ? "Reconnect AMOS" : "Connect AMOS";
  renderStep(elements.connectCheck, state.connected);
  renderStep(elements.providerCheck, state.configured);
  renderStep(elements.workspaceCheck, Boolean(state.settings.workspace));
  elements.enterButton.disabled = !(state.connected && state.configured && state.settings.workspace);
  elements.disconnectButton.classList.toggle("hidden", !state.connected);

  const boundary = {
    amos: "AMOS-managed inference in AWS. Company policy and proof remain in AMOS.",
    "customer-cloud": "Inference runs in the customer's AWS account through Bedrock.",
    local: "Inference runs on this computer; company actions remain governed by AMOS.",
    cloud: "Inference runs with the model provider; AMOS retains company state and authority.",
    custom: "Inference runs at the configured endpoint; AMOS retains company state and authority."
  };
  elements.deploymentSummary.textContent = boundary[state.provider.deployment] || boundary.custom;

  renderSettings();
  renderActivity();
  renderDecisions();
  renderAttachments();
}

function showView(view) {
  currentView = view;
  const map = {
    operator: elements.operatorView,
    decisions: elements.decisionsView,
    activity: elements.activityView,
    settings: elements.settingsView
  };
  for (const [name, section] of Object.entries(map)) section.classList.toggle("hidden", name !== view);
  elements.onboardingView.classList.add("hidden");
  for (const button of document.querySelectorAll(".nav-item")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
}

function renderIdentity() {
  if (!state) return;
  const identity = state.identity;
  const user = identity?.user;
  const person = user?.name || user?.email || "";
  const company = identity?.tenant_slug || "";
  const role = identity?.role || "";

  elements.connectionDot.classList.toggle("connected", state.connected);
  elements.connectionLabel.textContent = person || (state.connected ? "AMOS connected" : "AMOS not connected");
  elements.connectionDetail.textContent = state.connected
    ? [company, role].filter(Boolean).join(" · ") || "Company governance active"
    : "Connect your company";
  elements.identityDetail.textContent =
    user?.name && user?.email
      ? user.email
      : state.connectionMode === "api_key"
        ? "Machine credential · reconnect for personal decisions"
        : "";
  elements.identityBadge.textContent = person
    ? `${person}${role ? ` · ${role}` : ""}`
    : "";
  elements.identityBadge.classList.toggle("hidden", !person);
}

function renderDecisions() {
  if (!state) return;
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const pending = approvals.filter((approval) => approval.status === "pending");
  const recent = approvals.filter((approval) => approval.status !== "pending").slice(0, 10);
  elements.decisionBadge.textContent = String(pending.length);
  elements.decisionBadge.classList.toggle("hidden", pending.length === 0);

  const sync = state.remoteStatus || {};
  elements.decisionSyncStatus.textContent = sync.syncing
    ? "Syncing…"
    : sync.lastSyncedAt
      ? `Synced ${relativeTime(sync.lastSyncedAt)}`
      : "Not synced";
  elements.refreshDecisionsButton.disabled = Boolean(sync.syncing);

  const notice = !state.connected
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

function decisionCard(approval, actionable) {
  const card = document.createElement("article");
  card.className = `decision-card ${approval.status}`;
  const content = document.createElement("div");
  content.className = "decision-content";
  const meta = document.createElement("div");
  meta.className = "decision-meta";
  const status = document.createElement("span");
  status.className = `decision-status ${approval.status}`;
  status.textContent = approval.status.replaceAll("_", " ");
  const time = document.createElement("time");
  time.dateTime = approval.requested_at;
  time.textContent = approval.requested_at ? new Date(approval.requested_at).toLocaleString() : "";
  meta.append(status, time);
  const title = document.createElement("h2");
  title.textContent = humanizeTool(approval.verb);
  const summary = document.createElement("p");
  summary.textContent = approval.review_summary || humanizeTool(approval.verb);
  const provenance = document.createElement("small");
  provenance.textContent = [
    approval.agency_origin === "goal_pursuit" ? "Autonomous goal" : "Requested work",
    approval.decided_by ? `decided by ${approval.decided_by}` : "",
    approval.last_error ? `execution error: ${approval.last_error}` : ""
  ].filter(Boolean).join(" · ");
  content.append(meta, title, summary, provenance);

  const actions = document.createElement("div");
  actions.className = "decision-card-actions";
  if (actionable) {
    const review = document.createElement("button");
    review.className = "button primary";
    review.textContent = "Review securely →";
    review.addEventListener("click", async () => {
      setButtonBusy(review, true, "Opening…");
      try {
        await api.openApproval(approval.id);
      } catch (error) {
        toast(error.message, true);
      } finally {
        setButtonBusy(review, false, "Review securely →");
      }
    });
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

function renderSettings() {
  const settings = state.settings;
  selectedProvider = selectedProvider || settings.provider;
  elements.providerCards.replaceChildren();

  for (const provider of state.providers) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `provider-card${selectedProvider === provider.id ? " selected" : ""}`;
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

  if (document.activeElement !== elements.modelInput) elements.modelInput.value = settings.model || "";
  if (document.activeElement !== elements.baseUrlInput) elements.baseUrlInput.value = settings.baseUrl || "";
  elements.reasoningInput.value = settings.reasoningEffort || "max";
  elements.mcpInput.value = settings.amosMcpUrl;
  elements.apiKeyHelp.textContent = settings.hasApiKey
    ? "A credential is stored securely. Leave blank to keep it."
    : (providerDefaults[selectedProvider]?.credential || "Provider credential");
  elements.systemCard.replaceChildren(
    strong(`${state.system.arch.toUpperCase()} · ${state.system.memoryGb} GB memory`),
    text(state.system.localRecommendation)
  );
}

function selectProvider(providerId) {
  const changed = providerId !== selectedProvider;
  selectedProvider = providerId;
  const defaults = providerDefaults[providerId] || {};
  if (changed) {
    elements.modelInput.value = defaults.model || "";
    elements.baseUrlInput.value = defaults.baseUrl || "";
    elements.apiKeyInput.value = "";
  }
  renderProviderSelection();
  elements.apiKeyHelp.textContent = defaults.credential || "Provider credential";
}

function renderProviderSelection() {
  for (const card of elements.providerCards.children) {
    const providerName = card.querySelector("strong")?.textContent;
    const provider = state.providers.find((item) => item.displayName === providerName);
    card.classList.toggle("selected", provider?.id === selectedProvider);
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

async function disconnectAmos() {
  try {
    state = await api.logout();
    sessionStorage.removeItem("amos-onboarding-complete");
    toast("AMOS disconnected from this computer.");
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function chooseWorkspace() {
  try {
    state = await api.chooseWorkspace();
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  elements.settingsError.classList.add("hidden");
  try {
    await persistSettings();
    toast("Intelligence profile saved.");
    render();
  } catch (error) {
    elements.settingsError.textContent = error.message;
    elements.settingsError.classList.remove("hidden");
  }
}

async function persistSettings() {
  const payload = {
    provider: selectedProvider,
    model: elements.modelInput.value,
    baseUrl: elements.baseUrlInput.value,
    reasoningEffort: elements.reasoningInput.value,
    amosMcpUrl: elements.mcpInput.value
  };
  if (elements.apiKeyInput.value) payload.apiKey = elements.apiKeyInput.value;

  state = await api.saveSettings(payload);
  elements.apiKeyInput.value = "";
  return state;
}

async function testModel() {
  setButtonBusy(elements.testButton, true, "Testing…");
  try {
    await persistSettings();
    const result = await api.testModel();
    toast(result.message || "Intelligence is ready.");
  } catch (error) {
    elements.settingsError.textContent = error.message;
    elements.settingsError.classList.remove("hidden");
  } finally {
    setButtonBusy(elements.testButton, false, "Test intelligence");
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
  if (running) return;
  const prompt = elements.promptInput.value.trim();
  if (!prompt && attachments.length === 0) return;
  const attachmentSummary = attachments.length > 0
    ? `\n\nAttached: ${attachments.map((item) => item.name).join(", ")}`
    : "";
  addMessage("user", `${prompt || "Review the attached material."}${attachmentSummary}`);
  elements.promptInput.value = "";
  const pending = addMessage("pending", "AMOS is loading company context and determining the next action…");
  setRunning(true);

  try {
    const submitted = [...attachments];
    const result = await api.run({
      text: prompt,
      attachments: submitted.map((item) => ({ id: item.id, retention: item.retention }))
    });
    pending.remove();
    addMessage("assistant", result.answer);
    state.activity = result.activity;
    renderActivity();
    for (const attachment of submitted) {
      await api.removeAttachment(attachment.id);
    }
    updateAttachments([]);
    const failures = (result.memory || []).filter((item) => item.status === "failed");
    if (failures.length > 0) {
      toast(`Task completed, but ${failures.length} item${failures.length === 1 ? "" : "s"} could not be added to company memory.`, true);
    }
  } catch (error) {
    pending.remove();
    addMessage("error", error.message);
  } finally {
    setRunning(false);
  }
}

async function clearSession() {
  await api.clear();
  updateAttachments([]);
  const welcome = elements.messages.querySelector(".welcome-message");
  elements.messages.replaceChildren();
  if (welcome) elements.messages.append(welcome);
  elements.liveEvents.replaceChildren(emptyLiveState());
}

function addMessage(role, content) {
  const message = document.createElement("div");
  message.className = `message ${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  message.append(paragraph);
  elements.messages.append(message);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return message;
}

function renderLiveEvent(event) {
  if (elements.liveEvents.querySelector(".empty-state")) elements.liveEvents.replaceChildren();
  const card = document.createElement("div");
  card.className = `event-card${event.type === "tool_error" ? " error" : ""}`;
  const title = document.createElement("strong");
  title.textContent =
    event.type === "tool_start"
      ? `→ ${event.name}`
      : event.type === "tool_error"
        ? `× ${event.name}`
        : `✓ ${event.name}`;
  const detail = document.createElement("span");
  detail.textContent =
    event.type === "tool_error"
      ? event.error
      : event.type === "tool_start"
        ? humanizeTool(event.name)
        : "Completed with a recorded result";
  card.append(title, detail);
  elements.liveEvents.prepend(card);
}

function renderActivity() {
  if (!state) return;
  elements.activityList.replaceChildren();
  if (!state.activity?.length) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "Activity and proof will appear after AMOS begins working.";
    elements.activityList.append(empty);
    return;
  }
  for (const item of [...state.activity].reverse()) {
    const row = document.createElement("div");
    row.className = "activity-item";
    const type = document.createElement("span");
    type.className = "activity-type";
    type.textContent = item.type;
    const summary = document.createElement("span");
    summary.className = "activity-summary";
    summary.textContent = item.summary;
    const time = document.createElement("time");
    time.className = "activity-time";
    time.dateTime = item.at;
    time.textContent = new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    row.append(type, summary, time);
    elements.activityList.append(row);
  }
}

function setRunning(value) {
  running = value;
  elements.runButton.disabled = value;
  elements.attachButton.disabled = value;
  elements.promptInput.disabled = value;
  elements.runningIndicator.textContent = value ? "Working" : "Idle";
  elements.runningIndicator.classList.toggle("active", value);
  renderAttachments();
}

async function resolveApproval(approved) {
  if (!pendingApproval) return;
  await api.resolveApproval(pendingApproval.id, approved);
  elements.approvalModal.classList.add("hidden");
  toast(approved ? "Approved once." : "Action denied.");
  pendingApproval = null;
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function toast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.style.borderColor = error ? "rgba(255,117,87,.5)" : "";
  elements.toast.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => elements.toast.classList.add("hidden"), 4200);
}

function showFatal(error) {
  elements.loading.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "AMOS Desktop could not start";
  const detail = document.createElement("p");
  detail.textContent = error.message;
  elements.loading.append(title, detail);
}

function emptyLiveState() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const icon = document.createElement("span");
  icon.textContent = "⌁";
  const title = document.createElement("strong");
  title.textContent = "Nothing running";
  const detail = document.createElement("p");
  detail.textContent = "Tool calls, approvals, and receipts will appear here as AMOS works.";
  empty.append(icon, title, detail);
  return empty;
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
