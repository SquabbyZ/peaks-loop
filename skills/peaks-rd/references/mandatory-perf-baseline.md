# Mandatory perf-baseline output (RD)

> Body of `## Mandatory perf-baseline output` + numbered perf-baseline steps. **BLOCKING — Do not hand off to QA without a perf-baseline file when the slice has a user-visible performance surface.** The QA stage's Gate A4 (performance check) needs a stable reference to diff against; without an RD-side baseline, the first time Gate A4 runs it has nothing to compare against and any regression it finds is a blind-side surprise. The user-facing pain of leaving perf to QA only has historically been a 3-cycle repair loop. The RD-side baseline closes that loop.

> **Slice 025 — stable across slices within a session; refreshed on trigger.** The perf baseline is a **project-level** artifact (`.peaks/_runtime/<sessionId>/qa/perf-baseline.md`) and is **stable across slices within a session**. It is regenerated only when the slice diff matches the refresh trigger table (see `peaks-qa/references/qa-perf-test-plan.md`). Slices that do not trigger a refresh reference the existing baseline by hash from the per-slice `qa/performance-findings-<rid>.md` (not by regenerating the baseline). The CLI is `peaks workflow plan read|refresh|detect-trigger perf --project <repo>`; the RD-side `peaks perf baseline --apply` workflow below still scaffolds the initial file but the canonical refresh path post-slice-025 is the new `peaks workflow plan refresh` primitive.

**When this applies:**
- feature / refactor slices that touch a route, hook, API, or any user-perceivable surface
- bugfix slices where the bug is performance-shaped (slow render, hot loop, N+1)
- any slice where the PRD mentions a number (LCP / FCP / TBT / p95 / rps / etc.)

**When this does NOT apply:**
- docs / chore slices
- pure bugfixes whose fix is "remove the bug" (no perf surface)
- any slice where the slice is documentation-only or otherwise has no perf surface — in that case write `N/A — no perf surface` in the file's "Notes" section and surface that fact in the RD handoff

**How to produce the file:**

```bash
# 1. dry-run preview (default)
peaks perf baseline --project <repo>
# → ok: true, data.plannedWrites shows the file path, no files written

# 2. apply — scaffolds the file at .peaks/_runtime/<sessionId>/rd/perf-baseline.md
peaks perf baseline --project <repo> --apply --reason "capturing baseline for Gate A4 diff"
# → ok: true, data.writtenFiles includes the path

# 3. fill in the file's Results table
#    (lighthouse / k6 / autocannon / project-local bench — the
#    CLI does not call any of these; that is the RD's job)
#    open .peaks/_runtime/<sessionId>/rd/perf-baseline.md and complete the
#    "Path / route | Workload | Tool | Metric | Baseline | Threshold"
#    table

# 4. hand off to QA. The QA stage reads the file's Results
#    table as the input to Gate A4 — see peaks-qa SKILL.md
#    Gate A4.
```

**Idempotency:** re-running `peaks perf baseline --apply` on a session where the file already exists is a no-op (the CLI does not overwrite hand-edited content). This is the normal RD retry pattern (re-measurement, threshold adjustment, etc.). If the RD really does want to overwrite, delete the file first and re-run.

**The role of the CLI vs. the actual measurement:** the CLI is the *scaffolding*. It writes the file, exposes the path, and keeps the file's structure stable so QA can rely on it. The CLI does NOT call lighthouse / k6 / autocannon — those are project-shape dependent and the right tool is a project-local concern, not a peaks-loop concern. The CLI is justified (4-grounds check): it gates the QA-side decision on a stable artefact, it requires --apply for a destructive write, and it is invokable from a hook on session init. It is *not* a machine-enforced gate that prose cannot enforce — the measurement is the RD's responsibility.