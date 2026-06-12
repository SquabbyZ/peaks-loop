# peaks agent run — ECC 64 agents soft-optional integration

## Why

Per spec §7.2 line 818: "64 agents — Soft Optional — 装了 L3
直接调; 不装 L3 退化到 peaks-cli 自有少数核心诊断". The 64
ECC agents (e.g. `security-reviewer`, `code-reviewer`,
`typescript-reviewer`, `python-reviewer`) are npm-installable
via `[ECC](https://github.com/affaan-m/everything-claude-code)`.
The canonical subprocess contract is:

```bash
npx ecc consult "<topic>" --target claude       # agent selection
npx ecc agent run <agent-name> --target <path> --json   # run
```

This slice adds the `peaks agent run` CLI surface that:
1. Shells out to `npx ecc agent run <name> --target <path> --json`
   when ECC is installed and `agentShieldEnabled` preference is true.
2. Falls back to peaks-cli's own minimal diagnostic (no-op
   shell, JSON envelope) when ECC is missing or disabled.
3. The peaks-cli's own doctor service already runs ~2 native
   diagnostic checks (Slice 11); this slice does NOT replace
   those — it ADDS the ECC layer on top.

## What Changes

### New CLI: `peaks agent run <agent-name>`

```
peaks agent run <agent-name> [--target <path>] [--json]
peaks agent run --list                       # list known ECC agents
```

Flags:
- `--target <path>`: project root or file to analyze. Default:
  process.cwd().
- `--list`: emit the 64-agent registry (subset of the full ECC
  catalog; the wrapper hardcodes the canonical 12 most-used
  agents and the rest are ECC-discovered at runtime).
- `--json`: emit the JSON envelope.

### New service: `src/services/agent/ecc-agent-service.ts`

Pure wrapper over `npx ecc agent run <name> --target <path>
--json`. Mirrors the design of `static-service.ts` (the ECC
AgentShield wrapper from L2.3 P2-a):

- `subprocessRunner: SubprocessRunner` injection point
  (testable)
- 5s `ecc --version` detection timeout
- 30s `ecc agent run` timeout
- Soft-fail on non-zero exit / non-JSON output
- Returns `AgentRunState` with `reason`:
  `enabled-and-installed` | `disabled-by-preference` |
  `flag-disabled` | `flag-enabled-but-ecc-missing` |
  `disabled-and-ecc-missing`

## Acceptance Criteria

- A1 — `peaks agent run security-reviewer --target . --json` exits 0
  when ECC is missing; the result is `reason:
  'flag-enabled-but-ecc-missing'` with a soft warning + nextActions
  listing the 4-option install prompt.
- A2 — `peaks agent run --list --json` exits 0; returns 12+ agent
  names + descriptions (the 12 canonical + any discovered).
- A3 — When `agentShieldEnabled: true` in preferences AND ECC is
  installed, the subprocess is spawned and findings are merged.
- A4 — When `agentShieldEnabled: false` (default), no subprocess
  is spawned; the audit still completes (idempotent preference
  reuses the existing static-service design).
- A5 — TDD: 4+ unit tests (mocked subprocess, bogus agent
  rejection, list, soft-fail).
- A6 — Full vitest green.

## Spec reference (canonical)

- `docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md`
  §7.2 line 818 (64 agents — Soft Optional)
- `docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md`
  §7.2 line 832 (canonical subprocess contract)

## Out of scope

- The peaks-cli native diagnostic core (Slice 11 already shipped
  2 diagnostic checks at `peaks doctor scan`).
- Auto-installation of ECC (deferred; the user can install
  manually via the 4-option prompt).
- Cross-IDE dispatch of ECC agent output (the agent's stdout
  is the source of truth; no transformation).
