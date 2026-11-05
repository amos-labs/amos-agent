# Workflow workspace runtime

Connected companies can choose focused business workflows. The main Operator coordinates those workflows and their existing Mission/Automation specialists; it does not expose every engine by default. Personal/local work and existing full-company work retain distinct compatibility paths.

## Module ownership

- `src/desktop/workflowWorkspace.js` normalizes the Platform contract and owns pure navigation, update-pin, starter, and prompt projections.
- `src/desktop/workflowWorkspaceSession.js` owns refresh, authority-change invalidation, and company/revision/catalog-pinned settings writes.
- `src/tools/workflowAmos.js` supplies the focused model-facing bootstrap and exact workflow tool loader. Calls always go through Platform's existing gates.
- `desktop/renderer/workflowWorkspaceView.js` owns workflow navigation and configuration UI. The main renderer delegates to it instead of embedding another configuration subsystem.
- `src/runtime.js` selects the appropriate registry once. Focused company mode does not register shell, coding delegation, unrestricted engine discovery, or credentialled browser tools. Its bounded support tools include evidence reads, public research, deterministic calculation, and native artifacts.

The focused operator prompt reuses the AMOS constitution but replaces the general engine bootstrap. It encourages flexible investigation within the mandate, not a fixed questionnaire or a hardcoded sequence of steps.

## Authority and compatibility

Navigation and model tool exposure are usability controls, not the security boundary. Platform rechecks selected workflow, tenant, actor scopes, module/plan access, policy, approvals, Run Contracts, and budgets. Workflow context never grants local file access or weakens device approvals.

Old servers may report the workflow tools as unknown, in which case Desktop preserves its compatible behavior. Network failures do not count as successful configuration. Company switches clear the previous projection. Changing authority resets the runtime; ordinary background progress does not reset the conversation.

Workspace configuration requires an owner/admin decision. The dialog submits the displayed company, revision, and catalog digest. After a pending result, it links to the existing Decisions ceremony and waits for confirmed server state. Website-plan recommendations are displayed separately and never automatically enabled.

The backend is the shared contract for web, iPhone, and a future Desktop voice surface. This change does not move schedules to Electron or add a second agent/model router. Meeting-app packaging remains undecided.

## Validation

Run `npm test` and `npm run check`. Workflow tests cover the distinct registry, exact scoped calls, pinned Mission creation, rejected/mismatched schema snapshots, stale settings dialogs, company switches, starter behavior, and runtime invalidation. Existing per-operation approval, local safety, document, routing, conversation, and recovery tests remain part of the regression suite.

Persistent RFP source monitoring, Desktop voice, durable meeting sessions, and native phone notification/UI changes require their own integration acceptance. Workspace setup must not claim those features are already operational.
