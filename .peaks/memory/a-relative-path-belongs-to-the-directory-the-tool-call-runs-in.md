---
name: a-relative-path-belongs-to-the-directory-the-tool-call-runs-in
description: A relative path belongs to the directory the tool call runs in
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff.md
---

When a gate resolves a path, the base it resolves against is the gate's decision, not a detail. A
relative path is read against **the directory the tool call actually runs in** — the hook payload's
top-level `cwd` when the harness states a *usable* one (an absolute path naming an existing
directory **inside** the named project), and otherwise **the gate process's own working
directory**. The file it lands in is then judged by where it sits **inside the named project root**;
the deny families (`src/`, `tests/unit/`, `tests/integration/`, `config/`, `bin/`, `scripts/`) stay
project-relative prefixes against that **named** root. An **absolute** path is unchanged — it is
judged by where it lands relative to the named root — and a project **nested** inside another
repository is still judged against **itself**, not the git root above it.

**Why this base.** It is the only one of the three candidates (the tool call's cwd, the
caller-named project root, the canonical root) under which the gate's own invariant can hold: *the
verdict depends on which directory the file is in, not on how the path is written*. The named root
disagrees with that invariant exactly when the tool call's cwd is not the project root, which is
the case the measurement reproduced. The canonical root was already excluded by the two-roots rule.

**The shape of the escape.** Project root `<root>`, tool call running in `<root>/src`, payload
`file_path: "deep/x.ts"`. The file the call really writes is `<root>/src/deep/x.ts` — inside
`src/`, a hard-blocked family. Resolved against the named root the spelling reads `deep/x.ts`,
which is in no family, and the edit is **ALLOWED**. The escape is silent: a deny names a family,
and there is no reason to emit.

**The two spellings that opened it** (the spelling is the reusable part). (1) `deep/x.ts` — the
plain relative form, which lands in `src/` and was allowed because the base was the named root.
(2) `.//deep/x.ts` — the doubled-separator form. The bash sibling dropped leading `./` segments in
a loop, so the strip turned `.//deep/x.ts` into `/deep/x.ts`; a path that now starts with `/` reads
as **absolute**, the sibling does not relativize an absolute path (it has no project root in the
payload's spelling), so the file landed outside every family and was **ALLOWED**. The Node command
already decided absoluteness from the spelling *as the tool wrote it*, so the two implementations
disagreed on **6 of the 10** spellings of that one file.

**How to apply.** Any gate that takes a path and resolves it against a base it does not own has
this defect. Decide *which directory the file is in* before deciding *how the path is written*;
decide "is this absolute?" from the spelling **before** any normalization that can manufacture a
leading separator; and treat a path that lands outside the project as belonging to no family rather
than re-reading it against the root.
