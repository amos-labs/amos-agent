import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { DesktopBrowserRuntime } from "../desktop/browserRuntime.js";
import { assertPublicUrlSyntax } from "../src/util/publicUrl.js";

const scope = { boundary: "online", subjectId: "user-1", tenantId: "tenant-1", taskId: "task-1" };

function domElement({ attributes = {}, ...properties } = {}) {
  const element = {
    textContent: "", tagName: "INPUT", labels: [],
    getAttribute: name => attributes[name] || "",
    getBoundingClientRect: () => ({ width: 150, height: 30 }),
    ...properties
  };
  Object.defineProperty(element, "value", { get() { throw new Error("Editable values must not be read"); } });
  return element;
}

class LayoutWindow {
  constructor() {
    this.size = [1000, 700];
    this.sizes = [];
    this.url = "https://example.com/draft";
    this.scripts = [];
    this.listeners = {};
    const controls = [
      domElement({ type: "email", required: true, attributes: { name: "email" }, labels: [{ textContent: "Email" }] }),
      domElement({ type: "hidden", attributes: { name: "utm_source" }, getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
      domElement({ tagName: "BUTTON", type: "submit", attributes: { name: "send" } })
    ];
    this.controls = controls;
    this.form = domElement({ tagName: "FORM", method: "post", action: "https://example.com/lead", querySelectorAll: () => controls });
    this.images = [{ complete: true, naturalWidth: 100 }, { complete: true, naturalWidth: 0 }, { complete: false, naturalWidth: 0 }];
    this.links = [
      domElement({ href: "https://example.com/draft#missing", textContent: "Book a review" }),
      domElement({ href: "https://example.com/?access_token=secret", textContent: "Private" })
    ];
    this.document = {
      title: "Draft", documentElement: {}, body: {},
      querySelectorAll: selector => ({ img: this.images, "a[href]": this.links, form: [this.form] })[selector] || [],
      getElementById: () => null,
      getElementsByName: () => []
    };
    Object.defineProperties(this.document.documentElement, {
      scrollWidth: { get: () => this.size[0] + (this.size[0] === 390 ? 60 : 0) },
      clientWidth: { get: () => this.size[0] }
    });
    const browserWindow = {};
    Object.defineProperties(browserWindow, {
      innerWidth: { get: () => this.size[0] }, innerHeight: { get: () => this.size[1] }
    });
    const location = {};
    Object.defineProperty(location, "href", { get: () => this.url });
    this.scriptContext = { window: browserWindow, document: this.document, location, URL, getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
    this.webContents = {
      on: (name, callback) => { this.listeners[name] = callback; },
      setWindowOpenHandler() {}, isDestroyed: () => false,
      getURL: () => this.url,
      executeJavaScriptInIsolatedWorld: async (world, scripts, gesture) => {
        assert.equal(world, 1004);
        assert.equal(gesture, false);
        assert.equal(scripts.length, 1);
        this.scripts.push(scripts[0].code);
        return vm.runInNewContext(scripts[0].code, this.scriptContext);
      },
      capturePage: async () => ({ getSize: () => ({ width: this.size[0], height: this.size[1] }), toPNG: () => Buffer.from("frame") })
    };
  }
  getContentSize() { return [...this.size]; }
  setContentSize(width, height) { this.size = [width, height]; this.sizes.push([width, height]); }
  on() {}
  isDestroyed() { return false; }
}

async function setup() {
  let id = 0;
  const policyCalls = [];
  const runtime = new DesktopBrowserRuntime({
    BrowserWindow: LayoutWindow,
    session: { fromPartition: () => ({ webRequest: { onBeforeRequest() {} } }) },
    createId: () => `id-${++id}`
  });
  runtime.publicPolicy.validate = async (url, options) => {
    policyCalls.push({ url: String(url), options });
    return assertPublicUrlSyntax(url);
  };
  const record = await runtime.createSession(scope);
  record.revision = 4;
  record.url = record.window.url;
  record.title = "Draft";
  record.refs.set("old-ref", { revision: 4, selector: "#old" });
  return { runtime, record, window: record.window, policyCalls, inspect: options => runtime.inspectLayout(scope, { sessionId: record.id, ...options }) };
}

test("layout inspection reads fixed desktop/mobile DOM evidence and restores the original viewport", async () => {
  const run = await setup();
  const result = await run.inspect();
  assert.deepEqual(run.window.sizes, [[1280, 800], [390, 844], [1000, 700]]);
  assert.equal(result.page_revision, 4);
  assert.equal(result.url, "https://example.com/draft");
  assert.deepEqual(result.viewports.map(view => view.horizontal_overflow_px), [0, 60]);
  assert.deepEqual(result.viewports[1].images, { total: 3, inspected: 3, broken: 1, pending: 1 });
  assert.equal(result.viewports[1].links[0].missing_fragment, true);
  assert.equal(result.viewports[1].links[1].href, "", "credential URLs do not enter evidence");
  assert.equal(result.viewports[1].forms[0].controls[0].required, true);
  assert.equal(result.viewports[1].forms[0].controls[1].visible, false);
  assert.equal(JSON.stringify(result).includes('"value"'), false);
  assert.equal(result.frame.width, 1000);
  assert.equal(run.record.refs.size, 0, "resizing invalidates old interaction references");
  assert.equal(run.record.layoutInspectionActive, false);
  assert.equal(run.policyCalls.length, 2);
  assert.ok(run.policyCalls.every(call => call.options.allowSensitiveQuery === false));
  assert.match(result.limitations.join(" "), /do not establish visual design quality/);
  assert.ok(run.window.scripts.every(script => !/fetch\(|\.submit\(|\.click\(|\.value\b|executeJavaScript/.test(script)));
});

test("another task or tenant cannot inspect or resize this browser session", async () => {
  const run = await setup();
  for (const changed of [{ taskId: "other" }, { tenantId: "other" }, { subjectId: "other" }]) {
    await assert.rejects(run.runtime.inspectLayout({ ...scope, ...changed }, { sessionId: run.record.id }), /not available to this task and account/);
  }
  assert.deepEqual(run.window.sizes, []);
});

test("viewport API absence, direct user control, and unsafe navigation fail without inspection", async () => {
  const run = await setup();
  run.record.userVisible = true;
  await assert.rejects(run.inspect(), /Direct user control/);
  run.record.userVisible = false;
  const setSize = run.window.setContentSize;
  run.window.setContentSize = undefined;
  await assert.rejects(run.inspect(), /does not support bounded viewport/);
  run.window.setContentSize = setSize;
  run.window.url = "http://127.0.0.1:3000/private";
  await assert.rejects(run.inspect(), /public|local|private|loopback/i);
  assert.equal(run.window.scripts.length, 0);
  assert.deepEqual(run.window.size, [1000, 700]);
});

test("inspection failure at mobile width still restores the viewport and releases the lock", async () => {
  const run = await setup();
  const execute = run.window.webContents.executeJavaScriptInIsolatedWorld;
  run.window.webContents.executeJavaScriptInIsolatedWorld = (...args) => {
    if (run.window.size[0] === 390) throw new Error("Inspection failed");
    return execute(...args);
  };
  await assert.rejects(run.inspect(), /Inspection failed/);
  assert.deepEqual(run.window.size, [1000, 700]);
  assert.equal(run.record.layoutInspectionActive, false);
  assert.equal(run.record.frame, null);
});

test("navigation during inspection rejects mixed-page observations and restores the viewport", async () => {
  const run = await setup();
  const execute = run.window.webContents.executeJavaScriptInIsolatedWorld;
  run.window.webContents.executeJavaScriptInIsolatedWorld = async (...args) => {
    const result = await execute(...args);
    run.record.revision += 1;
    return result;
  };
  await assert.rejects(run.inspect(), /page changed/);
  assert.deepEqual(run.window.size, [1000, 700]);
  assert.equal(run.record.frame, null);
});

test("cancellation releases a hung isolated inspection and restores the viewport", async () => {
  const run = await setup();
  const abort = new AbortController();
  let started;
  const inspecting = new Promise(resolve => { started = resolve; });
  run.window.webContents.executeJavaScriptInIsolatedWorld = () => { started(); return new Promise(() => {}); };
  const pending = run.inspect({ signal: abort.signal });
  await inspecting;
  await assert.rejects(run.runtime.startUserTakeover(run.record.id), /finishing a layout check/);
  await assert.rejects(run.runtime.snapshot(scope, { sessionId: run.record.id }), /layout inspection is in progress/);
  abort.abort();
  await assert.rejects(pending, /canceled/);
  assert.deepEqual(run.window.size, [1000, 700]);
  assert.equal(run.record.layoutInspectionActive, false);
});

test("user takeover that is already starting excludes a competing layout inspection", async () => {
  const run = await setup();
  let capture;
  run.window.webContents.capturePage = () => new Promise(resolve => { capture = resolve; });
  const pending = run.runtime.startUserTakeover(run.record.id);
  await assert.rejects(run.inspect(), /Direct user control/);
  assert.deepEqual(run.window.sizes, []);
  capture({ getSize: () => ({ width: 1000, height: 700 }), toPNG: () => Buffer.from("frame") });
  await pending;
  assert.equal(run.record.userVisible, true);
  assert.equal(run.record.takeoverStarting, false);
});

test("large pages report truncated observations instead of claiming exhaustive checks", async () => {
  const run = await setup();
  run.window.images = Array.from({ length: 201 }, () => ({ complete: true, naturalWidth: 100 }));
  run.window.links = Array.from({ length: 61 }, () => domElement({ href: "https://example.com/" }));
  const result = await run.inspect();
  assert.equal(result.viewports[0].truncated, true);
  assert.equal(result.viewports[0].images.inspected, 200);
  assert.equal(result.viewports[0].link_count, 61);
  assert.equal(result.viewports[0].links.length, 60);
});

test("viewport mismatch never becomes a claimed mobile layout check", async () => {
  const run = await setup();
  const resize = run.window.setContentSize.bind(run.window);
  run.window.setContentSize = (width, height) => resize(width === 390 ? 500 : width, height);
  await assert.rejects(run.inspect(), /could not establish the requested layout viewport/);
  assert.deepEqual(run.window.size, [1000, 700]);
});

test("late screenshot completion after cancellation cannot repopulate frame evidence", async () => {
  const run = await setup();
  const abort = new AbortController();
  let captured;
  let started;
  const capturing = new Promise(resolve => { started = resolve; });
  run.window.webContents.capturePage = () => { started(); return new Promise(resolve => { captured = resolve; }); };
  const pending = run.inspect({ signal: abort.signal });
  await capturing;
  abort.abort();
  await assert.rejects(pending, /canceled/);
  captured({ getSize: () => ({ width: 1000, height: 700 }), toPNG: () => Buffer.from("late") });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.record.frame, null);
  assert.equal(run.record.layoutInspectionActive, false);
  assert.deepEqual(run.window.size, [1000, 700]);
});

test("valid legacy, top, and text fragments are not reported as broken links", async () => {
  const run = await setup();
  run.window.links = ["top", "legacy", ":~:text=Example"].map(fragment => domElement({ href: `https://example.com/draft#${fragment}` }));
  run.window.document.getElementsByName = name => name === "legacy" ? [{ tagName: "A" }] : [];
  const result = await run.inspect();
  assert.ok(result.viewports[0].links.every(link => link.missing_fragment === false));
});

test("long form metadata remains bounded while geometry and total counts survive", async () => {
  const run = await setup();
  run.window.form.querySelectorAll = () => Array.from({ length: 60 }, () => domElement({
    attributes: { name: "n".repeat(160), "aria-label": "l".repeat(160) }, type: "text"
  }));
  const result = await run.inspect();
  for (const view of result.viewports) {
    assert.ok(JSON.stringify(view).length <= 16_000);
    assert.equal(view.truncated, true);
    assert.equal(view.forms[0].control_count, 60);
    assert.equal(view.forms[0].truncated, true);
    assert.ok(view.forms[0].controls.length < 60);
  }
  assert.equal(result.viewports[1].horizontal_overflow_px, 60);
});
