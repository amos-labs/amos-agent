# Security Policy

## Reporting

Please do not open public issues for vulnerabilities. Email `security@amoslabs.com`
with a concise description, reproduction steps, and affected version or commit.

## Scope

AMOS Desktop and the AMOS Agent CLI can run local commands and access an AMOS
company brain. Reports involving workspace confinement, credential exposure,
attachment handling, provider data leakage, update integrity, approval bypass,
OAuth, MCP tenant boundaries, document sharing, or unsafe network access are
especially important.

## Safe defaults

- Local bash and file writes require approval.
- Agent file tools are confined to the workspace and block credential files.
- Child commands do not inherit provider or AMOS credentials.
- Attachments remain task-local unless explicitly promoted.
- AMOS mutations remain subject to server-side RBAC, policy, approvals, and
  proof receipts.
- Official macOS releases are signed, notarized, and distributed with hashed
  update metadata.

## Supported versions

Security fixes are applied to the latest published AMOS Desktop release and the
current `main` branch. Upgrade to the newest signed release before reporting an
issue that may already be fixed.
