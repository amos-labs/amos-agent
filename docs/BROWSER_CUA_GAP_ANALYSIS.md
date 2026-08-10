# Browser and computer-use gap analysis

## Decision

AMOS should preserve the old agent-marketing product loop—observe, act, observe,
and hand control to the user—without porting its server proxy or cookie-copying
architecture. Desktop owns browser execution locally; Platform connectors remain
preferred for durable company systems, credentials, normalized data, policy,
and proof.

The current implementation uses Electron's pinned Chromium rather than adding a
second Playwright browser download. Browser pages run in separate sandboxed,
ephemeral Electron sessions behind the main-process boundary. The canvas receives
only a task-scoped frame identifier and bounded page metadata.

## What the legacy implementation proved

The `agent_marketing` reference contains three useful product patterns:

- a persistent one-action-at-a-time browser loop with navigation, screenshots,
  page text, interactive-element discovery, click/type/scroll/key/wait actions,
  and recovery;
- a browser canvas that makes autonomous work visible; and
- user handoff for login followed by agent continuation.

Those patterns are valuable. The implementation itself should not move into
Desktop:

- its Rails proxy accepts arbitrary HTTP(S) targets without the Desktop public-
  network/DNS boundary;
- it removes CSP and frame protections and executes rewritten third-party pages
  through the application origin;
- it copies cached proxy cookies into the autonomous browser;
- model-authored CSS, XPath, and text selectors target live pages directly;
- sessions are process-global in-memory records rather than exact account,
  tenant, and task capabilities; and
- tests cover tool metadata and required arguments, but not destination safety,
  cross-tenant isolation, stale references, credentials, downloads, or exact
  consequence binding.

## Current AMOS Desktop position

Implemented in the first governed slice:

- public HTTP/HTTPS validation before navigation and on browser requests;
- private, loopback, link-local, metadata, unsupported-scheme, credential-bearing,
  and credential-like main-frame URL rejection;
- sandboxed, no-Node, no-preload, permission-denied, popup-denied, download-denied
  ephemeral Chromium sessions;
- exact boundary binding across user, tenant, task, and operating mode;
- bounded semantic snapshots with opaque revision-bound element references;
- deterministic article, table, list, form-structure, and referenced-region
  extraction;
- local screenshot frames rendered through a typed browser canvas block without
  putting base64 into model context; and
- frame/reference revocation on close, canvas removal, runtime reset, account
  switch, or task switch. Browser execution capabilities are excluded from task
  persistence and forks.

This closes the gap for public JavaScript research. It does not yet provide
authenticated browser operations or general visual computer use.

## Remaining product slices

### 2. Authenticated semantic browser actions

- Add `browser_click`, `browser_type`, `browser_select`, and `browser_wait` using
  only current opaque element references—never raw model selectors.
- Make user takeover show the same isolated browser session. The user enters
  passwords and MFA directly; AMOS cannot read or type them and no cookie copy
  occurs.
- Classify navigation, extraction, and harmless controls as observational.
  Bind form submission, messages, uploads, purchases, deletes, publishing,
  permission changes, and cross-origin authenticated transitions to an exact
  approval containing page revision, origin, fields, artifacts, and screenshot.
- Route downloads and uploads through the existing attachment, hashing,
  workspace, and approval boundaries.

### 3. Deterministic browser automations

- Record successful semantic workflows as typed recipes with origins, element
  contracts, extraction schemas, retry limits, and expected outcomes.
- Run matching recipes without an LLM.
- Stop on DOM/ARIA drift and let AI propose a reviewed repair; never silently
  retarget a different control.
- Promote stable enterprise workflows to Platform connectors or governed
  automations when browser execution should no longer be the system of record.

### 4. Visual browser fallback

- Add frame-hash-bound pointer and keyboard proposals only when semantic
  references are unavailable.
- Require a qualified vision model and invalidate coordinates after every frame
  change.
- Mask password fields and deny clipboard reads, notifications, popups, and
  unrelated windows.
- Keep deterministic recipes working when the model is offline; unfamiliar
  visual states stop safely.

### 5. General computer use

- Treat browser CUA and desktop CUA as different capabilities. Cross-application
  control needs explicit operating-system screen-recording/accessibility grants,
  application/window identity, bounded capture regions, secure-surface masking,
  and stronger consequence review.
- Start with approved AMOS-owned or named business applications. Do not expose
  unrestricted screen/keyboard control as a generic model tool.

## Current API choices

Electron now recommends `WebContentsView` instead of the deprecated
`BrowserView`, and discourages relying on the `<webview>` tag. The current
read-only slice avoids both: a hidden sandboxed `BrowserWindow` performs local
execution and the AMOS canvas renders an inert screenshot. A later same-session
takeover can reveal a governed window without exposing its debugging surface.

Playwright remains a valid future reliability option for semantic actions and
ARIA snapshots. Its browser versions are coupled to specific Playwright
releases and normally add a separate browser download measured in hundreds of
megabytes. AMOS should add that footprint only if qualification shows the
Electron-native runtime cannot meet action reliability and drift-detection
targets.

Primary references:

- [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron BrowserView deprecation](https://www.electronjs.org/docs/latest/api/browser-view)
- [Electron webview guidance](https://www.electronjs.org/docs/latest/api/webview-tag)
- [Playwright browser management](https://playwright.dev/docs/browsers)
- [Playwright ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
- [Playwright locators](https://playwright.dev/docs/locators)
