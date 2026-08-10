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
    /api\.on\("remote:changed",[\s\S]*?Object\.assign\(state, remote\)[\s\S]*?renderConnections\(\)/
  );
  assert.match(
    javascript,
    /api\.on\("remote:changed",[\s\S]*?Object\.assign\(state, remote\)[\s\S]*?renderHistory\(\)/
  );
});

test("Connections HTML contains no customer or provider-specific catalog truth", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
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
  assert.match(nav, /data-view="operator"[\s\S]*?data-view="tasks"[\s\S]*?data-view="canvas"[\s\S]*?data-view="connections"[\s\S]*?data-view="automations"[\s\S]*?data-view="work"/);
  assert.match(accountMenu, /id="accountMemoryButton"[\s\S]*?Memory &amp; context/);
  assert.match(accountMenu, /id="accountIntelligenceButton"[\s\S]*?Intelligence &amp; infrastructure/);
  assert.match(html, /id="memoryView"/);
  assert.match(html, /Connect systems[\s\S]*?Understand &amp; analyze[\s\S]*?Build deterministic automation[\s\S]*?Pursue governed goals/);
  assert.match(javascript, /const library = state\.automations \|\| \{\}/);
  assert.match(javascript, /api\.setAutomationStatus\(automation\.name, active\)/);
  assert.match(javascript, /api\.startNewConversation\(\{[\s\S]*?kind: "automation_builder"/);
  assert.match(preload, /desktop:start-new-conversation/);
  assert.match(preload, /desktop:set-automation-status/);
  assert.match(main, /controller\.startNewConversation\(input\)/);
  assert.match(main, /controller\.setAutomationStatus\(input\?\.name, input\?\.active === true\)/);
  assert.match(controller, /const id = randomUUID\(\);[\s\S]*?this\.activeContextKey = `task:\$\{id\}`/);
  assert.match(controller, /continuityCapturePayload\(transition, settings, this\.activeContextKey\)/);
  assert.match(remoteState, /this\.mcp\.callTool\("list_automations"/);
  assert.match(remoteState, /active \? "resume_automation" : "pause_automation"/);
  assert.doesNotMatch(html, /Neighborly|Franchise scorecard follow-up/);
});

test("Tasks expose durable resume, governed forking, lineage, and task-bound canvases", async () => {
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
  assert.match(html, /Everything[\s\S]*?From here[\s\S]*?Selected artifacts/);
  assert.match(html, /Same directory[\s\S]*?New Git worktree[\s\S]*?Context only/);
  assert.match(javascript, /api\.openTask\(task\.id\)/);
  assert.match(javascript, /api\.forkTask\(\{/);
  assert.match(javascript, /Fork from here/);
  assert.match(preload, /desktop:open-task/);
  assert.match(preload, /desktop:fork-task/);
  assert.match(main, /controller\.forkTaskResource\(input\)/);
  assert.match(controller, /this\.canvases\.restore\(task\.canvasState \|\| \{\}\)/);
  assert.match(controller, /replayed: false/);
  assert.match(taskStore, /pendingOperationsCopied: false/);
  assert.match(taskStore, /credentialsIncluded: false/);
  assert.match(workspace, /"worktree",[\s\S]*?"add"[\s\S]*?"-b"/);
  assert.doesNotMatch(workspace, /"reset"|"checkout"|"clean"|"stash"/);
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
  assert.match(html, /id="autoApproveFolderButton"/);
  assert.match(html, /id="approvalModal" class="approval-modal inline-approval hidden"/);
  assert.match(html, /You can keep typing while this waits/);
  assert.doesNotMatch(html, /id="approvalModal" class="modal-backdrop/);
  assert.match(javascript, /api\.setLocalApprovalMode\(enabled \? "ask" : "workspace"\)/);
  assert.match(javascript, /api\.allowLocalApprovalKind\(approval\.kind\)/);
  assert.match(javascript, /elements\.messages\.append\(elements\.approvalModal\)/);
  assert.match(javascript, /Keep typing—your direction will be queued while this approval waits/);
  assert.match(javascript, /elements\.promptInput\.disabled = false/);
  assert.match(javascript, /Company approvals remain governed/);
  assert.match(preload, /desktop:set-local-approval-mode/);
  assert.match(main, /Exact project folder:/);
  assert.match(main, /run with your local user permissions and are not OS-sandboxed/);
  assert.match(main, /Changing folders turns this off automatically/);
  assert.match(main, /AMOS company operations, connected-app writes, and governed decisions/);
  assert.match(main, /defaultId: 1/);
  assert.match(main, /cancelId: 1/);
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
  assert.match(javascript, /function renderCanvasCode[\s\S]*?code\.textContent = block\.content/);
  assert.match(javascript, /function renderCanvasLink[\s\S]*?api\.openExternal\(block\.url\)/);
  assert.doesNotMatch(javascript, /renderCanvasLink[\s\S]{0,900}createElement\("iframe"\)/);
  assert.match(javascript, /function renderCanvasDocument[\s\S]*?title\.textContent = block\.document\.title/);
  assert.match(javascript, /function renderDocumentPreviewBlock[\s\S]*?paragraph\.textContent = block\.text/);
  assert.match(javascript, /api\.openDocumentArtifact\(path, mode\)/);
  assert.doesNotMatch(javascript, /renderCanvasDocument[\s\S]{0,6000}(?:innerHTML|createElement\("iframe"\))/);
  assert.match(preload, /desktop:open-document-artifact/);
  assert.match(main, /controller\.resolveDocumentArtifactPath\(input\?\.path\)/);
  assert.match(main, /shell\.openPath\(artifactPath\)/);
  assert.match(main, /shell\.showItemInFolder\(artifactPath\)/);
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
