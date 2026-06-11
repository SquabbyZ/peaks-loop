import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

async function makeProjectWithSession(): Promise<string> {
  // A perf-baseline call needs a peaks session binding, so we
  // bootstrap the same shape that `ensureSession` would write: a
  // .peaks/.session.json + a session directory under it. We use
  // a fixed id so the JSON envelope assertions are stable.
  const project = await mkdtemp(join(tmpdir(), 'peaks-perf-cli-'));
  const sessionId = '2026-06-03-session-perfcli';
  await mkdir(join(project, '.peaks', '_runtime', sessionId, 'rd'), { recursive: true });
  await writeFile(
    join(project, '.peaks', '.session.json'),
    JSON.stringify({
      sessionId,
      createdAt: '2026-06-03T00:00:00.000Z',
      projectRoot: project
    }),
    'utf8'
  );
  return project;
}

describe('peaks perf commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('perf baseline', () => {
    test('dry-run (default) plans writes without touching the filesystem', async () => {
      const project = await makeProjectWithSession();
      const result = await runCommand(['perf', 'baseline', '--project', project, '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        apply: boolean;
        sessionId: string | null;
        perfBaselinePath: string | null;
        plannedWrites: Array<{ path: string; kind: string; bytes: number }>;
        writtenFiles: string[];
        createdDirectories: string[];
      }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.apply).toBe(false);
      expect(output.data.sessionId).toBe('2026-06-03-session-perfcli');
      expect(output.data.perfBaselinePath).toBe(
        join(project, '.peaks', '_runtime', '2026-06-03-session-perfcli', 'rd', 'perf-baseline.md')
      );
      expect(output.data.writtenFiles).toEqual([]);
      expect(output.data.createdDirectories).toEqual([]);

      const paths = output.data.plannedWrites.map((w) => w.path).sort();
      expect(paths).toEqual([
        join(project, '.peaks', '_runtime', '2026-06-03-session-perfcli', 'rd'),
        join(project, '.peaks', '_runtime', '2026-06-03-session-perfcli', 'rd', 'perf-baseline.md')
      ].sort());

      // Nothing must be on disk after a dry run.
      const { existsSync } = await import('node:fs');
      expect(existsSync(output.data.perfBaselinePath!)).toBe(false);
    });

    test('--apply scaffolds the rd/ directory and the perf-baseline.md file', async () => {
      // Use a fresh project layout where the session dir does NOT
      // yet contain an rd/ subdirectory. In a real RD workflow the
      // rd/ dir usually exists from a prior tech-doc write, but
      // here we want to assert the mkdir + file-write path
      // independently of other state.
      const project = await mkdtemp(join(tmpdir(), 'peaks-perf-cli-apply-'));
      const sessionId = '2026-06-03-session-perfcli-apply';
      await mkdir(join(project, '.peaks', '_runtime', sessionId), { recursive: true });
      await writeFile(
        join(project, '.peaks', '.session.json'),
        JSON.stringify({
          sessionId,
          createdAt: '2026-06-03T00:00:00.000Z',
          projectRoot: project
        }),
        'utf8'
      );

      const result = await runCommand(['perf', 'baseline', '--project', project, '--apply', '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        apply: boolean;
        writtenFiles: string[];
        createdDirectories: string[];
      }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.apply).toBe(true);

      const { existsSync, readFileSync, statSync } = await import('node:fs');
      const baselinePath = join(project, '.peaks', '_runtime', sessionId, 'rd', 'perf-baseline.md');
      expect(existsSync(baselinePath)).toBe(true);
      expect(existsSync(join(project, '.peaks', '_runtime', sessionId, 'rd'))).toBe(true);
      expect(statSync(join(project, '.peaks', '_runtime', sessionId, 'rd')).isDirectory()).toBe(true);

      const content = readFileSync(baselinePath, 'utf8');
      expect(content).toContain('# Performance baseline');
      expect(content).toContain('## Why this exists');
      expect(content).toContain('## Results');
      expect(content).toContain('| Path / route | Workload | Tool | Metric | Baseline | Threshold |');

      expect(output.data.createdDirectories).toContain(
        join(project, '.peaks', '_runtime', sessionId, 'rd')
      );
      expect(output.data.writtenFiles).toContain(baselinePath);
    });

    test('--apply is no-op on createdDirectories when rd/ already exists from a prior write', async () => {
      // The makeProjectWithSession helper pre-seeds rd/ alongside
      // the .peaks/.session.json, mirroring the "RD has already
      // written tech-doc" production state. Re-running perf
      // baseline --apply on that shape must still write the file
      // but must NOT report a createdDirectories hit.
      const project = await makeProjectWithSession();
      const result = await runCommand(['perf', 'baseline', '--project', project, '--apply', '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        apply: boolean;
        writtenFiles: string[];
        createdDirectories: string[];
      }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.apply).toBe(true);
      expect(output.data.createdDirectories).toEqual([]);
      const baselinePath = join(project, '.peaks', '_runtime', '2026-06-03-session-perfcli', 'rd', 'perf-baseline.md');
      expect(output.data.writtenFiles).toContain(baselinePath);
    });

    test('--reason is recorded in the response data', async () => {
      const project = await makeProjectWithSession();
      const result = await runCommand([
        'perf', 'baseline', '--project', project, '--apply',
        '--reason', 'baseline for the lock-banner slice',
        '--json'
      ]);
      const output = parseJsonOutput<{ ok: boolean; apply: boolean; reason?: string }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.apply).toBe(true);
      expect(output.data.reason).toBe('baseline for the lock-banner slice');
    });

    test('is idempotent — second --apply on an existing perf-baseline.md reports alreadyInitialized and does NOT overwrite', async () => {
      const project = await makeProjectWithSession();
      // First apply — fresh scaffold.
      const first = await runCommand(['perf', 'baseline', '--project', project, '--apply', '--json']);
      expect(parseJsonOutput(first.stdout).ok).toBe(true);

      // Hand-edit the file so we can detect any overwrite.
      const { readFileSync, writeFileSync } = await import('node:fs');
      const baselinePath = join(project, '.peaks', '_runtime', '2026-06-03-session-perfcli', 'rd', 'perf-baseline.md');
      writeFileSync(baselinePath, '# USER-HAND-WRITTEN — must not be stomped\n', 'utf8');

      // Second apply — must report alreadyInitialized and leave content intact.
      const second = await runCommand(['perf', 'baseline', '--project', project, '--apply', '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        alreadyInitialized: boolean;
        existingFiles: string[];
        writtenFiles: string[];
      }>(second.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.alreadyInitialized).toBe(true);
      expect(output.data.existingFiles).toContain(baselinePath);
      expect(output.data.writtenFiles).toEqual([]);

      const after = readFileSync(baselinePath, 'utf8');
      expect(after).toContain('USER-HAND-WRITTEN');
    });

    test('returns a recoverable error envelope when no peaks session is bound', async () => {
      // Empty project — no .peaks/.session.json.
      const project = await mkdtemp(join(tmpdir(), 'peaks-perf-cli-nobound-'));
      const result = await runCommand(['perf', 'baseline', '--project', project, '--apply', '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        sessionId: string | null;
        perfBaselinePath: string | null;
        writtenFiles: string[];
      }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.sessionId).toBeNull();
      expect(output.data.perfBaselinePath).toBeNull();
      expect(output.data.writtenFiles).toEqual([]);
      const nextActions = (output as unknown as { nextActions: string[] }).nextActions ?? [];
      expect(nextActions.some((a) => a.includes('peaks workspace init'))).toBe(true);
    });
  });
});
