import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 120_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'modify-commands-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout:
        typeof caught.stdout === 'string' ? caught.stdout : (caught.stdout?.toString('utf8') ?? ''),
      stderr:
        typeof caught.stderr === 'string' ? caught.stderr : (caught.stderr?.toString('utf8') ?? ''),
      code: caught.status ?? 1
    };
  }
}

function parseEnvelope<T = Record<string, unknown>>(
  result: RunResult
): {
  ok: boolean;
  command: string;
  code?: string;
  message?: string;
  data: T;
  warnings: readonly unknown[];
  nextActions: readonly string[];
} {
  return JSON.parse(result.stdout) as ReturnType<typeof parseEnvelope<T>>;
}

const projects: string[] = [];

function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  return project;
}

afterEach(() => {
  for (const project of projects) {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
});

// ============================================================================
// peaks config migrate / rollback / restore
// ============================================================================

describe('peaks config migrate (P2-B.2 modify e2e)', () => {
  test('dry-run reports planned migration without writing', () => {
    const project = makeProject('peaks-p2b2-cfg-mig-');
    const result = runCli(
      ['config', 'migrate', '--project', project, '--dry-run', '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      alreadyAtV2: boolean;
      detectedSchemaVersion: string;
      newConfigSchemaVersion: string;
      willMigrateFields: readonly string[];
      applied: boolean;
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('config.migrate');
    expect(envelope.data.applied).toBe(false);
    expect(typeof envelope.data.detectedSchemaVersion).toBe('string');
    expect(typeof envelope.data.newConfigSchemaVersion).toBe('string');
    expect(Array.isArray(envelope.data.willMigrateFields)).toBe(true);
  });
});

describe('peaks config rollback (P2-B.2 modify e2e)', () => {
  test('dry-run reports backup availability without writing', () => {
    const result = runCli(['config', 'rollback', '--dry-run', '--json'], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      available: boolean;
      backupPath: string | null;
      detectedVersion: string | null;
      applied: boolean;
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('config.rollback');
    expect(envelope.data.applied).toBe(false);
    expect(typeof envelope.data.available).toBe('boolean');
    // backupPath may be null when no .bak is present on this machine — assert type only
    expect(envelope.data.backupPath === null || typeof envelope.data.backupPath === 'string').toBe(
      true
    );
  });

  test('does NOT accept --project flag (drift: --project is rejected)', () => {
    const result = runCli(
      ['config', 'rollback', '--project', 'C:/tmp', '--dry-run', '--json'],
      process.cwd()
    );
    expect(result.code).not.toBe(0);
    // commander "unknown option" message lives on stderr; the structured
    // JSON envelope explaining the rejection lives on stdout OR stderr
    // depending on which path commander took — accept either channel.
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('unknown option');
    expect(combined).toContain('COMMAND_NOT_FOUND');
  });
});

describe('peaks config restore (P2-B.2 modify e2e)', () => {
  // `config restore` reads `~/.peaks/config.json.1.x.bak` — NOT the project
  // root — so `process.cwd()` was never the dependency these two cases relied
  // on: the DEVELOPER'S migrated config was. A fresh checkout has no `.bak`,
  // the CLI exits 1 with a structured NO_BACKUP envelope, and both cases went
  // red on CI while `config rollback` (which degrades to `available:false`
  // instead of throwing) stayed green. Build the `.bak` here, the same way
  // `config-migrate-cli.test.ts` and `full-migration.test.ts` already build
  // theirs: a temp `$HOME`.
  let home: string;
  let origHome: string | undefined;
  let origUserProfile: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'peaks-p2b2-restore-home-'));
    mkdirSync(join(home, '.peaks'), { recursive: true });
    writeFileSync(
      join(home, '.peaks', 'config.json.1.x.bak'),
      JSON.stringify({ version: '1.x', language: 'en', currentWorkspace: 'ws-default' }, null, 2) +
        '\n',
      'utf8'
    );
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    // Both, because `os.homedir()` prefers USERPROFILE on win32 and HOME
    // elsewhere.
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    rmSync(home, { recursive: true, force: true });
  });

  test('--list dry-run reports fields available in .bak without writing', () => {
    const result = runCli(['config', 'restore', '--list', '--dry-run', '--json'], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      fields: readonly string[];
      applied: boolean;
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('config.restore');
    expect(envelope.data.applied).toBe(false);
    expect(Array.isArray(envelope.data.fields)).toBe(true);
  });

  test('--field dry-run on missing field returns structured verdict', () => {
    const result = runCli(
      ['config', 'restore', '--field', 'currentWorkspace', '--dry-run', '--json'],
      process.cwd()
    );
    // Either the field is available (ok:true, applied:false) or unavailable (ok:false)
    // — both outcomes are valid structured verdicts; never silently a free-text crash.
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      field?: string;
      available?: boolean;
      applied?: boolean;
      reason?: string;
    }>(result);
    expect(envelope.ok === true || envelope.ok === false).toBe(true);
    if (envelope.ok === true) {
      expect(envelope.data.applied).toBe(false);
    }
  });
});

// ============================================================================
// peaks standards init / update / migrate / migrate-from-claude-rules
// ============================================================================

describe('peaks standards init (P2-B.2 modify e2e)', () => {
  test('dry-run reports planned standards writes without touching disk', () => {
    const project = makeProject('peaks-p2b2-std-init-');
    const result = runCli(
      ['standards', 'init', '--project', project, '--dry-run', '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      apply: boolean;
      projectRoot: string;
      language: string;
      plannedWrites: ReadonlyArray<{ relativePath: string; status: string }>;
      writtenFiles: readonly string[];
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('standards.init');
    expect(envelope.data.apply).toBe(false);
    expect(envelope.data.plannedWrites.length).toBeGreaterThan(0);
    // No real writes must have happened on disk during dry-run
    expect(envelope.data.writtenFiles).toHaveLength(0);
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(false);
  });
});

describe('peaks standards update (P2-B.2 modify e2e)', () => {
  test('dry-run reports planned append without writing', () => {
    const project = makeProject('peaks-p2b2-std-upd-');
    // Pre-create a CLAUDE.md so update has something to append to.
    writeFileSync(join(project, 'CLAUDE.md'), '# Project\n\nBody.\n', 'utf8');
    const result = runCli(
      ['standards', 'update', '--project', project, '--dry-run', '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      apply: boolean;
      plannedWrites: ReadonlyArray<{ relativePath: string; status: string }>;
      appendedFiles: readonly string[];
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('standards.update');
    expect(envelope.data.apply).toBe(false);
    expect(envelope.data.appendedFiles).toHaveLength(0);
    // The pre-existing CLAUDE.md body must remain untouched.
    const after = readFileSync(join(project, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('# Project');
    expect(after).toContain('Body.');
  });
});

describe('peaks standards migrate (P2-B.2 modify e2e)', () => {
  test('dry-run on empty project reports no-op without writing', () => {
    const project = makeProject('peaks-p2b2-std-mig-');
    const result = runCli(['standards', 'migrate', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      foundOldBlock: boolean;
      wouldChange: boolean;
      applied: boolean;
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('standards.migrate');
    expect(envelope.data.applied).toBe(false);
    expect(envelope.data.foundOldBlock).toBe(false);
    expect(envelope.data.wouldChange).toBe(false);
  });

  test('--from-claude-rules flag is accepted as a registered option (drift pointer)', () => {
    const project = makeProject('peaks-p2b2-std-mig-fcr-');
    // Note: the --from-claude-rules option is documented under `standards migrate`,
    // NOT as a separate `standards migrate-from-claude-rules` subcommand.
    const result = runCli(
      ['standards', 'migrate', '--project', project, '--from-claude-rules', '--json'],
      project
    );
    // Either ok:true with a verdict, or ok:false with a structured code — never a free-form crash.
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{ applied: boolean }>(result);
    expect(typeof envelope.ok).toBe('boolean');
    expect(envelope.data.applied).toBe(false);
  });
});

describe('peaks standards migrate-from-claude-rules (P2-B.2 modify e2e)', () => {
  test('subcommand is NOT registered as a separate verb (drift pointer)', () => {
    const project = makeProject('peaks-p2b2-std-mig-fcr-only-');
    const result = runCli(
      ['standards', 'migrate-from-claude-rules', '--project', project, '--json'],
      project
    );
    expect(result.code).not.toBe(0);
    // Commander "unknown command" message is on stdout (free-form), plus a structured
    // envelope on stderr (or vice-versa). Accept either channel as long as the rejection
    // surfaces somewhere in the combined output.
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command|migrate-from-claude-rules/);
  });
});

// Slice 2026-09-15-s4-dangling-citations registered the subcommand this
// describe used to pin as ABSENT. The drift pointer flips polarity: the same
// invocation must now reach the handler and fail on the MISSING FILE, not on an
// unknown command — a project with no `.peaks/standards/` has nothing to lint.
describe('peaks standards lint (P2-B.2 modify e2e)', () => {
  test('reaches the handler and reports the missing guideline file', () => {
    const project = makeProject('peaks-p2b2-std-lint-');
    const result = runCli(
      ['standards', 'lint', '--category', 'loop-engineering', '--project', project, '--json'],
      project
    );
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope<{ path: string }>(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('standards.lint');
    expect(envelope.code).toBe('LINT_FILE_NOT_FOUND');
  });

  test('rejects a category it does not implement', () => {
    const project = makeProject('peaks-p2b2-std-lint-cat-');
    const result = runCli(
      ['standards', 'lint', '--category', 'not-a-category', '--project', project, '--json'],
      project
    );
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('UNKNOWN_LINT_CATEGORY');
  });

  test('lints the shipped guideline file when pointed at a peaks-loop checkout', () => {
    // The lint reads its own `--project` tree; the repo root is the one tree
    // guaranteed to carry `.peaks/standards/loop-engineering-guidelines.md`.
    const repoRoot = resolve(__dirname, '..', '..');
    const result = runCli(
      ['standards', 'lint', '--category', 'loop-engineering', '--project', repoRoot, '--json'],
      repoRoot
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{ redLineCount: number; findings: readonly string[] }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.redLineCount).toBeGreaterThan(0);
    expect(envelope.data.findings).toEqual([]);
  });
});

// ============================================================================
// peaks upgrade / upgrade 1x-detector / upgrade gitignore-migrate
// ============================================================================

describe('peaks upgrade --detect-1x (P2-B.2 modify e2e)', () => {
  test('a project whose only peaks artifact is .peaks/_runtime is flagged as 1.x', () => {
    const project = makeProject('peaks-p2b2-upg-det-');
    // The detector's first job is to decide whether cwd is a peaks project at
    // all, and it does that by walking up for `.peaks/_runtime`: with no such
    // directory `projectRoot` stays null, the two project-level signals are
    // skipped wholesale, and a bare tmp dir reports `isOneX:false,
    // signals:[]` (src/services/upgrade/1x-detector-service.ts:38-50, 67-93).
    // The detector predates this test by six weeks and is mirrored line-for-line
    // in scripts/install-skills.mjs:1172-1187 (see its
    // "cwd is not a peaks project (no .peaks/_runtime/)" branch at :1266), so
    // the fixture — not the product — was what never matched.
    mkdirSync(join(project, '.peaks', '_runtime'), { recursive: true });
    const result = runCli(
      ['upgrade', '--to', '2.0', '--project', project, '--detect-1x', '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      isOneX: boolean;
      signals: readonly string[];
      projectRoot: string;
      configPath: string | null;
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('upgrade.detect-1x');
    expect(envelope.data.isOneX).toBe(true);
    expect(Array.isArray(envelope.data.signals)).toBe(true);
    expect(envelope.data.projectRoot.length).toBeGreaterThan(0);
    // Read-only probe: it may READ the fixture, but it must not CREATE the
    // migration state it is only supposed to report on.
    expect(existsSync(join(project, '.peaks', 'preferences.json'))).toBe(false);
    expect(readdirSync(join(project, '.peaks', '_runtime'))).toHaveLength(0);
  });

  test('on the real repo the verdict classifies non-1x state without writes', () => {
    // Running against the real repo to exercise the "already 2.x" branch.
    const result = runCli(['upgrade', '--to', '2.0', '--detect-1x', '--json'], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{ isOneX: boolean }>(result);
    expect(envelope.ok).toBe(true);
    expect(typeof envelope.data.isOneX).toBe('boolean');
  });
});

describe('peaks upgrade --gitignore-migrate (P2-B.2 modify e2e)', () => {
  test('reports a read-only migration verdict without changing .gitignore', () => {
    const project = makeProject('peaks-p2b2-upg-gim-flag-');
    const gitignorePath = join(project, '.gitignore');
    writeFileSync(gitignorePath, '/.peaks/\nnode_modules/\n', 'utf8');

    const result = runCli(
      ['upgrade', '--gitignore-migrate', '--project', project, '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{
      missing: boolean;
      changed: boolean;
      appliedWrite: boolean;
      backupPath: string | null;
      removedRules: readonly string[];
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('upgrade.gitignore-migrate');
    expect(envelope.data.changed).toBe(true);
    expect(envelope.data.appliedWrite).toBe(false);
    expect(envelope.data.backupPath).toBeNull();
    expect(readFileSync(gitignorePath, 'utf8')).toBe('/.peaks/\nnode_modules/\n');
  });
});

describe('peaks upgrade (P2-B.2 modify e2e)', () => {
  test('without --apply runs read-only verdict and emits a structured envelope', () => {
    const project = makeProject('peaks-p2b2-upg-readonly-');
    // No --apply / --auto: the CLI must still complete with a structured verdict
    // (sub-steps soft-fail individually but the umbrella reports the verdict).
    const result = runCli(['upgrade', '--to', '2.0', '--project', project, '--json'], project);
    // Exit 0 is the documented umbrella verdict; structured JSON is the contract.
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<Record<string, unknown>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toMatch(/^upgrade(\.|$)/);
  });
});

describe('peaks upgrade 1x-detector positional form (P2-B.2 modify e2e)', () => {
  test('rejects positional "1x-detector" and points to --detect-1x', () => {
    const project = makeProject('peaks-p2b2-upg-1xd-');
    const result = runCli(['upgrade', '1x-detector', '--project', project, '--json'], project);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope<Record<string, never>>(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('upgrade');
    expect(envelope.code).toBe('UPGRADE_POSITIONAL_REJECTED');
    expect(envelope.message).toContain('--detect-1x');
    expect(existsSync(join(project, '.peaks'))).toBe(false);
  });
});

describe('peaks upgrade gitignore-migrate positional form (P2-B.2 modify e2e)', () => {
  test('rejects positional "gitignore-migrate" and points to --gitignore-migrate', () => {
    const project = makeProject('peaks-p2b2-upg-gim-');
    const result = runCli(
      ['upgrade', 'gitignore-migrate', '--project', project, '--json'],
      project
    );
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope<Record<string, never>>(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('upgrade');
    expect(envelope.code).toBe('UPGRADE_POSITIONAL_REJECTED');
    expect(envelope.message).toContain('--gitignore-migrate');
    expect(existsSync(join(project, '.peaks'))).toBe(false);
  });
});

// ============================================================================
// peaks preferences list / set / get / unset
// ============================================================================

describe('peaks preferences round-trip (P2-B.2 modify e2e)', () => {
  test('set -> get -> reset cycle persists and clears the override', () => {
    const project = makeProject('peaks-p2b2-pref-');
    // Sanity: --get on default key reports source:default.
    const initial = parseEnvelope<{ key: string; source: string }>(
      runCli(
        ['preferences', 'get', '--key', 'economyMode', '--project', project, '--json'],
        project
      )
    );
    expect(initial.ok).toBe(true);
    expect(initial.data.source).toBe('default');

    // --set writes the override.
    const setResult = parseEnvelope<{ key: string; value: unknown }>(
      runCli(
        [
          'preferences',
          'set',
          '--key',
          'economyMode',
          '--value',
          'false',
          '--project',
          project,
          '--json'
        ],
        project
      )
    );
    expect(setResult.ok).toBe(true);
    expect(setResult.data.key).toBe('economyMode');
    expect(existsSync(join(project, '.peaks', 'preferences.json'))).toBe(true);

    // --get now returns source:override.
    const afterSet = parseEnvelope<{ key: string; value: unknown; source: string }>(
      runCli(
        ['preferences', 'get', '--key', 'economyMode', '--project', project, '--json'],
        project
      )
    );
    expect(afterSet.ok).toBe(true);
    expect(afterSet.data.source).toBe('override');
    expect(afterSet.data.value).toBe(false);

    // --reset removes the override (CLI exposes `reset`, NOT `unset`).
    const resetResult = parseEnvelope<{ key: string; removed: boolean }>(
      runCli(
        ['preferences', 'reset', '--key', 'economyMode', '--project', project, '--json'],
        project
      )
    );
    expect(resetResult.ok).toBe(true);
    expect(resetResult.data.removed).toBe(true);

    // After reset, --get returns source:default again.
    const afterReset = parseEnvelope<{ key: string; source: string }>(
      runCli(
        ['preferences', 'get', '--key', 'economyMode', '--project', project, '--json'],
        project
      )
    );
    expect(afterReset.ok).toBe(true);
    expect(afterReset.data.source).toBe('default');
  });

  test('set rejects unknown key with structured PREFERENCES_KEY_UNKNOWN', () => {
    const project = makeProject('peaks-p2b2-pref-unknown-');
    const result = runCli(
      [
        'preferences',
        'set',
        '--key',
        'bogus-key-12345',
        '--value',
        '"x"',
        '--project',
        project,
        '--json'
      ],
      project
    );
    expect(result.code).not.toBe(0);
    // The error is emitted on stderr (the help-shell's contract writes
    // PREFERENCES_KEY_UNKNOWN to stderr, not the JSON envelope stream).
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/PREFERENCES_KEY_UNKNOWN|Allowed keys/);
  });
});

describe('peaks preferences list / unset subcommand forms (P2-B.2 modify e2e)', () => {
  test('positional "list" is NOT registered (drift pointer)', () => {
    const project = makeProject('peaks-p2b2-pref-list-');
    const result = runCli(['preferences', 'list', '--project', project, '--json'], project);
    expect(result.code).not.toBe(0);
    // Commander emits "unknown command 'list'" to stderr (combined with
    // the structured envelope on stdout). Accept either channel.
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*list/);
  });

  test('positional "unset" is NOT registered — use "reset" instead (drift pointer)', () => {
    const project = makeProject('peaks-p2b2-pref-unset-');
    const result = runCli(
      ['preferences', 'unset', '--key', 'economyMode', '--project', project, '--json'],
      project
    );
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*unset|reset, set/);
  });
});

describe('peaks preferences migrate (P2-B.2 modify e2e)', () => {
  test('dry-run on a project with no preferences.json reports no-op verdict', () => {
    const project = makeProject('peaks-p2b2-pref-mig-');
    const result = runCli(['preferences', 'migrate', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope<{ migrated: boolean; reason: string }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.migrated).toBe(false);
    expect(envelope.data.reason).toBe('no-preferences-file');
  });
});

describe('Fix-4 regression guard', () => {
  test.each([
    ['1x-detector', '--detect-1x'],
    ['gitignore-migrate', '--gitignore-migrate']
  ] as const)('rejects upgrade %s with no filesystem writes', (positional, replacementFlag) => {
    const project = makeProject(`peaks-fix4-${positional}-`);
    const result = runCli(
      ['upgrade', positional, 'ignored-extra', '--project', project, '--json'],
      project
    );

    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope<Record<string, never>>(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('UPGRADE_POSITIONAL_REJECTED');
    expect(envelope.message).toContain(replacementFlag);
    expect(existsSync(join(project, '.peaks'))).toBe(false);
  });
});
