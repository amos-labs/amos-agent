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
- sandboxed, no-Node, no-preload, permission-denied, popup-denied,
  unapproved-download-denied ephemeral Chromium sessions;
- exact boundary binding across user, tenant, task, and operating mode;
- bounded semantic snapshots with opaque revision-bound element references;
- deterministic article, table, list, form-structure, and referenced-region
  extraction;
- local screenshot frames rendered through a typed browser canvas block without
  putting base64 into model context; and
- frame/reference revocation on close, canvas removal, runtime reset, account
  switch, or task switch. Browser execution capabilities are excluded from task
  persistence and forks.

The authenticated semantic slice now additionally provides:

- deterministic `click`, `type`, `select`, `check`, and bounded `wait` tools
  over current opaque references only;
- conservative action classification, with exact non-persistent approval for
  buttons, form fields, selects, checks, and consequential links;
- page-material and target fingerprint revalidation after approval;
- redacted post-action receipts containing payload hashes rather than typed
  text;
- authentication/sensitive-field detection that routes to user takeover rather
  than model operation; and
- direct user control of the same isolated session through a fixed-title
  native window, without cookie copying or credential extraction.

The governed transfer slice additionally provides:

- `browser_upload` over one current attachment ID and one current file-input
  reference, with exact byte/digest revalidation and one-time approval;
- private mode-0600 staging and main-process-only transient Chromium DOM
  assignment, without revealing local paths or a debugger capability;
- `browser_download` as the only approved download route, with surprise-download
  cancellation, private quarantine, a 20 MB limit, SHA-256 verification, and
  admission through the existing supported attachment pipeline;
- a typed canvas download summary and separate native **Save copy…** ceremony;
  and
- transfer-directory destruction with browser/task/account/runtime revocation.

The deterministic recipe slice now additionally provides:

- task-local redacted recording of successful verified semantic actions;
- encrypted identity-pinned recipes with origins, exact semantic contracts,
  named string/attachment inputs, bounded waits, and no stored selectors,
  values, credentials, cookies, paths, bytes, or approval authority;
- deterministic replay without an LLM, fresh approvals at each consequence,
  per-step checkpoints, an aggregate run receipt, and exact drift stop;
- local recipe management beside Platform automations; and
- focused AI-assisted repair tasks without silent retargeting.

The bounded visual browser slice now additionally provides:

- editable-value-masked screenshots delivered only as transient vision-model
  evidence, not public/persisted tool state;
- vision-tool availability only for qualified provider profiles;
- click, type, bounded key, and scroll inputs tied to exact task, origin, page
  revision, frame ID, frame SHA-256, geometry, coordinates, target description,
  descriptor, and payload;
- fresh approval for every non-scroll action and pixel revalidation after the
  approval wait;
- authentication-route and visible sensitive-field blocking with direct user
  takeover; and
- canvas progress, target, frame hash, and safety state.

This closes the AMOS Desktop gap for bounded authenticated browser operation,
file transfer, deterministic semantic replay, and isolated browser-CUA.
Unrestricted cross-application desktop control remains a separate capability,
not an implicit extension of the browser grant.

## Remaining product slices

### 2. Authenticated semantic browser actions and file transfer — implemented

- `browser_click`, `browser_type`, `browser_select`, `browser_check`, and
  `browser_wait` use only current opaque element references—never raw model
  selectors.
- User takeover shows the same isolated browser session. The user enters
  passwords and MFA directly; AMOS cannot read or type them and no cookie copy
  occurs.
- Navigation, extraction, harmless links, and search-like input are
  observational. Buttons and form changes bind to an exact approval containing
  page revision, page-material marker, origin, target, payload hash, and a fresh
  local screenshot.
- Uploads and downloads use separate exact-action tools, attachment IDs,
  hashing, quarantine, supported-format admission, receipts, and native user
  save rather than model-authored filesystem paths.

### 3. Deterministic browser automations — implemented locally

- Record successful semantic workflows as typed recipes with origins, exact
  element contracts, named runtime inputs, bounded waits, and checkpoints.
- Run matching recipes without an LLM.
- Stop on DOM/ARIA drift and let AI propose a reviewed repair; never silently
  retarget a different control.
- Promote stable enterprise workflows to Platform connectors or governed
  automations when browser execution should no longer be the system of record.

Local hidden scheduling is intentionally absent. Stable unattended workflows
should be promoted into Platform connectors or automations with explicit
durable credentials, schedules, policy, retries, and proof.

### 4. Visual browser fallback — implemented

- Add frame-hash-bound pointer and keyboard proposals only when semantic
  references cannot express the target.
- Require a qualified vision model and invalidate coordinates after every frame
  change.
- Mask password fields and deny clipboard reads, notifications, popups, and
  unrelated windows.
- Keep deterministic recipes working when the model is offline; unfamiliar
  visual states stop safely.

### 5. General computer use — separate future grant

- Treat browser CUA and desktop CUA as different capabilities. Cross-application
  control needs explicit operating-system screen-recording/accessibility grants,
  application/window identity, bounded capture regions, secure-surface masking,
  and stronger consequence review.
- Start with approved AMOS-owned or named business applications. Do not expose
  unrestricted screen/keyboard control as a generic model tool.

## Current API choices

Electron now recommends `WebContentsView` instead of the deprecated
`BrowserView`, and discourages relying on the `<webview>` tag. The current
semantic slices avoid both: a hidden sandboxed `BrowserWindow` performs local
execution, the AMOS canvas renders an inert screenshot, and same-session
takeover reveals that governed window without exposing its debugging surface.

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
