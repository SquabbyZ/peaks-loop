# Library version awareness

> Body of `## Library version awareness (3rd-party breaking-change gate)`. After `peaks scan libraries` lands the dependency list under `## Library versions` in `rd/project-scan.md`, RD MUST cross-check the slice's diff against `schemas/library-breaking-changes.data.json` before writing any 3rd-party API call. Concretely:

1. **Read the project's `## Library versions` section** in `.peaks/project-scan/project-scan.md`. Identify the `name` + `major` of every dependency the slice imports from.
2. **Open `schemas/library-breaking-changes.data.json`** (LLM reads via the `Read` tool). For each library where the installed `major` matches a `toMajor` in the table, load the corresponding `breakingChanges[]` list.
3. **For each `import` statement in the slice's diff** (e.g. `import { Drawer } from 'antd'`), check whether the imported symbol or its prop signature matches any `breakingChanges[].api` entry for the library's installed major.
4. **On a hit**:
   - **Warn the LLM in the slice's handoff**: in `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md` under `## Implementation evidence`, append a one-line note per hit: `- [lib-version] <library> <installed version> imports <api>; breaking-change rule says use <replacement> instead.`
   - **Persist a `lesson` memory** at the END of `.peaks/project-scan/project-scan.md` (or the tech-doc, or the handoff — any of these is read by future RD runs):
     ```
     <!-- peaks-memory:start -->
     title: <library> <installed major> requires <api> → <replacement>
     kind: lesson
     ---
     Observed in slice <rid>: project is on <library>@<major> and the diff imported <api> which is on the breaking-changes list. Use <replacement> instead. Source: schemas/library-breaking-changes.data.json.
     <!-- peaks-memory:end -->
     ```
   - The next RD run will see this lesson in `peaks project memories` and skip the same drift.

**Why this exists**: the LLM's training data lags the latest major versions. The user hit `[antd: Drawer] width is deprecated. Please use size instead` in an antv6 project because the LLM wrote v5-style code. The breaking-changes table is the canonical place for "library X at major Y has these known migrations" so the LLM doesn't have to guess.

**Out of scope**: the breaking-changes table is hand-curated; auto-syncing from upstream changelogs (Context7, etc.) is a follow-up slice. Per-slice the LLM only reads the table — it does NOT maintain it.

**Data freshness check (read schemas/library-breaking-changes.meta.json first)**:
- Before reading `schemas/library-breaking-changes.data.json`, also read `schemas/library-breaking-changes.meta.json`.
- Compute `ageInDays = (today - meta.lastUpdated)`. The LLM is responsible for this date math.
- If `ageInDays > meta.freshnessPolicyDays` (default 180 days), surface a **freshness warning** in the handoff: `- [data-staleness] library-breaking-changes.data.json is ${ageInDays} days old (last touched ${meta.lastUpdated}); the breaking-changes below may miss library X's recent major. Re-verify against the library's official changelog before relying on these substitutions.`
- The warning is **informational**, not blocking. A stale table is better than no table. The LLM still applies the entries it has, just with the caveat.
- When a row in the table matches an `import` in the diff AND the table is fresh, proceed without the warning.