---
name: the-pre-push-gate-refuses-a-tag-push-until-the-base-is-named
description: Pushing the release tag fails the pre-push "changed" leg with "nothing to compare" — fix it by naming the base with PEAKS_GATE_CHANGED_BASE=<previous release tag>, not with --no-verify.
metadata:
  type: project
---

`.husky/pre-push` runs three legs unconditionally, with no awareness of **what** is being pushed:
`format-check-ratchet.mjs` → `peaks-gate.mjs changed` → `pnpm test:changed -- origin/main`.

The `changed` leg diffs `origin/main...HEAD` (`.husky/gate/changed.mjs`). After the **branch** push
of `main`, `origin/main` already equals `HEAD` — so when the **tag** is pushed, the changed set is
empty and the leg refuses:

```
peaks-gate: origin/main resolves to HEAD (48402f7a), so the changed set is empty by construction.
  REFUSING to report that as a pass: "nothing to compare" and "compared and clean" are different
  results, and only one of them is evidence.
  To point this mode at another ref deliberately: PEAKS_GATE_CHANGED_BASE=<ref>
```

**The fix is the one the leg's own message names**: point the mode at a ref that makes the release
delta the thing being measured — the **previous release tag**:

```bash
PEAKS_GATE_CHANGED_BASE=v4.1.12 GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=30" \
  git push origin v4.1.13
```

⇒ The gate then measures the release's own diff (and runs the full suite against it) instead of
finding nothing. **This is not a bypass**: `--no-verify` is forbidden by the release runbook, and
naming the base is the documented mechanism — the override exists precisely so the mode can be
pointed at a deliberate ref, and it gets **no fallback**, so a typo fails loudly.

**Why it matters:** the release runbook (`.peaks/memory/peaks-loop-release-flow-is-tag-triggered-ci-publish.md`)
says "push main → wait CI green → tag → push tag" and does not mention this, so the tag push looks
like it is supposed to work as-is. It is not.
