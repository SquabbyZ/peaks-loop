---
name: the-pre-push-gate-refuses-a-tag-push-until-the-base-is-named
description: Pushing the release tag used to fail the pre-push "changed" leg with "nothing to compare"; the gate now learns the tag case (2026-10-28), and PEAKS_GATE_CHANGED_BASE is the fallback, not the routine.
metadata:
  type: project
---

**Before 2026-10-28**: `.husky/pre-push` ran three legs unconditionally, with no awareness of
**what** was being pushed: `format-check-ratchet.mjs` → `peaks-gate.mjs changed` →
`pnpm test:changed -- origin/main`. The `changed` leg diffed `origin/main...HEAD`
(`.husky/gate/changed.mjs`). After the **branch** push of `main`, `origin/main` already equalled
`HEAD` — so when the **tag** was pushed, the changed set was empty and the leg refused:

```
peaks-gate: origin/main resolves to HEAD (48402f7a), so the changed set is empty by construction.
  REFUSING to report that as a pass: "nothing to compare" and "compared and clean" are different
  results, and only one of them is evidence.
  To point this mode at another ref deliberately: PEAKS_GATE_CHANGED_BASE=<ref>
```

**Now (2026-10-28, backlog §22.10)**: the hook **learns the tag case**. `.husky/pre-push` reads
git's pushed-ref lines from stdin (`<local ref> <local sha> <remote ref> <remote sha>`) and exports
them as `PEAKS_PUSH_REFS`; when **every** pushed ref is a `refs/tags/` ref, the changed set is
measured against **the previous release tag** (`git describe --tags --abbrev=0 <sha>^`). A tag push
that cannot name its previous release **refuses loudly** — it never falls back to an empty set and
never reports one as a pass. The base and tip are resolved to **SHAs** before they reach git's
argv, because a tag name is repository-controlled and git reads an argv element starting with `--`
as an option (measured: `git diff --name-only '--output=pwned.txt...HEAD'` wrote a file).

⇒ **The routine tag push no longer needs an override.** `PEAKS_GATE_CHANGED_BASE=<ref>` remains the
sanctioned escape for a deliberate base, and it still gets **no fallback** — a typo fails loudly.
`--no-verify` is still forbidden by the release runbook.

**Why this memory changed rather than being deleted**: the old text said "the fix is the one the
leg's own message names" — which was true then and is now the *fallback*, not the answer. A memory
that describes a workaround after the workaround stopped being necessary teaches the next releaser
the old procedure, and the old procedure still works, so nothing would catch it.

**How to apply**: push the tag normally. If the gate refuses, read the message: a **tag push with
no resolvable previous tag** is the real refusal case (this repository's first tag would hit it —
name a base with `PEAKS_GATE_CHANGED_BASE` and say why), while a **branch push** refusing means the
branch base could not be resolved. The git stdin format is documented in the hook's own comment.

Related: [[a-function-no-production-code-calls-has-an-unmeasured-attack-surface]],
[[push-needs-ssh-keepalive]]
