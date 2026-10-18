---
name: map-the-cli-name-at-the-action-boundary
description: map-the-cli-name-at-the-action-boundary
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintconfig.md
---

Commander stores `--config` as `options.config`; the runner's option is `configPath`. The fix keeps
both names and maps at the action boundary: `configPath: options.config`. The flag is not renamed and
the runner's public option is not churned.

**Why:** the two names describe different layers (the CLI spelling and the internal option). A rename
would touch every caller for no behavioral gain; the mapping is one line per action.

**How to apply:** when a CLI's parsed property differs from the internal option name, map explicitly
at the action and state it in a comment. Test the flag through the action, not just the type.
