# Security Policy

## Reporting

Please do not open public issues for vulnerabilities. Email `security@amoslabs.com`
with a concise description, reproduction steps, and affected version or commit.

## Scope

AMOS Agent can run local commands and access an AMOS company brain. Reports
involving workspace confinement, credential exposure, approval bypass, OAuth,
MCP tenant boundaries, or unsafe network access are especially important.

## Safe defaults

- Local bash and file writes require approval.
- Agent file tools are confined to the workspace and block credential files.
- Child commands do not inherit provider or AMOS credentials.
- AMOS mutations remain subject to server-side RBAC, policy, approvals, and
  proof receipts.
