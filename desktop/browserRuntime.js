import { createHash, randomUUID } from "node:crypto";
import { assertPublicUrl, assertPublicUrlSyntax, parsePublicHttpUrl } from "../src/util/publicUrl.js";

const VIEWPORT = Object.freeze({ width: 1280, height: 800 });
const ISOLATED_WORLD_ID = 1004;
const DEFAULT_MAX_ELEMENTS = 80;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_SESSIONS = 6;
const ACTION_KINDS = new Set(["click", "type", "select", "check"]);
const TAKEOVER_TITLE = "AMOS Secure Browser";

export class DesktopBrowserRuntime {
  constructor({ BrowserWindow, session, now = () => new Date(), createId = randomUUID } = {}) {
    if (typeof BrowserWindow !== "function" || !session?.fromPartition) {
      throw new Error("The governed browser requires Electron BrowserWindow and session APIs");
    }
    this.BrowserWindow = BrowserWindow;
    this.electronSession = session;
    this.now = now;
    this.createId = createId;
    this.sessions = new Map();
    this.publicPolicy = new PublicUrlPolicy({ now });
  }

  async open(scope, { url, sessionId = null, signal = null } = {}) {
    throwIfAborted(signal);
    const target = await this.publicPolicy.validate(url, { allowSensitiveQuery: false });
    let record = sessionId ? this.requireSession(scope, sessionId) : null;
    const created = !record;
    if (created) record = await this.createSession(scope);
    try {
      assertAgentControl(record);
      throwIfAborted(signal);
      await this.load(record, target, signal);
      const snapshot = await this.snapshot(scope, {
        sessionId: record.id,
        maxElements: DEFAULT_MAX_ELEMENTS,
        maxChars: DEFAULT_MAX_CHARS,
        signal
      });
      return { ...snapshot, operation: "open" };
    } catch (error) {
      if (created) this.destroy(record);
      throw error;
    }
  }

  async snapshot(scope, {
    sessionId,
    maxElements = DEFAULT_MAX_ELEMENTS,
    maxChars = DEFAULT_MAX_CHARS,
    signal = null
  } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const expectedRevision = record.revision;
    throwIfAborted(signal);
    const elementLimit = boundedInteger(maxElements, DEFAULT_MAX_ELEMENTS, 1, 120);
    const characterLimit = boundedInteger(maxChars, DEFAULT_MAX_CHARS, 500, 20_000);
    const raw = await executeIsolated(record.window.webContents, snapshotScript({
      maxElements: elementLimit,
      maxChars: characterLimit
    }));
    throwIfAborted(signal);
    assertStableRevision(record, expectedRevision);
    const frame = await this.capture(record);
    assertStableRevision(record, expectedRevision);
    record.refs.clear();
    const elements = (Array.isArray(raw?.elements) ? raw.elements : []).slice(0, elementLimit)
      .map((element) => this.referenceElement(record, element));
    const observedAt = this.now().toISOString();
    record.lastObservedAt = observedAt;
    record.title = cleanText(raw?.title, 300) || record.title || "Untitled page";
    record.url = cleanUrl(raw?.url) || record.url;
    return {
      ok: true,
      status: "ready",
      session_id: record.id,
      url: record.url,
      title: record.title,
      page_revision: record.revision,
      observed_at: observedAt,
      text: cleanText(raw?.text, characterLimit),
      summary: cleanText(raw?.summary, 1_000),
      element_count: elements.length,
      elements,
      frame,
      takeover_active: record.userVisible === true
    };
  }

  async extract(scope, {
    sessionId,
    kind,
    ref = null,
    maxChars = 20_000,
    signal = null
  } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const expectedRevision = record.revision;
    const extractionKind = String(kind || "");
    if (!["article", "table", "list", "form", "region"].includes(extractionKind)) {
      throw new Error("Unsupported browser extraction kind");
    }
    const characterLimit = boundedInteger(maxChars, 20_000, 500, 30_000);
    let selector = null;
    if (extractionKind === "region") {
      selector = this.resolveReference(record, ref).selector;
    }
    throwIfAborted(signal);
    const extracted = await executeIsolated(record.window.webContents, extractionScript({
      kind: extractionKind,
      selector,
      maxChars: characterLimit
    }));
    throwIfAborted(signal);
    assertStableRevision(record, expectedRevision);
    const frame = await this.capture(record);
    assertStableRevision(record, expectedRevision);
    const observedAt = this.now().toISOString();
    return {
      ok: true,
      status: "ready",
      session_id: record.id,
      url: record.url,
      title: record.title,
      page_revision: record.revision,
      observed_at: observedAt,
      kind: extractionKind,
      data: boundStructured(extracted, characterLimit),
      element_count: record.refs.size,
      summary: `Extracted ${extractionKind} content from the current page revision.`,
      frame,
      takeover_active: record.userVisible === true
    };
  }

  async screenshot(scope, { sessionId, signal = null } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const expectedRevision = record.revision;
    throwIfAborted(signal);
    const frame = await this.capture(record);
    assertStableRevision(record, expectedRevision);
    const observedAt = this.now().toISOString();
    return {
      ok: true,
      status: "ready",
      session_id: record.id,
      url: record.url,
      title: record.title,
      page_revision: record.revision,
      observed_at: observedAt,
      element_count: record.refs.size,
      summary: "Refreshed the local browser screenshot shown in the dynamic canvas.",
      frame,
      takeover_active: record.userVisible === true
    };
  }

  async prepareAction(scope, {
    sessionId,
    kind,
    ref,
    optionRef = null,
    text = "",
    replace = true,
    checked = null,
    signal = null
  } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const actionKind = String(kind || "");
    if (!ACTION_KINDS.has(actionKind)) throw new Error("Unsupported browser action kind");
    const expectedRevision = record.revision;
    const targetReference = this.resolveReference(record, ref);
    const optionReference = actionKind === "select"
      ? this.resolveReference(record, optionRef)
      : null;
    const payload = normalizeActionPayload(actionKind, { text, replace, checked });
    throwIfAborted(signal);
    const descriptor = await executeIsolated(
      record.window.webContents,
      actionDescriptorScript({
        selector: targetReference.selector,
        optionSelector: optionReference?.selector || null
      })
    );
    throwIfAborted(signal);
    assertStableRevision(record, expectedRevision);
    const classification = classifyBrowserAction(actionKind, descriptor, payload);
    const frame = await this.capture(record);
    assertStableRevision(record, expectedRevision);
    const publicAction = publicBrowserAction({
      kind: actionKind,
      ref,
      optionRef,
      descriptor,
      payload,
      classification,
      url: record.url,
      revision: record.revision
    });
    const plan = {
      sessionId: record.id,
      revision: record.revision,
      kind: actionKind,
      ref: String(ref),
      optionRef: optionRef ? String(optionRef) : null,
      selector: targetReference.selector,
      optionSelector: optionReference?.selector || null,
      payload,
      fingerprint: actionFingerprint({
        kind: actionKind,
        ref,
        optionRef,
        descriptor,
        payload
      }),
      publicAction,
      requiresApproval: classification.requiresApproval,
      takeoverRequired: classification.takeoverRequired
    };
    return {
      plan,
      public_action: publicAction,
      requires_approval: plan.requiresApproval,
      takeover_required: plan.takeoverRequired,
      observation: {
        ok: true,
        status: "ready",
        session_id: record.id,
        url: record.url,
        title: record.title,
        page_revision: record.revision,
        observed_at: this.now().toISOString(),
        element_count: record.refs.size,
        summary: plan.takeoverRequired
          ? "This authentication or sensitive field requires direct user control."
          : plan.requiresApproval
            ? "Review the exact browser action beside this fresh page observation."
            : "Prepared a bounded observational browser action.",
        frame,
        takeover_active: record.userVisible === true
      }
    };
  }

  async performAction(scope, { plan, approved = false, waitMs = 750, signal = null } = {}) {
    if (!plan || !ACTION_KINDS.has(plan.kind)) throw new Error("A prepared browser action is required");
    if (plan.takeoverRequired) {
      throw new Error("Authentication and sensitive fields require direct user control");
    }
    if (plan.requiresApproval && approved !== true) {
      throw new Error("This consequential browser action requires exact human approval");
    }
    const record = this.requireSession(scope, plan.sessionId);
    assertAgentControl(record);
    assertStableRevision(record, plan.revision);
    throwIfAborted(signal);
    const descriptor = await executeIsolated(
      record.window.webContents,
      actionDescriptorScript({ selector: plan.selector, optionSelector: plan.optionSelector })
    );
    const fingerprint = actionFingerprint({
      kind: plan.kind,
      ref: plan.ref,
      optionRef: plan.optionRef,
      descriptor,
      payload: plan.payload
    });
    if (fingerprint !== plan.fingerprint) {
      record.refs.clear();
      record.frame = null;
      throw new Error("The browser action target changed while approval was pending; take a fresh snapshot");
    }
    const before = { url: record.url, page_revision: record.revision };
    const directNavigation = plan.kind === "click" &&
      plan.publicAction.risk === "observational" &&
      descriptor.target?.tag === "a"
      ? await this.publicPolicy.validate(descriptor.target.href, { allowSensitiveQuery: false })
      : null;
    if (directNavigation) {
      await this.load(record, directNavigation, signal);
    } else {
      await executeIsolated(record.window.webContents, actionScript({
        kind: plan.kind,
        selector: plan.selector,
        optionSelector: plan.optionSelector,
        payload: plan.payload
      }));
    }
    throwIfAborted(signal);
    await this.waitForSettled(record, boundedInteger(waitMs, 750, 250, 5_000), signal);
    const snapshot = await this.snapshot(scope, {
      sessionId: record.id,
      maxElements: DEFAULT_MAX_ELEMENTS,
      maxChars: DEFAULT_MAX_CHARS,
      signal
    });
    return {
      ...snapshot,
      operation: plan.kind,
      action_receipt: {
        contract: "amos.browser-action:1",
        receipt_id: this.createId(),
        action: plan.kind,
        risk: plan.publicAction.risk,
        approved: approved === true,
        target: plan.publicAction.target,
        payload: plan.publicAction.payload,
        before,
        after: { url: snapshot.url, page_revision: snapshot.page_revision },
        executed_at: this.now().toISOString(),
        verified: true
      },
      summary: `Completed and verified the ${plan.kind} action on the current page.`
    };
  }

  async wait(scope, {
    sessionId,
    condition = "settled",
    value = "",
    timeoutMs = 5_000,
    signal = null
  } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const waitCondition = String(condition || "settled");
    if (!new Set(["settled", "url", "text"]).has(waitCondition)) {
      throw new Error("Unsupported browser wait condition");
    }
    const expected = cleanText(value, 300);
    if (waitCondition !== "settled" && !expected) {
      throw new Error(`browser_wait requires a value for the ${waitCondition} condition`);
    }
    const limit = boundedInteger(timeoutMs, 5_000, 250, 10_000);
    const started = Date.now();
    if (waitCondition === "settled") {
      const settled = await this.waitForSettled(record, limit, signal);
      if (!settled) throw new Error("Browser wait timed out before the page settled");
    } else {
      let matched = false;
      while (Date.now() - started < limit) {
        throwIfAborted(signal);
        const observed = await executeIsolated(
          record.window.webContents,
          waitConditionScript({ condition: waitCondition, value: expected })
        );
        if (observed === true) {
          matched = true;
          break;
        }
        await delay(100, signal);
      }
      if (!matched) {
        throw new Error(`Browser wait timed out before the ${waitCondition} condition matched`);
      }
    }
    const snapshot = await this.snapshot(scope, {
      sessionId: record.id,
      maxElements: DEFAULT_MAX_ELEMENTS,
      maxChars: DEFAULT_MAX_CHARS,
      signal
    });
    return {
      ...snapshot,
      operation: "wait",
      summary: `The browser ${waitCondition} condition matched and the page was observed again.`
    };
  }

  async startUserTakeover(sessionId) {
    const record = this.requireSessionById(sessionId);
    if (!record.frame) await this.capture(record);
    record.userVisible = true;
    record.window.setTitle?.(takeoverTitle(record.url));
    record.window.show?.();
    record.window.focus?.();
    return takeoverResult(record, this.now(), true);
  }

  async finishUserTakeover(sessionId) {
    const record = this.requireSessionById(sessionId);
    record.userVisible = false;
    record.window.hide?.();
    const snapshot = await this.snapshot(record.scope, {
      sessionId: record.id,
      maxElements: DEFAULT_MAX_ELEMENTS,
      maxChars: DEFAULT_MAX_CHARS
    });
    return {
      ...snapshot,
      operation: "takeover_finished",
      takeover_active: false,
      summary: "Direct user control ended. AMOS refreshed the page without reading credentials or form values."
    };
  }

  async waitForSettled(record, timeoutMs, signal = null) {
    const started = Date.now();
    await delay(Math.min(150, timeoutMs), signal);
    while (Date.now() - started < timeoutMs) {
      throwIfAborted(signal);
      assertAgentControl(record);
      const loading = record.window.webContents.isLoading?.() === true;
      const ready = await executeIsolated(
        record.window.webContents,
        "(() => document.readyState === 'interactive' || document.readyState === 'complete')()"
      ).catch(() => false);
      if (!loading && ready) {
        await delay(Math.min(200, Math.max(0, timeoutMs - (Date.now() - started))), signal);
        return true;
      }
      await delay(100, signal);
    }
    return false;
  }

  async close(scope, { sessionId } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const result = {
      ok: true,
      status: "closed",
      session_id: record.id,
      url: record.url,
      title: record.title,
      page_revision: record.revision,
      observed_at: this.now().toISOString(),
      element_count: 0,
      summary: "Closed the task-bound browser and revoked its references and frame."
    };
    this.destroy(record);
    return result;
  }

  readFrame(sessionId, frameId) {
    const record = this.sessions.get(String(sessionId || ""));
    if (!record || !record.frame || record.frame.id !== frameId) {
      throw new Error("That browser frame is no longer available");
    }
    return {
      mime: "image/png",
      base64: record.frame.buffer.toString("base64"),
      width: record.frame.width,
      height: record.frame.height
    };
  }

  closeSession(sessionId) {
    const record = this.sessions.get(String(sessionId || ""));
    if (!record) return false;
    this.destroy(record);
    return true;
  }

  closeAll() {
    for (const record of [...this.sessions.values()]) this.destroy(record);
  }

  async createSession(scope) {
    while (this.sessions.size >= MAX_SESSIONS) {
      this.destroy([...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt)[0]);
    }
    const normalizedScope = normalizeScope(scope);
    const id = this.createId();
    const partition = `amos-browser-${createHash("sha256")
      .update(`${scopeKey(normalizedScope)}:${id}`)
      .digest("hex")
      .slice(0, 24)}`;
    const browserSession = this.electronSession.fromPartition(partition, { cache: false });
    this.lockSessionNetwork(browserSession);
    const window = new this.BrowserWindow({
      title: TAKEOVER_TITLE,
      show: false,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      paintWhenInitiallyHidden: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        session: browserSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    });
    window.setMenuBarVisibility?.(false);
    const record = {
      id,
      scope: normalizedScope,
      window,
      browserSession,
      revision: 0,
      refs: new Map(),
      frame: null,
      url: "",
      title: "AMOS browser",
      createdAt: this.now().getTime(),
      lastObservedAt: null,
      userVisible: false,
      closing: false
    };
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (record.userVisible) {
        this.publicPolicy.validate(url, { allowSensitiveQuery: false })
          .then((target) => this.load(record, target, null))
          .catch(() => {});
      }
      return { action: "deny" };
    });
    const navigated = (_event, value) => {
      try {
        const next = parsePublicHttpUrl(value);
        record.revision += 1;
        record.refs.clear();
        record.frame = null;
        if (!hasCredentialLikeUrlData(next)) record.url = next.href;
        if (record.userVisible) record.window.setTitle?.(takeoverTitle(record.url));
      } catch {
        // Network policy blocks unsupported destinations before they become usable.
      }
    };
    window.webContents.on("did-navigate", navigated);
    window.webContents.on("did-navigate-in-page", navigated);
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.on("page-title-updated", (event) => {
      event.preventDefault?.();
      window.setTitle?.(takeoverTitle(record.url));
    });
    window.on("close", (event) => {
      if (!record.closing && record.userVisible) {
        event.preventDefault?.();
        window.hide?.();
      }
    });
    window.on("closed", () => this.sessions.delete(id));
    this.sessions.set(id, record);
    return record;
  }

  async load(record, target, signal) {
    const abort = () => record.window.webContents.stop();
    if (signal?.aborted) throw new Error("Browser operation canceled");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await record.window.loadURL(target.href, { httpReferrer: "" });
      throwIfAborted(signal);
      const current = await this.publicPolicy.validate(record.window.webContents.getURL(), {
        allowSensitiveQuery: false
      });
      record.url = current.href;
      record.title = cleanText(record.window.webContents.getTitle(), 300) || "Untitled page";
      if (record.revision === 0) record.revision = 1;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  lockSessionNetwork(browserSession) {
    browserSession.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler?.(() => false);
    browserSession.setDisplayMediaRequestHandler?.((_request, callback) => callback({}));
    browserSession.on?.("will-download", (event, item) => {
      event.preventDefault();
      item?.cancel?.();
    });
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      let settled = false;
      const finish = (cancel) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback({ cancel });
      };
      const timer = setTimeout(() => finish(true), 5_000);
      this.validateRequest(details)
        .then(() => finish(false))
        .catch(() => finish(true));
    });
  }

  async validateRequest(details) {
    const url = new URL(details.url);
    if (["http:", "https:"].includes(url.protocol)) {
      await this.publicPolicy.validate(url, {
        allowSensitiveQuery: details.resourceType !== "mainFrame"
      });
      return;
    }
    if (url.protocol === "blob:") {
      if (details.resourceType === "mainFrame") throw new Error("Blob navigation is blocked");
      await this.publicPolicy.validate(new URL(url.pathname));
      return;
    }
    if (url.protocol === "data:" && details.resourceType !== "mainFrame") return;
    if (url.href === "about:blank") return;
    throw new Error("Unsupported browser request scheme");
  }

  referenceElement(record, input) {
    const selector = cleanText(input?.selector, 1_000);
    const ref = `el_${this.createId().replaceAll("-", "").slice(0, 16)}`;
    record.refs.set(ref, {
      revision: record.revision,
      selector,
      role: cleanText(input?.role, 80),
      name: cleanText(input?.name, 300),
      tag: cleanText(input?.tag, 40),
      type: cleanText(input?.type, 40)
    });
    return {
      ref,
      role: cleanText(input?.role, 80),
      name: cleanText(input?.name, 300),
      tag: cleanText(input?.tag, 40),
      type: cleanText(input?.type, 40),
      text: cleanText(input?.text, 300),
      href: safeObservedHref(input?.href),
      disabled: input?.disabled === true,
      checked: input?.checked === true,
      selected: input?.selected === true
    };
  }

  resolveReference(record, ref) {
    const resolved = record.refs.get(String(ref || ""));
    if (!resolved || resolved.revision !== record.revision || !resolved.selector) {
      throw new Error("That browser element reference expired; take a fresh snapshot");
    }
    return resolved;
  }

  async capture(record) {
    const image = await record.window.webContents.capturePage();
    const size = image.getSize();
    const buffer = image.toPNG();
    if (!buffer?.length || buffer.length > 8 * 1024 * 1024) {
      throw new Error("The browser screenshot exceeded its local safety limit");
    }
    const id = this.createId();
    record.frame = {
      id,
      buffer,
      width: boundedInteger(size.width, VIEWPORT.width, 1, 4_000),
      height: boundedInteger(size.height, VIEWPORT.height, 1, 4_000)
    };
    return {
      frame_id: id,
      width: record.frame.width,
      height: record.frame.height,
      bytes: buffer.length
    };
  }

  requireSession(scope, sessionId) {
    const record = this.sessions.get(String(sessionId || ""));
    if (!record || scopeKey(record.scope) !== scopeKey(normalizeScope(scope))) {
      throw new Error("That browser session is not available to this task and account");
    }
    if (record.window.isDestroyed?.() || record.window.webContents.isDestroyed?.()) {
      this.destroy(record);
      throw new Error("That browser session is no longer available");
    }
    return record;
  }

  requireSessionById(sessionId) {
    const record = this.sessions.get(String(sessionId || ""));
    if (!record || record.window.isDestroyed?.() || record.window.webContents.isDestroyed?.()) {
      if (record) this.destroy(record);
      throw new Error("That browser session is no longer available");
    }
    return record;
  }

  destroy(record) {
    if (!record) return;
    record.refs.clear();
    record.frame = null;
    record.closing = true;
    record.userVisible = false;
    this.sessions.delete(record.id);
    if (!record.window.isDestroyed?.()) record.window.destroy();
  }
}

export class PublicUrlPolicy {
  constructor({ now = () => new Date(), ttlMs = 2_000 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  async validate(value, { allowSensitiveQuery = true } = {}) {
    const url = parsePublicHttpUrl(value);
    if (!allowSensitiveQuery && hasCredentialLikeUrlData(url)) {
      throw new Error("Credential-like browser URLs are not allowed");
    }
    const hostname = url.hostname.toLowerCase();
    const cached = this.cache.get(hostname);
    if (cached && cached.expiresAt > this.now().getTime()) {
      await cached.promise;
      return url;
    }
    const promise = assertPublicUrl(url).catch((error) => {
      this.cache.delete(hostname);
      throw error;
    });
    this.cache.set(hostname, { promise, expiresAt: this.now().getTime() + this.ttlMs });
    await promise;
    return url;
  }
}

function executeIsolated(webContents, code) {
  if (typeof webContents.executeJavaScriptInIsolatedWorld !== "function") {
    throw new Error("This AMOS Desktop build does not support isolated browser inspection");
  }
  return webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code }], false);
}

function snapshotScript({ maxElements, maxChars }) {
  return `(() => {
    const maxElements = ${maxElements};
    const maxChars = ${maxChars};
    const clean = (value, limit = 300) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const cssPath = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.documentElement) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          part += '#' + CSS.escape(node.id);
          parts.unshift(part);
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const peers = Array.from(parent.children).filter((item) => item.tagName === node.tagName);
          if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };
    const role = (el) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'option') return 'option';
      if (tag === 'input') {
        const type = String(el.type || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        return 'textbox';
      }
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'table') return 'table';
      if (tag === 'img') return 'img';
      return tag;
    };
    const name = (el) => {
      const labelledBy = clean(el.getAttribute('aria-labelledby'), 200);
      const labelled = labelledBy
        ? labelledBy.split(/\\s+/).map((id) => clean(document.getElementById(id)?.textContent, 120)).filter(Boolean).join(' ')
        : '';
      const labels = el.labels ? Array.from(el.labels).map((label) => clean(label.textContent, 120)).join(' ') : '';
      const type = String(el.getAttribute('type') || '').toLowerCase();
      const labelledName = labelled || el.getAttribute('aria-label') || labels || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name');
      if (type === 'password') return clean(labelledName || 'Password field');
      if (el.isContentEditable) return clean(labelledName || 'Editable field');
      if (['input', 'textarea'].includes(el.tagName.toLowerCase())) return clean(labelledName || 'Text field');
      return clean(labelledName || el.textContent);
    };
    const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,option,[role],[contenteditable="true"],h1,h2,h3,h4,h5,h6,table,img[alt]'));
    const elements = candidates.filter(visible).slice(0, maxElements).map((el) => ({
      selector: cssPath(el),
      role: role(el),
      name: name(el),
      tag: el.tagName.toLowerCase(),
      type: String(el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase(),
      text: clean(el.getAttribute('type') === 'password' || el.isContentEditable ? '' : el.textContent, 300),
      href: el.tagName.toLowerCase() === 'a' ? String(el.href || '') : '',
      disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
      checked: el.matches(':checked') || el.getAttribute('aria-checked') === 'true',
      selected: el.matches(':checked') || el.getAttribute('aria-selected') === 'true'
    }));
    const root = document.querySelector('main,article,[role="main"]') || document.body;
    const readable = root?.cloneNode(true);
    readable?.querySelectorAll('input,textarea,select,option,[contenteditable]').forEach((control) => control.remove());
    const text = clean(readable?.textContent, maxChars);
    return {
      url: location.href,
      title: clean(document.title, 300),
      text,
      summary: clean(text, 1000),
      elements
    };
  })()`;
}

function extractionScript({ kind, selector, maxChars }) {
  const safeKind = JSON.stringify(kind);
  const safeSelector = JSON.stringify(selector);
  return `(() => {
    const kind = ${safeKind};
    const selector = ${safeSelector};
    const maxChars = ${maxChars};
    const clean = (value, limit = maxChars) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const readableText = (node, limit = maxChars) => {
      if (!node) return '';
      const clone = node.cloneNode(true);
      clone.querySelectorAll?.('input,textarea,select,option,[contenteditable]').forEach((control) => control.remove());
      return clean(clone.textContent, limit);
    };
    if (kind === 'region') {
      const region = document.querySelector(selector);
      if (!region) throw new Error('The referenced region changed; take a fresh snapshot');
      if (region.matches('input,textarea,select,option,[contenteditable]')) {
        throw new Error('Editable browser fields cannot be extracted');
      }
      return { text: readableText(region) };
    }
    if (kind === 'article') {
      const root = document.querySelector('article,main,[role="main"]') || document.body;
      return { title: clean(document.title, 300), text: readableText(root) };
    }
    if (kind === 'table') {
      return Array.from(document.querySelectorAll('table')).slice(0, 12).map((table) => ({
        caption: clean(table.caption?.innerText, 300),
        headers: Array.from(table.querySelectorAll('thead th')).slice(0, 30).map((cell) => clean(cell.innerText, 300)),
        rows: Array.from(table.querySelectorAll('tbody tr, tr')).slice(0, 200).map((row) =>
          Array.from(row.querySelectorAll('th,td')).slice(0, 30).map((cell) => readableText(cell, 1000))
        )
      }));
    }
    if (kind === 'list') {
      return Array.from(document.querySelectorAll('ul,ol')).slice(0, 30).map((list) => ({
        ordered: list.tagName.toLowerCase() === 'ol',
        items: Array.from(list.children).filter((item) => item.tagName === 'LI').slice(0, 200).map((item) => readableText(item, 1000))
      }));
    }
    return Array.from(document.querySelectorAll('form')).slice(0, 20).map((form) => ({
      name: clean(form.getAttribute('aria-label') || form.getAttribute('name') || form.id, 300),
      method: clean(form.method || 'get', 20).toLowerCase(),
      controls: Array.from(form.querySelectorAll('input,textarea,select,button')).slice(0, 120).map((control) => {
        const type = clean(control.getAttribute('type') || control.tagName.toLowerCase(), 40).toLowerCase();
        const labels = control.labels ? Array.from(control.labels).map((label) => clean(label.textContent, 120)).join(' ') : '';
        return {
          type,
          name: clean(control.getAttribute('name'), 200),
          label: clean(control.getAttribute('aria-label') || labels || (type === 'password' ? 'Password field' : control.getAttribute('placeholder')), 300),
          required: control.required === true,
          disabled: control.disabled === true
        };
      })
    }));
  })()`;
}

function actionDescriptorScript({ selector, optionSelector }) {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const optionSelector = ${JSON.stringify(optionSelector)};
    const clean = (value, limit = 300) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const semanticName = (el) => {
      const labelledBy = clean(el.getAttribute('aria-labelledby'), 200);
      const labelled = labelledBy
        ? labelledBy.split(/\\s+/).map((id) => clean(document.getElementById(id)?.textContent, 120)).filter(Boolean).join(' ')
        : '';
      const labels = el.labels ? Array.from(el.labels).map((label) => clean(label.textContent, 120)).join(' ') : '';
      const type = String(el.getAttribute('type') || '').toLowerCase();
      const labelledName = labelled || el.getAttribute('aria-label') || labels || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name');
      if (type === 'password') return clean(labelledName || 'Password field');
      if (el.isContentEditable) return clean(labelledName || 'Editable field');
      if (['input', 'textarea'].includes(el.tagName.toLowerCase())) return clean(labelledName || 'Text field');
      return clean(labelledName || el.textContent);
    };
    const inferredRole = (el) => {
      const explicit = clean(el.getAttribute('role'), 80);
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const type = String(el.getAttribute('type') || '').toLowerCase();
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'button' || ['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (tag === 'select') return 'combobox';
      if (tag === 'option') return 'option';
      if (tag === 'textarea' || tag === 'input' || el.isContentEditable) return type === 'search' ? 'searchbox' : 'textbox';
      return tag;
    };
    const describe = (el) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const form = el.form || el.closest('form');
      return {
        tag: el.tagName.toLowerCase(),
        type: clean(el.getAttribute('type') || el.tagName.toLowerCase(), 40).toLowerCase(),
        role: inferredRole(el),
        name: semanticName(el),
        identifier: clean([el.id, el.getAttribute('name'), el.getAttribute('autocomplete'), el.getAttribute('placeholder')].filter(Boolean).join(' '), 500),
        href: el.tagName.toLowerCase() === 'a' ? String(el.href || '') : '',
        target: clean(el.getAttribute('target'), 40),
        download: el.hasAttribute('download'),
        disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
        readOnly: el.readOnly === true || el.getAttribute('aria-readonly') === 'true',
        checked: el.matches(':checked') || el.getAttribute('aria-checked') === 'true',
        selected: el.matches(':checked') || el.getAttribute('aria-selected') === 'true',
        contentEditable: el.isContentEditable === true,
        autocomplete: clean(el.getAttribute('autocomplete'), 80).toLowerCase(),
        maxLength: Number.isFinite(Number(el.maxLength)) ? Number(el.maxLength) : -1,
        visible: style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0,
        form: form ? {
          method: clean(form.method || 'get', 20).toLowerCase(),
          action: String(form.action || location.href),
          hasPassword: Boolean(form.querySelector('input[type="password"]')),
          name: clean(form.getAttribute('aria-label') || form.getAttribute('name') || form.id, 200)
        } : null
      };
    };
    const target = document.querySelector(selector);
    if (!target) throw new Error('The referenced browser element changed; take a fresh snapshot');
    const option = optionSelector ? document.querySelector(optionSelector) : null;
    const pageMaterial = [
      location.href,
      document.title,
      String(document.body?.innerText || '').slice(0, 20000),
      document.querySelectorAll('a,button,input,textarea,select,option,[role]').length
    ].join('\\n');
    let pageMarker = 2166136261;
    for (let index = 0; index < pageMaterial.length; index += 1) {
      pageMarker ^= pageMaterial.charCodeAt(index);
      pageMarker = Math.imul(pageMarker, 16777619);
    }
    return {
      url: location.href,
      pageMarker: (pageMarker >>> 0).toString(16),
      target: describe(target),
      option: describe(option),
      optionBelongsToTarget: Boolean(option && option.tagName === 'OPTION' && option.closest('select') === target)
    };
  })()`;
}

function actionScript({ kind, selector, optionSelector, payload }) {
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const selector = ${JSON.stringify(selector)};
    const optionSelector = ${JSON.stringify(optionSelector)};
    const payload = ${JSON.stringify(payload)};
    const target = document.querySelector(selector);
    if (!target) throw new Error('The approved browser target changed; take a fresh snapshot');
    if (target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true') {
      throw new Error('The approved browser target is disabled');
    }
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    if (kind === 'click') {
      const previousTarget = target.tagName === 'A' ? target.getAttribute('target') : null;
      if (previousTarget && previousTarget.toLowerCase() !== '_self') target.setAttribute('target', '_self');
      target.click();
      if (previousTarget && previousTarget.toLowerCase() !== '_self') target.setAttribute('target', previousTarget);
      return true;
    }
    if (kind === 'type') {
      if (target.readOnly === true || target.getAttribute('aria-readonly') === 'true') {
        throw new Error('The approved browser field is read-only');
      }
      if (target.isContentEditable) {
        target.textContent = payload.replace ? payload.text : String(target.textContent || '') + payload.text;
      } else {
        const prototype = Object.getPrototypeOf(target);
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        const next = payload.replace ? payload.text : String(target.value || '') + payload.text;
        if (setter) setter.call(target, next);
        else target.value = next;
      }
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (kind === 'select') {
      const option = document.querySelector(optionSelector);
      if (!option || option.tagName !== 'OPTION' || option.closest('select') !== target) {
        throw new Error('The approved browser option changed; take a fresh snapshot');
      }
      target.value = option.value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (!['checkbox', 'radio'].includes(String(target.type || '').toLowerCase())) {
      throw new Error('The referenced browser element is not checkable');
    }
    target.checked = payload.checked;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

function waitConditionScript({ condition, value }) {
  return `(() => {
    const condition = ${JSON.stringify(condition)};
    const value = ${JSON.stringify(value)};
    if (condition === 'url') {
      const current = new URL(location.href);
      const sensitive = /(?:access|refresh|id)[_-]?token|api[_-]?key|secret|password|signature|authorization/i;
      const safeHref = [...current.searchParams.keys()].some((key) => sensitive.test(key)) || sensitive.test(current.hash)
        ? current.origin + current.pathname
        : current.href;
      return safeHref.includes(value);
    }
    const readable = document.body?.cloneNode(true);
    readable?.querySelectorAll('input,textarea,select,option,[contenteditable]').forEach((control) => control.remove());
    return String(readable?.textContent || '').includes(value);
  })()`;
}

function normalizeActionPayload(kind, { text, replace, checked }) {
  if (kind === "type") {
    const value = String(text ?? "");
    if (value.length > 5_000) throw new Error("Browser text input is limited to 5,000 characters");
    return { text: value, replace: replace !== false };
  }
  if (kind === "check") {
    if (typeof checked !== "boolean") throw new Error("browser_check requires a checked state");
    return { checked };
  }
  return {};
}

function classifyBrowserAction(kind, descriptor, payload) {
  const target = descriptor?.target;
  if (!target || target.visible !== true) {
    throw new Error("The referenced browser element is no longer visible; take a fresh snapshot");
  }
  if (target.disabled) throw new Error("The referenced browser element is disabled");
  const authRelated = browserTargetRequiresTakeover(target);
  if (kind === "type") {
    const editable = target.tag === "input" || target.tag === "textarea" || target.contentEditable;
    if (!editable || target.readOnly) throw new Error("The referenced browser element is not an editable field");
    if (target.maxLength > 0 && payload.text.length > target.maxLength) {
      throw new Error(`Browser text exceeds this field's ${target.maxLength}-character limit`);
    }
    if (authRelated) return { risk: "credential", requiresApproval: false, takeoverRequired: true };
      const explicitSearch = target.role === "searchbox" || target.type === "search";
      const namedSearch = /(?:^|\b)(?:q|query|search)(?:\b|$)/i.test(`${target.identifier} ${target.name}`);
      const searchLike = (!target.form && explicitSearch) ||
        (target.form?.method === "get" && (explicitSearch || namedSearch));
    return {
      risk: searchLike ? "observational" : "consequential",
      requiresApproval: !searchLike,
      takeoverRequired: false
    };
  }
  if (kind === "select") {
    if (target.tag !== "select" || !descriptor.option || !descriptor.optionBelongsToTarget) {
      throw new Error("browser_select requires current select and option references");
    }
    if (authRelated || browserTargetRequiresTakeover(descriptor.option)) {
      return { risk: "credential", requiresApproval: false, takeoverRequired: true };
    }
    return { risk: "consequential", requiresApproval: true, takeoverRequired: false };
  }
  if (kind === "check") {
    if (!new Set(["checkbox", "radio"]).has(target.type)) {
      throw new Error("browser_check requires a checkbox or radio reference");
    }
    if (authRelated) return { risk: "credential", requiresApproval: false, takeoverRequired: true };
    return { risk: "consequential", requiresApproval: true, takeoverRequired: false };
  }
  if (authRelated) return { risk: "credential", requiresApproval: false, takeoverRequired: true };
  const href = safeObservedHref(target.href);
  const consequenceText = `${target.name} ${href} ${target.form?.action || ""}`;
  const consequential = /delete|remove|logout|log[\s_-]?out|sign[\s_-]?out|unsubscribe|purchase|checkout|payment|\bpay\b|\bbook\b|submit|approve|accept|invite|send|publish|deploy|grant|permission|confirm/i;
  let sameOrigin = false;
  try {
    sameOrigin = new URL(href).origin === new URL(descriptor.url).origin;
  } catch {
    sameOrigin = false;
  }
  const safeLink = target.tag === "a" && href && sameOrigin && !target.download && !consequential.test(consequenceText);
  return {
    risk: safeLink ? "observational" : "consequential",
    requiresApproval: !safeLink,
    takeoverRequired: false
  };
}

function browserTargetRequiresTakeover(target = {}) {
  if (target.form?.hasPassword) return true;
  const identity = `${target.type} ${target.role} ${target.name} ${target.identifier} ${target.autocomplete}`;
  return /password|passcode|one[\s_-]?time|\botp\b|verification[\s_-]?code|security[\s_-]?code|\bmfa\b|\b2fa\b|\bsso\b|authenticat|sign[\s_-]?in|log[\s_-]?in|continue with (?:google|microsoft|apple|okta)|recovery|bearer|token|secret|api[\s_-]?key|credit[\s_-]?card|\bcvv\b|\bcvc\b|social[\s_-]?security|\bssn\b/i.test(identity) ||
    /current-password|new-password|one-time-code|cc-/.test(String(target.autocomplete || ""));
}

function publicBrowserAction({ kind, ref, optionRef, descriptor, payload, classification, url, revision }) {
  const target = descriptor.target;
  const page = new URL(url);
  const actionPayload = kind === "type"
    ? {
        characters: payload.text.length,
        sha256: createHash("sha256").update(payload.text).digest("hex"),
        replace: payload.replace
      }
    : kind === "select"
      ? { option_ref: String(optionRef), option_name: cleanText(descriptor.option?.name, 300) }
      : kind === "check"
        ? { checked: payload.checked }
        : {};
  return {
    action: kind,
    risk: classification.risk,
    origin: page.origin,
    page_revision: revision,
    target: {
      ref: String(ref),
      role: cleanText(target.role, 80),
      name: cleanText(target.name, 300),
      tag: cleanText(target.tag, 40),
      type: cleanText(target.type, 40),
      destination: safeObservedHref(target.href || target.form?.action)
    },
    payload: actionPayload
  };
}

function actionFingerprint({ kind, ref, optionRef, descriptor, payload }) {
  return createHash("sha256").update(JSON.stringify({
    kind,
    ref: String(ref),
    optionRef: optionRef ? String(optionRef) : null,
    descriptor,
    payload
  })).digest("hex");
}

function takeoverTitle(value) {
  try {
    return `${TAKEOVER_TITLE} — ${new URL(value).hostname}`;
  } catch {
    return TAKEOVER_TITLE;
  }
}

function takeoverResult(record, now, active) {
  return {
    ok: true,
    status: "ready",
    session_id: record.id,
    url: record.url,
    title: record.title,
    page_revision: record.revision,
    observed_at: now.toISOString(),
    element_count: record.refs.size,
    summary: active
      ? "Direct user control is open. Passwords, MFA, and cookies remain inside the isolated browser session."
      : "Direct user control is closed.",
    frame: record.frame ? {
      frame_id: record.frame.id,
      width: record.frame.width,
      height: record.frame.height,
      bytes: record.frame.buffer.length
    } : null,
    takeover_active: active
  };
}

function normalizeScope(value = {}) {
  return {
    boundary: cleanRequired(value.boundary, 32, "browser boundary"),
    subjectId: cleanRequired(value.subjectId, 256, "browser user"),
    tenantId: cleanRequired(value.tenantId, 256, "browser tenant"),
    taskId: cleanRequired(value.taskId, 256, "browser task")
  };
}

function scopeKey(scope) {
  return [scope.boundary, scope.subjectId, scope.tenantId, scope.taskId].join("\u0000");
}

function safeObservedHref(value) {
  if (!value) return "";
  try {
    const url = assertPublicUrlSyntax(new URL(String(value)));
    return hasCredentialLikeUrlData(url) ? "" : url.href.slice(0, 2_048);
  } catch {
    return "";
  }
}

function hasCredentialLikeUrlData(url) {
  const sensitive = /(?:access|refresh|id)[_-]?token|api[_-]?key|secret|password|signature|authorization/i;
  if ([...url.searchParams.keys()].some((key) => sensitive.test(key))) return true;
  return sensitive.test(url.hash);
}

function cleanUrl(value) {
  try {
    const url = assertPublicUrlSyntax(new URL(String(value)));
    return hasCredentialLikeUrlData(url) ? "" : url.href;
  } catch {
    return "";
  }
}

function cleanRequired(value, max, label) {
  const text = cleanText(value, max);
  if (!text) throw new Error(`A ${label} is required`);
  return text;
}

function cleanText(value, max = 1_000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}

function boundStructured(value, maxChars) {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length <= maxChars) return value;
  return {
    truncated: true,
    preview: serialized.slice(0, Math.max(0, maxChars - 1)) + "…"
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("Browser operation canceled");
}

function delay(milliseconds, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Browser operation canceled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, Math.max(0, milliseconds));
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new Error("Browser operation canceled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function assertAgentControl(record) {
  if (record?.userVisible === true) {
    throw new Error("Direct user control is active; return control to AMOS before browser tools continue");
  }
}

function assertStableRevision(record, expectedRevision) {
  if (record.revision === expectedRevision) return;
  record.refs.clear();
  record.frame = null;
  throw new Error("The page changed during browser inspection; take a fresh snapshot");
}
