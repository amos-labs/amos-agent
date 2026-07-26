# Safety

AMOS Desktop combines model reasoning, local execution, and governed company
tools. Those surfaces have different authorities and must remain visibly
separate.

The core rules are:

1. shared business authority stays in AMOS;
2. local access is explicitly granted and workspace-bounded;
3. local mutations ask first by default;
4. private material is not silently promoted into company memory; and
5. model choice never weakens identity, policy, approvals, or proof.

## Local workspace

- The user selects the workspace root.
- File operations resolve canonical paths and reject traversal.
- Symlinks cannot escape the workspace.
- Common credential files, private keys, SSH/cloud configuration, and environment
  files are unavailable to model file tools.
- Reads and command output are bounded.
- File writes and patches require approval by default.
- Shell commands require approval by default.
- Command timeouts terminate the full process group.

## Child-process environment

Commands receive a small allowlist of normal process values. AMOS credentials,
provider keys, database URLs, cloud secrets, and desktop OAuth tokens are
removed.

Approval applies to the exact proposed local action. It is not a blanket grant
for later commands.

## Company actions

AMOS tools use the authenticated tenant and identity from the connection.
Server-side AMOS resolves:

- tenant isolation;
- effective role and scopes;
- operation and actor policy;
- budgets and consequence level;
- human approval requirements;
- idempotency and execution; and
- proof receipt generation.

The local model or desktop cannot self-approve a consequential company action.

## Documents and screenshots

- Attachments stay task-local by default.
- The user must explicitly choose **Add to company memory**.
- PDF, DOCX, text, and source extraction happens locally before model use.
- Images are sent only to a vision-capable model.
- Unsupported binary content is not pushed through model output as base64.
- Company persistence remains subject to AMOS document and sharing policy.

Private, shared, group, and company document visibility is authoritative in the
managed platform, not inferred by the desktop.

## Web access

Public fetch blocks:

- loopback and private networks;
- link-local addresses;
- cloud metadata endpoints;
- credentialed URLs; and
- redirects to any blocked destination.

Native search is optional and uses its own configured provider credential.

## Intelligence providers

The configured provider receives the conversation and task context needed for
inference. Users should understand that deployment choice affects where that
data is processed.

- AMOS-managed and customer-cloud profiles follow their deployment contract.
- Provider APIs process data in the provider's cloud.
- Local runtimes keep inference on the device but may be less capable.
- Credentials must not be placed in prompts or documents.

## Updates

Production updates come only from the configured signed release feed.

- Development builds do not query it.
- macOS applications are signed and notarized.
- Update metadata carries cryptographic hashes for architecture-specific ZIPs.
- Downloads require explicit user action.
- Restart/install requires explicit user action.
- Active work blocks restart.

## Offline and memory roadmap

Private Desktop memory is encrypted with platform Keychain protection and
remains user-authoritative. Reusing it sends bounded content to the selected
model for that task but does not add it to company memory. Promotion uses the
ordinary AMOS company-document tool and therefore inherits the user's tenant,
scope, policy, and proof boundary. **Forget** removes the encrypted local item;
a previously promoted AMOS copy remains governed company memory.

Offline company work must fail safe:

- cached company context carries source, scope, age, and expiry;
- offline answers clearly disclose cached versus live context;
- queued company work remains a proposal;
- reconnect re-evaluates current identity, data, policy, and idempotency;
- nothing queued offline executes silently; and
- memory exports never include credentials.

AMOS Desktop 0.7 enforces an explicit local-only tool surface. AMOS MCP and
public-web tools are not registered in that runtime, company-memory promotion
is blocked, and approval synchronization is paused. The UI continuously labels
the mode and the local model in use. This is stronger than relying on a prompt
to tell a model that the network is unavailable.

## Advanced environment controls

```bash
AMOS_AGENT_AUTO_APPROVE_BASH=true
AMOS_AGENT_AUTO_APPROVE_WRITES=true
AMOS_AGENT_ALLOW_OUTSIDE_WORKSPACE=true
AMOS_AGENT_BASH_TIMEOUT_MS=60000
AMOS_AGENT_MAX_OUTPUT_BYTES=24000
```

These controls are for deliberately isolated automation environments. They are
not recommended for normal interactive Desktop use.

## Reporting a problem

Security vulnerabilities should be reported privately as described in
[SECURITY.md](../SECURITY.md). Do not include secrets, customer data, or live
tokens in a public issue.
