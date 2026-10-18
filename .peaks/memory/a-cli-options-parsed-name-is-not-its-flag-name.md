---
name: a-cli-options-parsed-name-is-not-its-flag-name
description: a-cli-options-parsed-name-is-not-its-flag-name
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintidem.md
---

QA found an adjacent defect while checking the parity fix: `--config <path>` is declared on
`peaks lint check` and `peaks lint baseline`, but the action reads `options.configPath`. Commander
stores the flag as `options.config`, so the value is ignored and the default config is used with no
warning.

**Why:** the option's parsed property name is derived from the flag unless an override is given; a
reader that guesses the longer name compiles and silently reads undefined.

**How to apply:** after adding a CLI option, assert the action reads the SAME property commander
stores (a unit test that passes the flag and sees the value is the cheapest proof). Check every
subcommand that declares the flag.
