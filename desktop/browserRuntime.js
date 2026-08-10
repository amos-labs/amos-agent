import { createHash, randomUUID } from "node:crypto";
import { assertPublicUrl, assertPublicUrlSyntax, parsePublicHttpUrl } from "../src/util/publicUrl.js";

const VIEWPORT = Object.freeze({ width: 1280, height: 800 });
const ISOLATED_WORLD_ID = 1004;
const DEFAULT_MAX_ELEMENTS = 80;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_SESSIONS = 6;

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
      frame
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
      frame
    };
  }

  async screenshot(scope, { sessionId, signal = null } = {}) {
    const record = this.requireSession(scope, sessionId);
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
      frame
    };
  }

  async close(scope, { sessionId } = {}) {
    const record = this.requireSession(scope, sessionId);
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
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
      lastObservedAt: null
    };
    const navigated = (_event, value) => {
      try {
        const next = parsePublicHttpUrl(value);
        record.revision += 1;
        record.refs.clear();
        record.frame = null;
        if (!hasCredentialLikeUrlData(next)) record.url = next.href;
      } catch {
        // Network policy blocks unsupported destinations before they become usable.
      }
    };
    window.webContents.on("did-navigate", navigated);
    window.webContents.on("did-navigate-in-page", navigated);
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
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
      tag: cleanText(input?.tag, 40)
    });
    return {
      ref,
      role: cleanText(input?.role, 80),
      name: cleanText(input?.name, 300),
      tag: cleanText(input?.tag, 40),
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

  destroy(record) {
    if (!record) return;
    record.refs.clear();
    record.frame = null;
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
      if (type === 'password') return clean(labelled || el.getAttribute('aria-label') || labels || 'Password field');
      return clean(labelled || el.getAttribute('aria-label') || labels || el.getAttribute('alt') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder'));
    };
    const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,option,[role],h1,h2,h3,h4,h5,h6,table,img[alt]'));
    const elements = candidates.filter(visible).slice(0, maxElements).map((el) => ({
      selector: cssPath(el),
      role: role(el),
      name: name(el),
      tag: el.tagName.toLowerCase(),
      text: clean(el.getAttribute('type') === 'password' ? '' : el.textContent, 300),
      href: el.tagName.toLowerCase() === 'a' ? String(el.href || '') : '',
      disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
      checked: el.matches(':checked') || el.getAttribute('aria-checked') === 'true',
      selected: el.matches(':checked') || el.getAttribute('aria-selected') === 'true'
    }));
    const root = document.querySelector('main,article,[role="main"]') || document.body;
    const text = clean(root?.innerText, maxChars);
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
    if (kind === 'region') {
      const region = document.querySelector(selector);
      if (!region) throw new Error('The referenced region changed; take a fresh snapshot');
      return { text: clean(region.innerText) };
    }
    if (kind === 'article') {
      const root = document.querySelector('article,main,[role="main"]') || document.body;
      return { title: clean(document.title, 300), text: clean(root?.innerText) };
    }
    if (kind === 'table') {
      return Array.from(document.querySelectorAll('table')).slice(0, 12).map((table) => ({
        caption: clean(table.caption?.innerText, 300),
        headers: Array.from(table.querySelectorAll('thead th')).slice(0, 30).map((cell) => clean(cell.innerText, 300)),
        rows: Array.from(table.querySelectorAll('tbody tr, tr')).slice(0, 200).map((row) =>
          Array.from(row.querySelectorAll('th,td')).slice(0, 30).map((cell) => clean(cell.innerText, 1000))
        )
      }));
    }
    if (kind === 'list') {
      return Array.from(document.querySelectorAll('ul,ol')).slice(0, 30).map((list) => ({
        ordered: list.tagName.toLowerCase() === 'ol',
        items: Array.from(list.children).filter((item) => item.tagName === 'LI').slice(0, 200).map((item) => clean(item.innerText, 1000))
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

function assertStableRevision(record, expectedRevision) {
  if (record.revision === expectedRevision) return;
  record.refs.clear();
  record.frame = null;
  throw new Error("The page changed during browser inspection; take a fresh snapshot");
}
