# ExpertCache research boundary

ExpertCache is an experimental page-aware Metal runtime for oversized sparse
mixture-of-experts checkpoints. Its portable runtime patch, simulation and
replay harnesses, tests, evidence bundles, and research documentation have
moved to:

https://github.com/amos-labs/expertcache

ExpertCache is not bundled with AMOS Desktop and is not part of the production
local-model execution path. AMOS Desktop continues to use its signed,
checksum-verified local runtime and curated local-model catalog independently.

The separation is intentional:

- `expertcache` owns experimental inference mechanics, reproducibility, and
  publication artifacts;
- `amos-agent` owns product routing, device experience, local-model
  qualification, company data boundaries, policy, approvals, receipts, and
  signed deployment; and
- a future integration should consume a versioned ExpertCache backend through
  an explicit adapter after the runtime passes product, quality, thermal,
  cancellation, and security gates.

Historical ExpertCache work remains available in the `amos-agent` Git history,
including PRs #37, #38, #40, #41, #42, and #43.
