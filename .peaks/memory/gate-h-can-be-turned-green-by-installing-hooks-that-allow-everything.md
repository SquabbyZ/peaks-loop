---
name: gate-h-can-be-turned-green-by-installing-hooks-that-allow-everything
description: Gate H can be turned green by installing hooks that allow everything
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/txt/handoff.md
---

The last violation blocking a `refactor` slice at `rd:qa-handoff` was Gate H: "5 feedback memories
are not yet promoted to an enforcement layer with a real artifact". `peaks feedback promote
<memory> --layer B --dry-run` shows what the promotion installs:

    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node -e \"process.exit(0)\"" } ] }

— a hook that always allows — and layer A emits a `sop.json` whose body instructs the reader to
author the gates later. So five commands with no judgement in them satisfy the gate that exists to
force judgement into enforcement, and the resulting green is **weaker than the previous red**: the
red said "this lesson is not enforced"; the green says "a file exists that looks like enforcement".

**How to apply:** never clear Gate H by promoting stubs. Fix the primitive first — require the
promoted artifact to name a matcher that denies something, proven by a positive control in the
style of `tests/unit/standards/vitest-worker-cap.test.ts` (remove the cap → the guard turns red).
Treat any gate whose satisfaction path is a template as a candidate for the same audit: ask what
the artifact would look like if it were empty, and whether the check can tell.
