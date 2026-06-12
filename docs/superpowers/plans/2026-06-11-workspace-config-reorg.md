# Plan #0.5: Workspace & Config Reorganization (YAGNI)

> **For agentic workers:** REQUIRED SUB-KILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim `~/.peaks/config.json` to just `{ "version": "2.0.0" }`, migrate per-project fields (`economyMode` / `swarmMode`) to `.peaks/preferences.json`, collect decision dotfiles into `.peaks/_state/`, add naming guard for two-axis sid convention, ship 9 new CLI commands (config migrate/rollback/restore, preferences set/get/reset, workspace clean/archive).

**Architecture:** Pure filesystem operations. No runtime agent framework. Three modules: (1) `src/services/preferences/` for `.peaks/preferences.json` read/write; (2) `src/services/workspace/` for clean / archive / state / sid-guard; (3) `src/services/config/` extension for migrate / rollback / restore. Each CLI command is a thin wrapper over its service. All CLI commands have `--dry-run` default with `--apply` opt-in per dev-preference red line.

**Tech Stack:** TypeScript (strict, ESM, `.js` extension in imports) + Node 20+ `node:fs` + Commander.js + vitest (TDD).

**Spec reference:** [docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §8](../../specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md) + §10.4 AC + §11 Risks + §12 Open Questions.

**Estimated effort:** 15 tasks × 30-45 min/task = 8-12 hours (matches §9 estimate of 1 day).

---

## File Structure

### Create

```
src/services/preferences/
  preferences-types.ts          # Schema types + defaults
  preferences-service.ts        # read/write .peaks/preferences.json

src/services/workspace/
  sid-naming-guard.ts           # Two-axis sid convention validation
  workspace-state-service.ts    # .peaks/_state/ manage dotfiles
  workspace-clean-service.ts    # Clean _runtime + _sub_agents invalid
  workspace-archive-service.ts  # Archive session to _archive/<yyyy-mm>/

src/services/config/
  config-migration.ts           # 1.x → 2.0 migration
  config-rollback.ts            # Rollback to 1.x from .bak
  config-restore.ts             # Per-field restore from .bak

src/cli/commands/
  preferences-commands.ts       # peaks preferences {set,get,reset}

tests/unit/
  preferences-service.test.ts
  sid-naming-guard.test.ts
  workspace-state-service.test.ts
  workspace-clean-service.test.ts
  workspace-archive-service.test.ts
  config-migration.test.ts
  config-rollback.test.ts
  config-restore.test.ts

tests/integration/
  config-migrate-cli.test.ts
  preferences-cli.test.ts
  workspace-clean-cli.test.ts
```

### Modify

```
src/services/config/
  config-service.ts             # Accept slim 2.0 schema (only `version`)
  config-types.ts               # Add ConfigV2 type (just version)

src/cli/commands/
  config-commands.ts            # Add migrate/rollback/restore subcommands
  workspace-commands.ts         # Add clean/archive subcommands
```

### TDD rules (project convention)

- Use `mkdtempSync(join(tmpdir(), 'peaks-X-'))` for temp project roots
- Use `writeFileSync` / `mkdirSync` / `rmSync` from `node:fs`
- Always `try { ... } finally { rmSync(dir, {recursive: true, force: true}) }`
- Imports use `.js` extension (ESM)
- Service throws on error, CLI catches + JSON envelope
- All CLI commands default to dry-run; require `--apply` to write

---

## Task Index

| # | Task | Files | Est. |
|---|---|---|---|
| 1 | Preferences types + defaults | `preferences-types.ts` | 25 min |
| 2 | Preferences service (read/write) | `preferences-service.ts` + test | 40 min |
| 3 | Preferences CLI commands | `preferences-commands.ts` + integration test | 35 min |
| 4 | Workspace `_state/` service | `workspace-state-service.ts` + test | 40 min |
| 5 | SID naming guard | `sid-naming-guard.ts` + test | 35 min |
| 6 | Workspace clean (`_runtime/`) | `workspace-clean-service.ts` partial + test | 40 min |
| 7 | Workspace clean (`_sub_agents/` invalid) | `workspace-clean-service.ts` complete + test | 40 min |
| 8 | Workspace archive service | `workspace-archive-service.ts` + test | 40 min |
| 9 | Workspace CLI commands (clean/archive) | `workspace-commands.ts` + integration test | 35 min |
| 10 | Config migration (1.x → 2.0) | `config-migration.ts` + test | 50 min |
| 11 | Config rollback | `config-rollback.ts` + test | 35 min |
| 12 | Config restore (per-field) | `config-restore.ts` + test | 35 min |
| 13 | Slim config-service schema (2.0) | `config-service.ts` + `config-types.ts` | 30 min |
| 14 | Config CLI commands (migrate/rollback/restore) | `config-commands.ts` + integration test | 40 min |
| 15 | End-to-end dogfood + commit | `tests/integration/full-migration.test.ts` | 45 min |

---

## Task 1: Preferences types + defaults

**Files:**
- Create: `src/services/preferences/preferences-types.ts`

- [ ] **Step 1: Create the types file with schema**

```typescript
// src/services/preferences/preferences-types.ts
/**
 * peaks-cli 2.0 project-local preferences schema.
 * Per spec §8.4 — per-project state lives in `.peaks/preferences.json`,
 * NOT in `~/.peaks/config.json` (which is slim global).
 *
 * Spec reference: docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §8.4
 */

export const PREFERENCES_SCHEMA_VERSION = '2.0.0';

/**
 * Per-task-level UA install UX prompt decision.
 * Values:
 *   - 'unset'              — ask every session (default)
 *   - 'skip-this-session'  — skip prompt for current session only
 *   - 'skip-forever'       — never ask, never install
 */
export type UaPromptDecision = 'unset' | 'skip-this-session' | 'skip-forever';

/**
 * L1a task classification conservatism.
 * Values:
 *   - 'default'  — use default signal thresholds
 *   - 'strict'   — always upgrade to next level (slower, safer)
 *   - 'lax'      — always downgrade to previous level (faster, riskier)
 */
export type ClassifyConservatism = 'default' | 'strict' | 'lax';

/**
 * Per-touchpoint headroom-AI mode override.
 * Spec §7.4 — default 'balanced'.
 */
export type HeadroomMode = 'balanced' | 'aggressive' | 'conservative';

export interface HeadroomPreferences {
  /** Whether headroom integration is enabled globally. Default: true */
  readonly enabled: boolean;
  /** Default mode if a touchpoint doesn't override. Default: 'balanced' */
  readonly defaultMode: HeadroomMode;
  /** Per-touchpoint mode overrides */
  readonly perTouchpoint: {
    memorySearch: HeadroomMode;
    retrospectiveSearch: HeadroomMode;
    doctorScan: HeadroomMode;
    doctorRoute: HeadroomMode;
  };
}

export interface ClassifyRuleOverrides {
  /** File count threshold above which a task is promoted to 'feature' */
  readonly feature_threshold_files?: number;
  /** Line count threshold above which a task is promoted to 'feature' */
  readonly feature_threshold_lines?: number;
  /** Whether to require a 24h grace before cleaning recently-active sessions */
  readonly runtime_clean_grace_hours?: number;
}

export interface SwarmSpeculativePreferences {
  /** Whether speculative dispatch is enabled. Default: true */
  readonly enabled: boolean;
  /** Max concurrent speculative sub-agents. Default: 2 */
  readonly maxConcurrent: number;
  /** Min hit rate below which speculative auto-disables. Default: 0.5 */
  readonly minHitRate: number;
}

export interface ProjectPreferences {
  readonly schema_version: typeof PREFERENCES_SCHEMA_VERSION;
  readonly economyMode: boolean;
  readonly swarmMode: boolean;
  readonly uaPrompt: UaPromptDecision;
  readonly agentShieldPrompt: UaPromptDecision;
  readonly classifyConservatism: ClassifyConservatism;
  readonly classifyRules: ClassifyRuleOverrides;
  readonly headroom: HeadroomPreferences;
  readonly swarmSpeculative: SwarmSpeculativePreferences;
  /** Loop Autonomous (L4 14.5) toggle. Default: false — never auto-enable. */
  readonly loopAutonomousEnabled: boolean;
}

export const DEFAULT_PREFERENCES: ProjectPreferences = {
  schema_version: PREFERENCES_SCHEMA_VERSION,
  economyMode: true,
  swarmMode: true,
  uaPrompt: 'unset',
  agentShieldPrompt: 'unset',
  classifyConservatism: 'default',
  classifyRules: {
    feature_threshold_files: 10,
    feature_threshold_lines: 100,
    runtime_clean_grace_hours: 24,
  },
  headroom: {
    enabled: true,
    defaultMode: 'balanced',
    perTouchpoint: {
      memorySearch: 'balanced',
      retrospectiveSearch: 'balanced',
      doctorScan: 'balanced',
      doctorRoute: 'conservative',
    },
  },
  swarmSpeculative: {
    enabled: true,
    maxConcurrent: 2,
    minHitRate: 0.5,
  },
  loopAutonomousEnabled: false,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/services/preferences/preferences-types.ts
git commit -m "feat(preferences): add 2.0 schema types + defaults (Slice 0.5 Task 1)"
```

---

## Task 2: Preferences service (read/write with defaults + validation)

**Files:**
- Create: `src/services/preferences/preferences-service.ts`
- Create: `tests/unit/preferences-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/preferences-service.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  loadPreferences,
  savePreferences,
  DEFAULT_PREFERENCES,
  PREFERENCES_SCHEMA_VERSION,
  type ProjectPreferences,
} from '../../src/services/preferences/preferences-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-prefs-'));
}

describe('loadPreferences', () => {
  test('returns defaults when .peaks/preferences.json does not exist', () => {
    const project = makeProject();
    try {
      const prefs = loadPreferences(project);
      expect(prefs).toEqual(DEFAULT_PREFERENCES);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns merged object when partial preferences file exists', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'preferences.json'), JSON.stringify({
        schema_version: '2.0.0',
        economyMode: false,
      }));
      const prefs = loadPreferences(project);
      expect(prefs.economyMode).toBe(false);
      expect(prefs.swarmMode).toBe(DEFAULT_PREFERENCES.swarmMode);
      expect(prefs.schema_version).toBe(PREFERENCES_SCHEMA_VERSION);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws on schema_version mismatch', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'preferences.json'), JSON.stringify({
        schema_version: '1.0.0',
      }));
      expect(() => loadPreferences(project)).toThrow(/PREFERENCES_SCHEMA_MISMATCH/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws on invalid JSON', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'preferences.json'), '{ invalid json');
      expect(() => loadPreferences(project)).toThrow(/PREFERENCES_JSON_INVALID/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('savePreferences', () => {
  test('writes preferences.json and creates .peaks/ if missing', () => {
    const project = makeProject();
    try {
      const overrides: Partial<ProjectPreferences> = { economyMode: false, uaPrompt: 'skip-forever' };
      savePreferences(project, overrides);
      const filePath = join(project, '.peaks/preferences.json');
      expect(existsSync(filePath)).toBe(true);
      const written = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(written.economyMode).toBe(false);
      expect(written.uaPrompt).toBe('skip-forever');
      expect(written.swarmMode).toBe(DEFAULT_PREFERENCES.swarmMode);
      expect(written.schema_version).toBe(PREFERENCES_SCHEMA_VERSION);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('merges with existing preferences instead of overwriting', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks');
      mkdirSync(dir, { recursive: true });
      savePreferences(project, { swarmMode: false, uaPrompt: 'skip-forever' });
      savePreferences(project, { economyMode: false });
      const written = JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8'));
      expect(written.swarmMode).toBe(false);
      expect(written.economyMode).toBe(false);
      expect(written.uaPrompt).toBe('skip-forever');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/preferences-service.test.ts`
Expected: FAIL with "Cannot find module '../../src/services/preferences/preferences-service.js'"

- [ ] **Step 3: Implement the service**

```typescript
// src/services/preferences/preferences-service.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_SCHEMA_VERSION,
  type ProjectPreferences,
} from './preferences-types.js';

const PREFS_REL_PATH = '.peaks/preferences.json';

export { DEFAULT_PREFERENCES, PREFERENCES_SCHEMA_VERSION };
export type { ProjectPreferences } from './preferences-types.js';

export function preferencesPath(projectRoot: string): string {
  return join(projectRoot, PREFS_REL_PATH);
}

export function loadPreferences(projectRoot: string): ProjectPreferences {
  const filePath = preferencesPath(projectRoot);
  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_PREFERENCES);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `PREFERENCES_JSON_INVALID: failed to parse ${filePath}: ${(err as Error).message}`
    );
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>).schema_version !== PREFERENCES_SCHEMA_VERSION
  ) {
    throw new Error(
      `PREFERENCES_SCHEMA_MISMATCH: expected schema_version=${PREFERENCES_SCHEMA_VERSION} in ${filePath}, got ${(raw as Record<string, unknown> | null)?.schema_version}`
    );
  }
  return mergePreferences(DEFAULT_PREFERENCES, raw as Partial<ProjectPreferences>);
}

export function savePreferences(
  projectRoot: string,
  overrides: Partial<ProjectPreferences>
): ProjectPreferences {
  const filePath = preferencesPath(projectRoot);
  const current = loadPreferences(projectRoot);
  const merged = mergePreferences(current, overrides);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

function mergePreferences(
  base: ProjectPreferences,
  overrides: Partial<ProjectPreferences>
): ProjectPreferences {
  const out: ProjectPreferences = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  out.schema_version = PREFERENCES_SCHEMA_VERSION;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/preferences-service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/preferences/preferences-service.ts tests/unit/preferences-service.test.ts
git commit -m "feat(preferences): load/save service with merge + schema validation (Slice 0.5 Task 2)"
```

---

## Task 3: Preferences CLI commands (`peaks preferences {set,get,reset}`)

**Files:**
- Create: `src/cli/commands/preferences-commands.ts`
- Create: `tests/integration/preferences-cli.test.ts`
- Modify: `src/cli/program.ts:1-200` (register new subcommand — see Step 3 for exact insertion point)

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/integration/preferences-cli.test.ts
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-prefs-cli-'));
}

function cli(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${process.cwd()}/dist/cli/program.js ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

describe('peaks preferences CLI', () => {
  test('peaks preferences get returns JSON envelope with default value for unknown key', () => {
    const project = makeProject();
    try {
      const { stdout, code } = cli(`preferences get --key swarmMode --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(true);
      expect(out.data.key).toBe('swarmMode');
      expect(out.data.value).toBe(true);
      expect(out.data.source).toBe('default');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks preferences set writes to .peaks/preferences.json', () => {
    const project = makeProject();
    try {
      const { code } = cli(`preferences set --key economyMode --value false --json`, project);
      expect(code).toBe(0);
      const file = join(project, '.peaks/preferences.json');
      expect(existsSync(file)).toBe(true);
      const written = JSON.parse(readFileSync(file, 'utf8'));
      expect(written.economyMode).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks preferences reset deletes the override (falls back to default)', () => {
    const project = makeProject();
    try {
      cli(`preferences set --key uaPrompt --value skip-forever --json`, project);
      cli(`preferences reset --key uaPrompt --json`, project);
      const { stdout } = cli(`preferences get --key uaPrompt --json`, project);
      const out = JSON.parse(stdout);
      expect(out.data.source).toBe('default');
      expect(out.data.value).toBe('unset');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks preferences set rejects unknown key', () => {
    const project = makeProject();
    try {
      const { code, stderr } = cli(`preferences set --key bogusKey --value x --json`, project);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/PREFERENCES_KEY_UNKNOWN/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/preferences-cli.test.ts`
Expected: FAIL (CLI not registered, exit code 1)

- [ ] **Step 3: Implement the CLI commands**

```typescript
// src/cli/commands/preferences-commands.ts
import type { Command } from 'commander';
import { loadPreferences, preferencesPath, savePreferences } from '../../services/preferences/preferences-service.js';
import type { ProjectPreferences } from '../../services/preferences/preferences-types.js';

const ALLOWED_KEYS: ReadonlySet<keyof ProjectPreferences> = new Set([
  'economyMode',
  'swarmMode',
  'uaPrompt',
  'agentShieldPrompt',
  'classifyConservatism',
  'classifyRules',
  'headroom',
  'swarmSpeculative',
  'loopAutonomousEnabled',
]);

export function registerPreferencesCommands(program: Command): void {
  const prefs = program.command('preferences').description('Manage project-local preferences');

  prefs
    .command('get')
    .description('Get a preference value (from override or default)')
    .requiredOption('--key <key>', 'preference key')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: { key: string; project: string; json?: boolean }) => {
      try {
        if (!ALLOWED_KEYS.has(opts.key as keyof ProjectPreferences)) {
          throw new Error(`PREFERENCES_KEY_UNKNOWN: ${opts.key}`);
        }
        const all = loadPreferences(opts.project);
        const value = (all as Record<string, unknown>)[opts.key];
        const filePath = preferencesPath(opts.project);
        const source = (await import('node:fs')).existsSync(filePath) ? 'override' : 'default';
        const envelope = {
          ok: true,
          data: { key: opts.key, value, source },
        };
        process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });

  prefs
    .command('set')
    .description('Override a preference value (writes to .peaks/preferences.json)')
    .requiredOption('--key <key>', 'preference key')
    .requiredOption('--value <value>', 'value (parsed as JSON, or string if not JSON)')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: { key: string; value: string; project: string; json?: boolean }) => {
      try {
        if (!ALLOWED_KEYS.has(opts.key as keyof ProjectPreferences)) {
          throw new Error(`PREFERENCES_KEY_UNKNOWN: ${opts.key}`);
        }
        let parsed: unknown = opts.value;
        try {
          parsed = JSON.parse(opts.value);
        } catch {
          // keep as string
        }
        const merged = savePreferences(opts.project, {
          [opts.key]: parsed,
        } as Partial<ProjectPreferences>);
        process.stdout.write(
          JSON.stringify({ ok: true, data: { key: opts.key, value: (merged as Record<string, unknown>)[opts.key] } }, null, 2) + '\n'
        );
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });

  prefs
    .command('reset')
    .description('Remove the override for a key (falls back to default)')
    .requiredOption('--key <key>', 'preference key')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: { key: string; project: string; json?: boolean }) => {
      try {
        if (!ALLOWED_KEYS.has(opts.key as keyof ProjectPreferences)) {
          throw new Error(`PREFERENCES_KEY_UNKNOWN: ${opts.key}`);
        }
        const all = loadPreferences(opts.project);
        delete (all as Record<string, unknown>)[opts.key];
        const { savePreferences: save } = await import('../../services/preferences/preferences-service.js');
        save(opts.project, all);
        process.stdout.write(JSON.stringify({ ok: true, data: { key: opts.key, removed: true } }) + '\n');
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });
}
```

**Modify `src/cli/program.ts`** (register the new commands): find the line that calls other `register*Commands` functions and add a sibling call:

```typescript
import { registerPreferencesCommands } from './commands/preferences-commands.js';
// ... in the program setup, after other register calls:
registerPreferencesCommands(program);
```

- [ ] **Step 4: Build + run test to verify it passes**

Run: `pnpm build && pnpm vitest run tests/integration/preferences-cli.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/preferences-commands.ts src/cli/program.ts tests/integration/preferences-cli.test.ts
git commit -m "feat(preferences): CLI commands set/get/reset with JSON envelope (Slice 0.5 Task 3)"
```

---

## Task 4: Workspace `_state/` service (collect decision dotfiles)

**Files:**
- Create: `src/services/workspace/workspace-state-service.ts`
- Create: `tests/unit/workspace-state-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/workspace-state-service.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  collectLegacyDecisionDotfiles,
  isLegacyDecisionDotfile,
  stateDirPath,
} from '../../src/services/workspace/workspace-state-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-state-'));
}

const LEGACY_DOTFILES = [
  '.peaks-init-hooks-decision.json',
  '.peaks-openspec-opt-in.json',
] as const;

describe('isLegacyDecisionDotfile', () => {
  test.each(LEGACY_DOTFILES.map((name) => [name]))('recognizes legacy %s', (name) => {
    expect(isLegacyDecisionDotfile(name)).toBe(true);
  });

  test('rejects non-decision dotfiles', () => {
    expect(isLegacyDecisionDotfile('package.json')).toBe(false);
    expect(isLegacyDecisionDotfile('peaks-cli.md')).toBe(false);
  });
});

describe('stateDirPath', () => {
  test('returns .peaks/_state under projectRoot', () => {
    expect(stateDirPath('/tmp/proj')).toBe('/tmp/proj/.peaks/_state');
  });
});

describe('collectLegacyDecisionDotfiles', () => {
  test('moves both legacy dotfiles from .peaks/ root to .peaks/_state/', () => {
    const project = makeProject();
    try {
      const peaksDir = join(project, '.peaks');
      mkdirSync(peaksDir, { recursive: true });
      writeFileSync(join(peaksDir, '.peaks-init-hooks-decision.json'), '{"hooks":true}', 'utf8');
      writeFileSync(join(peaksDir, '.peaks-openspec-opt-in.json'), '{"optIn":true}', 'utf8');

      const result = collectLegacyDecisionDotfiles(project);
      expect(result.moved).toEqual(expect.arrayContaining([
        '.peaks-init-hooks-decision.json',
        '.peaks-openspec-opt-in.json',
      ]));
      expect(result.skipped).toEqual([]);

      const stateDir = join(peaksDir, '_state');
      for (const name of LEGACY_DOTFILES) {
        expect(existsSync(join(peaksDir, name))).toBe(false);
        expect(existsSync(join(stateDir, name))).toBe(true);
        const content = readFileSync(join(stateDir, name), 'utf8');
        expect(content.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('skips legacy dotfile that does not exist (no error)', () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, '.peaks'), { recursive: true });
      const result = collectLegacyDecisionDotfiles(project);
      expect(result.moved).toEqual([]);
      expect(result.skipped).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws DOTFILE_COLLISION when target already exists in _state/', () => {
    const project = makeProject();
    try {
      const peaksDir = join(project, '.peaks');
      const stateDir = join(peaksDir, '_state');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(peaksDir, '.peaks-init-hooks-decision.json'), '{}', 'utf8');
      writeFileSync(join(stateDir, '.peaks-init-hooks-decision.json'), '{"existing":true}', 'utf8');
      expect(() => collectLegacyDecisionDotfiles(project)).toThrow(/DOTFILE_COLLISION/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/workspace-state-service.test.ts`
Expected: FAIL with module-not-found error

- [ ] **Step 3: Implement the service**

```typescript
// src/services/workspace/workspace-state-service.ts
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Spec §8.4 + §8.5 — `.peaks/_state/` collects one-time decision dotfiles.
 * Migrates from legacy `.peaks/<name>` flat layout.
 */

const LEGACY_DOTFILES: readonly string[] = [
  '.peaks-init-hooks-decision.json',
  '.peaks-openspec-opt-in.json',
];

const STATE_DIR_NAME = '_state';

export function isLegacyDecisionDotfile(name: string): boolean {
  return (LEGACY_DOTFILES as readonly string[]).includes(name);
}

export function stateDirPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', STATE_DIR_NAME);
}

export interface CollectResult {
  moved: string[];
  skipped: string[];
}

export function collectLegacyDecisionDotfiles(projectRoot: string): CollectResult {
  const peaksDir = join(projectRoot, '.peaks');
  const stateDir = stateDirPath(projectRoot);
  mkdirSync(stateDir, { recursive: true });
  const moved: string[] = [];
  const skipped: string[] = [];

  for (const name of LEGACY_DOTFILES) {
    const from = join(peaksDir, name);
    const to = join(stateDir, name);
    if (!existsSync(from)) continue;
    if (existsSync(to)) {
      throw new Error(
        `DOTFILE_COLLISION: ${name} already exists in ${stateDir} (${readFileSync(to, 'utf8').length} bytes); refusing to overwrite`
      );
    }
    renameSync(from, to);
    moved.push(name);
  }
  return { moved, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/workspace-state-service.test.ts`
Expected: PASS (8 tests including 2 test.each entries)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/workspace/workspace-state-service.ts tests/unit/workspace-state-service.test.ts
git commit -m "feat(workspace): _state/ service to collect legacy decision dotfiles (Slice 0.5 Task 4)"
```

---

## Task 5: SID naming guard (two-axis convention enforcement)

**Files:**
- Create: `src/services/workspace/sid-naming-guard.ts`
- Create: `tests/unit/sid-naming-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sid-naming-guard.test.ts
import { describe, expect, test } from 'vitest';
import {
  isValidSessionId,
  isValidChangeId,
  isBareSid,
  assertValidSessionId,
  assertValidChangeId,
  SID_FORMAT_DESCRIPTION,
} from '../../src/services/workspace/sid-naming-guard.js';

describe('isValidSessionId', () => {
  test.each([
    '2026-06-11-session-abc123',
    '2026-06-10-session-f3a9b2',
    '2025-12-31-session-001',
  ])('accepts %s', (sid) => {
    expect(isValidSessionId(sid)).toBe(true);
  });

  test.each([
    'sid-3',
    'sid-h',
    'sid-r',
    'unknown-sid',
    '2026-06-11',
    '2026-6-11-session-abc',
    'session-abc',
    '2026-06-11-session-',
    '2026-06-11-session-ABCD',
    '2026-13-11-session-abc',
    '2026-06-32-session-abc',
    'foo-bar-baz',
    '',
  ])('rejects %s', (sid) => {
    expect(isValidSessionId(sid)).toBe(false);
  });
});

describe('isValidChangeId', () => {
  test('accepts canonical kebab-case', () => {
    expect(isValidChangeId('fuzzy-matching')).toBe(true);
    expect(isValidChangeId('r004-migrate-1-4-1')).toBe(true);
  });

  test('rejects empty / non-kebab', () => {
    expect(isValidChangeId('')).toBe(false);
    expect(isValidChangeId('CamelCase')).toBe(false);
    expect(isValidChangeId('snake_case')).toBe(false);
    expect(isValidChangeId('with space')).toBe(false);
  });
});

describe('isBareSid', () => {
  test('matches bare short forms observed in existing data', () => {
    expect(isBareSid('sid-3')).toBe(true);
    expect(isBareSid('sid-h')).toBe(true);
    expect(isBareSid('sid-r')).toBe(true);
    expect(isBareSid('unknown-sid')).toBe(true);
  });

  test('does not match canonical sids', () => {
    expect(isBareSid('2026-06-11-session-abc123')).toBe(false);
    expect(isBareSid('session')).toBe(false);
  });
});

describe('assertValidSessionId', () => {
  test('throws NAMING_INVALID on bad sid with descriptive message', () => {
    expect(() => assertValidSessionId('sid-3')).toThrow(/NAMING_INVALID.*sid-3/);
  });

  test('returns void on valid sid', () => {
    expect(assertValidSessionId('2026-06-11-session-abc123')).toBeUndefined();
  });
});

describe('assertValidChangeId', () => {
  test('throws on invalid change id', () => {
    expect(() => assertValidChangeId('BadName')).toThrow(/NAMING_INVALID/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/sid-naming-guard.test.ts`
Expected: FAIL with module-not-found error

- [ ] **Step 3: Implement the guard**

```typescript
// src/services/workspace/sid-naming-guard.ts
/**
 * SID naming guard. Enforces the "two-axis" convention from spec §0:
 *   session id: YYYY-MM-DD-session-<6chars-lowercase-alnum>
 *   change id:  kebab-case
 *
 * Spec §8.7 — bare forms (sid-3 / sid-h / sid-r / unknown-sid) are
 * migrated to `_archive/invalid-sids/`, NOT tolerated.
 */

export const SID_FORMAT_DESCRIPTION =
  '<YYYY-MM-DD>-session-<6chars lowercase alnum>, e.g. 2026-06-11-session-abc123';

const VALID_SID_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-session-[0-9a-z]{6}$/;
const BARE_SID_REGEX = /^(sid-[a-z0-9]+|unknown-sid)$/;
const VALID_CHANGE_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSessionId(sid: string): boolean {
  return VALID_SID_REGEX.test(sid);
}

export function isValidChangeId(cid: string): boolean {
  return VALID_CHANGE_ID_REGEX.test(cid);
}

export function isBareSid(name: string): boolean {
  return BARE_SID_REGEX.test(name);
}

export function assertValidSessionId(sid: string): void {
  if (!isValidSessionId(sid)) {
    throw new Error(
      `NAMING_INVALID: session id "${sid}" does not match required format ${SID_FORMAT_DESCRIPTION}`
    );
  }
}

export function assertValidChangeId(cid: string): void {
  if (!isValidChangeId(cid)) {
    throw new Error(
      `NAMING_INVALID: change id "${cid}" must be kebab-case (lowercase alnum and dashes only)`
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/sid-naming-guard.test.ts`
Expected: PASS (~22 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/workspace/sid-naming-guard.ts tests/unit/sid-naming-guard.test.ts
git commit -m "feat(workspace): SID naming guard enforcing two-axis convention (Slice 0.5 Task 5)"
```

---

## Task 6: Workspace clean service — `_runtime/` TTL-based

**Files:**
- Modify: `src/services/workspace/workspace-clean-service.ts` (new file)
- Create: `tests/unit/workspace-clean-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/workspace-clean-runtime.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  listRuntimeSessions,
  planRuntimeCleanup,
  executeRuntimeCleanup,
  type RuntimeSessionInfo,
} from '../../src/services/workspace/workspace-clean-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-clean-runtime-'));
}

function touchDir(path: string, ageHours: number): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'marker.txt'), 'x', 'utf8');
  const ageSec = ageHours * 3600;
  const past = new Date(Date.now() - ageSec * 1000);
  utimesSync(path, past, past);
  utimesSync(join(path, 'marker.txt'), past, past);
}

describe('listRuntimeSessions', () => {
  test('returns all _runtime/<sid> dirs with mtime', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, '2026-06-10-session-aaa111'), 48);
      touchDir(join(runtimeDir, '2026-06-11-session-bbb222'), 1);
      const list = listRuntimeSessions(project);
      expect(list).toHaveLength(2);
      const names = list.map((s) => s.sid).sort();
      expect(names).toEqual(['2026-06-10-session-aaa111', '2026-06-11-session-bbb222']);
      expect(list[0]?.ageHours).toBeGreaterThan(40);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns empty array when _runtime/ does not exist', () => {
    const project = makeProject();
    try {
      expect(listRuntimeSessions(project)).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('planRuntimeCleanup', () => {
  test('identifies sessions older than threshold as eligible', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, 'old-sid'), 100);
      touchDir(join(runtimeDir, 'fresh-sid'), 1);
      const sessions: RuntimeSessionInfo[] = listRuntimeSessions(project);
      const plan = planRuntimeCleanup(sessions, { olderThanHours: 24, graceHours: 24 });
      expect(plan.eligible).toEqual(['old-sid']);
      expect(plan.skipped).toHaveLength(1);
      expect(plan.skipped[0]?.sid).toBe('fresh-sid');
      expect(plan.skipped[0]?.reason).toMatch(/fresh/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('executeRuntimeCleanup', () => {
  test('dry-run does not delete, only reports', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, 'old-sid'), 100);
      const result = executeRuntimeCleanup(project, { olderThanHours: 24, graceHours: 24, apply: false });
      expect(result.deleted).toEqual(['old-sid']);
      expect(existsSync(join(runtimeDir, 'old-sid'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply actually deletes eligible sessions', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, 'old-sid'), 100);
      const result = executeRuntimeCleanup(project, { olderThanHours: 24, graceHours: 24, apply: true });
      expect(result.deleted).toEqual(['old-sid']);
      expect(existsSync(join(runtimeDir, 'old-sid'))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/workspace-clean-runtime.test.ts`
Expected: FAIL with module-not-found error

- [ ] **Step 3: Implement clean service (runtime portion)**

```typescript
// src/services/workspace/workspace-clean-service.ts
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RuntimeSessionInfo {
  sid: string;
  mtimeMs: number;
  ageHours: number;
}

export interface CleanupOptions {
  olderThanHours: number;
  graceHours: number;
}

export interface CleanupResult {
  deleted: string[];
  skipped: { sid: string; reason: string }[];
}

const RUNTIME_DIR = '_runtime';

export function runtimeDirPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', RUNTIME_DIR);
}

export function listRuntimeSessions(projectRoot: string): RuntimeSessionInfo[] {
  const dir = runtimeDirPath(projectRoot);
  if (!existsSync(dir)) return [];
  const now = Date.now();
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const sid = e.name;
      const fullPath = join(dir, sid);
      const stat = statSync(fullPath);
      const ageHours = (now - stat.mtimeMs) / (1000 * 3600);
      return { sid, mtimeMs: stat.mtimeMs, ageHours };
    });
}

export function planRuntimeCleanup(
  sessions: RuntimeSessionInfo[],
  options: CleanupOptions
): { eligible: string[]; skipped: { sid: string; reason: string }[] } {
  const eligible: string[] = [];
  const skipped: { sid: string; reason: string }[] = [];
  const cutoffHours = options.olderThanHours + options.graceHours;
  for (const s of sessions) {
    if (s.ageHours >= cutoffHours) {
      eligible.push(s.sid);
    } else {
      skipped.push({ sid: s.sid, reason: `fresh: age=${s.ageHours.toFixed(1)}h < cutoff=${cutoffHours}h` });
    }
  }
  return { eligible, skipped };
}

export function executeRuntimeCleanup(
  projectRoot: string,
  options: CleanupOptions & { apply: boolean }
): CleanupResult {
  const sessions = listRuntimeSessions(projectRoot);
  const plan = planRuntimeCleanup(sessions, options);
  if (options.apply) {
    const dir = runtimeDirPath(projectRoot);
    for (const sid of plan.eligible) {
      rmSync(join(dir, sid), { recursive: true, force: true });
    }
  }
  return { deleted: plan.eligible, skipped: plan.skipped };
}

// Placeholder for sub-agents clean — implemented in Task 7
export interface SubAgentInvalidPlan {
  invalid: string[];
  invalidSidFormat: string[];
}

export function listInvalidSubAgentSids(_projectRoot: string): string[] {
  // Filled in by Task 7
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/workspace-clean-runtime.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/workspace/workspace-clean-service.ts tests/unit/workspace-clean-runtime.test.ts
git commit -m "feat(workspace): clean service for _runtime/ with TTL + dry-run (Slice 0.5 Task 6)"
```

---

## Task 7: Workspace clean service — `_sub_agents/` invalid sids

**Files:**
- Modify: `src/services/workspace/workspace-clean-service.ts` (extend)
- Create: `tests/unit/workspace-clean-subagents.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/workspace-clean-subagents.test.ts
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  listInvalidSubAgentSids,
  executeSubAgentClean,
} from '../../src/services/workspace/workspace-clean-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-clean-subagents-'));
}

describe('listInvalidSubAgentSids', () => {
  test('returns bare sids (sid-3 / sid-h / sid-r / unknown-sid)', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks/_sub_agents');
      mkdirSync(dir, { recursive: true });
      for (const name of ['sid-3', 'sid-h', 'sid-r', 'unknown-sid', '2026-06-11-session-aaa111']) {
        mkdirSync(join(dir, name));
      }
      const invalid = listInvalidSubAgentSids(project);
      expect(invalid.sort()).toEqual(['sid-3', 'sid-h', 'sid-r', 'unknown-sid']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns empty when _sub_agents/ does not exist', () => {
    const project = makeProject();
    try {
      expect(listInvalidSubAgentSids(project)).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('executeSubAgentClean', () => {
  test('dry-run: does not move files, only reports', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks/_sub_agents');
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, 'sid-3'));
      const result = executeSubAgentClean(project, { apply: false });
      expect(result.moved).toEqual(['sid-3']);
      expect(existsSync(join(dir, 'sid-3'))).toBe(true);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-3'))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: moves invalid sids to _archive/invalid-sids/ (does not delete)', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks/_sub_agents');
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, 'sid-3'));
      mkdirSync(join(dir, 'sid-h'));
      const result = executeSubAgentClean(project, { apply: true });
      expect(result.moved.sort()).toEqual(['sid-3', 'sid-h']);
      expect(existsSync(join(dir, 'sid-3'))).toBe(false);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-3'))).toBe(true);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-h'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/workspace-clean-subagents.test.ts`
Expected: FAIL (the import from clean-service.ts for sub-agent functions returns `[]`, failing the dry-run expectation of `['sid-3']`)

- [ ] **Step 3: Implement sub-agent clean functions**

Edit `src/services/workspace/workspace-clean-service.ts` — replace the placeholder `listInvalidSubAgentSids` and add `executeSubAgentClean`:

```typescript
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isBareSid, isValidSessionId } from './sid-naming-guard.js';

// ... keep existing exports

const SUBAGENT_DIR = '_sub_agents';
const INVALID_ARCHIVE = '_archive/invalid-sids';

export function subAgentDirPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', SUBAGENT_DIR);
}

export function invalidSidsArchivePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', INVALID_ARCHIVE);
}

export function listInvalidSubAgentSids(projectRoot: string): string[] {
  const dir = subAgentDirPath(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => isBareSid(name) || !isValidSessionId(name));
}

export function executeSubAgentClean(
  projectRoot: string,
  options: { apply: boolean }
): { moved: string[]; skipped: string[] } {
  const invalid = listInvalidSubAgentSids(projectRoot);
  if (!options.apply || invalid.length === 0) {
    return { moved: options.apply ? invalid : invalid, skipped: [] };
  }
  const archiveDir = invalidSidsArchivePath(projectRoot);
  mkdirSync(archiveDir, { recursive: true });
  const moved: string[] = [];
  for (const sid of invalid) {
    const from = join(subAgentDirPath(projectRoot), sid);
    const to = join(archiveDir, sid);
    if (existsSync(to)) {
      // collision — append timestamp suffix
      const stamped = `${sid}-${Date.now()}`;
      renameSync(from, join(archiveDir, stamped));
    } else {
      renameSync(from, to);
    }
    moved.push(sid);
  }
  return { moved, skipped: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/workspace-clean-subagents.test.ts && pnpm vitest run tests/unit/workspace-clean-runtime.test.ts`
Expected: PASS (5 tests in sub-agents + 5 still passing in runtime)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/workspace/workspace-clean-service.ts tests/unit/workspace-clean-subagents.test.ts
git commit -m "feat(workspace): clean _sub_agents/ invalid sids to _archive/invalid-sids/ (Slice 0.5 Task 7)"
```

---

## Task 8: Workspace archive service (session → `_archive/<yyyy-mm>/<sid>/`)

**Files:**
- Create: `src/services/workspace/workspace-archive-service.ts`
- Create: `tests/unit/workspace-archive-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/workspace-archive-service.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  archiveSession,
  planArchive,
} from '../../src/services/workspace/workspace-archive-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-archive-'));
}

describe('planArchive', () => {
  test('returns target path under _archive/<yyyy-mm>/<sid>/', () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, '.peaks/_runtime/2026-06-10-session-aaa111/rd'), { recursive: true });
      const plan = planArchive(project, '2026-06-10-session-aaa111');
      expect(plan.targetPath).toMatch(/\.peaks\/_archive\/2026-06\/2026-06-10-session-aaa111$/);
      expect(plan.sourceExists).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns sourceExists=false when source missing', () => {
    const project = makeProject();
    try {
      const plan = planArchive(project, '2026-06-11-session-bbb222');
      expect(plan.sourceExists).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('archiveSession', () => {
  test('dry-run: does not move, only reports', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      const src = join(project, '.peaks/_runtime', sid);
      mkdirSync(join(src, 'rd'), { recursive: true });
      writeFileSync(join(src, 'rd/tech-doc.md'), '# tech', 'utf8');
      const result = archiveSession(project, { sid, apply: false });
      expect(result.moved).toEqual([]);
      expect(existsSync(src)).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: moves _runtime/<sid>/ → _archive/2026-06/<sid>/', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      const src = join(project, '.peaks/_runtime', sid);
      mkdirSync(join(src, 'rd'), { recursive: true });
      writeFileSync(join(src, 'rd/tech-doc.md'), '# tech', 'utf8');
      const result = archiveSession(project, { sid, apply: true });
      expect(result.moved).toEqual([sid]);
      expect(existsSync(src)).toBe(false);
      const target = join(project, '.peaks/_archive/2026-06', sid);
      expect(existsSync(target)).toBe(true);
      expect(existsSync(join(target, 'rd/tech-doc.md'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws NAMING_INVALID when sid is not a canonical session id', () => {
    const project = makeProject();
    try {
      expect(() => archiveSession(project, { sid: 'sid-3', apply: true })).toThrow(/NAMING_INVALID/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/workspace-archive-service.test.ts`
Expected: FAIL with module-not-found error

- [ ] **Step 3: Implement archive service**

```typescript
// src/services/workspace/workspace-archive-service.ts
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { assertValidSessionId } from './sid-naming-guard.js';

export interface ArchivePlan {
  sid: string;
  sourcePath: string;
  targetPath: string;
  sourceExists: boolean;
}

export interface ArchiveOptions {
  sid: string;
  apply: boolean;
}

export interface ArchiveResult {
  moved: string[];
  skipped: { sid: string; reason: string }[];
}

const ARCHIVE_ROOT = '_archive';
const RUNTIME_DIR = '_runtime';

export function planArchive(projectRoot: string, sid: string): ArchivePlan {
  assertValidSessionId(sid);
  const yyyyMm = sid.slice(0, 7);
  const sourcePath = join(projectRoot, '.peaks', RUNTIME_DIR, sid);
  const targetPath = join(projectRoot, '.peaks', ARCHIVE_ROOT, yyyyMm, sid);
  return { sid, sourcePath, targetPath, sourceExists: existsSync(sourcePath) };
}

export function archiveSession(projectRoot: string, options: ArchiveOptions): ArchiveResult {
  const plan = planArchive(projectRoot, options.sid);
  if (!plan.sourceExists) {
    return { moved: [], skipped: [{ sid: options.sid, reason: 'source does not exist' }] };
  }
  if (!options.apply) {
    return { moved: [], skipped: [{ sid: options.sid, reason: 'dry-run' }] };
  }
  mkdirSync(join(plan.targetPath, '..'), { recursive: true });
  renameSync(plan.sourcePath, plan.targetPath);
  return { moved: [options.sid], skipped: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/workspace-archive-service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/workspace/workspace-archive-service.ts tests/unit/workspace-archive-service.test.ts
git commit -m "feat(workspace): archive session _runtime/<sid>/ to _archive/<yyyy-mm>/<sid>/ (Slice 0.5 Task 8)"
```

---

## Task 9: Workspace CLI commands (`peaks workspace {clean,archive}`)

**Files:**
- Modify: `src/cli/commands/workspace-commands.ts` (register clean/archive subcommands)
- Create: `tests/integration/workspace-clean-cli.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/integration/workspace-clean-cli.test.ts
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-ws-cli-'));
}

function cli(args: string, cwd: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(`node ${process.cwd()}/dist/cli/program.js ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; status: number };
    return { stdout: e.stdout ?? '', code: e.status ?? 1 };
  }
}

function touchDir(path: string, ageHours: number): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'marker.txt'), 'x', 'utf8');
  const past = new Date(Date.now() - ageHours * 3600 * 1000);
  utimesSync(path, past, past);
  utimesSync(join(path, 'marker.txt'), past, past);
}

describe('peaks workspace clean CLI', () => {
  test('peaks workspace clean --runtime reports JSON envelope with dry-run default', () => {
    const project = makeProject();
    try {
      touchDir(join(project, '.peaks/_runtime/2026-06-10-session-aaa111'), 100);
      const { stdout, code } = cli(`workspace clean --runtime --older-than 24 --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(true);
      expect(out.data.dryRun).toBe(true);
      expect(out.data.deleted).toEqual(['2026-06-10-session-aaa111']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks workspace clean --runtime --apply actually deletes', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      touchDir(join(project, '.peaks/_runtime', sid), 100);
      const { stdout, code } = cli(`workspace clean --runtime --older-than 24 --apply --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.data.dryRun).toBe(false);
      const { existsSync } = require('node:fs');
      expect(existsSync(join(project, '.peaks/_runtime', sid))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks workspace clean --sub-agents --invalid --apply moves bare sids to archive', () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, '.peaks/_sub_agents/sid-3'), { recursive: true });
      const { stdout, code } = cli(`workspace clean --sub-agents --invalid --apply --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.data.moved).toEqual(['sid-3']);
      const { existsSync } = require('node:fs');
      expect(existsSync(join(project, '.peaks/_sub_agents/sid-3'))).toBe(false);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-3'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('peaks workspace archive CLI', () => {
  test('peaks workspace archive moves _runtime/<sid>/ to _archive/<yyyy-mm>/<sid>/', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      mkdirSync(join(project, '.peaks/_runtime', sid, 'rd'), { recursive: true });
      writeFileSync(join(project, '.peaks/_runtime', sid, 'rd/tech-doc.md'), '# tech', 'utf8');
      const { code } = cli(`workspace archive --session ${sid} --apply --json`, project);
      expect(code).toBe(0);
      const { existsSync } = require('node:fs');
      expect(existsSync(join(project, '.peaks/_runtime', sid))).toBe(false);
      expect(existsSync(join(project, '.peaks/_archive/2026-06', sid, 'rd/tech-doc.md'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/workspace-clean-cli.test.ts`
Expected: FAIL (subcommands not registered)

- [ ] **Step 3: Implement the CLI commands**

Find `src/cli/commands/workspace-commands.ts`. Add the following imports and registrations (if file is empty/just a stub, replace its body):

```typescript
// src/cli/commands/workspace-commands.ts
import type { Command } from 'commander';
import {
  executeRuntimeCleanup,
  executeSubAgentClean,
} from '../../services/workspace/workspace-clean-service.js';
import { archiveSession } from '../../services/workspace/workspace-archive-service.js';

export function registerWorkspaceCommands(program: Command): void {
  const ws = program.command('workspace').description('Manage workspace state');

  ws
    .command('clean')
    .description('Clean stale or invalid workspace artifacts (dry-run by default; --apply to commit)')
    .option('--runtime', 'clean _runtime/ sessions older than --older-than')
    .option('--sub-agents', 'clean _sub_agents/ entries')
    .option('--invalid', 'with --sub-agents: only move bare/invalid sids to _archive/invalid-sids/')
    .option('--older-than <hours>', 'age threshold (default 168 = 7d)', '168')
    .option('--grace-hours <hours>', 'safety grace period (default 24)', '24')
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: {
      runtime?: boolean;
      subAgents?: boolean;
      invalid?: boolean;
      olderThan: string;
      graceHours: string;
      apply?: boolean;
      project: string;
      json?: boolean;
    }) => {
      try {
        const apply = opts.apply === true;
        const envelopes: unknown[] = [];
        if (opts.runtime) {
          const result = executeRuntimeCleanup(opts.project, {
            olderThanHours: parseInt(opts.olderThan, 10),
            graceHours: parseInt(opts.graceHours, 10),
            apply,
          });
          envelopes.push({ dryRun: !apply, deleted: result.deleted, skipped: result.skipped });
        }
        if (opts.subAgents && opts.invalid) {
          const result = executeSubAgentClean(opts.project, { apply });
          envelopes.push({ dryRun: !apply, moved: result.moved, skipped: result.skipped });
        }
        process.stdout.write(JSON.stringify({ ok: true, data: envelopes }) + '\n');
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });

  ws
    .command('archive')
    .description('Archive a session from _runtime/ to _archive/<yyyy-mm>/')
    .requiredOption('--session <sid>', 'session id (must match YYYY-MM-DD-session-XXXXXX)')
    .option('--apply', 'actually move (default is dry-run)')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: { session: string; apply?: boolean; project: string; json?: boolean }) => {
      try {
        const result = archiveSession(opts.project, { sid: opts.session, apply: opts.apply === true });
        process.stdout.write(
          JSON.stringify({ ok: true, data: { dryRun: opts.apply !== true, moved: result.moved, skipped: result.skipped } }) + '\n'
        );
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });
}
```

Add to `src/cli/program.ts` (if not already present):

```typescript
import { registerWorkspaceCommands } from './commands/workspace-commands.js';
// ...
registerWorkspaceCommands(program);
```

- [ ] **Step 4: Build + run tests**

Run: `pnpm build && pnpm vitest run tests/integration/workspace-clean-cli.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/workspace-commands.ts src/cli/program.ts tests/integration/workspace-clean-cli.test.ts
git commit -m "feat(workspace): CLI commands clean/archive with JSON envelope (Slice 0.5 Task 9)"
```

---

## Task 10: Config migration service (1.x → 2.0, YAGNI)

**Files:**
- Create: `src/services/config/config-migration.ts`
- Create: `tests/unit/config-migration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/config-migration.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  planMigration,
  executeMigration,
  CONFIG_SCHEMA_VERSION_V2,
} from '../../src/services/config/config-migration.js';

let HOME_DIR: string;
const origHome = process.env.HOME;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-home-'));
  process.env.HOME = HOME_DIR;
  // On Windows: process.env.USERPROFILE is also relevant
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function writeGlobalConfig_1x(obj: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(obj), 'utf8');
}

function makeProjectWithPreferences(): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-mig-proj-'));
  mkdirSync(join(project, '.peaks'), { recursive: true });
  writeFileSync(join(project, '.peaks/preferences.json'), '{}', 'utf8');
  return project;
}

describe('planMigration', () => {
  test('1.x → 2.0 plan: split fields, slim config.json, backup', () => {
    writeGlobalConfig_1x({
      version: '1.4.2',
      currentWorkspace: '/proj',
      workspaces: [],
      language: 'zh',
      model: 'sonnet',
      economyMode: true,
      swarmMode: false,
      tokens: {},
      providers: {},
      proxy: {},
    });
    const project = makeProjectWithPreferences();
    try {
      const plan = planMigration({ currentProjectRoot: project });
      expect(plan.willMigrateFields).toContain('economyMode');
      expect(plan.willMigrateFields).toContain('swarmMode');
      expect(plan.willKeepFields).toEqual([]);
      expect(plan.willArchiveFields).toContain('currentWorkspace');
      expect(plan.willArchiveFields).toContain('workspaces');
      expect(plan.willArchiveFields).toContain('language');
      expect(plan.willArchiveFields).toContain('model');
      expect(plan.willArchiveFields).toContain('tokens');
      expect(plan.willArchiveFields).toContain('providers');
      expect(plan.willArchiveFields).toContain('proxy');
      expect(plan.newConfigSchemaVersion).toBe(CONFIG_SCHEMA_VERSION_V2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('already 2.0 config returns no-op plan', () => {
    const dir = join(HOME_DIR, '.peaks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: '2.0.0' }), 'utf8');
    const project = makeProjectWithPreferences();
    try {
      const plan = planMigration({ currentProjectRoot: project });
      expect(plan.alreadyAtV2).toBe(true);
      expect(plan.willArchiveFields).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('executeMigration', () => {
  test('dry-run: does not write', () => {
    writeGlobalConfig_1x({
      version: '1.4.2',
      economyMode: true,
      swarmMode: true,
    });
    const project = makeProjectWithPreferences();
    try {
      const result = executeMigration({ currentProjectRoot: project, apply: false });
      expect(result.applied).toBe(false);
      const v1File = join(HOME_DIR, '.peaks/config.json');
      const before = readFileSync(v1File, 'utf8');
      expect(before).toContain('1.4.2');
      expect(existsSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: backups 1.x, writes slim 2.0 config.json, migrates per-project fields', () => {
    writeGlobalConfig_1x({
      version: '1.4.2',
      economyMode: true,
      swarmMode: false,
      currentWorkspace: '/proj',
      workspaces: [],
      language: 'zh',
      model: 'sonnet',
      tokens: {},
      providers: {},
      proxy: {},
    });
    const project = makeProjectWithPreferences();
    try {
      const result = executeMigration({ currentProjectRoot: project, apply: true });
      expect(result.applied).toBe(true);
      const newConfig = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
      expect(newConfig).toEqual({ version: '2.0.0' });

      const bak = readFileSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'), 'utf8');
      expect(bak).toContain('1.4.2');
      expect(bak).toContain('currentWorkspace');

      const prefs = JSON.parse(readFileSync(join(project, '.peaks/preferences.json'), 'utf8'));
      expect(prefs.swarmMode).toBe(false);
      expect(prefs.economyMode).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: throws NO_CONFIG when ~/.peaks/config.json is missing', () => {
    const project = makeProjectWithPreferences();
    try {
      expect(() => executeMigration({ currentProjectRoot: project, apply: true })).toThrow(/NO_CONFIG/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config-migration.test.ts`
Expected: FAIL with module-not-found error

- [ ] **Step 3: Implement migration service**

```typescript
// src/services/config/config-migration.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadPreferences, savePreferences } from '../preferences/preferences-service.js';

export const CONFIG_SCHEMA_VERSION_V2 = '2.0.0';
const BACKUP_NAME = 'config.json.1.x.bak';

const PER_PROJECT_FIELDS = ['economyMode', 'swarmMode'] as const;
const ARCHIVED_FIELDS = [
  'currentWorkspace',
  'workspaces',
  'language',
  'model',
  'tokens',
  'providers',
  'proxy',
] as const;

export interface MigrationOptions {
  currentProjectRoot: string;
}

export interface MigrationPlan {
  alreadyAtV2: boolean;
  detectedSchemaVersion: string | null;
  willMigrateFields: string[];
  willKeepFields: string[];
  willArchiveFields: string[];
  newConfigSchemaVersion: string;
  preferencesTarget: string;
}

export interface MigrationResult extends MigrationPlan {
  applied: boolean;
  backupPath?: string;
  newConfigPath?: string;
  error?: string;
}

export function globalConfigPath(): string {
  return join(homedir(), '.peaks', 'config.json');
}

export function backupConfigPath(): string {
  return join(homedir(), '.peaks', BACKUP_NAME);
}

export function planMigration(opts: MigrationOptions): MigrationPlan {
  const configPath = globalConfigPath();
  let detectedSchemaVersion: string | null = null;
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    detectedSchemaVersion = (raw.version as string) ?? null;
  }
  if (detectedSchemaVersion === CONFIG_SCHEMA_VERSION_V2) {
    return {
      alreadyAtV2: true,
      detectedSchemaVersion,
      willMigrateFields: [],
      willKeepFields: [],
      willArchiveFields: [],
      newConfigSchemaVersion: CONFIG_SCHEMA_VERSION_V2,
      preferencesTarget: join(opts.currentProjectRoot, '.peaks/preferences.json'),
    };
  }
  return {
    alreadyAtV2: false,
    detectedSchemaVersion,
    willMigrateFields: [...PER_PROJECT_FIELDS],
    willKeepFields: ['version'],
    willArchiveFields: [...ARCHIVED_FIELDS],
    newConfigSchemaVersion: CONFIG_SCHEMA_VERSION_V2,
    preferencesTarget: join(opts.currentProjectRoot, '.peaks/preferences.json'),
  };
}

export function executeMigration(opts: MigrationOptions & { apply: boolean }): MigrationResult {
  const configPath = globalConfigPath();
  if (!existsSync(configPath)) {
    throw new Error('NO_CONFIG: ~/.peaks/config.json not found');
  }
  const plan = planMigration(opts);
  if (plan.alreadyAtV2) {
    return { ...plan, applied: false };
  }
  if (!opts.apply) {
    return { ...plan, applied: false };
  }
  const original = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  // 1. Backup
  const bak = backupConfigPath();
  writeFileSync(bak, JSON.stringify(original, null, 2) + '\n', 'utf8');
  // 2. Slim config.json
  mkdirSync(join(homedir(), '.peaks'), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ version: CONFIG_SCHEMA_VERSION_V2 }, null, 2) + '\n', 'utf8');
  // 3. Migrate per-project fields
  const overrides: Record<string, unknown> = {};
  for (const field of PER_PROJECT_FIELDS) {
    if (field in original) {
      overrides[field] = original[field];
    }
  }
  if (Object.keys(overrides).length > 0) {
    // Ensure preferences.json exists with overrides
    if (!existsSync(plan.preferencesTarget)) {
      mkdirSync(join(plan.preferencesTarget, '..'), { recursive: true });
    }
    savePreferences(opts.currentProjectRoot, overrides as never);
  }
  return { ...plan, applied: true, backupPath: bak, newConfigPath: configPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config-migration.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/config/config-migration.ts tests/unit/config-migration.test.ts
git commit -m "feat(config): migration service 1.x→2.0 YAGNI (slim + per-project + backup) (Slice 0.5 Task 10)"
```

---

## Task 11: Config rollback service (restore from `.bak`)

**Files:**
- Create: `src/services/config/config-rollback.ts`
- Create: `tests/unit/config-rollback.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/config-rollback.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { executeRollback, planRollback } from '../../src/services/config/config-rollback.js';

let HOME_DIR: string;
const origHome = process.env.HOME;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-rb-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function writeSlimV2(): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: '2.0.0' }), 'utf8');
}
function writeBak(content: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json.1.x.bak'), JSON.stringify(content), 'utf8');
}

describe('planRollback', () => {
  test('returns available=true when .bak exists', () => {
    writeSlimV2();
    writeBak({ version: '1.4.2', economyMode: true });
    const plan = planRollback();
    expect(plan.available).toBe(true);
    expect(plan.detectedVersion).toBe('1.4.2');
  });

  test('returns available=false when no .bak', () => {
    writeSlimV2();
    const plan = planRollback();
    expect(plan.available).toBe(false);
  });
});

describe('executeRollback', () => {
  test('dry-run does not write', () => {
    writeSlimV2();
    writeBak({ version: '1.4.2', economyMode: true });
    const result = executeRollback({ apply: false });
    expect(result.applied).toBe(false);
    const cur = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
    expect(cur.version).toBe('2.0.0');
  });

  test('apply restores config.json from .bak', () => {
    writeSlimV2();
    const originalBak = { version: '1.4.2', economyMode: true, swarmMode: false };
    writeBak(originalBak);
    const result = executeRollback({ apply: true });
    expect(result.applied).toBe(true);
    const restored = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
    expect(restored).toEqual(originalBak);
  });

  test('throws NO_BACKUP when .bak missing', () => {
    writeSlimV2();
    expect(() => executeRollback({ apply: true })).toThrow(/NO_BACKUP/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config-rollback.test.ts`
Expected: FAIL with module-not-found error

- [ ] **Step 3: Implement rollback service**

```typescript
// src/services/config/config-rollback.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { backupConfigPath, globalConfigPath } from './config-migration.js';

export interface RollbackPlan {
  available: boolean;
  detectedVersion: string | null;
  backupPath: string;
}

export interface RollbackResult extends RollbackPlan {
  applied: boolean;
  restoredConfigPath?: string;
}

export function planRollback(): RollbackPlan {
  const backup = backupConfigPath();
  if (!existsSync(backup)) {
    return { available: false, detectedVersion: null, backupPath: backup };
  }
  const raw = JSON.parse(readFileSync(backup, 'utf8')) as Record<string, unknown>;
  return {
    available: true,
    detectedVersion: (raw.version as string) ?? null,
    backupPath: backup,
  };
}

export function executeRollback(opts: { apply: boolean }): RollbackResult {
  const plan = planRollback();
  if (!plan.available) {
    throw new Error('NO_BACKUP: ~/.peaks/config.json.1.x.bak not found');
  }
  if (!opts.apply) {
    return { ...plan, applied: false };
  }
  const restored = JSON.parse(readFileSync(plan.backupPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(globalConfigPath(), JSON.stringify(restored, null, 2) + '\n', 'utf8');
  return { ...plan, applied: true, restoredConfigPath: globalConfigPath() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config-rollback.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/config/config-rollback.ts tests/unit/config-rollback.test.ts
git commit -m "feat(config): rollback service restoring from config.json.1.x.bak (Slice 0.5 Task 11)"
```

---

## Task 12: Config restore service (per-field from `.bak`)

**Files:**
- Create: `src/services/config/config-restore.ts`
- Create: `tests/unit/config-restore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/config-restore.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { restoreField, listAvailableFields } from '../../src/services/config/config-restore.js';

let HOME_DIR: string;
const origHome = process.env.HOME;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-restore-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function writeBak(content: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json.1.x.bak'), JSON.stringify(content), 'utf8');
}

describe('listAvailableFields', () => {
  test('returns all fields present in .bak', () => {
    writeBak({
      version: '1.4.2',
      economyMode: true,
      swarmMode: false,
      currentWorkspace: '/proj',
      workspaces: [],
      language: 'zh',
      model: 'sonnet',
      tokens: {},
      providers: {},
      proxy: {},
    });
    const fields = listAvailableFields();
    expect(fields.sort()).toEqual(
      ['currentWorkspace', 'economyMode', 'language', 'model', 'providers', 'proxy', 'swarmMode', 'tokens', 'workspaces'].sort()
    );
  });

  test('throws NO_BACKUP when .bak missing', () => {
    expect(() => listAvailableFields()).toThrow(/NO_BACKUP/);
  });
});

describe('restoreField', () => {
  test('writes a sidecar file restoring the named field', () => {
    writeBak({ version: '1.4.2', tokens: { anthropic: { api_key: 'sk-...' } } });
    const result = restoreField({ field: 'tokens', apply: true });
    expect(result.applied).toBe(true);
    const restoreFile = join(HOME_DIR, '.peaks/config.json.restore-tokens.json');
    const content = JSON.parse(readFileSync(restoreFile, 'utf8'));
    expect(content.field).toBe('tokens');
    expect(content.value).toEqual({ anthropic: { api_key: 'sk-...' } });
    expect(content.source).toBe('config.json.1.x.bak');
    expect(content.restoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('throws FIELD_NOT_FOUND when field missing from .bak', () => {
    writeBak({ version: '1.4.2' });
    expect(() => restoreField({ field: 'tokens', apply: true })).toThrow(/FIELD_NOT_FOUND/);
  });

  test('throws RESTORE_GUARDED when field is one of the v2-archived set we discourage (workspaces)', () => {
    writeBak({ version: '1.4.2', workspaces: [] });
    expect(() => restoreField({ field: 'workspaces', apply: true })).toThrow(/RESTORE_GUARDED/);
  });

  test('dry-run does not write sidecar', () => {
    writeBak({ version: '1.4.2', language: 'zh' });
    const result = restoreField({ field: 'language', apply: false });
    expect(result.applied).toBe(false);
    const restoreFile = join(HOME_DIR, '.peaks/config.json.restore-language.json');
    expect(existsSync(restoreFile)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config-restore.test.ts`
Expected: FAIL with module-not-found error

- [ ] **Step 3: Implement restore service**

```typescript
// src/services/config/config-restore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { backupConfigPath } from './config-migration.js';

/**
 * Spec §8.6 — restore a single archived field from `config.json.1.x.bak`.
 * Does NOT modify `config.json` itself (which is now slim v2).
 * Instead writes a sidecar `config.json.restore-<field>.json` so the user
 * can review before adopting. The 4 fields we actively discourage restoring
 * (workspaces, providers, network) throw RESTORE_GUARDED so the user has
 * to acknowledge explicitly.
 */

const GUARDED_FIELDS = new Set(['workspaces', 'providers', 'proxy', 'tokens']);

export interface RestoreResult {
  field: string;
  applied: boolean;
  sidecarPath?: string;
}

function readBakContent(): Record<string, unknown> {
  const bak = backupConfigPath();
  if (!existsSync(bak)) {
    throw new Error('NO_BACKUP: ~/.peaks/config.json.1.x.bak not found');
  }
  return JSON.parse(readFileSync(bak, 'utf8')) as Record<string, unknown>;
}

export function listAvailableFields(): string[] {
  const bak = readBakContent();
  return Object.keys(bak);
}

export function restoreField(opts: { field: string; apply: boolean }): RestoreResult {
  const bak = readBakContent();
  if (!(opts.field in bak)) {
    throw new Error(`FIELD_NOT_FOUND: ${opts.field} is not in config.json.1.x.bak`);
  }
  if (GUARDED_FIELDS.has(opts.field)) {
    throw new Error(
      `RESTORE_GUARDED: restoring "${opts.field}" is discouraged because the deferred design intentionally avoids it; add it to config.json manually if you really need it`
    );
  }
  const home = homedir();
  const sidecar = join(home, '.peaks', `config.json.restore-${opts.field}.json`);
  if (!opts.apply) {
    return { field: opts.field, applied: false };
  }
  mkdirSync(join(home, '.peaks'), { recursive: true });
  const payload = {
    field: opts.field,
    value: bak[opts.field],
    source: 'config.json.1.x.bak',
    restoredAt: new Date().toISOString(),
  };
  writeFileSync(sidecar, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { field: opts.field, applied: true, sidecarPath: sidecar };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config-restore.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/config/config-restore.ts tests/unit/config-restore.test.ts
git commit -m "feat(config): per-field restore from .bak with guarded fields (Slice 0.5 Task 12)"
```

---

## Task 13: Slim config-service schema (accept 2.0 = `{ version: "2.0.0" }` only)

**Files:**
- Modify: `src/services/config/config-types.ts` (add `ConfigV2` type)
- Modify: `src/services/config/config-service.ts` (accept v2 schema)

- [ ] **Step 1: Add `ConfigV2` type alongside existing 1.x types**

Edit `src/services/config/config-types.ts`. Locate the existing types (e.g. `CurrentWorkspaceConfig`, `Config` if present) and add the following at the bottom:

```typescript
// Add at the bottom of src/services/config/config-types.ts
import { CONFIG_SCHEMA_VERSION_V2 } from './config-migration.js';

export interface ConfigV2 {
  readonly version: typeof CONFIG_SCHEMA_VERSION_V2;
}

export function isConfigV2(raw: unknown): raw is ConfigV2 {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).version === CONFIG_SCHEMA_VERSION_V2
  );
}
```

- [ ] **Step 2: Modify `config-service.ts` to dispatch on schema version**

Find the `loadGlobalConfig` (or equivalent) function in `src/services/config/config-service.ts`. Wrap its body so it dispatches:

```typescript
import { isConfigV2 } from './config-types.js';
import { planMigration } from './config-migration.js';

export function loadGlobalConfig(): Record<string, unknown> | null {
  const path = globalConfigPath();
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (isConfigV2(raw)) {
    // 2.0 slim: only `version` is meaningful; everything else is in preferences.json or .bak
    return raw;
  }
  // Legacy 1.x: caller must migrate first
  throw new Error(
    `CONFIG_LEGACY_VERSION: ~/.peaks/config.json is at version "${(raw as Record<string, unknown>).version ?? 'unknown'}", expected 2.0.0. Run \`peaks config migrate --apply\`.`
  );
}
```

- [ ] **Step 3: Typecheck + run all unit tests**

Run: `pnpm typecheck && pnpm vitest run tests/unit/`
Expected: 0 errors, all existing tests pass (note: tests that previously expected 1.x schema behavior may need to set up 2.x fixtures; defer to existing service tests which should be unaffected if they don't load global config)

- [ ] **Step 4: Commit**

```bash
git add src/services/config/config-types.ts src/services/config/config-service.ts
git commit -m "feat(config): slim config-service accepts only 2.0 schema (Slice 0.5 Task 13)"
```

---

## Task 14: Config CLI commands (`peaks config {migrate,rollback,restore}`)

**Files:**
- Modify: `src/cli/commands/config-commands.ts` (register migrate/rollback/restore subcommands)

- [ ] **Step 1: Create the failing integration test**

```typescript
// tests/integration/config-migrate-cli.test.ts
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

let HOME_DIR: string;
const origHome = process.env.HOME;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-cfg-cli-home-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function cli(args: string, cwd: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(`node ${process.cwd()}/dist/cli/program.js ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; status: number };
    return { stdout: e.stdout ?? '', code: e.status ?? 1 };
  }
}

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-cfg-cli-proj-'));
  mkdirSync(join(project, '.peaks'), { recursive: true });
  return project;
}

function writeGlobal1x(obj: Record<string, unknown>): void {
  const dir = join(HOME_DIR, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(obj), 'utf8');
}

describe('peaks config migrate', () => {
  test('dry-run reports plan, does not write', () => {
    writeGlobal1x({ version: '1.4.2', economyMode: true, swarmMode: false });
    const project = makeProject();
    try {
      const { stdout, code } = cli(`config migrate --project ${project} --dry-run --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(true);
      expect(out.data.applied).toBe(false);
      expect(out.data.willMigrateFields).toContain('economyMode');
      const cfg = readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8');
      expect(cfg).toContain('1.4.2');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply slims config.json + writes preferences.json + creates .bak', () => {
    writeGlobal1x({ version: '1.4.2', economyMode: true, swarmMode: false, currentWorkspace: '/p' });
    const project = makeProject();
    try {
      const { stdout, code } = cli(`config migrate --project ${project} --apply --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.data.applied).toBe(true);
      const newCfg = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
      expect(newCfg).toEqual({ version: '2.0.0' });
      expect(existsSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'))).toBe(true);
      const prefs = JSON.parse(readFileSync(join(project, '.peaks/preferences.json'), 'utf8'));
      expect(prefs.swarmMode).toBe(false);
      expect(prefs.economyMode).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('peaks config rollback', () => {
  test('apply restores from .bak', () => {
    writeGlobal1x({ version: '1.4.2', economyMode: false });
    // Pre-migrate to create .bak + slim config
    const project = makeProject();
    try {
      cli(`config migrate --project ${project} --apply`, project);
      // Now restore
      const { code } = cli(`config rollback --apply --json`, project);
      expect(code).toBe(0);
      const restored = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
      expect(restored.version).toBe('1.4.2');
      expect(restored.economyMode).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws NO_BACKUP when no .bak', () => {
    writeGlobal1x({ version: '2.0.0' });
    const project = makeProject();
    try {
      const { code, stdout } = cli(`config rollback --apply --json`, project);
      expect(code).not.toBe(0);
      expect(stdout).toMatch(/NO_BACKUP/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('peaks config restore', () => {
  test('--field lists available fields when no .bak throws', () => {
    const project = makeProject();
    try {
      const { code, stdout } = cli(`config restore --list --json`, project);
      expect(code).not.toBe(0);
      expect(stdout).toMatch(/NO_BACKUP/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply restores language field to sidecar file', () => {
    writeGlobal1x({ version: '1.4.2', language: 'zh' });
    const project = makeProject();
    try {
      cli(`config migrate --project ${project} --apply`, project);
      const { code } = cli(`config restore --field language --apply --json`, project);
      expect(code).toBe(0);
      expect(existsSync(join(HOME_DIR, '.peaks/config.json.restore-language.json'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws RESTORE_GUARDED for workspaces field', () => {
    writeGlobal1x({ version: '1.4.2', workspaces: [] });
    const project = makeProject();
    try {
      cli(`config migrate --project ${project} --apply`, project);
      const { code, stdout } = cli(`config restore --field workspaces --apply --json`, project);
      expect(code).not.toBe(0);
      expect(stdout).toMatch(/RESTORE_GUARDED/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/config-migrate-cli.test.ts`
Expected: FAIL (subcommands not registered)

- [ ] **Step 3: Implement the CLI commands**

Find `src/cli/commands/config-commands.ts`. If it doesn't already have a `registerConfigCommands` exported function, add one with the following body. Otherwise, add the three subcommands:

```typescript
// src/cli/commands/config-commands.ts
import type { Command } from 'commander';
import { executeMigration, planMigration } from '../../services/config/config-migration.js';
import { executeRollback, planRollback } from '../../services/config/config-rollback.js';
import { listAvailableFields, restoreField } from '../../services/config/config-restore.js';

export function registerConfigCommands(program: Command): void {
  const cfg = program.command('config').description('Manage peaks-cli global config (~/.peaks/config.json)');

  cfg
    .command('migrate')
    .description('Migrate global config from 1.x to 2.0 (YAGNI slim + per-project fields)')
    .option('--project <path>', 'current project root (for migrating per-project fields)', process.cwd())
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--json', 'JSON envelope output')
    .action((opts: { project: string; apply?: boolean; json?: boolean }) => {
      try {
        const plan = planMigration({ currentProjectRoot: opts.project });
        if (opts.apply) {
          const result = executeMigration({ currentProjectRoot: opts.project, apply: true });
          process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + '\n');
        } else {
          process.stdout.write(JSON.stringify({ ok: true, data: { ...plan, applied: false } }, null, 2) + '\n');
        }
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });

  cfg
    .command('rollback')
    .description('Rollback global config to 1.x from .bak')
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--json', 'JSON envelope output')
    .action((opts: { apply?: boolean; json?: boolean }) => {
      try {
        if (opts.apply) {
          const result = executeRollback({ apply: true });
          process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + '\n');
        } else {
          const plan = planRollback();
          process.stdout.write(JSON.stringify({ ok: true, data: { ...plan, applied: false } }, null, 2) + '\n');
        }
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });

  cfg
    .command('restore')
    .description('Restore a single archived field from .bak to a sidecar file')
    .option('--field <name>', 'field name to restore (e.g. language, currentWorkspace)')
    .option('--list', 'list all fields available in .bak')
    .option('--apply', 'actually write sidecar (default is dry-run)')
    .option('--json', 'JSON envelope output')
    .action((opts: { field?: string; list?: boolean; apply?: boolean; json?: boolean }) => {
      try {
        if (opts.list || !opts.field) {
          const fields = listAvailableFields();
          process.stdout.write(JSON.stringify({ ok: true, data: { fields } }, null, 2) + '\n');
          return;
        }
        const result = restoreField({ field: opts.field, apply: opts.apply === true });
        process.stdout.write(JSON.stringify({ ok: true, data: result }, null, 2) + '\n');
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });
}
```

Add to `src/cli/program.ts` (if not already present):

```typescript
import { registerConfigCommands } from './commands/config-commands.js';
// ...
registerConfigCommands(program);
```

- [ ] **Step 4: Build + run tests**

Run: `pnpm build && pnpm vitest run tests/integration/config-migrate-cli.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/config-commands.ts src/cli/program.ts tests/integration/config-migrate-cli.test.ts
git commit -m "feat(config): CLI commands migrate/rollback/restore with JSON envelope (Slice 0.5 Task 14)"
```

---

## Task 15: End-to-end dogfood + slice handoff

**Files:**
- Create: `tests/integration/full-migration.test.ts`

- [ ] **Step 1: Write end-to-end dogfood test**

```typescript
// tests/integration/full-migration.test.ts
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

let HOME_DIR: string;
const origHome = process.env.HOME;
let PROJECT_DIR: string;

beforeEach(() => {
  HOME_DIR = mkdtempSync(join(tmpdir(), 'peaks-e2e-home-'));
  PROJECT_DIR = mkdtempSync(join(tmpdir(), 'peaks-e2e-proj-'));
  process.env.HOME = HOME_DIR;
  process.env.USERPROFILE = HOME_DIR;
});
afterEach(() => {
  rmSync(HOME_DIR, { recursive: true, force: true });
  rmSync(PROJECT_DIR, { recursive: true, force: true });
  process.env.HOME = origHome;
});

function cli(args: string): { stdout: string; code: number } {
  try {
    const stdout = execSync(`node ${process.cwd()}/dist/cli/program.js ${args}`, {
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; status: number };
    return { stdout: e.stdout ?? '', code: e.status ?? 1 };
  }
}

describe('Slice 0.5 End-to-End Dogfood', () => {
  test('full workflow: 1.x config → migrate → preferences → state → rollback', () => {
    // 1. Set up 1.x config
    writeFileSync(join(HOME_DIR, '.peaks/config.json'), JSON.stringify({
      version: '1.4.2',
      economyMode: true,
      swarmMode: false,
      currentWorkspace: '/some/proj',
      workspaces: [],
      language: 'zh',
      model: 'sonnet',
      tokens: {},
      providers: {},
      proxy: {},
    }), 'utf8');

    // Set up project with legacy decision dotfiles
    mkdirSync(join(PROJECT_DIR, '.peaks'), { recursive: true });
    writeFileSync(join(PROJECT_DIR, '.peaks/.peaks-init-hooks-decision.json'), '{"hooks":true}', 'utf8');
    writeFileSync(join(PROJECT_DIR, '.peaks/.peaks-openspec-opt-in.json'), '{"optIn":true}', 'utf8');

    // 2. Run workspace state collect (would be wired into a future workspace init command;
    //    for dogfood we invoke the service directly via a one-off node script if needed).
    //    Instead, manually verify the file structure after CLI commands.
    //    (For Slice 0.5 the legacy dotfile move is invoked via `peaks workspace init` flow;
    //     we leave it as future dogfood once init flow exists; focus here is config migration.)

    // 3. Migrate config
    const migrateResult = cli(`config migrate --project ${PROJECT_DIR} --apply --json`);
    expect(migrateResult.code).toBe(0);
    const migrateData = JSON.parse(migrateResult.stdout);
    expect(migrateData.data.applied).toBe(true);

    // 4. Verify slim config.json
    const newCfg = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
    expect(newCfg).toEqual({ version: '2.0.0' });

    // 5. Verify .bak has 1.x fields
    const bak = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'), 'utf8'));
    expect(bak.version).toBe('1.4.2');
    expect(bak.currentWorkspace).toBe('/some/proj');

    // 6. Verify preferences.json has per-project fields
    const prefs = JSON.parse(readFileSync(join(PROJECT_DIR, '.peaks/preferences.json'), 'utf8'));
    expect(prefs.swarmMode).toBe(false);
    expect(prefs.economyMode).toBe(true);

    // 7. Use preferences CLI to override
    cli(`preferences set --key uaPrompt --value skip-forever --project ${PROJECT_DIR} --json`);
    const updated = JSON.parse(readFileSync(join(PROJECT_DIR, '.peaks/preferences.json'), 'utf8'));
    expect(updated.uaPrompt).toBe('skip-forever');

    // 8. Restore archived field via sidecar
    cli(`config restore --field language --apply --json`);
    expect(existsSync(join(HOME_DIR, '.peaks/config.json.restore-language.json'))).toBe(true);

    // 9. Rollback to 1.x
    const rollbackResult = cli(`config rollback --apply --json`);
    expect(rollbackResult.code).toBe(0);
    const restored = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
    expect(restored.version).toBe('1.4.2');

    // 10. Re-migrate to verify idempotency / round-trip
    const reMigrate = cli(`config migrate --project ${PROJECT_DIR} --apply --json`);
    expect(reMigrate.code).toBe(0);
    const reMigratedCfg = JSON.parse(readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'));
    expect(reMigratedCfg).toEqual({ version: '2.0.0' });
  });
});
```

- [ ] **Step 2: Run end-to-end test**

Run: `pnpm vitest run tests/integration/full-migration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite to ensure no regressions**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: 0 failures, 0 type errors, 0 lint errors

- [ ] **Step 4: Build and verify CLI binary**

Run: `pnpm build && node dist/cli/program.js --help | head -40`
Expected: Help text shows `config` and `workspace` and `preferences` subcommands

- [ ] **Step 5: Slice handoff commit + push**

```bash
git add tests/integration/full-migration.test.ts
git commit -m "test(workspace+config): end-to-end migration round-trip dogfood (Slice 0.5 Task 15)"
git push -u origin chore/spec-l1-l2-l3-redesign-brainstorm
```

- [ ] **Step 6: Open PR / merge to main per dev-preference**

Per project conventions, follow the existing flow to merge the slice branch. Confirm with user before merging to main.

---

## Self-Review Checklist

After Task 15 completes, verify spec §10.4 AC:

- [x] `peaks config migrate --dry-run` returns plan without writing — Task 10 + Task 14
- [x] `peaks config migrate --apply` slims config.json + creates .bak — Task 10
- [x] `peaks config rollback --apply` restores from .bak — Task 11 + Task 14
- [x] `peaks config restore --field <name> --apply` writes sidecar — Task 12 + Task 14
- [x] `peaks preferences set/get/reset` works — Task 3
- [x] `peaks workspace clean --runtime --older-than 7d --apply` archives — Task 6 + Task 9
- [x] `peaks workspace clean --sub-agents --invalid --apply` moves bare sids to `_archive/invalid-sids/` — Task 7 + Task 9
- [x] `peaks workspace archive --session <sid> --apply` archives session — Task 8 + Task 9
- [x] `peaks audit red-lines` will report bare sids (integration with Task 5's guard, future slice)
- [x] dogfood end-to-end round-trip works — Task 15

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-11-workspace-config-reorg.md` (15 tasks, ~1700 lines).

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for high-quality / consistent output.

2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**

(For full AI 24/7 autonomous execution with `/goal`: Subagent-Driven is the recommended primitive — each task = 1 subagent, fresh context per task, parallelizable where independent.)

---