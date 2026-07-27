# AMOS memory classes and private memory

AMOS uses one explicit memory model across Desktop and the managed company
brain. The model distinguishes who owns authority from where a copy happens to
be stored.

## Memory classes

| Class | Authority | Default visibility | Persistence |
| --- | --- | --- | --- |
| Session | Desktop | Private | Ephemeral unless explicitly kept |
| Private | User | Private | Encrypted on the user's device |
| Shared | AMOS | Explicit people or groups | Managed |
| Company | AMOS | Tenant and role scoped | Managed |
| Evidence and receipts | AMOS | Policy scoped | Managed and immutable |

Desktop does not invent local roles for shared company data. Shared, company,
and receipt access is always decided by AMOS using the current user, tenant,
role, document policy, and effective scopes.

## Attachment choices

Every document, source file, or pasted screenshot begins as session memory.
Before a task runs, the user may choose:

- **Use for this task** — send the bounded extracted content only to the chosen
  model for the current task.
- **Keep in private memory** — encrypt the item locally so the user can attach
  it to a later task.
- **Add to company memory** — submit it through the governed AMOS company
  document tool.

No file is promoted merely because it was attached or discussed.

## Private-memory storage

The private store lives in the application's user-data directory and is
protected with operating-system-backed `safeStorage` (Keychain on macOS and
DPAPI on Windows).

- File and content metadata are inside encrypted envelopes.
- The plaintext envelope contains only the opaque item ID and ciphertext.
- The store is written atomically with owner-only permissions.
- Content is deduplicated by SHA-256 after decryption.
- The first release permits 250 items and 512 MB of encrypted content.
- The journal is bounded and records only opaque IDs, operations, classes, and
  timestamps—never content or credentials.

Supported private items match Desktop universal input: extracted documents and
source files plus image bytes. Provider vision checks still apply when a private
image is reused.

## User controls

### Use in next task

Creates a session attachment from the encrypted local item. The bounded content
is sent to the selected model for that task, just like any other attachment,
but it is not added to AMOS company memory and its visibility does not change.

### Promote to company

Submits a copy through the existing AMOS `company/store_document` path. The
operation inherits normal tenant scoping, engine-tool authorization, policy,
and receipt behavior. The private item remains local until the user forgets it.

### Forget

Removes the encrypted local item and appends an opaque forget record to the
local journal. Forgetting a local item does not delete a company copy that the
user previously promoted; the managed copy remains subject to AMOS retention
and deletion policy.

## Portable capsules

AMOS Desktop 0.8.0 can export one private item or the complete private-memory
store as a `.amos-memory` capsule, then preview and import it on another device.
A version-1 manifest carries:

- format and version;
- capsule, subject, and optional tenant IDs;
- creation, refresh, expiry, and fork lineage timestamps;
- memory class, source ID, SHA-256 content hash, media type, visibility, and
  allowed-use labels;
- encrypted-content requirements;
- a prohibition on credentials;
- signatures for shared, company, and receipt material; and
- a bounded sync journal with base-version references.

The manifest and private content are encrypted together with AES-256-GCM. A
32-byte key is derived from the owner's passphrase with scrypt; the clear
envelope contains only the format/version, cipher parameters, creation time,
and opaque capsule ID. GCM authenticates both the encrypted content and clear
header, so a wrong passphrase or modified file cannot be imported.

Before import, Desktop decrypts and validates the manifest and every content
hash, then shows the item names, types, sizes, and lineage. Nothing is written
until the user confirms. Existing content is deduplicated by source SHA-256.
Imported items receive new local IDs while retaining the capsule, parent
capsule, source-memory, and import lineage. Re-exporting a set of items from one
capsule creates a new capsule that identifies the prior capsule as its parent.

Unlocked previews live only in memory, expire after ten minutes, and are
discarded when canceled. Passphrases are never written to settings, memory,
activity, or the capsule itself.

## Export policy

- Session memory must be promoted before export.
- Private memory may be exported only as an owner-controlled encrypted capsule.
- Shared and company memory require a current AMOS policy decision and AMOS
  signature.
- Receipt exports require current authorization, a valid signature, and remain
  read-only.

Credentials, OAuth tokens, provider keys, and unrestricted raw application data
are never valid capsule entries.

Portable private memory is implemented. Export of governed company memory
remains separate. AMOS Desktop 0.10 reconciles offline outcome drafts without
storing tool arguments: it checks current identity and data, shows section
drift, and requires explicit online reauthorization before ordinary AMOS policy
can evaluate any action.

## Signed offline company context

AMOS Desktop 0.9 implements a deliberately narrower capability than exporting
company memory. A signed-in user may explicitly capture the already bounded
`resume_company` briefing for a short period of offline use.

- AMOS derives the user, tenant, role, and scopes from the authenticated
  connection; the model cannot supply them.
- The exact snapshot is signed with AMOS's rotating Ed25519 key under a
  company-cache-specific token type and audience.
- Desktop verifies the live JWKS and exact user, tenant, issuer, canonical
  scope fingerprint, validity window, signature, and signed snapshot.
- The verified token and public key are stored together inside a local
  operating-system-encrypted envelope.
- Local-only mode exposes one sectioned read tool. It does not expose AMOS MCP,
  company writes, approvals, receipts, or public web access.
- The default lifetime is four hours; AMOS permits only 15 minutes through 24
  hours. Expired data is unavailable to the model.
- Reconnect revalidates against the current user, tenant, and live AMOS signing
  keys. A mismatch removes the copy. Disconnecting the AMOS account removes it
  immediately from the device.

The saved briefing is point-in-time evidence, not current company truth and
never action authority. See
[Signed offline company context](OFFLINE_COMPANY_CONTEXT.md).

Offline outcome drafts retain only business-readable intent, assumptions, and
signed-context fingerprints. They remain private local state until the user
compares and explicitly continues them. See
[Offline draft reconciliation](OFFLINE_RECONCILIATION.md).
