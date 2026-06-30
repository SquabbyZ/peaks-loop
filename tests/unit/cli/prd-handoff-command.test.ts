/**
 * v2.11.0 Group B — `peaks prd handoff {init,verify,show}` CLI integration tests.
 *
 * Pins:
 *   - help text does NOT reference legacy `peaks prd write-handoff` (AC-1)
 *   - `init --apply` writes the handoff under .peaks/_runtime/<sid>/prd/handoff.md
 *   - `init` without --apply is a dry-run preview (no file written)
 *   - `verify` returns ok:true for a freshly written handoff
 *   - `verify` returns ok:false reason:hash-mismatch after tampering
 *   - `show` returns the raw frontmatter + body
 *   - error path: verify on missing file → ok:false reason:file-missing
 *   - body @<file> syntax reads from disk
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand, parseJsonOutput } from '../cli-program-test-utils.js';

const RID = '001-v2-11-handoff-cli-test';
const SID = '2026-06-26-session-handoff-cli-test';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-prd-handoff-cli-'));
});

afterEach(() => {
  try {
    process.chdir(tmpdir());
  } catch {
    // ignore
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

async function bootstrapValidHandoff(): Promise<string> {
  const bodyPath = join(root, 'body.md');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(bodyPath, '# CLI PRD body\n\nGoals G1, G2.\n', 'utf8');
  const { stdout } = await runCommand([
    'prd', 'handoff', 'init',
    '--rid', RID,
    '--sid', SID,
    `--body`, `@${bodyPath}`,
    '--goals', 'G1,G2',
    '--ac', 'AC-1',
    '--preserve', 'P1',
    '--project', root,
    '--apply',
    '--json'
  ], {});
  const parsed = parseJsonOutput<{ ok: boolean; path: string; hash: string }>(stdout);
  expect(parsed.ok).toBe(true);
  return parsed.data.path;
}

describe('peaks prd handoff — AC-1 help text excludes legacy write-handoff', () => {
  it('prd --help does NOT mention "write-handoff"', async () => {
    let stdout: string[] = [];
    try {
      ({ stdout } = await runCommand(['prd', '--help'], {}));
    } catch (error: unknown) {
      // Commander's exitOverride throws on --help; that's expected.
      if (!(error instanceof CommanderError)) throw error;
    }
    expect(stdout.join('\n')).not.toMatch(/write-handoff/);
  });

  it('prd handoff --help does NOT mention "write-handoff"', async () => {
    let stdout: string[] = [];
    try {
      ({ stdout } = await runCommand(['prd', 'handoff', '--help'], {}));
    } catch (error: unknown) {
      if (!(error instanceof CommanderError)) throw error;
    }
    expect(stdout.join('\n')).not.toMatch(/write-handoff/);
  });

  it('prd handoff init --help does NOT mention "write-handoff"', async () => {
    let stdout: string[] = [];
    try {
      ({ stdout } = await runCommand(['prd', 'handoff', 'init', '--help'], {}));
    } catch (error: unknown) {
      if (!(error instanceof CommanderError)) throw error;
    }
    expect(stdout.join('\n')).not.toMatch(/write-handoff/);
  });
});

describe('peaks prd handoff init — write + dry-run', () => {
  it('init --apply writes the handoff under .peaks/_runtime/<sid>/prd/handoff.md', async () => {
    const path = await bootstrapValidHandoff();
    expect(existsSync(path)).toBe(true);
    expect(path).toBe(join(root, '.peaks', '_runtime', SID, 'prd', 'handoff.md'));
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('requestId: ' + RID);
    expect(raw).toContain('sessionId: ' + SID);
    expect(raw).toContain('schemaVersion: "2"');
    expect(raw).toContain('# CLI PRD body');
  });

  it('init without --apply is a dry-run (no file written)', async () => {
    const bodyPath = join(root, 'body.md');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(bodyPath, '# Dry run body\n', 'utf8');
    const { stdout } = await runCommand([
      'prd', 'handoff', 'init',
      '--rid', RID,
      '--sid', SID,
      `--body`, `@${bodyPath}`,
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{ dryRun: boolean; handoffPath: string; handoffHash: string }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dryRun).toBe(true);
    // The CLI returns the relative handoffPath from frontmatter (matches initHandoff),
    // not an absolute path. Use the same join form so Windows + POSIX both pass.
    const expectedRelative = join('.peaks', '_runtime', SID, 'prd', 'handoff.md');
    expect(parsed.data.handoffPath).toBe(expectedRelative);
    expect(existsSync(join(root, expectedRelative))).toBe(false);
  });
});

describe('peaks prd handoff verify', () => {
  it('verify returns ok:true for a freshly written handoff', async () => {
    const path = await bootstrapValidHandoff();
    const { stdout } = await runCommand([
      'prd', 'handoff', 'verify',
      '--path', path,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{ ok: boolean; data: { ok: boolean } }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ok).toBe(true);
  });

  it('verify returns ok:false reason:hash-mismatch after body tampering', async () => {
    const path = await bootstrapValidHandoff();
    const raw = readFileSync(path, 'utf8');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, raw.replace('# CLI PRD body\n\nGoals G1, G2.\n', '# Tampered\n'), 'utf8');

    const { stdout, exitCode } = await runCommand([
      'prd', 'handoff', 'verify',
      '--path', path,
      '--json'
    ], {});
    const parsed = parseJsonOutput<unknown>(stdout) as { ok: boolean; code?: string; data?: { ok: boolean; reason?: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('HANDOFF_VERIFY_FAILED');
    expect(parsed.data?.reason).toBe('hash-mismatch');
    expect(exitCode).toBe(1);
  });

  it('verify returns ok:false reason:file-missing when the path does not exist', async () => {
    const { stdout, exitCode } = await runCommand([
      'prd', 'handoff', 'verify',
      '--path', join(root, 'does-not-exist.md'),
      '--json'
    ], {});
    const parsed = parseJsonOutput<unknown>(stdout) as { ok: boolean; code?: string; data?: { ok: boolean; reason?: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.data?.reason).toBe('file-missing');
    expect(exitCode).toBe(1);
  });
});

describe('peaks prd handoff show', () => {
  it('show --json returns frontmatter + body', async () => {
    const path = await bootstrapValidHandoff();
    const { stdout } = await runCommand([
      'prd', 'handoff', 'show',
      '--path', path,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{ path: string; frontmatter: { requestId: string; schemaVersion: string }; body: string }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.path).toBe(path);
    expect(parsed.data.frontmatter.requestId).toBe(RID);
    expect(parsed.data.frontmatter.schemaVersion).toBe('2');
    expect(parsed.data.body).toContain('# CLI PRD body');
  });
});