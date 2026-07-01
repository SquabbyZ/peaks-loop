# Red Lines Spec (Slice L2.1)

## Purpose

Define the data model and behavior of the peaks-loop red-line audit framework + the 5 P0 enforcers shipped in L2.1.

## `peaks audit red-lines`

### CLI contract

```bash
peaks audit red-lines --project <path> [--json] [--no-color]
```

Output envelope (per `r3-format-compact-defaults-by-artifact-type.md`):

```json
{
  "ok": true,
  "command": "audit.red-lines",
  "data": {
    "totalRedLines": 73,
    "cliBacked": 33,
    "partial": 41,
    "proseOnly": 0,
    "audit": [
      {
        "id": "rl-solo-code-ban-001",
        "rule": "Solo Code-Change Red Line",
        "source": {
          "file": "skills/peaks-solo/SKILL.md",
          "line": 42,
          "marker": "BLOCKING",
          "context": "Peaks-Loop Solo is an orchestrator, NOT an implementer..."
        },
        "backing": "cli-backed",
        "enforcerRef": "src/services/audit/enforcers/solo-code-ban.ts"
      }
    ]
  },
  "warnings": [],
  "nextActions": []
}
```

### Behavior

- Default: scan all 3 trees (skills, .claude/rules, openspec/changes).
- `--json` flag: emit the JSON envelope; default is a human-readable table.
- Errors:
  - `--project <path>` does not exist → `code: "PROJECT_NOT_FOUND"`, exit 1.
  - Scanner reads a malformed file → record the file in `warnings`, continue.

### Backing classification

For each red line, `backing-detector.ts` inspects the surrounding context and the catalog of known enforcers. The detector:

- Looks for the red-line ID in the enforcer catalog. If found → `cli-backed`.
- Looks for a `Partial` marker in the red-line's prose (e.g. "if LLM cooperates") → `partial`.
- Otherwise → `prose-only`.

The detector's classification is **heuristic, not authoritative** — the catalog is hand-maintained and ships with the 5 P0 enforcers. Future enforcers (L2.2/2.3/2.4) add their entries.

## P0 enforcer contracts

### 1. Solo-code-ban

**Trigger**: PreToolUse on `Bash` matcher, when the bash command is `git commit` or `git apply` AND the active skill starts with `peaks-`.

**Behavior**: deny with `permissionDecision: "deny"`, reason: "Solo Code-Change Red Line: peaks-* skills must go through peaks-solo / peaks-rd. Use `peaks request transition` instead."

**Fail-open**: registry / manifest read failure → warn + allow (per `gate-enforcement-hook.md` trust red line).

**Tests**: 4 cases — (a) `git commit` from peaks-* skill → deny; (b) `git commit` from a non-peaks skill → allow; (c) `git status` (not commit) → allow; (d) registry read failure → allow + warn.

### 2. no-root-pollution

**Trigger**: PreToolUse on `Write` / `Edit` matcher, when `file_path` is at the project root and the file is NOT in the allowlist.

**Allowlist** (`src/services/audit/enforcers/no-root-pollution.ts`):

```typescript
const ROOT_FILE_ALLOWLIST = new Set([
  'README.md', 'README-en.md', 'LICENSE', 'LICENSE.md', 'package.json', 'pnpm-lock.yaml',
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
  'openspec', '.peaks', '.claude', 'skills', 'docs', 'tests',
  'bin', 'scripts', 'schemas', 'output-styles',
  'dist', 'node_modules', 'coverage',
]);
```

**Behavior**: deny with reason: "no-root-pollution: file `<path>` is not in the root allowlist. Move it under `docs/`, `tests/`, `skills/`, or another documented directory."

**Tests**: 5 cases — (a) write to `docs/foo.md` → allow; (b) write to `peaks-foo.md` (not in allowlist) → deny; (c) write to `tests/unit/foo.test.ts` → allow; (d) write to `dist/foo.js` → allow (build output); (e) symlink traversal → deny.

### 3. sub-agent-sid

**Trigger**: `peaks audit red-lines` + `peaks workspace clean` (existing).

**Behavior**: scan `.peaks/_sub_agents/<sid>/` for sids that fail `isValidSessionId` from `src/services/workspace/sid-naming-guard.ts`. Report each invalid sid in the audit's `warnings` array; classify the red line as `cli-backed`.

**Tests**: 3 cases — (a) all valid sids → 0 invalid; (b) one bare sid (no date prefix) → 1 invalid; (c) `_sub_agents/` missing → 0 invalid (no error).

### 4. tech-doc-presence

**Trigger**: `peaks request transition <rid> spec-locked` (existing transition, new prerequisite).

**Behavior**: refuse the transition if `.peaks/_runtime/<sid>/rd/tech-doc.md` is missing or empty. Error: `code: "TECH_DOC_MISSING"`, message: "spec-locked transition requires `rd/tech-doc.md` to exist."

**Tests**: 4 cases — (a) tech-doc.md exists → transition proceeds; (b) tech-doc.md missing → transition fails; (c) tech-doc.md exists but empty (0 bytes) → transition fails; (d) other transitions (e.g. `draft → spec-locked`) are unaffected.

### 5. mock-placement

**Trigger**: `peaks slice check` (existing, new 5th check).

**Behavior**: scan changed files (from `peaks scan diff-vs-scope`) for inline mock-data patterns. Fail the slice check if any changed file in `src/` or `skills/` contains `mockData: { ... }`, `fixtures = { ... }`, or `const fooMock = { ... > 20 chars }`.

**Mock patterns** (regex):

```typescript
const MOCK_PATTERNS = [
  /\bmockData\s*[:=]\s*\{/,
  /\bfixtures?\s*=\s*\{/,
  /const\s+\w*[Mm]ock\w*\s*=\s*\{[\s\S]{20,}/,
];
```

**Tests**: 5 cases — (a) src/ with inline mock → fail; (b) tests/fixtures/ with mock → allow; (c) src/ without mock → allow; (d) skills/ with mock data → fail; (e) empty file → allow.

## Acceptance criteria

- `peaks audit red-lines --project .` returns a stable JSON envelope.
- 5 P0 enforcers are testable from the CLI (per the test cases above).
- After L2.1 ships, the JSON shows ≥ 5 red lines as `cli-backed` with `enforcerRef` pointing to a real file.
- Coverage ≥ 80% on the new audit service.
- No new `any` types.
- Each new file ≤ 200 lines (well below Karpathy 800-line cap).
- Backward compat: `peaks doctor`, `peaks scan *`, `peaks gate enforce`, `peaks hooks install` all unchanged in behavior.
