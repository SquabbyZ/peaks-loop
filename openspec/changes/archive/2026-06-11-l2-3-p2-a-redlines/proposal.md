# L2.3 P2-a: First batch of lint-style red-lines + ECC AgentShield soft-optional

## Why

Per spec §5.4 + §9 slice #6, the peaks-loop L2 audit framework shipped 8-12
P0 enforcers (L2.1, commit `621a693`) and 10-15 P1 enforcers (L2.2, commit
`a80f28e`). The catalog currently has 15 entries:

```
rl-solo-code-ban-001
rl-no-root-pollution-001
rl-sub-agent-sid-001
rl-tech-doc-presence-001
rl-mock-placement-001
rl-resume-detection-001
rl-resume-detection-002
rl-prototype-fidelity-001
rl-prototype-fidelity-002
rl-设计-draft-confirm-001
rl-设计-draft-confirm-002
rl-pre-rd_scan-001
rl-pre-rd_scan-002
rl-login-gate-001
rl-login-gate-002
```

The L2.1 + L2.2 coverage protects the *structural* gates (solo-code-ban,
root-pollution, sub-agent-sid, mock-placement, resume, prototype,
design-draft, pre-rd, login). What's missing is the *lint-style* layer:
small per-skill and per-reference red-lines that catch inline bloat, missing
sections, and CLI-back gaps. Spec §5.4 says P2-a targets 25-40 of these.

Slice #4 audit-test currently reports `totalRedLines: 15`. After this
slice, the catalog grows to ~45 entries and `peaks audit red-lines` should
report `prose-only` falling to < 10% (per §10.2 acceptance).

Slice #6 also opens the ECC AgentShield integration (§5.3): when ECC is
installed (`npx ecc-agentshield --version` succeeds), `peaks audit static`
shells out to the 102 AgentShield rules; when not installed, the audit
falls back to the peaks-loop lint engine with no broken behaviour.

## What Changes

### Catalog growth (15 → ~45 entries)

Group new enforcers into 6 themes, each with a small dedicated
enforcer file in `src/services/audit/enforcers/`:

**Theme A — Section structure (5 enforcers)**
- `section-hard-contracts-present` — every skill SKILL.md has
  `## Hard contracts for ...` near the top when the skill produces
  browser/IO surface.
- `section-mandatory-artifact-present` — every RD/QA/PRD/TXT skill
  has `## Mandatory ...` heading for its primary artifact.
- `section-default-runbook-present` — every role-skill has a Default
  runbook section (inline pointer or references/runbook.md).
- `section-gate-index-present` — every role-skill has a gate-index
  section enumerating its CLI-backed gates.
- `section-skills-md-naming-axiom` — every skill SKILL.md has the
  Two-axis naming convention callout at the top.

**Theme B — Frontmatter shape (3 enforcers)**
- `frontmatter-skills-md-parseable` — frontmatter is valid YAML and
  has `name` + `description` (the frontmatter at the top of each
  SKILL.md that the skill-runbook-service reads).
- `frontmatter-references-load-strategy` — every reference in
  `references/` declares `loadStrategy: always | on-demand` in its
  heading.
- `frontmatter-applicable-task-levels` — every skill SKILL.md has
  the `applicableTaskLevels` field in its body, declaring which
  L1a task levels invoke it.

**Theme C — Output style (3 enforcers)**
- `output-style-status-header` — when a skill executes, the first
  line of its response carries the canonical
  `Peaks-Loop Skill: <name> | Peaks-Loop Gate: <gate> | Next: <action>`
  status header. The status header is detected by scanning
  recent session transcripts (test-only fixture) for the literal
  string.
- `output-style-no-fluff` — SKILL.md does not contain greeting
  patterns ("你好", "我是", "Hello, I am") that signal a generic
  persona instead of a CLI orchestrator.
- `output-style-no-closing-prompt` — SKILL.md does not end with
  closing prompts ("如有需要", "Let me know if you need ...") that
  signal conversational-style responses.

**Theme D — CLI-back gaps (4 enforcers)**
- `cli-back-mandatory-text-has-enforcer` — every literal
  `MANDATORY` / `BLOCKING` / `MUST NOT` / `MUST` / `REQUIRED` marker
  in any SKILL.md has a corresponding `peaks *` enforcer in the
  catalog. The enforcer is referenced by name in the surrounding
  ±2 lines.
- `cli-back-no-orphan-blocking` — no `BLOCKING` marker exists
  without a corresponding enforcerRef in the red-line catalog.
- `cli-back-no-orphan-must-not` — no `MUST NOT` marker exists
  without a corresponding enforcerRef.
- `cli-back-prose-only-threshold` — the audit reports a
  `proseOnlyRatio` derived from the catalog; > 10% triggers
  WARN (per §10.2 acceptance: "L2.4 完成时, prose-only
  比例 < 10%"). Now that P2 is shipping, the threshold tightens
  to 5%.

**Theme E — Reference integrity (4 enforcers)**
- `ref-path-resolves` — every `./references/...md` or
  `references/<file>.md` link from a SKILL.md resolves to a real
  file.
- `ref-no-broken-mkdir` — no SKILL.md or reference tells the LLM
  to run a `mkdir -p` outside the project; only the peaks-loop
  `peaks workspace init` / `peaks project mkdir` may create
  directories.
- `ref-no-pwd-symlink-jumps` — no `cd ..` or `../..` chains
  outside the project root in any inline shell snippet. The LLM
  is pinned to `process.cwd()` and must not jump.
- `ref-no-relative-archive-paths` — no `cp` / `mv` / `ln` to
  absolute paths like `/tmp`; the LLM must use the peaks-loop
  archive / clean commands instead.

**Theme F — Workflow-bound shape (4 enforcers)**
- `openspec-proposal-has-acceptance-bullets` — every
  `openspec/changes/*/proposal.md` has a non-empty
  `## Acceptance Criteria` section with at least one `- `
  bullet (not just a blockquote).
- `openspec-proposal-has-spec-changes` — every non-trivial change
  (≥ 50 LOC or affecting a public CLI surface) has at least one
  `## Spec reference (canonical)` link.
- `tech-doc-presence-pre-rd` — when a slice is about to enter
  `rd:qa-handoff`, the `rd/tech-doc.md` file exists with
  `## Red-line scope` and `## Implementation evidence` sections.
  (Tightens the existing tech-doc-presence enforcer with content
  shape.)
- `peaks-doctor-skill-acknowledged` — every skill that writes a
  request artifact acknowledges the L3 doctor
  (`peaks doctor scan --json` is in its runbook or pre-rd
  context).

### ECC AgentShield soft-optional integration

`peaks audit static --json` new top-level command:
- Detects ECC AgentShield via `npx ecc-agentshield --version` (5s
  timeout, soft-fail on error).
- If installed: spawns `npx ecc-agentshield scan --json` and
  merges its findings into the audit's EnforcerFinding list.
- If not installed: surfaces the same §5.3 four-option UX as UA
  (a) install, b) skip, c) never, d) learn).
- Soft-disabled via `agentShieldEnabled` preference (default
  `false`); the audit runs even when disabled, just without the
  external subprocess.

### Acceptance behavior changes

- `peaks audit red-lines --json`: totalRedLines grows from 15 to
  ~45; `cliBacked` grows from 12 to ~38; `proseOnly` shrinks
  from 3 to ≤ 5.
- `peaks audit static --json`: new command, ECC-merged findings
  when available.
- `peaks slice check`: existing 4-5 stages unchanged; enforcer
  count badge updates to reflect the new catalog size.

## Spec reference (canonical)

- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §5.3 (ECC AgentShield soft-optional)
- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §5.4 (sub-slice split: L2.3 P2-a targets 25-40 lint-style red
  lines)
- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §9 (slice #6 in the 10-slice plan)
- `docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md`
  §10.2 (L2 acceptance: P2 complete when prose-only < 10%)

## Acceptance Criteria

- A1 — `peaks audit red-lines --json` reports `totalRedLines: 45+`, `cliBacked: 38+`, `proseOnly: ≤ 5` (per §10.2 L2 acceptance).
- A2 — All 25 new P2 enforcers ship with at least one TDD unit test in `tests/unit/audit/enforcers/`.
- A3 — `peaks audit static --json` runs without ECC installed (returns peaks-loop-only findings) AND with ECC installed (returns merged findings from both engines).
- A4 — When `agentShieldEnabled: false` (default), no external subprocess is spawned; the audit still completes.
- A5 — The four-option UA-style install prompt fires once per session (not per call) when ECC is missing.
- A6 — The catalog grows from 15 to ~45 entries; the `proseOnlyRatio` computed from the catalog is ≤ 5%.
- A7 — The existing L2.1 / L2.2 / L2.4 enforcers continue to pass — no regression.
- A8 — The `solo-code-ban` and `no-root-pollution` (L2.1 P0) tests still report 0 violations in the peaks-loop repo.
- A9 — `pnpm vitest run` is green (2595 + 25+ new tests = 2620+ passing).
- A10 — `pnpm typecheck` is clean.
