import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every renderer element reference is registered and present in the HTML shell", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);
  const registrySource = javascript.match(
    /const elements = Object\.fromEntries\(([\s\S]*?)\.map\(\(id\)/
  )?.[1];
  assert.ok(registrySource, "renderer element registry must be discoverable");

  const registered = new Set(
    [...registrySource.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1])
  );
  const referenced = new Set(
    [...javascript.matchAll(/elements\.([A-Za-z0-9_]+)/g)].map((match) => match[1])
  );
  const htmlIds = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  );

  assert.deepEqual(
    [...referenced].filter((id) => !registered.has(id)),
    [],
    "all elements.* references must be in the renderer registry"
  );
  assert.deepEqual(
    [...registered].filter((id) => !htmlIds.has(id)),
    [],
    "all registered renderer elements must exist in index.html"
  );
});

test("the running-task composer stays available for steering through the allowlisted IPC bridge", async () => {
  const [javascript, preload, main] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8")
  ]);

  assert.match(javascript, /await steerTask\(prompt\)/);
  assert.match(javascript, /Working · steer or stop/);
  assert.doesNotMatch(javascript, /elements\.promptInput\.disabled = value/);
  assert.match(preload, /desktop:steer-task/);
  assert.match(main, /controller\.steerTask/);
});

test("AMOS Hosted turns an unauthenticated intelligence test into account onboarding", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);

  assert.match(html, /Create or connect your AMOS account/);
  assert.match(html, /return here automatically/);
  assert.match(javascript, /needsManagedConnection/);
  assert.match(javascript, /state = await api\.login\(\)/);
  assert.match(javascript, /Create or connect to test/);
  assert.match(javascript, /Error invoking remote method/);
});

test("AMOS Intelligence is one automatic experience with infrastructure controls disclosed", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);

  assert.match(html, /AMOS Intelligence routes automatically/);
  assert.match(html, /id="managedProfileField" class="amos-routing-card hidden"/);
  assert.match(html, /id="advancedInfrastructureDetails"/);
  assert.match(html, /Advanced intelligence infrastructure/);
  assert.doesNotMatch(html, /Efficient —|Balanced —|Deep —|Frontier —/);
  assert.doesNotMatch(html, /id="intelligenceProfileInput"/);
  assert.match(javascript, /intelligenceProfile: "auto"/);
  assert.match(javascript, /reasoningEffort: managed\s*\? ""/);
  assert.match(javascript, /if \(!managed\) elements\.advancedInfrastructureDetails\.open = true/);
  assert.doesNotMatch(javascript, /advancedInfrastructureDetails\.open = !managed/);
  assert.match(html, /id="modelInput"[^>]*><\/select>/);
  assert.match(html, /id="baseUrlHelp"/);
  assert.match(html, /id="bedrockAuthInput"/);
  assert.match(html, /AWS credential chain · SigV4 \(recommended\)/);
  assert.match(javascript, /modelInput\.addEventListener\("change", syncSelectedModelEndpoint\)/);
  assert.match(javascript, /bedrockAuthMode: selectedProvider === "bedrock"/);
  assert.match(javascript, /model\.aliases\?\.includes\(selectedModel\)/);
  assert.match(javascript, /endpoint\.pathname = model\.endpointPath/);
  assert.match(javascript, /syncProviderReasoning\(provider, model\)/);
  assert.match(javascript, /data sharing required/);
  assert.match(javascript, /opt into provider data sharing/);
});

test("routine approval review stays inside Desktop", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="approvalsButton"[^>]*>Review decisions</);
  assert.match(html, /data-view="work"[\s\S]*?Decisions/);
  assert.match(html, /id="workDecisionsTab"[\s\S]*?Open[\s\S]*?id="workProofTab"[^>]*>History</);
  assert.match(html, /PAST DECISIONS[\s\S]*?id="recentDecisions"[\s\S]*?CONSEQUENTIAL OUTCOMES/);
  assert.match(html, /id="allApprovalsButton"[^>]*compact-button[^>]*>Web approval center</);
  assert.match(
    javascript,
    /elements\.approvalsButton\.addEventListener\("click", \(\) => showView\("decisions"\)\)/
  );
  assert.match(javascript, /showWorkTab\(view === "activity" \? "history" : "open"\)/);
  assert.doesNotMatch(javascript, /sha256:\$\{receipt\.digest/);
  assert.doesNotMatch(javascript, /for \(const receipt of receipts\.slice/);
  assert.match(javascript, /function decisionSummary\([\s\S]*?structuredTail/);
  assert.doesNotMatch(javascript, /decided by \$\{approval\.decided_by\}/);
  assert.match(javascript, /Revalidate & reopen/);
  const decisions = html.match(/<section id="workView"([\s\S]*?)<section id="settingsView"/)?.[1] || "";
  assert.doesNotMatch(decisions, /INTERRUPTED &amp; FAILED WORK|interruptedTaskList/);
  assert.match(html, /id="conversationRecovery"[\s\S]*?INTERRUPTED &amp; FAILED CONVERSATIONS/);
  assert.match(javascript, /state\.approvalDecisionMode === "desktop"/);
  assert.match(javascript, /reviewCanvasApproval\(block\.pendingId, review\)/);
  assert.match(javascript, /approvalIdFromUrl\(node\.href\)/);
  assert.match(javascript, /running\s*\?\s*"Steer AMOS "/);
  assert.match(javascript, /restoreConversationFromContinuity/);
  assert.match(javascript, /Enable native approval/);
  assert.match(javascript, /state = await api\.login\(\)/);
  assert.match(
    javascript,
    /const openHosted = window\.confirm\([\s\S]*?if \(openHosted\) await api\.openApproval\(id\)/
  );
});

test("background remote refresh projects live Connections into the renderer", async () => {
  const javascript = await readFile(
    new URL("../desktop/renderer/app.js", import.meta.url),
    "utf8"
  );

  assert.match(
    javascript,
    /api\.on\("remote:changed",[\s\S]*?Object\.assign\(state, next\)[\s\S]*?renderConnections\(\)/
  );
  assert.match(
    javascript,
    /api\.on\("remote:changed",[\s\S]*?Object\.assign\(state, next\)[\s\S]*?renderHistory\(\)/
  );
});

test("Connections HTML contains no customer or provider-specific catalog truth", async () => {
  const [javascript, html, preload, main, controller, remoteState] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/remoteState.js", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(html, /Neighborly/i);
  assert.doesNotMatch(html, /Microsoft 365|Power BI|Nuvola|AWS Data Lake/);
  assert.doesNotMatch(html, />SUPPORTED|>LIVE SERVICE|>SCOPED NEXT/);
  assert.match(html, /id="availableProviderList"/);
  assert.match(html, /id="connectionModal"/);
  assert.match(html, /never added to chat or saved by Desktop/);
  assert.match(
    javascript,
    /connectedSystems = connections\.filter\([\s\S]*?connection\.status === "connected"/
  );
  assert.match(
    javascript,
    /availableProviders = providers\.filter\([\s\S]*?!connectionsByProvider\.has\(provider\.provider\)/
  );
  assert.match(javascript, /api\.connectProvider\(provider\.provider\)/);
  assert.match(javascript, /api\.connectSecretProvider\(connectionSetupProvider\.provider/);
  assert.match(javascript, /api\.disconnectConnection\(connection\.id\)/);
  assert.match(javascript, /remove its vaulted credential/);
  assert.match(preload, /desktop:disconnect-connection/);
  assert.match(main, /controller\.disconnectConnection\(connectionId\)/);
  assert.match(controller, /item\.id === id && item\.status === "connected"/);
  assert.match(controller, /if \(!connection\.usable\)/);
  assert.match(remoteState, /this\.mcp\.callTool\([\s\S]*?"delete_connection"/);
});

test("Automations replace Memory in primary navigation and launch isolated governed task lanes", async () => {
  const [javascript, html, preload, main, controller, remoteState] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/remoteState.js", import.meta.url), "utf8")
  ]);
  const nav = html.match(/<nav class="nav"([\s\S]*?)<\/nav>/)?.[1] || "";
  const accountMenu = html.match(/id="accountMenu"([\s\S]*?)<button id="workspaceButton"/)?.[1] || "";

  assert.doesNotMatch(nav, /data-view="memory"/);
  assert.doesNotMatch(nav, /data-view="settings"/);
  assert.match(nav, /data-view="operator"[\s\S]*?data-view="projects"[\s\S]*?data-view="tasks"[\s\S]*?data-view="canvas"[\s\S]*?data-view="connections"[\s\S]*?data-view="automations"[\s\S]*?data-view="work"/);
  assert.match(accountMenu, /id="accountMemoryButton"[\s\S]*?Memory &amp; context/);
  assert.match(accountMenu, /id="accountIntelligenceButton"[\s\S]*?Intelligence &amp; infrastructure/);
  assert.match(html, /id="memoryView"/);
  assert.match(html, /Connect systems[\s\S]*?Understand &amp; analyze[\s\S]*?Build deterministic automation[\s\S]*?Pursue governed goals/);
  assert.match(javascript, /const library = state\.automations \|\| \{\}/);
  assert.match(javascript, /const recipeLibrary = state\.browserRecipes \|\| \{\}/);
  assert.match(javascript, /LOCAL BROWSER RECIPE/);
  assert.match(javascript, /api\.removeBrowserRecipe\(recipe\.id\)/);
  assert.match(javascript, /api\.setAutomationStatus\(automation\.name, active\)/);
  assert.match(javascript, /api\.revokeAutomationGrant\(/);
  assert.match(javascript, /api\.simulateAutomation\(automation\.id, null\)/);
  assert.match(javascript, /api\.repairAutomationFailure\(failure\.id/);
  assert.match(javascript, /Not applied — retry/);
  assert.match(javascript, /Applied — settle/);
  assert.match(javascript, /api\.startNewConversation\(\{[\s\S]*?kind: "automation_builder"/);
  assert.match(preload, /desktop:start-new-conversation/);
  assert.match(preload, /desktop:set-automation-status/);
  assert.match(preload, /desktop:revoke-automation-grant/);
  assert.match(preload, /desktop:simulate-automation/);
  assert.match(preload, /desktop:repair-automation-failure/);
  assert.match(preload, /desktop:remove-browser-recipe/);
  assert.match(main, /controller\.startNewConversation\(input\)/);
  assert.match(main, /controller\.setAutomationStatus\(input\?\.name, input\?\.active === true\)/);
  assert.match(main, /controller\.revokeAutomationGrant\(input\?\.grantId, input\?\.reason\)/);
  assert.match(main, /controller\.simulateAutomation\(input\?\.automationId, input\?\.sampleTrigger \?\? null\)/);
  assert.match(main, /controller\.repairAutomationFailure\(input\?\.incidentId, input\?\.resolution\)/);
  assert.match(main, /controller\.removeBrowserRecipe\(id\)/);
  assert.match(controller, /const id = randomUUID\(\);[\s\S]*?this\.activeContextKey = `task:\$\{id\}`/);
  assert.match(controller, /continuityCapturePayload\(transition, settings, this\.activeContextKey, record\)/);
  const turnPayload = controller.slice(
    controller.indexOf("function continuityCapturePayload"),
    controller.indexOf("function compactContinuityField")
  );
  assert.doesNotMatch(turnPayload, /consultative_state/);
  assert.match(controller, /origin: "user_gesture"/);
  assert.match(preload, /desktop:confirm-consultative-assertion/);
  assert.match(preload, /desktop:correct-consultative-assertion/);
  assert.match(preload, /desktop:propose-consultative-update/);
  assert.match(preload, /desktop:reject-consultative-assertion/);
  assert.match(preload, /desktop:reopen-consultative-assertion/);
  assert.match(preload, /desktop:set-relationship-preference/);
  assert.match(preload, /desktop:reset-relationship-profile/);
  assert.match(main, /controller\.confirmConsultativeAssertion\(input\)/);
  assert.match(main, /controller\.correctConsultativeAssertion\(input\)/);
  assert.match(main, /controller\.proposeConsultativeUpdate\(input\)/);
  assert.match(main, /controller\.rejectConsultativeAssertion\(input\)/);
  assert.match(main, /controller\.reopenConsultativeAssertion\(input\)/);
  assert.match(main, /controller\.setRelationshipPreference\(input\)/);
  assert.match(main, /controller\.resetRelationshipProfile\(input\)/);
  assert.match(remoteState, /this\.mcp\.callTool\("get_collaboration_profile"/);
  assert.match(remoteState, /this\.mcp\.callTool\("update_collaboration_profile"/);
  assert.match(remoteState, /this\.mcp\.callTool\("reset_collaboration_profile"/);
  assert.match(remoteState, /this\.mcp\.callTool\("list_automations"/);
  assert.match(remoteState, /active \? "resume_automation" : "pause_automation"/);
  assert.match(remoteState, /this\.mcp\.callTool\("list_automation_grants"/);
  assert.match(remoteState, /this\.mcp\.callTool\("list_automation_failures"/);
  assert.match(remoteState, /this\.mcp\.callTool\("list_automation_runs"/);
  assert.match(remoteState, /this\.mcp\.callTool\("simulate_automation"/);
  assert.match(remoteState, /this\.mcp\.callTool\([\s\S]*?"repair_automation_failure"/);
  assert.match(html, /id="automationOperationsCenter"/);
  assert.doesNotMatch(html, /Neighborly|Franchise scorecard follow-up/);
});

test("Operator exposes guided Platform-owned Automation setup beside chat", async () => {
  const [javascript, html, preload, main, controller, prompts, tool] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/prompts.js", import.meta.url), "utf8"),
    readFile(new URL("../src/tools/automationSetup.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="automationSetupSurface"/);
  assert.match(html, /Outcome, connections, mappings, trigger, preview/i);
  assert.match(javascript, /api\.beginAutomationSetup\(\{ intent: objective \}\)/);
  assert.match(javascript, /api\.automationOperations\(automationSetupDraft\.connection\)/);
  assert.match(javascript, /compileAutomationMappings/);
  assert.match(javascript, /api\.installAutomationSetup\(\{/);
  assert.match(javascript, /api\.activateAutomationSetup\(automationSetupDraft\.setupId\)/);
  assert.match(javascript, /activation\.pendingApproval[\s\S]*?showView\("work"\)/);
  assert.match(preload, /automation-setup:requested/);
  assert.match(preload, /desktop:install-automation-setup/);
  assert.match(main, /controller\.installAutomationSetup\(input\)/);
  assert.match(controller, /pendingAutomationActivations\.set/);
  assert.match(controller, /remote\.activateAutomationDraft\(pending\.arguments\)/);
  assert.match(prompts, /desktop_begin_automation_setup/);
  assert.match(tool, /name: "desktop_begin_automation_setup"/);
  assert.doesNotMatch(html, /Stripe|QuickBooks|Neighborly/);
});

test("Conversations expose durable resume, explicit forking capability, lineage, and bound canvases", async () => {
  const [javascript, html, preload, main, controller, taskStore, workspace] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/taskStore.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/taskWorkspace.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="tasksView"/);
  assert.match(html, /data-view="tasks"[\s\S]*?Conversations/);
  assert.match(html, /id="newTaskButton"[^>]*>New conversation/);
  assert.match(html, /id="newConversationButton"[^>]*>[\s\S]*?New conversation/);
  assert.match(html, /id="forkConversationButton"[^>]*>[\s\S]*?Fork conversation/);
  assert.match(html, /Everything[\s\S]*?From here[\s\S]*?Selected artifacts/);
  assert.match(html, /Same directory[\s\S]*?New Git worktree[\s\S]*?Context only/);
  assert.match(javascript, /api\.openTask\(task\.id\)/);
  assert.match(javascript, /api\.startNewConversation\(\{\s*kind: "general"\s*\}\)/);
  assert.match(javascript, /forkCurrentConversation[\s\S]*?capability\.latestMilestoneId/);
  assert.match(javascript, /state\?\.conversationCapabilities/);
  assert.doesNotMatch(javascript, /latestTaskEventId/);
  assert.doesNotMatch(javascript, /What should this task move forward\?/);
  assert.match(javascript, /api\.forkTask\(\{/);
  assert.match(javascript, /Fork from here/);
  assert.match(preload, /desktop:open-task/);
  assert.match(preload, /desktop:fork-task/);
  assert.match(main, /controller\.forkTaskResource\(input\)/);
  assert.match(controller, /this\.canvases\.restore\(durableCanvasState\(task\.canvasState \|\| \{\}\)\)/);
  assert.match(controller, /function conversationForkCapability\(task, continuity\)/);
  assert.match(controller, /reason: "no_persisted_milestone"/);
  const capabilityContract = controller.match(
    /function conversationForkCapability\(task, continuity\)([\s\S]*?)function conversationForkUnavailableMessage/
  )?.[1] || "";
  assert.doesNotMatch(capabilityContract, /RegExp|\.match\(|\.test\(/);
  assert.match(controller, /function durableCanvasState[\s\S]*?block\?\.type !== "browser"/);
  assert.match(controller, /replayed: false/);
  assert.match(taskStore, /pendingOperationsCopied: false/);
  assert.match(taskStore, /credentialsIncluded: false/);
  assert.match(workspace, /"worktree",[\s\S]*?"add"[\s\S]*?"-b"/);
  assert.doesNotMatch(workspace, /"reset"|"checkout"|"clean"|"stash"/);
});

test("Projects expose bounded parallel coordination and one supervised activity center", async () => {
  const [javascript, html, css, preload, main, controller, remoteState] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/remoteState.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-view="projects"/);
  assert.match(html, /id="projectsView"/);
  assert.match(html, /PARALLEL WORK &amp; SUPERVISION/);
  assert.match(html, /id="activityCenterList"/);
  assert.match(html, /never grants execution authority or replaces proof receipts/);
  assert.match(html, /id="projectParallelInput"[^>]*max="32"/);
  assert.match(javascript, /function renderProjects\(\)/);
  assert.match(javascript, /function projectConversationList\(conversations\)/);
  assert.match(javascript, /task\.projectId === project\.id/);
  assert.match(javascript, /api\.assignTaskProject\(/);
  assert.match(javascript, /api\.cancelSupervisedRun\(/);
  assert.match(javascript, /The worker must acknowledge it at the next heartbeat/);
  assert.match(preload, /desktop:create-project/);
  assert.match(preload, /desktop:cancel-supervised-run/);
  assert.match(main, /controller\.createProject\(input\)/);
  assert.match(main, /controller\.cancelSupervisedTaskRun/);
  assert.match(controller, /remote\.projectsLibrary\(\)/);
  assert.match(controller, /execution_authority: false/);
  assert.match(remoteState, /this\.mcp\.callTool\("list_projects"/);
  assert.match(remoteState, /this\.mcp\.callTool\("list_task_inbox"/);
  assert.match(remoteState, /this\.mcp\.callTool\("start_task_run"/);
  assert.match(remoteState, /this\.mcp\.callTool\("report_task_run"/);
  assert.match(css, /\.project-workspace\s*\{[\s\S]*?grid-template-columns/);
  assert.match(css, /\.project-conversations\s*\{/);
  const activityCenterContract = javascript.match(
    /function renderActivityCenter\(projects, inbox\)([\s\S]*?)function activityRunCard/
  )?.[1] || "";
  assert.doesNotMatch(activityCenterContract, /taskCheckpoints|taskCheckpointCard/);
  assert.doesNotMatch(javascript, /All Projects & Conversations/);
  assert.doesNotMatch(html, /Neighborly rollout|Build KPI scorecard/);
});

test("Briefings use the platform catalog and typed actions instead of Desktop prompt injection", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);

  assert.match(javascript, /const platformLibrary = state\.briefings \|\| \{\}/);
  assert.match(javascript, /api\.runBriefing\(input\)/);
  assert.match(javascript, /templateKey: template\.key/);
  assert.match(javascript, /api\.scheduleCanvasView\(activeCanvasId, cadence\)/);
  assert.match(html, /Company Briefing definitions and schedules live in governed AMOS state/);
  assert.doesNotMatch(javascript, /const briefingTemplates\s*=/);
  assert.doesNotMatch(javascript, /title: "Goals and coaching"/);
  assert.doesNotMatch(javascript, /most relevant coaching or learning intervention/);
});

test("Operator is chat-first with collapsible navigation and inline governed progress", async () => {
  const [javascript, html, css] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="sidebarToggle"/);
  assert.match(html, /id="conversationHeading"/);
  assert.match(
    html,
    /class="composer-tools"[\s\S]*?id="clearButton"[\s\S]*?>Clear context<\/button>/
  );
  assert.match(html, /id="activityStream"/);
  assert.match(html, /Progress summaries, governed tool use, and recorded outcomes/);
  const operator = html.match(/<section id="operatorView"([\s\S]*?)<section id="canvasView"/)?.[1] || "";
  const heading = operator.match(/id="conversationHeading"([\s\S]*?)<div id="messages"/)?.[1] || "";
  assert.doesNotMatch(operator, /class="work-panel"/);
  assert.doesNotMatch(heading, /id="clearButton"/);
  assert.match(javascript, /function beginInlineActivity\(\)/);
  assert.match(javascript, /finishInlineActivity\(\)/);
  assert.match(javascript, /function toggleSidebar\(\)[\s\S]*?setSidebarCollapsed/);
  assert.match(javascript, /elements\.app\.classList\.toggle\("nav-collapsed", collapsed\)/);
  assert.match(
    javascript,
    /function renderConversationChrome\(\)[\s\S]*?\.message\.user, \.message\.assistant, \.message\.error[\s\S]*?conversationHeading\.classList\.toggle\("hidden", hasConversation\)[\s\S]*?welcomeMessage\.classList\.toggle\("hidden", hasConversation\)[\s\S]*?starterActions\.classList\.toggle\("hidden", hasConversation\)/
  );
  assert.match(javascript, /elements\.messages\.append\(message\);\s+renderConversationChrome\(\)/);
  assert.match(javascript, /operatorView\.classList\.toggle\("has-demo-banner", demo\)/);
  assert.match(css, /\.sidebar-toggle\s*{[\s\S]*?-webkit-app-region: no-drag;[\s\S]*?z-index: 3;/);
  assert.match(css, /\.operator\s*{[\s\S]*?padding: 0;/);
  assert.match(css, /\.operator\.has-demo-banner\s*{\s*grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(css, /\.conversation\.has-history\s*{\s*grid-template-rows: minmax\(0, 1fr\) auto;/);
});

test("local auto-approve is an exact-folder Desktop trust ceremony, not a company approval bypass", async () => {
  const [javascript, html, preload, main] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="localApprovalButton"/);
  assert.match(html, /id="alwaysApproveButton"/);
  assert.match(html, /id="taskApproveButton"/);
  assert.match(html, /id="autoApproveFolderButton"/);
  assert.match(html, /id="approvalModal" class="approval-modal inline-approval hidden"/);
  assert.match(html, /You can keep typing while this waits/);
  assert.doesNotMatch(html, /id="approvalModal" class="modal-backdrop/);
  assert.match(javascript, /api\.setLocalApprovalMode\(enabled \? "ask" : "workspace"\)/);
  assert.match(javascript, /api\.allowLocalApprovalKind\(approval\.kind\)/);
  assert.match(javascript, /api\.allowTaskLocalWork\(\)/);
  assert.match(javascript, /elements\.messages\.append\(elements\.approvalModal\)/);
  assert.match(javascript, /approval\.kind === "browser-action"/);
  assert.match(javascript, /It can never be made persistent or covered by local workspace auto-approval/);
  assert.match(javascript, /Keep typing—your direction will be queued while this approval waits/);
  assert.match(javascript, /elements\.promptInput\.disabled = false/);
  assert.match(javascript, /Company approvals remain governed/);
  assert.match(preload, /desktop:set-local-approval-mode/);
  assert.match(preload, /desktop:allow-task-local-work/);
  assert.match(main, /Exact project folder:/);
  assert.match(main, /run with your local user permissions and are not OS-sandboxed/);
  assert.match(main, /Changing folders turns this off automatically/);
  assert.match(main, /AMOS company operations, connected-app writes, and governed decisions/);
  assert.match(main, /defaultId: 1/);
  assert.match(main, /cancelId: 1/);
});

test("authenticated browser actions keep credentials in a user-controlled isolated window", async () => {
  const [javascript, preload, main, controller, runtime, tools] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/browserRuntime.js", import.meta.url), "utf8"),
    readFile(new URL("../src/tools/browser.js", import.meta.url), "utf8")
  ]);
  assert.match(javascript, /Take control for login/);
  assert.match(javascript, /Return to AMOS & refresh/);
  assert.match(javascript, /Passwords, MFA codes, tokens, and cookies stay inside the isolated browser/);
  assert.match(preload, /desktop:start-browser-takeover/);
  assert.match(preload, /desktop:finish-browser-takeover/);
  assert.match(preload, /desktop:save-browser-download/);
  assert.match(main, /controller\.startBrowserTakeover\(input\?\.sessionId\)/);
  assert.match(main, /controller\.finishBrowserTakeover\(input\?\.sessionId\)/);
  assert.match(main, /controller\.browserDownloadPayload\(input\?\.attachmentId\)/);
  assert.match(javascript, /Save copy…/);
  assert.match(javascript, /api\.saveBrowserDownload\(block\.download\.attachmentId\)/);
  assert.match(javascript, /submittedIds = new Set/);
  assert.match(javascript, /filter\(\(attachment\) => !submittedIds\.has\(attachment\.id\)\)/);
  assert.match(controller, /attachedBrowserBlock\(sessionId\)/);
  assert.match(runtime, /AMOS Secure Browser/);
  assert.match(runtime, /This consequential browser action requires exact human approval/);
  assert.match(runtime, /The browser action target changed while approval was pending/);
  assert.match(tools, /name: "browser_click"/);
  assert.match(tools, /name: "browser_type"/);
  assert.match(tools, /name: "browser_select"/);
  assert.match(tools, /name: "browser_check"/);
  assert.match(tools, /name: "browser_wait"/);
  assert.match(tools, /name: "browser_upload"/);
  assert.match(tools, /name: "browser_download"/);
  assert.match(tools, /Passwords, MFA, recovery codes, tokens, and authentication forms are never model-operated/);
});

test("dynamic canvases open beside chat without navigating away from Operator", async () => {
  const [javascript, html, css] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="canvasSidecar"/);
  assert.match(html, /id="liveCanvasList"/);
  assert.match(javascript, /if \(activeCanvasId\) canvasSidecarOpen = true;\s+renderCanvas\(\);/);
  assert.match(javascript, /operatorGrid\.classList\.toggle\("has-context", sidecarVisible\)/);
  assert.match(javascript, /contextResizeHandle\.classList\.toggle\("hidden", !sidecarVisible\)/);
  assert.doesNotMatch(
    javascript,
    /api\.on\("canvas:changed",[\s\S]*?if \(activeCanvasId\) showView\("canvas"\)/
  );
  assert.match(javascript, /actionLabel: "Open beside chat"/);
  assert.match(
    css,
    /\.operator-grid\.has-context\s*{\s*grid-template-columns: minmax\(480px, 1fr\) 6px minmax\(380px, var\(--context-width, 48%\)\);/
  );
  assert.match(css, /\.context-resize-handle\s*{[\s\S]*?cursor: col-resize;/);
  assert.match(css, /\.operator-grid\.has-context \.conversation\s*{\s*border-right:/);
  assert.match(css, /\.operator-grid\.has-context \.scope-note\s*{\s*display: none;/);
});

test("the identity card opens Google-style account switching outside Intelligence", async () => {
  const [html, controller] = await Promise.all([
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8")
  ]);
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] || "";
  const settings = html.match(/<section id="settingsView"([\s\S]*?)<\/section>/)?.[1] || "";
  const sidebar = html.match(/<aside class="sidebar">([\s\S]*?)<\/aside>/)?.[1] || "";
  assert.doesNotMatch(topbar, /companySwitcher/);
  assert.doesNotMatch(settings, /companySwitcherControl|addAccountButton/);
  assert.match(sidebar, /id="accountMenuButton"/);
  assert.match(sidebar, /id="addAccountButton"/);
  assert.match(sidebar, /id="companySwitcherControl" class="account-company-switcher hidden"/);
  assert.match(sidebar, /id="accountMemoryButton"/);
  assert.match(sidebar, /id="accountIntelligenceButton"/);
  assert.doesNotMatch(sidebar, /id="companySwitcherControl" class="field company-switcher/);
  assert.match(sidebar, /Platform is never told what other accounts are present/);
  assert.match(controller, /clearEphemeralCompanyBoundary\(\)/);
});

test("canvas code and previews stay typed, inert, and outside the privileged renderer", async () => {
  const [javascript, preload, main] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8")
  ]);
  assert.match(javascript, /function renderCanvasOperatingPlan[\s\S]*?function applyOperatingPlanAction/);
  assert.match(javascript, /api\.confirmConsultativeAssertion\(\{ assertionId: item\.id \}\)/);
  assert.match(javascript, /api\.rejectConsultativeAssertion\(\{ assertionId: item\.id \}\)/);
  assert.match(javascript, /api\.reopenConsultativeAssertion\(\{ assertionId: item\.id \}\)/);
  assert.doesNotMatch(javascript, /renderCanvasOperatingPlan[\s\S]{0,4000}innerHTML/);
  assert.match(javascript, /function renderCanvasCode[\s\S]*?code\.textContent = block\.content/);
  assert.match(javascript, /function renderCanvasLink[\s\S]*?api\.openExternal\(block\.url\)/);
  assert.doesNotMatch(javascript, /renderCanvasLink[\s\S]{0,900}createElement\("iframe"\)/);
  assert.match(javascript, /function renderCanvasDocument[\s\S]*?title\.textContent = block\.document\.title/);
  assert.match(javascript, /function renderDocumentPreviewBlock[\s\S]*?paragraph\.textContent = block\.text/);
  assert.match(javascript, /api\.openDocumentArtifact\(path, mode\)/);
  assert.doesNotMatch(javascript, /renderCanvasDocument[\s\S]{0,6000}(?:innerHTML|createElement\("iframe"\))/);
  assert.match(preload, /desktop:open-document-artifact/);
  assert.match(preload, /desktop:read-document-preview/);
  assert.match(main, /controller\.resolveDocumentArtifactPath\(input\?\.path\)/);
  assert.match(main, /controller\.resolveDocumentPreviewPath\(input\?\.path\)/);
  assert.match(javascript, /api\.readDocumentPreview\(preview\.path\)/);
  assert.match(main, /shell\.openPath\(artifactPath\)/);
  assert.match(main, /shell\.showItemInFolder\(artifactPath\)/);
  assert.match(javascript, /function renderCanvasSpreadsheet[\s\S]*?Open in Excel[\s\S]*?Show in folder/);
  assert.match(javascript, /className = "spreadsheet-artifact-link"/);
  assert.match(javascript, /className = "message-copy-button"/);
  assert.match(javascript, /await api\.copyText\(content\)/);
  assert.match(preload, /desktop:copy-text/);
  assert.match(main, /clipboard\.writeText\(copy\)/);
});

test("offline model cards badge unmeasured, conditional, and experimental profiles", async () => {
  const [javascript, css] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8")
  ]);

  assert.match(javascript, /function offlineCatalogBadge\(/);
  assert.match(javascript, /const badge = offlineCatalogBadge\(model\)/);
  assert.match(javascript, /labels\.append\(status\)/);
  assert.match(javascript, /model\.experimental \|\| model\.qualification\?\.status === "experimental"/);
  assert.match(javascript, /Unmeasured — not for governed work/);
  assert.match(javascript, /label: "Experimental"/);
  assert.match(javascript, /label: "Conditional"/);
  assert.match(javascript, /offlineCatalogFailures\(model\)/);
  assert.match(javascript, /model\.capabilityContract\?\.failures/);
  assert.match(css, /\.offline-model-labels \.unmeasured \{ color: var\(--coral\); \}/);
  assert.match(
    css,
    /\.offline-model-labels \.conditional,\s*\.offline-model-labels \.experimental \{ color: var\(--warning\); \}/
  );
});

test("chat renders only typed Platform-authorized connect actions", async () => {
  const javascript = await readFile(
    new URL("../desktop/renderer/app.js", import.meta.url),
    "utf8"
  );

  assert.match(javascript, /"amos_connections_connect_link"/);
  assert.match(javascript, /event\.args\?\.tool === "connect_link"/);
  assert.match(javascript, /function parsePlatformToolResult\(result\)/);
  assert.match(javascript, /action\?\.authority !== "amos_platform"/);
  assert.match(javascript, /action\?\.type !== "open_url"/);
  assert.match(javascript, /url\.protocol !== "https:"/);
  assert.match(javascript, /await api\.openExternal\(action\.url\)/);
});

test("first-run persists completion and requires local or BYO for My workspace", async () => {
  const [javascript, html, preload, main, settings, controller] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/settingsStore.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8")
  ]);
  const onboarding = html.match(/<section id="onboardingView"([\s\S]*?)<section id="operatorView"/)?.[1] || "";

  assert.doesNotMatch(javascript, /amos-onboarding-complete/);
  assert.doesNotMatch(javascript, /sessionStorage\.(setItem|getItem|removeItem)/);
  assert.match(settings, /onboardingCompletedAt: isoOrEmpty\(input\.onboardingCompletedAt\)/);
  assert.match(settings, /\["personal", "northwind", "company"\]\.includes\(input\.onboardingBoundary\)/);
  assert.match(javascript, /function firstRunNeeded/);
  assert.match(javascript, /connectionMode === "demo_expired"/);
  assert.match(javascript, /!current\.settings\?\.onboardingCompletedAt/);
  assert.match(javascript, /api\.completeOnboarding\(\{ boundary \}\)/);
  assert.match(preload, /desktop:complete-onboarding/);
  assert.match(main, /controller\.completeOnboarding\(input\)/);
  assert.match(controller, /onboardingCompletedAt: settings\.onboardingCompletedAt \|\| new Date\(\)\.toISOString\(\)/);

  assert.match(onboarding, /What do you want to operate\?/);
  assert.match(onboarding, /<strong>My workspace<\/strong>/);
  assert.match(onboarding, /id="demoModeButton" class="start-mode-card featured"/);
  assert.match(onboarding, /<strong>Northwind demo<\/strong>/);
  assert.match(onboarding, /<strong>My company<\/strong>/);
  assert.match(onboarding, /Run locally or bring your own model key/);
  assert.match(onboarding, /Qwen 3\.6 27B/);
  assert.match(onboarding, /OpenAI · Claude · Kimi · custom endpoints/);
  assert.match(html, /Choose AMOS Local, OpenAI, Anthropic \(Claude\), Kimi, or any OpenAI-compatible endpoint/);
  assert.match(javascript, /personalNeedsIntelligence/);
  assert.match(javascript, /Choose a local profile or your own key/);
  assert.match(
    javascript,
    /enterButton\.disabled = !\(\s*\(state\.connected \|\| state\.mode\?\.personal \|\| state\.mode\?\.offline\) &&\s*state\.configured &&\s*state\.settings\.workspace/
  );
  assert.match(
    controller,
    /settings\.operatingMode === "personal" &&\s*settings\.provider === "amos-hosted" &&\s*!useOAuth/
  );
  assert.match(controller, /createRuntime: createRuntimeImpl = createRuntime/);
  assert.match(controller, /this\.createRuntime = createRuntimeImpl/);
  assert.match(controller, /runtime: this\.createRuntime\(\{/);
  assert.doesNotMatch(controller, /unqualified[\s\S]{0,80}configured\s*=\s*false/);
  assert.doesNotMatch(controller, /officialWindowsPublished/);
  assert.doesNotMatch(onboarding, /Claude Desktop|paste this URL|Connectors/i);
  assert.doesNotMatch(onboarding, /anonymous auto|no account[\s\S]{0,40}automatic/i);
});

test("first-run funnel events fire only after telemetry opt-in", async () => {
  const [javascript, controller, telemetry] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/telemetry.js", import.meta.url), "utf8")
  ]);

  assert.match(controller, /desktop_boundary_selected/);
  assert.match(controller, /desktop_onboarding_completed/);
  assert.match(controller, /desktop_first_task_started/);
  assert.match(
    controller,
    /async recordAcquisitionEvent\(settings, eventType, context = \{\}, \{ once = false \} = \{\}\) \{\s*if \(!this\.telemetry\) return;\s*await this\.telemetry\s*\.record\(/
  );
  assert.match(telemetry, /QUEUED_MILESTONES/);
  assert.match(
    telemetry,
    /if \(this\.preference === null && QUEUED_MILESTONES\.has\(eventType\)\) \{\s*return this\.queueMilestone/
  );
  assert.match(telemetry, /await this\.flushQueued\(\{ mcpUrl \}\)/);
  assert.match(javascript, /setTelemetryPreference/);
  assert.match(javascript, /desktop:set-telemetry-preference|setTelemetryPreference\(\{ enabled \}\)/);
  assert.match(javascript, /telemetryConsent\.classList\.toggle\("hidden", !pending\)/);
  assert.match(javascript, /operatorView\.prepend\(elements\.telemetryConsent\)/);
  assert.match(javascript, /find broken flows and improve Desktop faster/);
  assert.match(javascript, /never send prompts, responses, files, company data, credentials, or tokens/i);
});
