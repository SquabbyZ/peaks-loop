---
name: eslint-exiting-0-is-not-the-commit-ratchet-s-standard-for-a-new-file
description: eslint exiting 0 is not the commit ratchet's standard for a new file
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-24-session-b714c7/txt/handoff.md
---

The pre-commit gate's rule for a **NEW** file is "zero findings of **any** severity"; `eslint`'s exit code is 0 for
warnings-only, so an exit code cannot express that standard. Measured in `rid-muf2sasw`:
`scripts/packages-build-prerequisite.mjs` carried four `no-magic-numbers` warnings, eslint exited 0, and both the
RD (cycle 2) and QA (cycle 3) reported "eslint exit 0" as passing — the gate then blocked the commit, correctly.
Verify a new file with the gate's own command (`node .husky/peaks-gate.mjs staged <paths>`, or eslint JSON output
counted by hand), and state the command you used.

Two corollaries worth as much as the rule:

- The file had **never been linted at all** — it was shadowed out of the lint program by its own `.d.mts` sibling
  (extension priority drops the lower-priority member). Adding one path to `config/eslint/tsconfig.lint.json`
  exposed the four findings. A "clean" file can mean "not parsed".
- `no-magic-numbers` is stock with `enforceConst` unset, which exempts a literal that is a variable declarator's
  *direct* initializer and reports the same literal inside an expression. Both operands of `10 * 60_000` are
  reported. Naming only the unit (`10 * MINUTE_MS`) leaves `10` reported — the number's *meaning* needs its own
  name. Do not reach for `eslint-disable`: `rd/rid-muf2sasw-repair-3-handoff.md` §1 shows four findings answered
  with four named constants, no suppression, no exported surface change.
