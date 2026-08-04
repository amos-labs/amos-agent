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

test("built-in Briefings stay objective-led instead of prescribing coaching", async () => {
  const javascript = await readFile(
    new URL("../desktop/renderer/app.js", import.meta.url),
    "utf8"
  );

  assert.match(javascript, /title: "Goals and progress"/);
  assert.match(javascript, /unless the user requested it or cited company evidence supports it/);
  assert.match(javascript, /never describe data, an engine, or a capability as locked unless the platform explicitly reports that state/);
  assert.doesNotMatch(javascript, /title: "Goals and coaching"/);
  assert.doesNotMatch(javascript, /most relevant coaching or learning intervention/);
});

test("Operator is chat-first with collapsible navigation and inline governed progress", async () => {
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="sidebarToggle"/);
  assert.match(html, /id="activityStream"/);
  assert.match(html, /Progress summaries, governed tool use, and recorded outcomes/);
  const operator = html.match(/<section id="operatorView"([\s\S]*?)<section id="canvasView"/)?.[1] || "";
  assert.doesNotMatch(operator, /class="work-panel"/);
  assert.match(javascript, /function beginInlineActivity\(\)/);
  assert.match(javascript, /finishInlineActivity\(\)/);
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
  const [javascript, html] = await Promise.all([
    readFile(new URL("../desktop/renderer/app.js", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="canvasSidecar"/);
  assert.match(html, /id="liveCanvasList"/);
  assert.match(javascript, /if \(activeCanvasId\) canvasSidecarOpen = true;\s+renderCanvas\(\);/);
  assert.doesNotMatch(
    javascript,
    /api\.on\("canvas:changed",[\s\S]*?if \(activeCanvasId\) showView\("canvas"\)/
  );
  assert.match(javascript, /actionLabel: "Open beside chat"/);
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
  assert.doesNotMatch(sidebar, /id="companySwitcherControl" class="field company-switcher/);
  assert.match(sidebar, /Platform is never told what other accounts are present/);
  assert.match(controller, /clearEphemeralCompanyBoundary\(\)/);
});

test("canvas code and previews stay typed, inert, and outside the privileged renderer", async () => {
  const javascript = await readFile(
    new URL("../desktop/renderer/app.js", import.meta.url),
    "utf8"
  );
  assert.match(javascript, /function renderCanvasCode[\s\S]*?code\.textContent = block\.content/);
  assert.match(javascript, /function renderCanvasLink[\s\S]*?api\.openExternal\(block\.url\)/);
  assert.doesNotMatch(javascript, /renderCanvasLink[\s\S]{0,900}createElement\("iframe"\)/);
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
