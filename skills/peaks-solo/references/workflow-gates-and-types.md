# Peaks-Cli Workflow Order + Request Type Classification + Transition Verification Gates

> **Maintenance**: This reference holds the canonical contract for (a) how Solo sequences the 11 workflow steps, (b) which `--type` to pass to `peaks request init` for which slice shape, and (c) the executable `ls` / `grep` gate commands that physically block progression. SKILL.md keeps the narrative ("what peaks-solo does"); this file keeps the contract.
>
> **Why extracted from SKILL.md**: this content is 165 lines of mostly-tabular + bash-block contract — reference data, not orchestration prose. Inlining it bloats SKILL.md past the 800-line cap (per `common/coding-style.md`). The numbers, gate command shapes, and type-classification rules change rarely; the SKILL.md prose around them (orchestration flow, repair-loop intent, swarm fan-out shape) changes more often.
>
> **How peaks-cli tooling reads this file**:
> - `peaks skill runbook peaks-solo` (CLI) and the in-line LLM reading the SKILL.md should reference this file when the gate-machine or type-classification contract is in play.
> - The test `tests/unit/skill-default-runbook.test.ts` does NOT check this file (it only checks the runbook). Future tests can add a similar fallback for the gates-and-types contract.

## Peaks-Cli Request type classification (MANDATORY before `peaks request init`)

Before initializing any role artifact, classify the request into exactly one of six types. The choice drives RD/QA gate strictness (see "Mandatory RD QA repair loop"). Pick the **primary intent** — if a request could fit two types, the higher-strictness one wins.

| `--type` | Pick this when the PRD says... | Pick something else when... |
|---|---|---|
| `feature` | Add new capability, new page/component/route/API path, new user-facing behavior. Includes "extend X to support Y" when Y is a new code path. | The PRD is fixing an existing broken behavior → `bugfix`. The PRD is reshaping existing code without changing user-visible behavior → `refactor`. |
| `bugfix` | Fix a specific broken behavior; PRD includes reproduction steps or a defect description; success = "the broken thing now works as it was supposed to". | The "fix" actually adds new capability (validation that didn't exist, a missing field) → `feature`. The "fix" is purely cosmetic and has zero risk → still `bugfix`; do NOT downgrade to `chore`. |
| `refactor` | Restructure code without changing user-visible behavior. Examples: rename modules, extract shared utilities, migrate a library version with no API surface change, split a monolithic file. PRD mentions coverage targets or "no behavior change". | The refactor incidentally adds or changes user-visible behavior → split into `refactor` + `feature` or pick `feature`. The change is one-line formatting → `chore`. |
| `config` | Modify config / infrastructure files only: `tsconfig.json`, `eslint`, CI YAML, `package.json` scripts, env defaults, CORS/CSP rules, build config, Docker, deployment manifests. No application source-code changes. | The config change is paired with code changes that consume the new config → `feature` or `refactor` (whichever the code change is). |
| `docs` | Modify only `*.md` / docs site / inline JSDoc / README. No `.ts` / `.tsx` / `.js` / `.css` / config-file changes. | Any source code change is included → use the type matching the code change. Adding a code example to docs that requires the example to compile → still `docs` if the example is illustrative only. |
| `chore` | Pure mechanical hygiene: formatter run, lint fix, dependency version bump with no API surface change, dead-code removal of unused files identified by tooling. | The bump changes API behavior or requires consumer migration → `refactor` (or `feature` if it adds capability). Any logic edit → `bugfix` or `refactor`. |

**Self-check before locking the type**: read the PRD scope and answer "what is the smallest gate set that still protects users from regression?" — that is the right type. Picking `docs` or `chore` to skip gates when source code is actually changing is a workflow violation and the SC phase will reject it.

For ambiguous cases (e.g. "improve login flow"), ask the user to clarify before initializing. The cost of one `AskUserQuestion` round is much lower than running the wrong gate matrix for the whole workflow.

When Peaks-Cli Solo coordinates development in a code repository, keep this order explicit:

0. **Peaks-Cli Snapshot** — `peaks doctor` + `peaks project dashboard` to capture baseline state before anything else;
0.5. **Peaks-Cli Workspace initialization** — `.peaks/<session-id>/` created, directory structure verified;
0.6. **Peaks-Cli Project scan** — archetype, component library, CSS framework, build tool, state management, routing, data fetching, legacy signals detected and recorded to `.peaks/<session-id>/rd/project-scan.md`;
0.7. **Peaks-Cli Existing-system extraction** (MANDATORY when archetype ∈ {legacy-frontend, legacy-fullstack, frontend-monorepo}; SKIP for greenfield) — extract visual tokens and code conventions from the live codebase to `.peaks/<session-id>/system/existing-system.md`. The path lives under `system/` (not `ui/`) because the file also records non-UI conventions (service-layer signatures, hooks, naming) that backend-only or legacy-fullstack work consumes. See `references/existing-system-extraction.md`. UI design-draft and RD implementation MUST treat the extracted tokens and conventions as hard constraints;
1. **Peaks-Cli Standards preflight** — `peaks standards init/update --dry-run`, must reference concrete project-scan findings (never emit generic templates);
2. **Peaks-Cli PRD phase** — capture request as canonical artifact, extract scope and acceptance criteria:
   - Full-auto/Swarm: auto-transition to `confirmed-by-user` once the artifact is complete;
   - Assisted/Strict: pause with `AskUserQuestion` for explicit user confirmation before proceeding;
3. **Peaks-Cli Swarm parallel phase** — after PRD confirmed, launch UI, RD(planning), QA(test-cases) simultaneously:
   3a. UI design draft and visual direction (MANDATORY when request is frontend/user-visible; skipped for `--type docs|chore|config` or pure-backend requests);
   3b. RD planning artifact — `rd/tech-doc.md` for feature/refactor, `rd/bug-analysis.md` for bugfix, skipped for docs/chore/config;
   3c. QA test-case generation (skipped for docs/chore — no acceptance surface to validate);
4. **Peaks-Cli RD implementation** — consumes the type-appropriate inputs: project-scan + standards + (if UI involved) UI design-draft + RD planning artifact + QA test-cases. Includes unit tests for new/changed behavior (TDD) unless `--type` is docs/chore;
5. **Peaks-Cli Code review + security review** — CRITICAL/HIGH issues fixed before progression; marked-blocked issues only allow a blocked handoff;
6. **Peaks-Cli QA validation** (auto-proceed from RD in full-auto) — execute test cases + API checks + Playwright MCP headed browser E2E for frontend + security/perf checks + test report;
7. **Peaks-Cli RD↔QA repair loop** — if QA verdict is `return-to-rd`, loop back to step 4 (RD implementation) and re-run through QA; max 3 repair cycles, then emit blocked TXT regardless;
8. **Peaks-Cli SC phase** — change-control evidence: impact, retention, validate, boundary;
9. **Peaks-Cli OpenSpec archive** — exit gate: validate → archive only after QA verdict=pass (when `openspec/` exists);
10. **Peaks-Cli TXT handoff capsule** — mode, validated decisions, artifact paths, standards deltas, open questions, next action;
11. **Peaks-Cli Final snapshot** — `peaks project dashboard` + `peaks skill doctor` to confirm the workflow closed cleanly.

### Peaks-Cli Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare a phase complete from memory. Each gate below is a `ls` command you **MUST run** and whose output you **MUST see** before proceeding. If any file shows "No such file", the phase is incomplete.

**Peaks-Cli Gate A — After workspace init + project scan:**
```bash
ls .peaks/<id>/rd/project-scan.md
# Expected output: .peaks/<id>/rd/project-scan.md
# "No such file" → STOP, run project scan first
# File present but missing `## Archetype` or `## Project mode` sections → INCOMPLETE, rerun scan
# File present and complete → reuse (project-scan is a session-scoped singleton)
```

**Peaks-Cli Gate A.5 — Existing-system extraction (legacy projects only):**
```bash
# If project-scan.md `## Archetype` is greenfield → skip this gate
# Otherwise:
ls .peaks/<id>/system/existing-system.md
# "No such file" → STOP, run existing-system extraction
# (see references/existing-system-extraction.md)
```

**Peaks-Cli Gate B — After swarm convergence (UI + RD planning + QA test-cases):**

Peaks-Cli Gate B has two sub-checks: a HARD gate (blocks progression) and an INFORMATIONAL check (records degradation but does not block).

```bash
# B.hard — REQUIRED before continuing to RD implementation.
#          Missing any of these → STOP, return to the role that owns the file.

# Always required (every type):
ls .peaks/<id>/prd/requests/<rid>.md

# Type-specific RD planning artifact:
#   feature / refactor → ls .peaks/<id>/rd/tech-doc.md
#   bugfix             → ls .peaks/<id>/rd/bug-analysis.md
#   config / docs / chore → (no RD planning artifact required)

# QA test-cases (skipped for docs/chore):
ls .peaks/<id>/qa/test-cases/<rid>.md
```

```bash
# B.info — NON-BLOCKING. Record degradation in TXT, then proceed.
ls .peaks/<id>/ui/design-draft.md 2>&1
# "No such file" + request affects user-visible UI → swarm degradation rule 1 fires:
#   note "ui-design-missing" in TXT, RD continues with PRD visual descriptions.
# "No such file" + pure backend / docs / chore / config → state skip reason in TXT, proceed.
```

**Peaks-Cli Gate C — After RD implementation (before QA handoff):**

The CLI gate (`peaks request transition --state qa-handoff`) is the authoritative check; running this `ls` first lets you produce missing files before the CLI rejects the transition.

```bash
# Always required
ls .peaks/<id>/rd/requests/<rid>.md

# Type-specific RD evidence (must match the type recorded in the artifact body)
#   feature / refactor → ls rd/tech-doc.md rd/code-review.md rd/security-review.md rd/perf-baseline.md qa/test-cases/<rid>.md
#                         (qa/test-cases/<rid>.md pre-drafted by the 4th sub-agent in peaks-rd's parallel fan-out — slice 004)
#   bugfix             → ls rd/bug-analysis.md rd/code-review.md rd/security-review.md qa/test-cases/<rid>.md
#                         (rd/perf-baseline.md only when the bug is performance-shaped)
#   config             → ls rd/security-review.md
#   docs / chore       → (no extra evidence required)
# Missing any required file → DO NOT attempt the qa-handoff transition; CLI will reject with PREREQUISITES_MISSING.
```

**Peaks-Cli Gate D — After QA validation:**

The CLI gate at `qa:verdict-issued` is the authoritative check; this `ls` lets you produce missing evidence before the CLI rejects the transition.

```bash
# Always required
ls .peaks/<id>/qa/requests/<rid>.md

# Type-specific QA evidence
#   feature / refactor → ls qa/test-cases/<rid>.md qa/test-reports/<rid>.md qa/security-findings.md qa/performance-findings.md
#   bugfix             → ls qa/test-cases/<rid>.md qa/test-reports/<rid>.md qa/security-findings.md
#   config             → ls qa/security-findings.md
#   docs / chore       → (no QA evidence files required)
# Missing required file → QA incomplete; do not transition to verdict-issued.
```

**Peaks-Cli Gate E — Before declaring workflow complete:**
```bash
find .peaks/<id>/ -type f | sort
# Verify: files from gates A-D all appear in this list.
# Any mandatory file missing → NOT complete. Do not emit TXT.
# Peaks-Cli Gate G (CLAUDE.md + .claude/rules/**) must ALSO pass before TXT is emitted.
```

**Peaks-Cli Gate F — Root pollution check (BLOCKING before completion):**
```bash
# Verify no Peaks-Cli intermediate artifacts leaked to project root.
ls feishu-doc-*.md *-snapshot.md qa-server.js 2>&1
# Expected: "No such file or directory" for ALL patterns.
# Any file found → ROOT POLLUTION. Move it to .peaks/<id>/prd/source/
# (for doc snapshots) or .peaks/<id>/qa/ (for QA artifacts).
# Note the migration in TXT handoff. Do NOT complete the workflow
# with intermediate artifacts in the project root.
```
```bash
# Extended check for common leak patterns
find . -maxdepth 1 -name "*.png" -o -name "*.jpg" -o -name "qa-*.js" -o -name "mock-server.*" 2>&1
# Any Peaks-Cli QA/UI intermediate files here → ROOT POLLUTION. Move and note.
# Legitimate project files (e.g. favicon.png) are fine — only move Peaks-Cli artifacts.
```

**Peaks-Cli Gate G — Project standards present (BLOCKING before workflow completion):**
```bash
# After `peaks standards init/update --apply`, verify the files actually landed
# at the project root. The CLAUDE.md and rules files are required so that
# subsequent peaks-rd / peaks-qa / peaks-solo runs perform the project-local
# preflight described in CLAUDE.md (read coding-style.md, code-review.md, security.md).
ls <repo>/CLAUDE.md
# "No such file" → BLOCKED. Run `peaks standards init --project <repo> --apply --json`
# (first time) or `peaks standards update --project <repo> --apply --json` (existing).
ls <repo>/.claude/rules/common/coding-style.md \
   <repo>/.claude/rules/common/code-review.md \
   <repo>/.claude/rules/common/security.md
# Any "No such file" → BLOCKED. The standards apply step did not complete; re-run
# standards init/update with --apply and re-verify.
# Skipping Peaks-Cli Gate G (e.g. because the user did not explicitly authorize writes) is
# only acceptable in `assisted`/`strict` modes where the user actively declined; in
# `full-auto`/`swarm` the absence of these files is a workflow violation.
```
