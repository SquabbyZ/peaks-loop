// Slice 0.5 Task 15 — full end-to-end migration round-trip dogfood
// Spec reference: docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md §8
//
// This is the FINAL slice-0.5 task. It exercises the full migration workflow
// across every Slice-0.5 surface: config (migrate/rollback/restore), preferences
// (per-project override), and the workspace preference migration (legacy
// decision dotfiles in .peaks/.peaks-*.json).
//
// Spec bug fixes baked into this test (deviation report in the slice PR):
//   #1 Entrypoint: spec wrote `dist/cli/program.js` (factory-only — no output).
//       The real CLI entrypoint is `bin/peaks.js`. Use
//       `resolve(__dirname, '../../bin/peaks.js')`.
//   #2 stderr/stdout: `execSync` error object exposes `stderr`; the spec code
//       returned only `stdout` then asserted on `stderr`. Add `stderr` to the
//       return type, populate via `e.stderr ?? ''`.
//   #3 preferences.json schema: the migrate step's `savePreferences` call
//       requires a valid preferences.json. The spec used a `makeProject`
//       helper that does not exist in this test. Pre-populate the project
//       with `{ schema_version: '2.0.0' }` directly in test setup.
//   #4 No-push: spec said to push; dev-preference red line + system rules
//       require explicit user confirmation before pushing. Commit only;
//       leave push to the user.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseCliEnvelope } from '../../src/cli/cli-envelope.js';
import { parseJson } from '../../src/shared/json-parse.js';

/**
 * The fields these cases read back off the two files migration owns.
 *
 * They are read as RAW files on purpose: the assertions below exist to prove
 * what the migration WROTE, and `readRecord`-style helpers default the very
 * fields under test — a missing write would then pass. But "raw" was
 * `JSON.parse(...)` and every read through it was an `any` read against
 * nothing. Naming the fields keeps the write proving write proving, and makes
 * a malformed file a schema error instead of a confusing `undefined`.
 */
const configFileFields = z.looseObject({
  version: z.string(),
  /** Present on the 1.x `.bak`; the migrated 2.0 file may not carry it. */
  currentWorkspace: z.string().optional()
});
const preferencesFileFields = z.looseObject({
  swarmMode: z.boolean().optional(),
  economyMode: z.boolean().optional(),
  uaPrompt: z.string().optional()
});

const CLI_BIN = resolve(__dirname, '../../bin/peaks.js');

let HOME_DIR: string;
const origHome = process.env.HOME;
const origUserProfile = process.env.USERPROFILE;
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
  process.env.USERPROFILE = origUserProfile;
});

function cli(args: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI_BIN} ${args}`, {
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

describe('Slice 0.5 End-to-End Dogfood', () => {
  test('full workflow: 1.x config -> migrate -> preferences -> state -> rollback -> re-migrate', () => {
    // 1. Set up 1.x config
    mkdirSync(join(HOME_DIR, '.peaks'), { recursive: true });
    writeFileSync(
      join(HOME_DIR, '.peaks/config.json'),
      JSON.stringify({
        version: '1.4.2',
        economyMode: true,
        swarmMode: false,
        currentWorkspace: '/some/proj',
        workspaces: [],
        language: 'zh',
        model: 'sonnet',
        tokens: {},
        providers: {},
        proxy: {}
      }),
      'utf8'
    );

    // Set up project with valid preferences.json + legacy decision dotfiles
    mkdirSync(join(PROJECT_DIR, '.peaks'), { recursive: true });
    writeFileSync(
      join(PROJECT_DIR, '.peaks/preferences.json'),
      JSON.stringify({ schema_version: '2.0.0' }),
      'utf8'
    );
    writeFileSync(
      join(PROJECT_DIR, '.peaks/.peaks-init-hooks-decision.json'),
      '{"hooks":true}',
      'utf8'
    );
    writeFileSync(
      join(PROJECT_DIR, '.peaks/.peaks-openspec-opt-in.json'),
      '{"optIn":true}',
      'utf8'
    );

    // 2. Migrate config (1.x -> 2.0)
    const migrateResult = cli(`config migrate --project ${PROJECT_DIR} --apply --json`);
    expect(migrateResult.code).toBe(0);
    const migrateData = parseCliEnvelope(migrateResult.stdout);
    expect(migrateData.data.applied).toBe(true);

    // 3. Verify slim config.json
    const newCfg = parseJson(
      readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'),
      configFileFields
    );
    expect(newCfg).toEqual({
      version: '2.0.0',
      ocr: {
        llm: { url: '', authToken: '', model: '', useAnthropic: false, authHeader: 'authorization' }
      }
    });

    // 4. Verify .bak has 1.x fields
    const bak = parseJson(
      readFileSync(join(HOME_DIR, '.peaks/config.json.1.x.bak'), 'utf8'),
      configFileFields
    );
    expect(bak.version).toBe('1.4.2');
    expect(bak.currentWorkspace).toBe('/some/proj');

    // 5. Verify preferences.json has per-project fields migrated
    const prefs = parseJson(
      readFileSync(join(PROJECT_DIR, '.peaks/preferences.json'), 'utf8'),
      preferencesFileFields
    );
    expect(prefs.swarmMode).toBe(false);
    expect(prefs.economyMode).toBe(true);

    // 6. Use preferences CLI to override uaPrompt
    cli(`preferences set --key uaPrompt --value skip-forever --project ${PROJECT_DIR} --json`);
    const updated = parseJson(
      readFileSync(join(PROJECT_DIR, '.peaks/preferences.json'), 'utf8'),
      preferencesFileFields
    );
    expect(updated.uaPrompt).toBe('skip-forever');

    // 7. Restore archived field (language) via sidecar
    cli(`config restore --field language --apply --json`);
    expect(existsSync(join(HOME_DIR, '.peaks/config.json.restore-language.json'))).toBe(true);

    // 8. Rollback to 1.x
    const rollbackResult = cli(`config rollback --apply --json`);
    expect(rollbackResult.code).toBe(0);
    const restored = parseJson(
      readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'),
      configFileFields
    );
    expect(restored.version).toBe('1.4.2');

    // 9. Re-migrate to verify round-trip / idempotency
    const reMigrate = cli(`config migrate --project ${PROJECT_DIR} --apply --json`);
    expect(reMigrate.code).toBe(0);
    const reMigratedCfg = parseJson(
      readFileSync(join(HOME_DIR, '.peaks/config.json'), 'utf8'),
      configFileFields
    );
    expect(reMigratedCfg).toEqual({
      version: '2.0.0',
      ocr: {
        llm: { url: '', authToken: '', model: '', useAnthropic: false, authHeader: 'authorization' }
      }
    });
  });
});
