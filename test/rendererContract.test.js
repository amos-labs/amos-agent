import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Electron suspend interrupts active work and resume refreshes recoverable state", async () => {
  const main = await readFile(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /powerMonitor\.on\("suspend"[\s\S]*?interruptForSystemSleep/);
  assert.match(main, /powerMonitor\.on\("resume"[\s\S]*?refreshRemote/);
});

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

test("the coding work surface renders deterministic file trees and inert line-numbered diffs", async () => {
  const [javascript, css, canvas, tool] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/canvas.js", import.meta.url), "utf8"),
    readFile(new URL("../src/tools/codeWorkspace.js", import.meta.url), "utf8")
  ]);

  assert.match(javascript, /block\.type === "file_tree"/);
  assert.match(javascript, /block\.type === "diff"/);
  assert.match(javascript, /function renderCanvasFileTree/);
  assert.match(javascript, /function renderCanvasDiff/);
  assert.match(javascript, /code\.textContent = line\.text/);
  assert.doesNotMatch(javascript, /renderCanvasDiff[\s\S]*?innerHTML/);
  assert.match(css, /\.canvas-diff-line\.addition/);
  assert.match(css, /\.canvas-file-tree-row\.hidden/);
  assert.match(canvas, /MAX_DIFF_LINES = 4_000/);
  assert.match(canvas, /safeWorkspaceDisplayPath/);
  assert.match(tool, /name: "desktop_present_code_workspace"/);
  assert.match(tool, /Desktop reads Git and the filesystem directly/);
});

test("the renderer paints live thinking traces during a run", async () => {
  const [javascript, css, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);
  assert.match(javascript, /channel === "thinking"/);
  assert.match(javascript, /function updateStreamingThought/);
  assert.match(javascript, /function renderMarkdown\(container, source\) \{[\s\S]{0,120}container\.replaceChildren\(\)/);
  assert.match(javascript, /renderMarkdown\(markdown, text\)/);
  assert.doesNotMatch(javascript, /renderMarkdown\(markdown, collapseThoughtStream\(text\)\)/);
  assert.match(javascript, /from "\.\.\/\.\.\/src\/model\/thoughtDelta\.js"/);
  assert.match(javascript, /LIVE_THOUGHT_VISIBLE_LINES = 6/);
  assert.match(javascript, /LIVE_EVENT_VISIBLE_COUNT = 20/);
  assert.doesNotMatch(javascript, /className = "message-thought-stream"/);
  assert.doesNotMatch(javascript, /className = "message-live-steps"/);
  assert.doesNotMatch(javascript, /function appendInlineLiveStep/);
  assert.match(javascript, /Context is ready\. Waiting for the model/);
  assert.match(html, /id="approvalModal"[\s\S]*?<\/section>\s*<\/div>\s*<div id="chatRunStatus"/);
  assert.match(html, /id="chatRunStatus"[\s\S]*?<form id="promptForm"/);
  assert.match(html, /id="chatRunThoughtSnippet"/);
  assert.match(javascript, /updateStreamingThought\(event\.thinking \|\| event\.delta \|\| ""\)/);
  assert.doesNotMatch(javascript, /updateLiveThinkingCard/);
  assert.doesNotMatch(javascript, /thinking-live/);
  assert.doesNotMatch(css, /thinking-live/);
  assert.match(css, /\.conversation\.has-history \{ grid-template-rows: minmax\(0, 1fr\) auto auto; \}/);
  assert.match(css, /\.chat-run-thought/);
  assert.match(css, /\.chat-run-thought[\s\S]*?white-space:\s*pre-wrap/);
  assert.match(css, /\.chat-run-thought[\s\S]*?max-height:\s*8\.4em/);
});

test("the sidebar stays reachable on short Windows windows", async () => {
  const [javascript, css] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8")
  ]);
  assert.match(javascript, /function placeAccountMenu/);
  assert.match(javascript, /panelUserClosed/);
  assert.match(css, /\.account-menu\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.brand\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/);
  assert.match(javascript, /function explainOnboardingGate/);
  assert.match(javascript, /function applyPlatformShell/);
  assert.match(javascript, /document\.documentElement\.dataset\.platform = platform/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*?-webkit-app-region: no-drag;/);
  assert.match(css, /\.nav\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.sidebar-bottom\s*\{[\s\S]*?flex-shrink: 0;/);
  assert.match(css, /html\[data-platform="win32"\] \.sidebar/);
  assert.match(css, /@media \(max-height: 820px\)/);
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
  assert.match(html, /AMOS Intelligence is available with an AMOS company subscription: 14-day free trial, then plans starting at \$99\/month/);
  assert.match(html, /AMOS company subscription required/);
  assert.match(html, /AMOS Local and BYOK require no AMOS subscription/);
  assert.match(html, /id="managedProfileField" class="amos-routing-card hidden"/);
  assert.match(html, /id="hybridRoutingEnabled" type="checkbox"/);
  assert.match(html, /Off keeps the proven AMOS Hosted automatic path exactly as-is/);
  assert.match(html, /The tiny local router only classifies the step/);
  assert.match(html, /Use specialized models for coding/);
  assert.match(html, /Non-coding work stays on its normal route/);
  assert.match(html, /id="intelligenceRoleControls" class="role-selects hidden"/);
  assert.match(javascript, /hybridRouting: collectHybridRouting\(\)/);
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
  assert.match(html, /id="bedrockRetentionField"/);
  assert.match(html, /I understand this changes the data-retention mode for this AWS account/);
  assert.match(html, /AMOS will never enable this automatically/);
  assert.match(html, /AWS credential chain · SigV4 \(recommended\)/);
  assert.match(javascript, /modelInput\.addEventListener\("change", syncSelectedModelEndpoint\)/);
  assert.match(javascript, /bedrockAuthMode: selectedProvider === "bedrock"/);
  assert.match(javascript, /api\.configureBedrockDataRetention\(\{ confirmed: true \}\)/);
  assert.match(javascript, /model\.aliases\?\.includes\(selectedModel\)/);
  assert.match(javascript, /endpoint\.pathname = model\.endpointPath/);
  assert.match(javascript, /syncProviderReasoning\(provider, model\)/);
  assert.match(javascript, /data sharing required/);
  assert.match(javascript, /opt into provider data sharing/);
});

test("intelligence settings stay independent from workspace selection and are native-menu discoverable", async () => {
  const [javascript, html, preload, main] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="onboardingModelSelect"/);
  assert.match(html, /Intelligence &amp; Settings/);
  assert.match(html, /id="settingsBackButton"[^>]*>← Back to setup</);
  assert.match(html, /Choosing intelligence never requires choosing a workspace/);
  assert.match(html, /id="intelligenceTestStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(javascript, /"testing",\s*needsManagedConnection \? "Waiting for AMOS sign-in…" : "Testing intelligence…"/);
  assert.match(javascript, /"success",\s*`\$\{providerStatusLabel\(\)\} is connected`/);
  assert.match(javascript, /"error",\s*"Intelligence test failed"/);
  assert.match(javascript, /function returnFromIntelligenceSettings\(\) \{\s*showView\("operator"\);\s*\}/);
  assert.match(
    javascript,
    /async function saveSettings[\s\S]*?render\(\);\s*showView\("settings"\);/
  );
  assert.match(
    javascript,
    /async function activateLocalModel[\s\S]*?render\(\);\s*if \(!firstRunNeeded\(\)\) showView\("settings"\);/
  );
  assert.match(preload, /"desktop:navigate"/);
  assert.match(main, /label: "Intelligence & Settings…"/);
  assert.match(main, /accelerator: "CommandOrControl\+,"/);
  assert.match(main, /label: "Choose Intelligence…"/);
  assert.match(main, /label: "Memory & Context…"/);
  assert.match(main, /label: "Choose Workspace…"/);
  assert.match(main, /label: `AMOS Desktop v\$\{app\.getVersion\(\)\}`/);
  assert.match(main, /label: "Check for Updates…"/);
  assert.match(main, /navigateFromApplicationMenu\("settings"\)/);
  assert.match(main, /navigateFromApplicationMenu\("memory"\)/);
  assert.match(main, /navigateFromApplicationMenu\("choose-workspace"\)/);
  assert.match(main, /navigateFromApplicationMenu\("check-updates"\)/);
  assert.match(html, /id="accountVersion"/);
  assert.match(html, /id="accountUpdateButton"[^>]*>Check for updates</);
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
  assert.match(javascript, /function missionDecisionCard\(/);
  assert.match(javascript, /function renderInlineMissionDecision\(/);
  assert.match(javascript, /Retry the same mission/);
  assert.match(javascript, /Add optional guidance/);
  assert.match(javascript, /function missionContractSummary\(/);
  assert.match(javascript, /Read-only authority · no writes/);
  assert.match(javascript, /if \(isMissionApproval\(approval\)\)/);
  assert.match(javascript, /api\.answerMissionDecision\(decision\.id, exactAnswer\)/);
  assert.match(javascript, /inside its existing authority/);
  assert.match(javascript, /Choose an action below\. Only type guidance if neither choice says what you want/);
  assert.match(javascript, /Optional guidance/);
  assert.match(javascript, /Mission has been stopped and its Run Contract revoked/);
  assert.match(javascript, /Authorize “\$\{missionName\}”/);
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
  assert.match(javascript, /canDecideCompanyApprovalsInDesktop\(\)/);
  assert.match(javascript, /textContent = "Approve once"/);
  assert.match(javascript, /textContent = "Deny"/);
  assert.match(javascript, /api\.decideCompanyApproval\(id, approved \? "approve" : "deny"\)/);
  assert.match(javascript, /function renderInlineCompanyApproval\(/);
  assert.match(javascript, /companyApprovalChatBaseline == null/);
  assert.match(javascript, /if \(companyApprovalChatBaseline.has\(approval.id\)\) continue/);
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
  assert.match(controller, /const contextKey = `task:\$\{id\}`/);
  assert.match(controller, /if \(select\) \{[\s\S]*?this\.activeContextKey = contextKey/);
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
  assert.match(javascript, /api\.automationOperations\(automationSetupDraft\.destinationConnection\)/);
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
  assert.match(html, /Every durable thread/);
  assert.match(html, /id="taskProjectFilterInput"/);
  assert.match(html, /id="taskStatusFilters"/);
  assert.match(html, /id="taskPager"/);
  assert.match(html, /id="newTaskButton"[^>]*>New conversation/);
  assert.match(html, /id="newConversationButton"[^>]*>[\s\S]*?New conversation/);
  assert.match(html, /id="forkConversationButton"[^>]*>[\s\S]*?Fork conversation/);
  assert.match(html, /Everything[\s\S]*?From here[\s\S]*?Selected artifacts/);
  assert.match(html, /Same directory[\s\S]*?New Git worktree[\s\S]*?Context only/);
  assert.match(javascript, /const LIST_PAGE_SIZE = 15;/);
  assert.match(javascript, /function conversationStatusBucket\(task\)/);
  assert.match(javascript, /PROJECT · \$\{\(project\?\.name \|\| "Assigned"\)\.toUpperCase\(\)\}/);
  assert.match(javascript, /taskStatusFilter = option\.id/);
  assert.match(javascript, /paginateItems\(visible, "tasks"\)/);
  assert.match(javascript, /api\.openTask\(task\.id\)/);
  assert.match(javascript, /api\.prepareTaskCheckpoint\(id\)[\s\S]*?result\.state[\s\S]*?adoptOpenedTask\(result\)/);
  const checkpointResumeContract = javascript.match(
    /async function resumeTaskCheckpoint\(id, button\)([\s\S]*?)async function removeTaskCheckpoint/
  )?.[1] || "";
  assert.doesNotMatch(checkpointResumeContract, /promptInput\.value = result\.prompt/);
  assert.match(
    checkpointResumeContract,
    /await runTask\(null, \{[\s\S]*?automaticResume: true,[\s\S]*?prompt: result\.prompt,[\s\S]*?resumeTaskId: id/
  );
  assert.match(javascript, /automaticResume[\s\S]*?api\.run\(\{[\s\S]*?resumeTaskId/);
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
  assert.match(controller, /conversation: \{[\s\S]*?taskRecordId: this\.activeTaskRecordId,[\s\S]*?contextKey: this\.activeContextKey/);
  assert.match(controller, /restoreSelectedConversation\(settings\)/);
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
  assert.match(taskStore, /selectedAt: optionalTimestamp\(value\?\.selectedAt\)/);
  assert.match(taskStore, /scratchpad: normalizeScratchpad\(value\?\.scratchpad/);
  assert.match(controller, /bindConversationScratchpad/);
  assert.match(controller, /persistConversationScratchpad/);
  assert.match(workspace, /"worktree",[\s\S]*?"add"[\s\S]*?"-b"/);
  assert.doesNotMatch(workspace, /"reset"|"checkout"|"clean"|"stash"/);
});

test("Projects are context workspaces and Missions own autonomous work", async () => {
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
  assert.match(html, />Projects</);
  assert.match(html, /Use it for related conversations or attach it to a Mission/);
  assert.doesNotMatch(html, /give it a goal and leave/);
  assert.doesNotMatch(html, /id="activityCenterList"/);
  assert.doesNotMatch(html, /ACTIVITY CENTER/);
  assert.doesNotMatch(html, /id="projectSummary"/);
  assert.match(html, /id="projectCostInput"/);
  assert.match(html, /Dollar cap \/ conversation \(USD\)/);
  assert.doesNotMatch(html, /id="projectParallelInput"/);
  assert.doesNotMatch(html, /id="projectTokenInput"/);
  assert.doesNotMatch(html, /Token ceiling/);
  assert.match(javascript, /function renderProjects\(\)/);
  assert.match(javascript, /function liveProjectAttention\(/);
  assert.match(javascript, /function isProjectDecisionVerb\(/);
  assert.match(javascript, /attentionRuns\.length \+ waitingDecisions/);
  assert.doesNotMatch(javascript, /attentionRuns\.length \|\| waitingDecisions/);
  assert.match(javascript, /function projectConversationList\(projectId, conversations\)/);
  assert.match(javascript, /function projectActivityList\(projectId, runs\)/);
  assert.match(javascript, /function projectDecisionList\(/);
  assert.match(javascript, /function projectAccordion\(/);
  assert.match(javascript, /task\.projectId === project\.id/);
  assert.match(javascript, /api\.startNewConversation\(\{[\s\S]*?projectId: project\.id[\s\S]*?title: `Talk in \$\{project\.name\}`/);
  assert.match(javascript, /actionButton\("Talk", "primary"\)/);
  assert.match(javascript, /actionButton\("New Mission", "secondary"\)/);
  assert.doesNotMatch(javascript, /Leave a goal/);
  assert.match(html, /data-view="missions"/);
  assert.match(html, /id="missionsView"/);
  assert.match(html, /Start from a Mission template/);
  assert.match(html, /id="missionObjectiveInput"/);
  assert.match(html, /id="missionExecutionInput"/);
  assert.match(html, /id="missionProjectInput"/);
  assert.match(html, /id="missionCheckpointInput"/);
  assert.match(html, /Keep working; ask only when a real decision is needed/);
  assert.match(html, /Create Mission/);
  assert.match(javascript, /api\.startMission\(/);
  assert.match(javascript, /function renderMissions\(\)/);
  assert.match(javascript, /executionLocation === "local" \? "THIS COMPUTER" : "AMOS HOSTED"/);
  assert.match(preload, /desktop:start-mission/);
  assert.match(main, /controller\.startMission/);
  assert.match(controller, /async startLocalMission\(/);
  assert.match(controller, /async startHostedMission\(/);
  assert.match(controller, /async startMission\(/);
  assert.match(preload, /desktop:start-autonomous-goal/);
  assert.match(main, /controller\.startAutonomousGoal/);
  assert.match(controller, /async startAutonomousGoal\(/);
  assert.match(controller, /kind: "goal_pursuit"/);
  assert.match(javascript, /optimizationMissions/);
  assert.match(javascript, /controlOptimizationMission/);
  assert.match(javascript, /function renderMissionActivity/);
  assert.match(javascript, /api\.getMission\(mission\.id\)/);
  assert.match(preload, /desktop:get-mission/);
  assert.match(preload, /desktop:set-optimization-mission-status/);
  assert.match(main, /controller\.getMission/);
  assert.match(main, /controller\.setOptimizationMissionStatus/);
  assert.match(css, /\.list-filter\s*\{/);
  assert.match(html, /id="missionKindInput"/);
  assert.match(controller, /isolate: true/);
  assert.match(javascript, /function decisionInputCard\(/);
  assert.match(javascript, /request\.decisionType === "research-checkpoint"/);
  assert.doesNotMatch(html, /Interactive research check-in/);
  assert.doesNotMatch(html, /id="researchCheckpointInput"/);
  assert.match(controller, /Interactive Operator can already stop and steer/);
  assert.match(javascript, /resolveDecisionInput\(request, option, chip, true\)/);
  assert.match(javascript, /api\.resolveDecisionInput\(/);
  assert.match(preload, /desktop:resolve-decision-input/);
  assert.match(main, /controller\.resolveDecisionInput/);
  assert.match(controller, /createDecisionInputTool\(\)/);
  assert.match(javascript, /api\.cancelSupervisedRun\(/);
  assert.match(javascript, /The worker must acknowledge it at the next heartbeat/);
  assert.match(preload, /desktop:create-project/);
  assert.match(preload, /desktop:cancel-supervised-run/);
  assert.match(main, /controller\.createProject\(input\)/);
  assert.match(main, /controller\.cancelSupervisedTaskRun/);
  assert.match(controller, /remote\.projectsLibrary\(\)/);
  assert.match(controller, /execution_authority: false/);
  assert.match(controller, /AMOS_MODEL_TRANSIENT_AFTER_PROGRESS/);
  assert.match(controller, /desktopResearchCheckpointPolicy/);
  assert.match(remoteState, /this\.callCompanyTool\("list_projects"/);
  assert.match(remoteState, /this\.callCompanyTool\("list_task_inbox"/);
  assert.match(javascript, /AMOS could not load Projects from the connected company/);
  assert.doesNotMatch(html, /supervised-run contract/);
  assert.match(remoteState, /this\.mcp\.callTool\("start_task_run"/);
  assert.match(remoteState, /this\.mcp\.callTool\("report_task_run"/);
  assert.match(css, /\.project-list\s*\{[\s\S]*?max-width:\s*none/);
  assert.match(css, /\.project-accordion\s*\{/);
  assert.match(css, /\.project-activity-filters\s*\{/);
  assert.match(javascript, /projectActivityFilters\.set\(projectId, next\)/);
  assert.match(javascript, /`Activity · \$\{runs\.length\}`[\s\S]*?false/);
  assert.match(javascript, /function renderComposerProjectChip\(/);
  assert.match(javascript, /Talking in \$\{project\.name\}/);
  assert.match(html, /id="projectPager"/);
  assert.match(javascript, /paginateItems\(matchingProjects, "projects"\)/);
  assert.match(javascript, /In Conversations/);
  assert.match(css, /\.project-conversations\s*\{/);
  assert.doesNotMatch(javascript, /function renderActivityCenter\(/);
  assert.doesNotMatch(javascript, /Watch Activity Center/);
  assert.doesNotMatch(javascript, /All Projects & Conversations/);
  assert.doesNotMatch(html, /Neighborly rollout|Build KPI scorecard/);
});

test("Briefings are a single-column saved-view library with typed platform actions", async () => {
  const [javascript, html, css] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8")
  ]);

  assert.match(javascript, /const platformLibrary = state\.briefings \|\| \{\}/);
  assert.match(javascript, /api\.runBriefing\(input\)/);
  assert.match(javascript, /templateKey: template\.key/);
  assert.match(javascript, /api\.scheduleCanvasView\(activeCanvasId, cadence\)/);
  assert.match(html, /Company Briefing definitions and schedules live in governed AMOS state/);
  assert.match(html, />Briefings</);
  assert.match(html, /A saved company view that refreshes with governed data/);
  assert.match(html, /class="briefing-open-now hidden"/);
  assert.match(html, /id="briefingSearchInput"/);
  assert.match(html, /id="briefingPager"/);
  assert.match(html, /id="newBriefingButton"[^>]*>New Briefing/);
  assert.match(html, /id="composerProjectChip"/);
  assert.match(html, /<section class="briefing-templates"/);
  assert.match(javascript, /function startNewBriefingFromScratch\(/);
  assert.doesNotMatch(html, /CURRENT WORK SURFACES/);
  assert.doesNotMatch(html, /START FROM A TEMPLATE/);
  assert.doesNotMatch(html, /Briefings that stay useful/);
  assert.match(javascript, /function briefingSettingsMenu\(/);
  assert.match(javascript, /actionLabel: "Open now"/);
  assert.match(javascript, /paginateItems\(saved, "briefings"\)/);
  assert.match(css, /\.briefing-library\s*\{[\s\S]*?max-width:\s*none/);
  assert.match(css, /\.canvas-view \.canvas-shell \{ width: 100%; \}/);
  assert.doesNotMatch(css, /minmax\(280px/);
  assert.doesNotMatch(javascript, /const briefingTemplates\s*=/);
  assert.doesNotMatch(javascript, /title: "Goals and coaching"/);
  assert.doesNotMatch(javascript, /most relevant coaching or learning intervention/);
});

test("Operator is chat-first with transient progress and detailed activity in the Panel", async () => {
  const [javascript, html, css, preload, main] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="sidebarToggle"/);
  assert.match(html, /id="conversationHeading"/);
  assert.match(
    html,
    /class="composer-tools"[\s\S]*?id="newConversationButton"[\s\S]*?>[\s\S]*?New conversation/
  );
  assert.doesNotMatch(html, />Clear context<\/button>/);
  assert.doesNotMatch(html, /id="clearButton"/);
  assert.doesNotMatch(javascript, /function clearSession/);
  assert.doesNotMatch(javascript, /api\.clear\(/);
  assert.doesNotMatch(preload, /invoke\("desktop:clear"\)/);
  assert.doesNotMatch(main, /"desktop:clear"/);
  assert.match(html, /id="activityStream"/);
  assert.match(html, /Routing, tools, governed actions, timing, and recorded outcomes/);
  assert.match(html, /id="chatRunStatus"/);
  assert.match(html, /id="panelActivityTab"/);
  assert.match(html, /id="panelCanvasTab"/);
  assert.match(html, /id="canvasToggleButton" class="button ghost panel-toggle"/);
  const operator = html.match(/<section id="operatorView"([\s\S]*?)<section id="canvasView"/)?.[1] || "";
  const heading = operator.match(/id="conversationHeading"([\s\S]*?)<div id="messages"/)?.[1] || "";
  assert.doesNotMatch(operator, /class="work-panel"/);
  assert.doesNotMatch(heading, /id="clearButton"/);
  assert.match(javascript, /function beginInlineActivity\(\)/);
  assert.match(javascript, /function finishInlineActivity\(status = runTerminalState\)/);
  assert.match(javascript, /function renderInlineDecisionRequest\(/);
  assert.doesNotMatch(javascript, /renderInlineDecisionRequest\(approval, \{ focus: true \}\)/);
  assert.match(javascript, /decisionInputDrafts\.set\(request\.id, textarea\.value\)/);
  assert.match(javascript, /function captureInteractiveState\(\)/);
  assert.match(javascript, /restoreInteractiveState\(interaction\)/);
  assert.match(javascript, /runId === currentTaskId/);
  assert.match(javascript, /if \(result\.resolvedInput\)/);
  assert.match(javascript, /finishCanceledRunInUi/);
  assert.doesNotMatch(javascript, /Work complete/);
  assert.match(javascript, /selectJourneyStarterActions\(state\)/);
  assert.match(javascript, /button\.dataset\.actionId = action\.id/);
  assert.match(javascript, /executeStarterAction\(action, button\)/);
  assert.match(javascript, /privateAction: true,[\s\S]*?prompt: action\.prompt,[\s\S]*?displayText: action\.label/);
  assert.doesNotMatch(
    javascript.match(/function renderStarterActions\(\)[\s\S]*?\n}\n\nasync function executeStarterAction/)?.[0] || "",
    /promptInput\.value/
  );
  assert.match(javascript, /The model timed out after making progress\. Completed work is intact/);
  assert.match(javascript, /function toggleSidebar\(\)[\s\S]*?setSidebarCollapsed/);
  assert.match(javascript, /elements\.app\.classList\.toggle\("nav-collapsed", collapsed\)/);
  assert.match(
    javascript,
    /function renderConversationChrome\(\)[\s\S]*?\.message\.user, \.message\.assistant, \.message\.error[\s\S]*?conversationHeading\.classList\.toggle\("hidden", hasConversation \|\| Boolean\(project\)\)[\s\S]*?welcomeMessage\.classList\.toggle\("hidden", hasConversation\)[\s\S]*?starterActions\.classList\.toggle\("hidden", hasConversation \|\| Boolean\(project\)\)/
  );
  assert.match(javascript, /function renderComposerProjectChip\(/);
  assert.match(javascript, /approvalModal[\s\S]*?insertBefore\(message, anchor\)[\s\S]*?renderConversationChrome\(\)/);
  assert.match(javascript, /operatorView\.classList\.toggle\("has-demo-banner", demo\)/);
  assert.match(css, /\.sidebar-toggle\s*{[\s\S]*?-webkit-app-region: no-drag;[\s\S]*?z-index: 3;/);
  assert.match(css, /\.operator\s*{[\s\S]*?padding: 0;/);
  assert.match(css, /\.operator\.has-demo-banner\s*{\s*grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(css, /\.conversation\.has-history\s*{\s*grid-template-rows: minmax\(0, 1fr\) auto auto;/);
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
  assert.match(
    javascript,
    /api\.on\("canvas:changed"[\s\S]*?canvasSidecarOpen = true;[\s\S]*?currentPanelTab = "canvas";[\s\S]*?renderCanvas\(\);/
  );
  assert.match(javascript, /operatorGrid\.classList\.toggle\("has-context", sidecarVisible\)/);
  assert.match(javascript, /contextResizeHandle\.classList\.toggle\("hidden", !sidecarVisible\)/);
  assert.doesNotMatch(
    javascript,
    /api\.on\("canvas:changed",[\s\S]*?if \(activeCanvasId\) showView\("canvas"\)/
  );
  assert.match(javascript, /actionLabel: "Open now"/);
  assert.match(javascript, /onAction: \(\) => openCanvasSidecar\(canvas\.id\)/);
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
  assert.match(javascript, /function renderCanvasPresentation[\s\S]*?Open in PowerPoint[\s\S]*?Show in folder/);
  assert.match(javascript, /className = "presentation-artifact-link"/);
  assert.match(javascript, /api\.readDocumentPreview\(preview\.path\)/);
  assert.doesNotMatch(javascript, /renderCanvasPresentation[\s\S]{0,6000}(?:innerHTML|createElement\("iframe"\))/);
  assert.match(javascript, /className = "message-copy-button"/);
  assert.match(javascript, /await api\.copyText\(content\)/);
  assert.match(preload, /desktop:copy-text/);
  assert.match(main, /clipboard\.writeText\(copy\)/);
});

test("offline model cards badge unmeasured, conditional, experimental, and retired profiles", async () => {
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
  assert.match(javascript, /Retired — replace with Qwen 3\.8/);
  assert.match(javascript, /offlineCatalogFailures\(model\)/);
  assert.match(javascript, /model\.capabilityContract\?\.failures/);
  assert.match(javascript, /identity\.textContent = `Model · \$\{model\.modelDisplayName \|\| model\.id\}`/);
  assert.match(javascript, /Use in personal workspace/);
  assert.match(javascript, /switch Intelligence to AMOS Local/);
  assert.match(javascript, /currentBoundary !== "offline"/);
  assert.match(css, /\.offline-model-card > \.offline-model-identity/);
  assert.match(css, /\.offline-model-labels \.unmeasured \{ color: var\(--coral\); \}/);
  assert.match(css, /\.offline-model-labels \.retired \{ color: var\(--coral\); \}/);
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
  const [javascript, html, preload, main, settings, controller, css] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/settingsStore.js", import.meta.url), "utf8"),
    readFile(new URL("../src/desktop/controller.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/app.css", import.meta.url), "utf8")
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
  assert.match(controller, /const completedAt = settings\.onboardingCompletedAt \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(controller, /onboardingCompletedAt: completedAt/);
  assert.match(controller, /onboardingBoundary: "northwind",\s*onboardingCompletedAt: ""/);

  assert.match(onboarding, /Get a working brain\. Then connect your company\./);
  assert.doesNotMatch(onboarding, /Connect your company\.<br>Put AMOS to work\./);
  assert.doesNotMatch(onboarding, /class="onboarding-copy"/);
  assert.match(onboarding, /class="onboarding-step required"/);
  assert.match(onboarding, /class="onboarding-step recommended onboarding-step-retention"/);
  assert.match(onboarding, /class="onboarding-step optional"/);
  assert.match(onboarding, /id="onboardHostedButton"/);
  assert.match(onboarding, /id="onboardByokButton"/);
  assert.match(onboarding, /id="connectButton" class="start-mode-card featured primary-path"/);
  assert.match(onboarding, /<strong>Connect your company<\/strong>/);
  assert.match(onboarding, /Run automations on a schedule or ad hoc — app to app, inbox to ledger, ticket to fix — that run outside of Desktop/);
  assert.match(onboarding, /Connect the systems you already run so AMOS is not guessing from chat/);
  assert.match(onboarding, /Keep durable company memory, policy, approvals, and receipts/);
  assert.match(onboarding, /You can skip this for now and connect apps later/);
  assert.match(onboarding, /14-day free trial · Plans start at \$99\/month/);
  assert.match(onboarding, /<strong>Explore the Northwind demo<\/strong>/);
  assert.match(onboarding, /Limited hosted turns included · Local and BYOK available/);
  assert.match(onboarding, /id="northwindIntelligenceChoice"/);
  assert.match(onboarding, /Choose how to power the demo/);
  assert.match(onboarding, /<strong>AMOS Intelligence<\/strong>/);
  assert.match(onboarding, /AMOS subscription required for ongoing use\. Northwind includes limited hosted demo turns/);
  assert.match(onboarding, /<strong>AMOS Local<\/strong>/);
  assert.match(onboarding, /<strong>Bring my own key<\/strong>/);
  assert.match(onboarding, /DEFAULT · AMOS HOSTED/);
  assert.match(onboarding, /AMOS Hosted is selected/);
  assert.match(html, /id="onboardingGateModal"/);
  assert.match(html, /Enter AMOS Desktop first\./);
  assert.match(javascript, /function explainOnboardingGate/);
  assert.match(onboarding, /id="onboardingModelSelect"/);
  assert.match(onboarding, /id="onboardingByokKey"/);
  assert.match(onboarding, /The recommended local model for this computer is selected automatically/);
  assert.doesNotMatch(onboarding, /data-open-settings/);
  assert.match(onboarding, /No AMOS subscription\. Use OpenAI, Claude, Grok, Kimi/);
  assert.match(onboarding, /Connect the systems you already run/);
  assert.match(javascript, /function chooseHostedIntelligence/);
  assert.match(javascript, /async function chooseOnboardingDoor/);
  assert.match(javascript, /function recommendedOnboardingLocalModel/);
  assert.match(javascript, /function renderOnboardingPicker/);
  assert.match(javascript, /hostedReady \|\| \(startingPointSelected && state\.configured\)/);
  assert.match(javascript, /renderStep\(elements\.providerCheck, intelligenceReady\)/);
  assert.match(css, /#telemetryConsent\s*{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /#telemetryConsent > div:first-child\s*{ min-width: 0; }/);
  assert.match(css, /\.onboarding\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(html, /AMOS Hosted is the default/);
  assert.match(html, /pick a model here/);
  assert.match(html, /id="demoConnectButton"[^>]*>Connect my company<\/button>/);
  assert.match(html, /id="demoChangeIntelligenceButton"[^>]*>Change intelligence<\/button>/);
  assert.match(html, /id="demoLeaveButton"[^>]*>Leave demo<\/button>/);
  assert.match(javascript, /northwindUsageLabel/);
  assert.match(javascript, /messagesRemaining/);
  assert.match(javascript, /openDemoIntelligenceSettings/);
  assert.match(javascript, /async function leaveDemo/);
  assert.match(javascript, /personalNeedsIntelligence/);
  assert.match(javascript, /Choose a local profile or your own key/);
  assert.match(javascript, /enterButton\.disabled = !\(intelligenceReady && state\.mode\?\.valid !== false\)/);
  assert.match(javascript, /async function activateRecommendedOnboardingLocal/);
  assert.doesNotMatch(javascript, /liveBoundary/);
  assert.match(onboarding, /id="onboardingWorkspaceButton" class="onboarding-provider-link"/);
  assert.match(onboarding, /id="onboardingWorkspaceText"/);
  assert.match(onboarding, /A workspace is a folder on this computer AMOS may read and change/);
  assert.match(javascript, /function workspaceFolderName/);
  assert.match(css, /\.onboarding\s*{[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(html, /id="connectSystemsPush"/);
  assert.match(html, /<strong>Get the first answer from your real business<\/strong>/);
  assert.match(html, /Connect up to two apps/);
  assert.doesNotMatch(html, /this is why customers stay/);
  assert.doesNotMatch(html, /That is the product/);
  assert.doesNotMatch(javascript, /That is the product/);
  assert.doesNotMatch(javascript, /customers stay/);
  assert.match(html, /Estimate savings/);
  assert.match(javascript, /AMOS_SAVINGS_AUDIT_PROMPT/);
  assert.match(javascript, /type === "connect_platform"/);
  assert.match(css, /\.setup-readiness\s*{[\s\S]*?grid-template-columns: 1fr;/);
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
