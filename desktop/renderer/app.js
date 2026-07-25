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

const elements = Object.fromEntries(
  [
    "loading", "app", "onboardingView", "operatorView", "activityView", "settingsView",
    "connectionDot", "connectionLabel", "connectionDetail", "runtimeBadge", "workspaceLabel",
    "connectButton", "connectCheck", "providerCheck", "workspaceCheck", "enterButton",
    "messages", "promptForm", "promptInput", "runButton", "clearButton", "liveEvents",
    "runningIndicator", "deploymentSummary", "activityList", "providerCards", "settingsForm",
    "modelInput", "baseUrlInput", "apiKeyInput", "apiKeyHelp", "reasoningInput", "mcpInput",
    "settingsError", "testButton", "systemCard", "approvalModal", "approvalMessage",
    "approveButton", "denyButton", "toast", "approvalsButton", "workspaceButton",
    "onboardingWorkspaceButton", "disconnectButton"
  ].map((id) => [id, document.getElementById(id)])
);

initialize().catch(showFatal);

async function initialize() {
  bindActions();
  bindEvents();
  state = await api.state();
  selectedProvider = state.settings.provider;
  render();
  elements.loading.classList.add("hidden");
  elements.app.classList.remove("hidden");
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
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      elements.promptForm.requestSubmit();
    }
  });
  elements.clearButton.addEventListener("click", clearSession);
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.testButton.addEventListener("click", testModel);
  elements.disconnectButton.addEventListener("click", disconnectAmos);
  elements.approvalsButton.addEventListener("click", () => api.openApprovals());
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
    elements.activityView.classList.add("hidden");
    elements.settingsView.classList.add("hidden");
  } else {
    showView(currentView);
  }

  elements.connectionDot.classList.toggle("connected", state.connected);
  elements.connectionLabel.textContent = state.connected ? "AMOS connected" : "AMOS not connected";
  elements.connectionDetail.textContent = state.connected ? "Company governance active" : "Connect your company";
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
}

function showView(view) {
  currentView = view;
  const map = {
    operator: elements.operatorView,
    activity: elements.activityView,
    settings: elements.settingsView
  };
  for (const [name, section] of Object.entries(map)) section.classList.toggle("hidden", name !== view);
  elements.onboardingView.classList.add("hidden");
  for (const button of document.querySelectorAll(".nav-item")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
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

async function runTask(event) {
  event.preventDefault();
  if (running) return;
  const prompt = elements.promptInput.value.trim();
  if (!prompt) return;
  addMessage("user", prompt);
  elements.promptInput.value = "";
  const pending = addMessage("pending", "AMOS is loading company context and determining the next action…");
  setRunning(true);

  try {
    const result = await api.run(prompt);
    pending.remove();
    addMessage("assistant", result.answer);
    state.activity = result.activity;
    renderActivity();
  } catch (error) {
    pending.remove();
    addMessage("error", error.message);
  } finally {
    setRunning(false);
  }
}

async function clearSession() {
  await api.clear();
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
  elements.promptInput.disabled = value;
  elements.runningIndicator.textContent = value ? "Working" : "Idle";
  elements.runningIndicator.classList.toggle("active", value);
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
