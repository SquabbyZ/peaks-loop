import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseCliEnvelope } from '../../src/cli/cli-envelope.js';
import { parseJson } from '../../src/shared/json-parse.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-prefs-cli-'));
}

const CLI_BIN = resolve(__dirname, '../../bin/peaks.js');

function cli(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    // Spec bug fix: `dist/cli/program.js` is a factory-only module, not a
    // CLI entrypoint — invoking it produces no output. The actual CLI
    // entrypoint is `bin/peaks.js` (matches the existing plan-cli test).
    const stdout = execSync(`node ${CLI_BIN} ${args}`, {
      cwd,
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

/**
 * The field this case reads back off `.peaks/preferences.json`.
 *
 * The read is RAW on purpose — it proves what `preferences set` WROTE, so it
 * must not go through the service's own defaults. Naming the field is what
 * stops the read from being an `any` read against nothing.
 */
const preferencesFileFields = z.looseObject({ economyMode: z.boolean().optional() });

describe('peaks preferences CLI', () => {
  test('peaks preferences get returns JSON envelope with default value for unknown key', () => {
    const project = makeProject();
    try {
      const { stdout, code } = cli(`preferences get --key swarmMode --json`, project);
      expect(code).toBe(0);
      const out = parseCliEnvelope(stdout);
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
      const written = parseJson(readFileSync(file, 'utf8'), preferencesFileFields);
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
      const out = parseCliEnvelope(stdout);
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

  test('peaks preferences set on unknown key lists the allowed keys (Stage-3 follow-up)', () => {
    // ice-cola surface check 2026-07-22, follow-on to report item 5.3:
    // the prior error message was bare `PREFERENCES_KEY_UNKNOWN: <key>`
    // which forced the operator to look up valid keys elsewhere. The
    // follow-up baked the ALLOWED_KEYS list into the stderr text so
    // the response is actionable. We exercise the `set` subcommand
    // because it is the only one of the three (get / set / reset) that
    // shares the same exec argv shape as the pre-existing passing
    // test on line 74; the get/reset paths reach the same
    // `unknownKeyError` helper via shared code so coverage of `set`
    // is sufficient regression coverage for the helper change.
    const project = makeProject();
    try {
      const sampleAllowed = ['economyMode', 'swarmMode', 'classifyRules'];
      const { code, stderr } = cli(`preferences set --key bogusKey --value x --json`, project);
      expect(code, 'set should exit non-zero').not.toBe(0);
      expect(stderr, 'should mention PREFERENCES_KEY_UNKNOWN').toMatch(/PREFERENCES_KEY_UNKNOWN/);
      expect(stderr, 'should list "Allowed keys:" prefix').toMatch(/Allowed keys:/);
      for (const sample of sampleAllowed) {
        expect(stderr, `stderr must list allowed key '${sample}'`).toContain(sample);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
