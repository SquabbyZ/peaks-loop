# L2.4 P2-b: Second batch of lint-style red-lines for references/*.md + audit regression

## Why

Per spec §5.4 + §9 slice #7, the peaks-loop L2 audit framework shipped
8-12 P0 enforcers (L2.1, commit `621a693`), 10-15 P1 enforcers
(L2.2, commit `a80f28e`), 25-40 P2-a enforcers (L2.3, commit
`23a4a7d` + gap fixes in `65f0755`), and 1 P2-b framework-integration
commit (L2.4, commit `bb3abe2`).

P2-a targeted SKILL.md lint (Themes A-G + wireframe). P2-b targets
**references/*.md** lint (the 100+ files in `skills/<name>/references/*.md`)
plus the **audit regression stage** that L2.4's title calls out
("+ audit 回归"). Per spec §10.2 L2 acceptance: "L2.4 完成时, prose-only
比例 < 10% (从当前 ~50% 降下来)". P2-b's job is to push prose-only
into the cli-backed column.

The 100+ references/*.md files are large, structurally rich, and
inconsistently linted today. P2-b adds:

1. **25 new P2-b enforcers** across 8 themes (H through P), each
   focused on references/*.md shape, cross-references, loadStrategy
   behavior, and inline-shell hygiene.
2. **An audit-regression stage** wired into `peaks slice check` —
   asserts catalog stability, enforcer count, runtime budget, and
   zero orphan enforcers/catalog entries.

## What Changes

### Catalog growth (41 → 66 entries)

The catalog grows by 25 new P2-b entries. Themes:

**Theme H — Reference structural shape (3 enforcers)**
- `ref-h1-title-required` — every references/*.md starts with a
  `# <title>` heading.
- `ref-applicable-task-levels-declared` — every references/*.md
  declares which `applicableTaskLevels` it applies to (in body or
  frontmatter).
- `ref-see-also-section` — every references/*.md has a
  `## See also` (or `## Related`) section near the end.

**Theme I — Reference cross-references (3 enforcers)**
- `ref-cross-ref-resolves` — every `../<file>.md` or
  `references/<file>.md` link from a reference resolves to a real
  file.
- `ref-no-self-reference` — a reference file does not link to itself.
- `ref-no-orphan-link` — no link to a non-existent file or section
  inside the same repo.

**Theme J — Reference size + structure (3 enforcers)**
- `ref-line-count-le-800` — Karpathy 4 原则 §2.3: each reference
  ≤ 800 lines (the catalogue currently has 9 files over 5KB,
  several over 8KB).
- `ref-h2-count-le-12` — a reference has at most 12 h2 headings
  (Karpathy-style depth cap).
- `ref-overview-section-near-top` — long references (>200 lines)
  must have a `## Overview` section within the first 30 lines.

**Theme K — Reference loadStrategy behavior (2 enforcers)**
- `ref-loadstrategy-on-demand-fallback` — references with
  `loadStrategy: on-demand` must declare a fallback path (line
  starting with `> Fallback:` or `**Fallback**:`).
- `ref-loadstrategy-always-cacheable` — references with
  `loadStrategy: always` must be safe to load unconditionally
  (no I/O at module level, no top-level shell).

**Theme L — Audit regression (4 enforcers)**
- `audit-catalog-stability` — catalog size has not grown by >20%
  in the last 90 days; flags drift.
- `audit-no-orphan-enforcer` — every `enforcerRef` in the
  catalog points to a file that exists on disk.
- `audit-no-orphan-catalog` — every `enforcerRef` is non-null,
  OR has a documented reason in the catalog entry.
- `audit-runtime-budget` — `peaks audit red-lines` completes in
  < 2 seconds on a 100-reference project.

**Theme M — Reference inline shell patterns (3 enforcers)**
- `ref-no-bash-heredoc` — no `cat <<EOF` in inline shell snippets
  (YAGNI for the demo skill; the LLM can't safely skip a heredoc).
- `ref-no-sudo` — no `sudo` in inline shell snippets
  (peaks-loop is user-scope; sudo violates the dev-preference red line).
- `ref-no-curl-pipe-bash` — no `curl ... | bash` (YAGNI for the
  install UX; the LLM may be tricked into running arbitrary
  remote code via this pattern).

**Theme N — Reference code blocks (3 enforcers)**
- `ref-code-block-language-declared` — every fenced block has a
  language tag (` ```typescript `, ` ```bash `, ` ```json `, ...).
- `ref-no-fake-prompt` — no `# fake prompt` / `$ fake` markers
  in code blocks (they signal placeholder code).
- `ref-no-absolute-paths` — no `C:\` or `/usr/local` in code
  blocks (the LLM should use peaks-loop primitives instead).

**Theme O — Reference permissions + numbers (2 enforcers)**
- `ref-no-chmod-777` — no `chmod 777` in inline shell (security
  red flag; the user has explicit hardening in `.peaks/memory/`).
- `ref-no-magic-numbers` — no unsigned integer ≥ 100 in code
  blocks that isn't a named constant (use `MAX_RETRIES = 3`
  pattern instead of `if (retries > 100)`).

**Theme P — Reference dogfooding (2 enforcers)**
- `ref-skill-cites-every-existing-reference` — every reference
  file that is *not* cited in its parent SKILL.md is flagged
  (so dead references surface).
- `ref-loadstrategy-matches-size` — `loadStrategy: on-demand`
  is required for files > 5KB (always-load everything is a
  context-budget bug).

### Audit regression stage

`peaks slice check` gains a 5th stage: `audit-regression`. The
stage:

1. Runs `peaks audit red-lines --json` against the current
   project.
2. Asserts `totalRedLines >= 60` (catalog grew to 66; this
   pins the lower bound).
3. Asserts `enforcerFindings.length === 0` for any catalog
   ID matching `audit-no-orphan-enforcer` or
   `audit-no-orphan-catalog` (no orphan enforcers or catalog
   entries).
4. Asserts runtime ≤ 2000ms.
5. Emits the catalog breakdown as the stage's
   `passSummary` JSON envelope.

The stage is **gating** — `peaks slice check` exits non-zero
if any audit-regression assertion fails.

## Spec reference (canonical)

- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §5.4 (P2-b: 第二批 lint-style red lines in references/*.md)
- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §9 (slice #7 in the 14-slice plan)
- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §10.2 (L2 acceptance: prose-only < 10%)

## Acceptance Criteria

- A1 — `peaks audit red-lines --json` reports
  `totalRedLines: 66+`, `cliBacked: 60+`, `proseOnly: ≤ 6`
  (per §10.2 L2 acceptance at L2.4 done).
- A2 — All 25 new P2-b enforcers ship with at least one TDD
  unit test in `tests/unit/services/audit/enforcers/`.
- A3 — `peaks slice check` includes the new `audit-regression`
  stage; the stage passes on a clean repo and fails on a
  repo with an orphan enforcer file.
- A4 — Catalog grows 41 → 66 entries (P2-b's 25 + the 1
  already in P2-a wireframe = 26, but 1 is renamed; net +25).
- A5 — The existing L2.1 / L2.2 / L2.3 enforcers continue to
  pass — no regression. The 3 pre-existing config-migration
  test failures are baseline-broken and out of scope for P2-b.
- A6 — The `proseOnlyRatio` computed from the catalog
  (prose-only / total) is ≤ 10% on the peaks-loop repo.
- A7 — Every reference file in the peaks-loop repo's
  `skills/<name>/references/*.md` directory passes all 25
  P2-b enforcers (or has a documented exception in the
  catalog). This is the dogfood assertion: a fresh
  `peaks audit red-lines` shows zero P2-b violations.
- A8 — `pnpm vitest run` is green (2651 + 25+ new tests =
  2676+ passing).
- A9 — `pnpm typecheck` is clean.
- A10 — `peaks audit static --json` continues to work with
  the new catalog; the 4-option ECC install prompt is
  preserved.
