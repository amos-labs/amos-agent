# AMOS Desktop 1.0.51

Release preparation; signed installers have not been published yet.

## Changes since 1.0.50

- Choose Auto, Routine, Balanced, Deep, or Frontier in Settings. A manual hosted
  tier skips Desktop's local routing passes and stays selected across restarts.
  Auto keeps automatic routing available.
- Manual hosted tiers pause the automatic hybrid and coding-role options while
  preserving those preferences for a return to Auto.
- Routing outcomes show the hosted tier actually returned by Platform, including
  account-policy adjustments or a context-capacity fallback. Platform still
  assigns the model behind each tier.
- Automatic routing preserves the current user request when conversation context
  is long, so older messages do not displace the task being classified.
- Removed the Northwind demo entry point from Desktop.
- Added offline tooling to review router corrections and evaluate contextual
  learning. This release retains the existing local router weights.

The tier selector is independent of the hosted S5 model trial. Selecting Frontier
uses the Platform's current Frontier assignment; it does not enable an experimental
model or change company permissions.

## Release validation

The manual-tier changes and compatibility follow-up passed 833 tests, syntax
checks, Node 22/24 CI, and the Windows installer smoke check before merging.
The version and lockfile must agree before the release tag is created.

The official release workflow runs the tests again, signs and notarizes both
macOS architectures, verifies the Windows signing identity and installer, and
checks the update metadata before publishing. Versioned installer build,
install/upgrade checks, and publication remain release work; source CI alone
does not establish that those checks passed.

See [the official release process](DESKTOP.md#official-release-process).
