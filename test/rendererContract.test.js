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
  assert.match(
    javascript,
    /elements\.approvalsButton\.addEventListener\("click", \(\) => showView\("decisions"\)\)/
  );
  assert.match(javascript, /state\.approvalDecisionMode === "desktop"/);
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
  assert.doesNotMatch(html, /class="work-panel"/);
  assert.match(javascript, /function beginInlineActivity\(\)/);
  assert.match(javascript, /finishInlineActivity\(\)/);
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
