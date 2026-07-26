# Signed offline company context

AMOS Desktop can make a short-lived company briefing available to a local
model without turning an old online session into permanent authority.

## User contract

The user must be online and connected through their personal AMOS sign-in.
From **Memory**, they explicitly choose **Make available offline** and confirm
the first copy. The default grant lasts four hours. The card always shows when
the briefing was captured, when it expires, which role produced it, and how
many effective scopes bounded it.

The resulting context is:

- point-in-time, not live;
- read-only;
- encrypted on the device;
- bound to one AMOS user and tenant;
- bounded by the user's effective scopes at capture time;
- unavailable after expiry; and
- removable at any time.

It contains no OAuth token, API key, connection credential, approval power,
write grant, or queued instruction.

## Issuance

Desktop asks the normal `resume_company` MCP tool to issue an offline cache.
AMOS first builds the ordinary bounded company briefing using the caller's
current tenant, scopes, subscription, policy, and brain visibility. It then
signs that exact JSON snapshot with the platform's rotating Ed25519 key.

The token uses:

- type `AMOS-COMPANY-CACHE+JWT`;
- audience `amos-desktop-company-cache`;
- format `amos-company-cache`, version `1`;
- user, tenant, tenant slug, role, and principal type;
- sorted effective scopes plus their SHA-256 fingerprint;
- issued-at, not-before, and expiry timestamps; and
- a unique cache ID.

API-key principals cannot request a grant. The request cannot choose a user,
tenant, role, or scope.

## Desktop verification and storage

Desktop fetches signing keys only from the connected AMOS origin and verifies:

1. the EdDSA algorithm, token type, key ID, and live JWKS key;
2. the signature;
3. the issuer, audience, format, and version;
4. the current signed-in user, tenant, and user-principal type;
5. canonical scopes and their fingerprint;
6. the validity window and 24-hour maximum; and
7. byte-equivalent JSON meaning between the returned briefing and signed
   snapshot.

Only then does Desktop store the token and verifying public key inside a
`safeStorage`-encrypted, owner-only, atomically replaced file. Company content
and identifying metadata do not remain as plaintext in that file.

## Offline runtime

When local-only mode starts, Desktop constructs a physically smaller tool
registry. AMOS MCP and public-web tools are absent. If a valid grant exists,
Desktop adds only `desktop_read_company_cache`.

The tool returns:

- explicit `live: false` and `read_only: true` provenance;
- capture and expiry times;
- tenant, role, and scope fingerprint;
- a summary by default; and
- one named briefing section when requested.

The system prompt tells the model to label cached claims, avoid presenting them
as current, and require a reconnect before consequential decisions or company
actions. The prompt communicates the boundary; the reduced registry and
signature checks enforce it.

## Reconnect and removal

Returning online never replays work. Desktop re-reads `whoami`, fetches the
current AMOS JWKS, and revalidates the saved grant. A changed user or tenant,
expired grant, retired key, bad signature, or corrupt envelope causes the copy
to be removed and the local runtime to be rebuilt without it.

The user can remove the copy from **Memory** at any time. Disconnecting the
AMOS account removes it automatically.

Future queued offline proposals require a separate reconciliation contract:
explicit diff and conflict review, current policy evaluation, idempotency, and
human confirmation. This cache does not implement or imply that authority.
