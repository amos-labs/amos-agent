# Contributing to AMOS Desktop

AMOS Desktop is the open-source native operator for the governed AMOS company
brain. Contributions should strengthen that boundary rather than duplicate the
managed platform inside the desktop.

## Good contribution areas

- macOS, Windows, and enterprise packaging;
- accessibility and native interaction;
- streaming, cancellation, and resumable local tasks;
- local workspace and coding tools;
- provider adapters and hardware-aware local inference;
- typed canvas renderers;
- private/offline memory and safe synchronization;
- security tests and threat-model improvements; and
- documentation, examples, and developer experience.

## Architectural guardrails

- AMOS remains authoritative for shared company data, credentials, policy,
  approvals, and receipts.
- The renderer remains sandboxed and receives an allowlisted IPC API.
- Local access is workspace-bounded and explicit.
- Mutating local tools require approval by default.
- Company actions use the authenticated AMOS tenant and scopes.
- Provider credentials never enter prompts, tool results, or child commands.
- New model providers belong behind the common provider boundary.
- Dynamic output should use typed safe blocks rather than arbitrary model HTML.

Read [Architecture](docs/ARCHITECTURE.md) and [Safety](docs/SAFETY.md) before
changing a trust boundary.

## Development setup

Requirements:

- Node.js 22 or newer;
- macOS for the current native application and packaging flow; and
- an AMOS account for end-to-end MCP testing.

```bash
git clone https://github.com/amos-labs/amos-agent.git
cd amos-agent
npm install
npm test
npm run check
npm run desktop
```

## Pull requests

Keep each PR focused and explain:

- the user problem;
- the trust boundary affected;
- behavior before and after;
- tests added or updated; and
- any release, migration, or compatibility impact.

Before opening a PR:

```bash
npm test
npm run check
npm audit --omit=dev
```

For UI changes, test first-run onboarding, a connected session, keyboard
behavior, and the smallest supported window.

## Testing principles

- Prefer dependency injection around OS, network, updater, and provider code.
- Test failure-closed behavior.
- Assert that secrets do not cross process or model boundaries.
- Cover both allowed paths and denied traversal/scope paths.
- Keep fixture content synthetic and tenant-neutral.

## Releases

Maintainers publish signed releases by pushing a version tag matching
`package.json`. Do not commit signing certificates, Apple credentials, provider
keys, or generated release artifacts.

See [Desktop release process](docs/DESKTOP.md#official-release-process).

## Security reports

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
