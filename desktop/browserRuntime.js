import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { assertPublicUrl, assertPublicUrlSyntax, parsePublicHttpUrl } from "../src/util/publicUrl.js";

const VIEWPORT = Object.freeze({ width: 1280, height: 800 });
const ISOLATED_WORLD_ID = 1004;
const DEFAULT_MAX_ELEMENTS = 80;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_SESSIONS = 6;
const ACTION_KINDS = new Set(["click", "type", "select", "check"]);
const VISUAL_ACTION_KINDS = new Set(["click", "type", "key", "scroll"]);
const VISUAL_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", "Tab",
  "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "Space"
]);
const TAKEOVER_TITLE = "AMOS Secure Browser";
const MAX_TRANSFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export class DesktopBrowserRuntime {
  constructor({
    BrowserWindow,
    session,
    now = () => new Date(),
    createId = randomUUID,
    transferRoot = join(tmpdir(), "amos-browser-transfers")
  } = {}) {
    if (typeof BrowserWindow !== "function" || !session?.fromPartition) {
      throw new Error("The governed browser requires Electron BrowserWindow and session APIs");
    }
    this.BrowserWindow = BrowserWindow;
    this.electronSession = session;
    this.now = now;
    this.createId = createId;
    const requestedTransferRoot = String(transferRoot || "").trim();
    if (!requestedTransferRoot) throw new Error("Browser transfer storage requires a private absolute directory");
    if (!isAbsolute(requestedTransferRoot)) throw new Error("Browser transfer storage must be absolute");
    this.transferRoot = resolve(requestedTransferRoot);
    this.sessions = new Map();
    this.localPreviewOrigins = new Map();
    this.publicPolicy = new PublicUrlPolicy({ now });
  }

  grantLocalPreview(scope, { origin } = {}) {
    const normalizedScope = normalizeScope(scope);
    const url = new URL(String(origin || ""));
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      Number(url.port) < 1024 ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error("Local previews require an exact non-privileged IPv4 loopback origin");
    }
    const key = scopeKey(normalizedScope);
    this.localPreviewOrigins.set(key, new Set([url.origin]));
    return { origin: url.origin };
  }

  revokeLocalPreview(scope, { origin } = {}) {
    const key = scopeKey(normalizeScope(scope));
    const origins = this.localPreviewOrigins.get(key);
    if (!origins) return false;
    const removed = origins.delete(String(origin || ""));
    if (origins.size === 0) this.localPreviewOrigins.delete(key);
    return removed;
  }

  localPreviewForSession(sessionId) {
    const record = this.sessions.get(String(sessionId || ""));
    if (!record?.localPreviewOrigin) return null;
    return {
      origin: record.localPreviewOrigin,
      network: "exact loopback origin only"
    };
  }

  async open(scope, { url, sessionId = null, signal = null } = {}) {
    throwIfAborted(signal);
    const target = await this.validateTarget(scope, url, { allowSensitiveQuery: false });
    const previewOrigin = this.localPreviewOrigin(scope, target);
    let record = sessionId ? this.requireSession(scope, sessionId) : null;
    const created = !record;
    if (created) record = await this.createSession(scope);
    try {
      if (record.localPreviewOrigin && record.localPreviewOrigin !== previewOrigin) {
        throw new Error("Open public pages and local previews in separate governed browser sessions");
      }
      if (!record.localPreviewOrigin && previewOrigin && !created) {
        throw new Error("Open public pages and local previews in separate governed browser sessions");
      }
      if (created) record.localPreviewOrigin = previewOrigin;
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
    record.url = cleanUrl(raw?.url, record.localPreviewOrigin) || record.url;
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

  async visualObserve(scope, { sessionId, targetDescription = "", signal = null } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const expectedRevision = record.revision;
    throwIfAborted(signal);
    await assertVisualSurfaceAllowed(record);
    const frame = await this.captureVisual(record);
    assertStableRevision(record, expectedRevision);
    return visualObservation(record, frame, this.now(), targetDescription);
  }

  async prepareVisualAction(scope, {
    sessionId,
    frameId,
    action,
    targetDescription = "",
    x = null,
    y = null,
    text = "",
    replace = true,
    key = "",
    deltaY = 0,
    signal = null
  } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    await assertVisualSurfaceAllowed(record);
    const kind = String(action || "");
    if (!VISUAL_ACTION_KINDS.has(kind)) throw new Error("Unsupported visual browser action");
    const frame = requireVisualFrame(record, frameId);
    const point = visualPoint({ kind, x, y, frame });
    const payload = normalizeVisualPayload(kind, { text, replace, key, deltaY });
    throwIfAborted(signal);
    const descriptor = point
      ? await executeIsolated(record.window.webContents, visualPointDescriptorScript(point))
      : null;
    throwIfAborted(signal);
    assertStableRevision(record, frame.pageRevision);
    const takeoverRequired = descriptor?.sensitive === true || looksLikeAuthenticationSurface(record.url);
    const risk = kind === "scroll" ? "observational" : takeoverRequired ? "credential" : "consequential";
    const publicAction = publicVisualAction({
      kind,
      targetDescription,
      point,
      descriptor,
      payload,
      risk,
      url: record.url,
      revision: record.revision,
      frame
    });
    return {
      plan: {
        sessionId: record.id,
        revision: record.revision,
        frameId: frame.id,
        frameSha256: frame.sha256,
        kind,
        point,
        payload,
        descriptorSha256: hashValue(descriptor),
        publicAction,
        requiresApproval: kind !== "scroll" && !takeoverRequired,
        takeoverRequired
      },
      requires_approval: kind !== "scroll" && !takeoverRequired,
      takeover_required: takeoverRequired,
      public_action: publicAction,
      observation: visualObservation(record, publicFrame(frame), this.now(), targetDescription)
    };
  }

  async performVisualAction(scope, {
    plan,
    approved = false,
    waitMs = 750,
    signal = null
  } = {}) {
    if (!plan || !VISUAL_ACTION_KINDS.has(plan.kind)) {
      throw new Error("A prepared visual browser action is required");
    }
    if (plan.takeoverRequired) throw new Error("Authentication and sensitive fields require direct user control");
    if (plan.requiresApproval && approved !== true) {
      throw new Error("This visual browser action requires exact human approval");
    }
    const record = this.requireSession(scope, plan.sessionId);
    assertAgentControl(record);
    assertStableRevision(record, plan.revision);
    const currentFrame = requireVisualFrame(record, plan.frameId);
    if (currentFrame.sha256 !== plan.frameSha256) throw new Error("The visual browser frame changed; observe it again");
    throwIfAborted(signal);
    const revalidated = await this.captureVisual(record);
    if (
      revalidated.sha256 !== plan.frameSha256 ||
      revalidated.width !== currentFrame.width ||
      revalidated.height !== currentFrame.height
    ) {
      throw new Error("The visual browser frame changed while approval was pending; observe it again");
    }
    const descriptor = plan.point
      ? await executeIsolated(record.window.webContents, visualPointDescriptorScript(plan.point))
      : null;
    if (hashValue(descriptor) !== plan.descriptorSha256 || descriptor?.sensitive === true) {
      throw new Error("The visual browser target changed while approval was pending; observe it again");
    }
    await sendVisualInput(record.window.webContents, plan);
    throwIfAborted(signal);
    await this.waitForSettled(record, boundedInteger(waitMs, 750, 250, 5_000), signal);
    if (record.blockedDownload) {
      throw new Error("The visual action attempted an unapproved download. Use browser_download on a fresh semantic snapshot.");
    }
    const frame = await this.captureVisual(record);
    const result = visualObservation(record, frame, this.now(), plan.publicAction.target_description);
    return {
      ...result,
      operation: `visual_${plan.kind}`,
      visual_action_receipt: {
        contract: "amos.browser-visual-action:1",
        receipt_id: this.createId(),
        action: plan.kind,
        risk: plan.publicAction.risk,
        approved: approved === true,
        origin: plan.publicAction.origin,
        target_description: plan.publicAction.target_description,
        point: plan.publicAction.point,
        payload: plan.publicAction.payload,
        before: {
          page_revision: plan.revision,
          frame_id: plan.frameId,
          frame_sha256: plan.frameSha256
        },
        after: {
          page_revision: record.revision,
          frame_id: frame.frame_id,
          frame_sha256: frame.sha256
        },
        executed_at: this.now().toISOString(),
        verified: true
      },
      summary: `Completed the frame-bound visual ${plan.kind} action and captured a new masked observation.`
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
    const classified = classifyBrowserAction(actionKind, descriptor, payload);
    const classification = record.localPreviewOrigin && !classified.takeoverRequired
      ? { ...classified, risk: "preview", requiresApproval: false }
      : classified;
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
      revision: record.revision,
      localPreviewOrigin: record.localPreviewOrigin
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

  async prepareUpload(scope, {
    sessionId,
    ref,
    attachment,
    signal = null
  } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const expectedRevision = record.revision;
    const targetReference = this.resolveReference(record, ref);
    const artifact = normalizeUploadAttachment(attachment);
    throwIfAborted(signal);
    const descriptor = await executeIsolated(
      record.window.webContents,
      actionDescriptorScript({ selector: targetReference.selector, optionSelector: null })
    );
    throwIfAborted(signal);
    assertStableRevision(record, expectedRevision);
    if (descriptor?.target?.tag !== "input" || descriptor.target.type !== "file") {
      throw new Error("browser_upload requires a current file-input reference");
    }
    const takeoverRequired = browserTargetRequiresTakeover(descriptor.target);
    const frame = await this.capture(record);
    assertStableRevision(record, expectedRevision);
    const publicAction = publicTransferAction({
      kind: "upload",
      ref,
      descriptor,
      artifact,
      url: record.url,
      revision: record.revision
    });
    let stagedPath = null;
    if (!takeoverRequired) {
      stagedPath = await this.stageUpload(record, artifact);
    }
    const plan = {
      sessionId: record.id,
      revision: record.revision,
      kind: "upload",
      ref: String(ref),
      selector: targetReference.selector,
      artifact: publicAction.payload,
      stagedPath,
      fingerprint: actionFingerprint({
        kind: "upload",
        ref,
        optionRef: null,
        descriptor,
        payload: publicAction.payload
      }),
      publicAction,
      requiresApproval: !takeoverRequired,
      takeoverRequired
    };
    return {
      plan,
      public_action: publicAction,
      requires_approval: plan.requiresApproval,
      takeover_required: plan.takeoverRequired,
      observation: transferObservation(record, frame, this.now(), plan.takeoverRequired
        ? "This sensitive upload control requires direct user control."
        : "Review the exact attachment, destination field, and page before uploading.")
    };
  }

  async prepareDownload(scope, { sessionId, ref, signal = null } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const expectedRevision = record.revision;
    const targetReference = this.resolveReference(record, ref);
    throwIfAborted(signal);
    const descriptor = await executeIsolated(
      record.window.webContents,
      actionDescriptorScript({ selector: targetReference.selector, optionSelector: null })
    );
    throwIfAborted(signal);
    assertStableRevision(record, expectedRevision);
    const takeoverRequired = browserTargetRequiresTakeover(descriptor.target);
    const frame = await this.capture(record);
    assertStableRevision(record, expectedRevision);
    const publicAction = publicTransferAction({
      kind: "download",
      ref,
      descriptor,
      artifact: null,
      url: record.url,
      revision: record.revision
    });
    const plan = {
      sessionId: record.id,
      revision: record.revision,
      kind: "download",
      ref: String(ref),
      selector: targetReference.selector,
      fingerprint: actionFingerprint({
        kind: "download",
        ref,
        optionRef: null,
        descriptor,
        payload: {}
      }),
      publicAction,
      requiresApproval: !takeoverRequired,
      takeoverRequired
    };
    return {
      plan,
      public_action: publicAction,
      requires_approval: plan.requiresApproval,
      takeover_required: plan.takeoverRequired,
      observation: transferObservation(record, frame, this.now(), plan.takeoverRequired
        ? "This sensitive download control requires direct user control."
        : "Review the exact download control and page before starting a quarantined download.")
    };
  }

  async cancelPreparedUpload(scope, { plan } = {}) {
    if (!plan?.stagedPath) return false;
    let record;
    try {
      record = this.requireSession(scope, plan.sessionId);
    } catch {
      return false;
    }
    if (plan.assigned === true) return false;
    if (!record.stagedUploads.has(plan.stagedPath)) return false;
    record.stagedUploads.delete(plan.stagedPath);
    await unlink(plan.stagedPath).catch(() => {});
    return true;
  }

  async performUpload(scope, { plan, approved = false, signal = null } = {}) {
    if (!plan || plan.kind !== "upload" || !plan.stagedPath) {
      throw new Error("A prepared browser upload is required");
    }
    if (plan.takeoverRequired) throw new Error("This upload control requires direct user control");
    if (approved !== true) throw new Error("Browser uploads require exact human approval");
    const record = this.requireSession(scope, plan.sessionId);
    assertAgentControl(record);
    assertStableRevision(record, plan.revision);
    if (!record.stagedUploads.has(plan.stagedPath)) throw new Error("That staged browser upload expired");
    const descriptor = await executeIsolated(
      record.window.webContents,
      actionDescriptorScript({ selector: plan.selector, optionSelector: null })
    );
    assertTransferFingerprint(plan, descriptor);
    const bytes = await readFile(plan.stagedPath);
    if (
      bytes.length !== plan.artifact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== plan.artifact.sha256
    ) {
      throw new Error("The staged browser upload changed before execution");
    }
    const before = { url: record.url, page_revision: record.revision };
    record.blockedDownload = null;
    await setFileInputFiles(record.window.webContents, plan.selector, [plan.stagedPath]);
    plan.assigned = true;
    const verified = await executeIsolated(
      record.window.webContents,
      verifyFileInputScript({ selector: plan.selector, artifact: plan.artifact })
    );
    if (verified !== true) throw new Error("The browser did not accept the approved upload attachment");
    throwIfAborted(signal);
    await this.waitForSettled(record, 750, signal);
    const snapshot = await this.snapshot(scope, {
      sessionId: record.id,
      maxElements: DEFAULT_MAX_ELEMENTS,
      maxChars: DEFAULT_MAX_CHARS,
      signal
    });
    return {
      ...snapshot,
      operation: "upload",
      transfer_receipt: transferReceipt({
        runtime: this,
        kind: "upload",
        action: plan.publicAction,
        before,
        after: snapshot,
        artifact: plan.artifact
      }),
      summary: `Uploaded ${plan.artifact.name} through the approved file input and verified the selected file metadata.`
    };
  }

  async performDownload(scope, {
    plan,
    approved = false,
    timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
    signal = null
  } = {}) {
    if (!plan || plan.kind !== "download") throw new Error("A prepared browser download is required");
    if (plan.takeoverRequired) throw new Error("This download control requires direct user control");
    if (approved !== true) throw new Error("Browser downloads require exact human approval");
    const record = this.requireSession(scope, plan.sessionId);
    assertAgentControl(record);
    assertStableRevision(record, plan.revision);
    if (record.pendingDownload) throw new Error("Another browser download is already pending");
    const descriptor = await executeIsolated(
      record.window.webContents,
      actionDescriptorScript({ selector: plan.selector, optionSelector: null })
    );
    assertTransferFingerprint(plan, descriptor);
    await this.ensureTransferDirectory(record);
    const pending = deferredDownload({
      id: this.createId(),
      timeoutMs: boundedInteger(timeoutMs, DEFAULT_DOWNLOAD_TIMEOUT_MS, 1_000, 60_000)
    });
    record.pendingDownload = pending;
    record.blockedDownload = null;
    const before = { url: record.url, page_revision: record.revision };
    try {
      await executeIsolated(record.window.webContents, actionScript({
        kind: "click",
        selector: plan.selector,
        optionSelector: null,
        payload: {}
      }));
      const transfer = await waitForDownload(pending, signal);
      await this.waitForSettled(record, 750, signal);
      const snapshot = await this.snapshot(scope, {
        sessionId: record.id,
        maxElements: DEFAULT_MAX_ELEMENTS,
        maxChars: DEFAULT_MAX_CHARS,
        signal
      });
      const artifact = {
        name: transfer.name,
        mime: transfer.mime,
        bytes: transfer.buffer.length,
        sha256: transfer.sha256
      };
      return {
        result: {
          ...snapshot,
          operation: "download",
          transfer_receipt: transferReceipt({
            runtime: this,
            kind: "download",
            action: plan.publicAction,
            before,
            after: snapshot,
            artifact
          }),
          summary: `Downloaded ${transfer.name} into the task attachment quarantine and verified its SHA-256 digest.`
        },
        transfer: {
          ...artifact,
          source_url: record.url,
          buffer: transfer.buffer
        }
      };
    } finally {
      if (record.pendingDownload === pending) record.pendingDownload = null;
    }
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
      ["observational", "preview"].includes(plan.publicAction.risk) &&
      descriptor.target?.tag === "a"
      ? await this.validateRecordTarget(record, descriptor.target.href, { allowSensitiveQuery: false })
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
    if (record.blockedDownload) {
      throw new Error("The action attempted an unapproved download. Use browser_download on a fresh page snapshot.");
    }
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

  async ensureTransferDirectory(record) {
    if (record.transferDirectory) return record.transferDirectory;
    await mkdir(this.transferRoot, { recursive: true, mode: 0o700 });
    record.transferDirectory = await mkdtemp(join(this.transferRoot, "session-"));
    return record.transferDirectory;
  }

  async stageUpload(record, artifact) {
    const directory = await this.ensureTransferDirectory(record);
    const staging = await mkdtemp(join(directory, "upload-"));
    const filePath = join(staging, cleanTransferName(artifact.name));
    await writeFile(filePath, artifact.buffer, { flag: "wx", mode: 0o600 });
    record.stagedUploads.add(filePath);
    return filePath;
  }

  handleDownload(record, event, item, webContents) {
    const pending = record?.pendingDownload;
    const wrongContents = webContents && webContents !== record.window.webContents;
    if (!pending || wrongContents || Date.now() > pending.expiresAt || pending.item) {
      event.preventDefault?.();
      item?.cancel?.();
      record.blockedDownload = {
        at: this.now().toISOString(),
        name: cleanTransferName(item?.getFilename?.() || "download")
      };
      return;
    }
    const declaredBytes = Number(item?.getTotalBytes?.() || 0);
    if (declaredBytes > MAX_TRANSFER_BYTES) {
      event.preventDefault?.();
      item?.cancel?.();
      pending.reject(new Error("The browser download exceeds the 20 MB attachment limit"));
      return;
    }
    const name = cleanTransferName(item?.getFilename?.() || "download");
    const filePath = join(record.transferDirectory, `${cleanId(pending.id)}-${name}`);
    pending.item = item;
    pending.path = filePath;
    pending.name = name;
    pending.mime = cleanText(item?.getMimeType?.(), 200) || "application/octet-stream";
    item.setSavePath?.(filePath);
    item.on?.("updated", () => {
      if (Number(item.getReceivedBytes?.() || 0) > MAX_TRANSFER_BYTES) item.cancel?.();
    });
    item.once?.("done", (_doneEvent, state) => {
      this.completeDownload(pending, state).catch((error) => pending.reject(error));
    });
  }

  async completeDownload(pending, state) {
    try {
      if (state !== "completed") {
        throw new Error(`The browser download ${state || "did not complete"}`);
      }
      const info = await stat(pending.path);
      if (!info.isFile() || info.size === 0) throw new Error("The browser download was empty");
      if (info.size > MAX_TRANSFER_BYTES) {
        throw new Error("The browser download exceeds the 20 MB attachment limit");
      }
      const buffer = await readFile(pending.path);
      pending.resolve({
        name: pending.name,
        mime: pending.mime,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        buffer
      });
    } finally {
      if (pending.path) await unlink(pending.path).catch(() => {});
    }
  }

  async close(scope, { sessionId } = {}) {
    const record = this.requireSession(scope, sessionId);
    assertAgentControl(record);
    const preview = record.localPreviewOrigin
      ? {
          origin: record.localPreviewOrigin,
          network: "exact loopback origin only"
        }
      : null;
    const result = {
      ok: true,
      status: "closed",
      session_id: record.id,
      url: record.url,
      title: record.title,
      page_revision: record.revision,
      observed_at: this.now().toISOString(),
      element_count: 0,
      summary: "Closed the task-bound browser and revoked its references and frame.",
      ...(preview ? { preview } : {})
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
    this.localPreviewOrigins.clear();
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
      closing: false,
      transferDirectory: null,
      stagedUploads: new Set(),
      pendingDownload: null,
      blockedDownload: null,
      localPreviewOrigin: ""
    };
    this.lockSessionNetwork(browserSession, record);
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (record.userVisible) {
        this.validateRecordTarget(record, url, { allowSensitiveQuery: false })
          .then((target) => this.load(record, target, null))
          .catch(() => {});
      }
      return { action: "deny" };
    });
    const navigated = (_event, value) => {
      try {
        const next = record.localPreviewOrigin
          ? parseBrowserHttpUrl(value)
          : parsePublicHttpUrl(value);
        if (record.localPreviewOrigin && next.origin !== record.localPreviewOrigin) return;
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
      const current = await this.validateRecordTarget(record, record.window.webContents.getURL(), {
        allowSensitiveQuery: false
      });
      record.url = current.href;
      record.title = cleanText(record.window.webContents.getTitle(), 300) || "Untitled page";
      if (record.revision === 0) record.revision = 1;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  lockSessionNetwork(browserSession, record) {
    browserSession.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler?.(() => false);
    browserSession.setDisplayMediaRequestHandler?.((_request, callback) => callback({}));
    browserSession.on?.("will-download", (event, item, webContents) => {
      this.handleDownload(record, event, item, webContents);
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
      this.validateRequest(details, record)
        .then(() => finish(false))
        .catch(() => finish(true));
    });
  }

  async validateRequest(details, record = null) {
    const url = new URL(details.url);
    if (["http:", "https:"].includes(url.protocol)) {
      if (record?.localPreviewOrigin) {
        if (url.origin !== record.localPreviewOrigin) {
          throw new Error("Local preview sessions cannot access external or other local origins");
        }
        if (details.resourceType === "mainFrame" && hasCredentialLikeUrlData(url)) {
          throw new Error("Credential-like browser URLs are not allowed");
        }
      } else {
        await this.publicPolicy.validate(url, {
          allowSensitiveQuery: details.resourceType !== "mainFrame"
        });
      }
      return;
    }
    if (url.protocol === "blob:") {
      if (details.resourceType === "mainFrame") throw new Error("Blob navigation is blocked");
      const embedded = new URL(url.pathname);
      if (record?.localPreviewOrigin) {
        if (embedded.origin !== record.localPreviewOrigin) {
          throw new Error("Local preview blobs must share the exact preview origin");
        }
      } else {
        await this.publicPolicy.validate(embedded);
      }
      return;
    }
    if (url.protocol === "data:" && details.resourceType !== "mainFrame") return;
    if (url.href === "about:blank") return;
    throw new Error("Unsupported browser request scheme");
  }

  async validateTarget(scope, value, { allowSensitiveQuery = true } = {}) {
    const url = parseBrowserHttpUrl(value);
    const previewOrigin = this.localPreviewOrigin(scope, url);
    if (previewOrigin) {
      if (!allowSensitiveQuery && hasCredentialLikeUrlData(url)) {
        throw new Error("Credential-like browser URLs are not allowed");
      }
      return url;
    }
    return this.publicPolicy.validate(url, { allowSensitiveQuery });
  }

  async validateRecordTarget(record, value, { allowSensitiveQuery = true } = {}) {
    const url = parseBrowserHttpUrl(value);
    if (record.localPreviewOrigin) {
      if (url.origin !== record.localPreviewOrigin) {
        throw new Error("Local preview sessions cannot leave their exact loopback origin");
      }
      if (!allowSensitiveQuery && hasCredentialLikeUrlData(url)) {
        throw new Error("Credential-like browser URLs are not allowed");
      }
      return url;
    }
    return this.publicPolicy.validate(url, { allowSensitiveQuery });
  }

  localPreviewOrigin(scope, value) {
    const url = value instanceof URL ? value : parseBrowserHttpUrl(value);
    const origins = this.localPreviewOrigins.get(scopeKey(normalizeScope(scope)));
    return origins?.has(url.origin) ? url.origin : "";
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
      href: safeObservedHref(input?.href, record.localPreviewOrigin),
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
      height: boundedInteger(size.height, VIEWPORT.height, 1, 4_000),
      pageRevision: record.revision,
      sha256: createHash("sha256").update(buffer).digest("hex")
    };
    return {
      frame_id: id,
      width: record.frame.width,
      height: record.frame.height,
      bytes: buffer.length,
      sha256: record.frame.sha256
    };
  }

  async captureVisual(record) {
    let cssKey = null;
    try {
      cssKey = await record.window.webContents.insertCSS?.([
        "input,textarea,select,[contenteditable='true'],[contenteditable='']{",
        "color:transparent!important;text-shadow:none!important;caret-color:transparent!important;",
        "}",
        "input::placeholder,textarea::placeholder{color:#687386!important;opacity:1!important;}"
      ].join(""));
      return await this.capture(record);
    } finally {
      if (cssKey) {
        const removal = record.window.webContents.removeInsertedCSS?.(cssKey);
        await removal?.catch(() => {});
      }
    }
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
    record.pendingDownload?.item?.cancel?.();
    record.pendingDownload?.reject?.(new Error("The browser session closed before the download completed"));
    record.pendingDownload = null;
    this.sessions.delete(record.id);
    if (!record.window.isDestroyed?.()) record.window.destroy();
    if (record.transferDirectory) {
      rm(record.transferDirectory, { recursive: true, force: true }).catch(() => {});
      record.transferDirectory = null;
    }
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

async function assertVisualSurfaceAllowed(record) {
  if (looksLikeAuthenticationSurface(record.url)) {
    throw new Error("Visual browser control is blocked on authentication surfaces. Ask the user to Take control.");
  }
  const result = await executeIsolated(record.window.webContents, visualSurfaceSafetyScript());
  if (Number(result?.visibleSensitiveFields || 0) > 0) {
    throw new Error("Visual browser control is blocked while a credential or sensitive field is visible. Ask the user to Take control.");
  }
}

function visualSurfaceSafetyScript() {
  return `(() => {
    const sensitive = /password|passcode|one[\\s_-]?time|\\botp\\b|verification[\\s_-]?code|security[\\s_-]?code|\\bmfa\\b|\\b2fa\\b|recovery|token|secret|api[\\s_-]?key|credit[\\s_-]?card|\\bcvv\\b|\\bcvc\\b|social[\\s_-]?security|\\bssn\\b/i;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const fields = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable]'));
    return {
      visibleSensitiveFields: fields.filter((element) => {
        if (!visible(element)) return false;
        const identity = [
          element.getAttribute('type'), element.getAttribute('name'), element.getAttribute('id'),
          element.getAttribute('autocomplete'), element.getAttribute('aria-label'), element.getAttribute('placeholder')
        ].filter(Boolean).join(' ');
        const form = element.form || element.closest('form');
        return String(element.getAttribute('type') || '').toLowerCase() === 'password' ||
          /current-password|new-password|one-time-code|cc-/.test(String(element.getAttribute('autocomplete') || '').toLowerCase()) ||
          sensitive.test(identity) || Boolean(form?.querySelector('input[type="password"]'));
      }).length
    };
  })()`;
}

function visualPointDescriptorScript({ x, y }) {
  return `(() => {
    const x = ${x};
    const y = ${y};
    const clean = (value, limit = 300) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const element = document.elementFromPoint(x, y);
    if (!element) throw new Error('No visible browser target exists at those coordinates');
    const interactive = element.closest('a,button,input,textarea,select,[role],[contenteditable]') || element;
    const type = clean(interactive.getAttribute('type') || interactive.tagName, 40).toLowerCase();
    const labels = interactive.labels ? Array.from(interactive.labels).map((label) => clean(label.textContent, 120)).join(' ') : '';
    const name = clean(interactive.getAttribute('aria-label') || labels || interactive.getAttribute('alt') || interactive.getAttribute('title') || interactive.getAttribute('placeholder') || interactive.getAttribute('name') || (['INPUT','TEXTAREA'].includes(interactive.tagName) ? 'Editable field' : interactive.textContent));
    const identity = [type, interactive.getAttribute('role'), name, interactive.getAttribute('id'), interactive.getAttribute('name'), interactive.getAttribute('autocomplete')].filter(Boolean).join(' ');
    const form = interactive.form || interactive.closest('form');
    const sensitive = /password|passcode|one[\\s_-]?time|\\botp\\b|verification[\\s_-]?code|security[\\s_-]?code|\\bmfa\\b|\\b2fa\\b|recovery|token|secret|api[\\s_-]?key|credit[\\s_-]?card|\\bcvv\\b|\\bcvc\\b|social[\\s_-]?security|\\bssn\\b/i;
    return {
      tag: interactive.tagName.toLowerCase(),
      type,
      role: clean(interactive.getAttribute('role'), 80) || interactive.tagName.toLowerCase(),
      name,
      disabled: interactive.matches(':disabled') || interactive.getAttribute('aria-disabled') === 'true',
      editable: ['input','textarea'].includes(interactive.tagName.toLowerCase()) || interactive.isContentEditable === true,
      sensitive: type === 'password' || /current-password|new-password|one-time-code|cc-/.test(String(interactive.getAttribute('autocomplete') || '').toLowerCase()) || sensitive.test(identity) || Boolean(form?.querySelector('input[type="password"]'))
    };
  })()`;
}

function requireVisualFrame(record, frameId) {
  const frame = record.frame;
  if (
    !frame || frame.id !== String(frameId || "") || frame.pageRevision !== record.revision ||
    !/^[a-f0-9]{64}$/.test(String(frame.sha256 || ""))
  ) {
    throw new Error("That visual browser frame expired; observe it again");
  }
  return frame;
}

function publicFrame(frame) {
  return {
    frame_id: frame.id,
    width: frame.width,
    height: frame.height,
    bytes: frame.buffer.length,
    sha256: frame.sha256
  };
}

function visualPoint({ kind, x, y, frame }) {
  if (kind === "key") return null;
  const defaultX = Math.floor(frame.width / 2);
  const defaultY = Math.floor(frame.height / 2);
  const parsedX = Number(x);
  const parsedY = Number(y);
  if (
    ["click", "type"].includes(kind) &&
    (!Number.isSafeInteger(parsedX) || !Number.isSafeInteger(parsedY) ||
      parsedX < 0 || parsedX >= frame.width || parsedY < 0 || parsedY >= frame.height)
  ) {
    throw new Error(`Visual ${kind} requires exact coordinates inside the current frame`);
  }
  const point = {
    x: boundedInteger(parsedX, defaultX, 0, frame.width - 1),
    y: boundedInteger(parsedY, defaultY, 0, frame.height - 1)
  };
  return point;
}

function normalizeVisualPayload(kind, { text, replace, key, deltaY }) {
  if (kind === "type") {
    const value = String(text ?? "");
    if (!value || value.length > 5_000) throw new Error("Visual browser text must contain 1-5,000 characters");
    return { text: value, replace: replace !== false };
  }
  if (kind === "key") {
    const value = String(key || "");
    if (!VISUAL_KEYS.has(value)) throw new Error("That visual browser key is not allowed");
    return { key: value };
  }
  if (kind === "scroll") {
    const value = boundedInteger(deltaY, 0, -2_000, 2_000);
    if (!value) throw new Error("Visual browser scroll requires a non-zero delta_y");
    return { deltaY: value };
  }
  return {};
}

function publicVisualAction({ kind, targetDescription, point, descriptor, payload, risk, url, revision, frame }) {
  const description = cleanRequired(targetDescription, 300, "visual browser target description");
  const publicPayload = kind === "type"
    ? {
        characters: payload.text.length,
        sha256: createHash("sha256").update(payload.text).digest("hex"),
        replace: payload.replace
      }
    : kind === "key" ? { key: payload.key }
      : kind === "scroll" ? { delta_y: payload.deltaY }
        : {};
  return {
    action: `visual_${kind}`,
    risk,
    origin: new URL(url).origin,
    page_revision: revision,
    frame_id: frame.id,
    frame_sha256: frame.sha256,
    target_description: description,
    point,
    observed_target: descriptor ? {
      role: cleanText(descriptor.role, 80),
      name: cleanText(descriptor.name, 300),
      tag: cleanText(descriptor.tag, 40),
      type: cleanText(descriptor.type, 40)
    } : null,
    payload: publicPayload
  };
}

function visualObservation(record, frame, now, targetDescription = "") {
  return {
    ok: true,
    status: "ready",
    contract: "amos.browser-visual-observation:1",
    session_id: record.id,
    url: record.url,
    title: record.title,
    page_revision: record.revision,
    observed_at: now.toISOString(),
    element_count: record.refs.size,
    target_description: cleanText(targetDescription, 300),
    frame,
    summary: "Captured a masked task-local browser frame for bounded visual fallback. Editable values were hidden.",
    takeover_active: false
  };
}

async function sendVisualInput(webContents, plan) {
  const point = plan.point;
  if (plan.kind === "scroll") {
    webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    webContents.sendInputEvent({ type: "mouseWheel", x: point.x, y: point.y, deltaY: plan.payload.deltaY, deltaX: 0 });
    return;
  }
  if (plan.kind === "key") {
    const keyCode = plan.payload.key === "Space" ? " " : plan.payload.key;
    webContents.sendInputEvent({ type: "keyDown", keyCode });
    webContents.sendInputEvent({ type: "keyUp", keyCode });
    return;
  }
  webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
  if (plan.kind !== "type") return;
  if (plan.payload.replace) {
    const modifiers = process.platform === "darwin" ? ["meta"] : ["control"];
    webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers });
    webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers });
  }
  if (typeof webContents.insertText !== "function") {
    throw new Error("This AMOS Desktop build cannot insert bounded visual text");
  }
  await webContents.insertText(plan.payload.text);
}

function looksLikeAuthenticationSurface(value) {
  try {
    const url = new URL(value);
    return /(?:^|\/)(?:login|log-in|signin|sign-in|auth|oauth|sso|mfa|2fa|verify|verification|recover|reset-password)(?:\/|$)/i.test(url.pathname);
  } catch {
    return true;
  }
}

function hashValue(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
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

function verifyFileInputScript({ selector, artifact }) {
  return `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target || target.tagName !== 'INPUT' || String(target.type).toLowerCase() !== 'file') return false;
    const files = Array.from(target.files || []);
    return files.length === 1 &&
      files[0].name === ${JSON.stringify(artifact.name)} &&
      files[0].size === ${artifact.bytes};
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
  if (kind === "click" && target.tag === "a" && target.download) {
    throw new Error("Use browser_download for download controls");
  }
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

function publicBrowserAction({
  kind,
  ref,
  optionRef,
  descriptor,
  payload,
  classification,
  url,
  revision,
  localPreviewOrigin = ""
}) {
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
      destination: safeObservedHref(target.href || target.form?.action, localPreviewOrigin)
    },
    payload: actionPayload
  };
}

function normalizeUploadAttachment(input = {}) {
  const buffer = Buffer.from(input.buffer || []);
  const artifact = {
    attachment_id: cleanRequired(input.id, 128, "browser upload attachment"),
    name: cleanTransferName(input.name),
    mime: cleanText(input.mime, 200) || "application/octet-stream",
    bytes: boundedInteger(input.size, buffer.length, 1, MAX_TRANSFER_BYTES),
    sha256: cleanText(input.sha256, 64).toLowerCase(),
    buffer
  };
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("The upload attachment needs a valid SHA-256 digest");
  if (buffer.length !== artifact.bytes) throw new Error("The upload attachment byte count changed");
  if (createHash("sha256").update(buffer).digest("hex") !== artifact.sha256) {
    throw new Error("The upload attachment digest changed");
  }
  return artifact;
}

function publicTransferAction({ kind, ref, descriptor, artifact, url, revision }) {
  const target = descriptor?.target;
  if (!target || target.visible !== true || target.disabled) {
    throw new Error("The referenced browser transfer control is unavailable; take a fresh snapshot");
  }
  const page = new URL(url);
  return {
    action: kind,
    risk: "file-transfer",
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
    payload: artifact
      ? {
          attachment_id: artifact.attachment_id,
          name: artifact.name,
          mime: artifact.mime,
          bytes: artifact.bytes,
          sha256: artifact.sha256
        }
      : {}
  };
}

function transferObservation(record, frame, now, summary) {
  return {
    ok: true,
    status: "ready",
    session_id: record.id,
    url: record.url,
    title: record.title,
    page_revision: record.revision,
    observed_at: now.toISOString(),
    element_count: record.refs.size,
    summary,
    frame,
    takeover_active: false
  };
}

function assertTransferFingerprint(plan, descriptor) {
  const fingerprint = actionFingerprint({
    kind: plan.kind,
    ref: plan.ref,
    optionRef: null,
    descriptor,
    payload: plan.kind === "upload" ? plan.artifact : {}
  });
  if (fingerprint !== plan.fingerprint) {
    throw new Error("The browser transfer target changed while approval was pending; take a fresh snapshot");
  }
}

async function setFileInputFiles(webContents, selector, files) {
  const debugging = webContents?.debugger;
  if (!debugging?.sendCommand || !debugging?.attach) {
    throw new Error("This AMOS Desktop build cannot stage governed browser uploads");
  }
  const attachedHere = debugging.isAttached?.() !== true;
  if (attachedHere) debugging.attach("1.3");
  try {
    const document = await debugging.sendCommand("DOM.getDocument", { depth: 0, pierce: false });
    const rootNodeId = document?.root?.nodeId;
    if (!rootNodeId) throw new Error("The upload page is no longer inspectable");
    const target = await debugging.sendCommand("DOM.querySelector", {
      nodeId: rootNodeId,
      selector
    });
    if (!target?.nodeId) throw new Error("The approved upload field changed; take a fresh snapshot");
    await debugging.sendCommand("DOM.setFileInputFiles", {
      files,
      nodeId: target.nodeId
    });
  } finally {
    if (attachedHere && debugging.isAttached?.()) debugging.detach();
  }
}

function transferReceipt({ runtime, kind, action, before, after, artifact }) {
  return {
    contract: "amos.browser-transfer:1",
    receipt_id: runtime.createId(),
    action: kind,
    risk: "file-transfer",
    approved: true,
    target: action.target,
    artifact: {
      ...(artifact.attachment_id ? { attachment_id: artifact.attachment_id } : {}),
      name: artifact.name,
      mime: artifact.mime,
      bytes: artifact.bytes,
      sha256: artifact.sha256
    },
    before,
    after: { url: after.url, page_revision: after.page_revision },
    executed_at: runtime.now().toISOString(),
    verified: true
  };
}

function deferredDownload({ id, timeoutMs }) {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return {
    id,
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
    expiresAt: Date.now() + timeoutMs,
    timeoutMs,
    item: null,
    path: null,
    name: "",
    mime: ""
  };
}

function waitForDownload(pending, signal = null) {
  return new Promise((resolveValue, rejectValue) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      handler(value);
    };
    const timeout = setTimeout(() => {
      pending.item?.cancel?.();
      finish(rejectValue, new Error("The approved browser control did not produce a download before the timeout"));
    }, pending.timeoutMs);
    const abort = () => {
      pending.item?.cancel?.();
      finish(rejectValue, new Error("Browser operation canceled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    pending.promise.then(
      (value) => finish(resolveValue, value),
      (error) => finish(rejectValue, error)
    );
  });
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

function safeObservedHref(value, localPreviewOrigin = "") {
  if (!value) return "";
  try {
    const candidate = parseBrowserHttpUrl(value);
    const url = localPreviewOrigin && candidate.origin === localPreviewOrigin
      ? candidate
      : assertPublicUrlSyntax(candidate);
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

function cleanUrl(value, localPreviewOrigin = "") {
  try {
    const candidate = parseBrowserHttpUrl(value);
    const url = localPreviewOrigin && candidate.origin === localPreviewOrigin
      ? candidate
      : assertPublicUrlSyntax(candidate);
    return hasCredentialLikeUrlData(url) ? "" : url.href;
  } catch {
    return "";
  }
}

function parseBrowserHttpUrl(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed");
  }
  return url;
}

function cleanRequired(value, max, label) {
  const text = cleanText(value, max);
  if (!text) throw new Error(`A ${label} is required`);
  return text;
}

function cleanText(value, max = 1_000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanTransferName(value) {
  return basename(String(value || "download").replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 200) || "download";
}

function cleanId(value) {
  return String(value || "transfer").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "transfer";
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
