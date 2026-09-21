// tests/unit/cli/codegraph-status-integrity.test.ts
//
// 4-dimension CLI test for the exclude-integrity gate wired into
// `peaks codegraph status` and the explicit repair path
// `peaks codegraph repair-exclude` (slice S2 of
// rid-2026-09-12-codegraph-exclude-integrity).
//
// The defect this guards: upstream's default `exclude` template blocks
// real source directories, so the index silently omits git-tracked
// files while `peaks codegraph status` still printed
// `[OK] Index is up to date`. The gate must make that state visible AND
// non-zero-exiting, so CI can block on it.
//
// What is mocked and why: only the upstream binary spawn
// (`executeCodegraphInvocation`). The reconcile, the config write, the
// backup, the exit code and the envelopes all run for real against a
// real temp git work tree — the CLI action is not stubbed.
//
// Dimensions covered:
//   - a11y:        the exit code (read from `process.exitCode`, not from
//                  the printed text) and the human-readable gap detail
//   - render:      the `--peaks-json` envelope shape a CI job parses
//   - behavior:    clean vs gapped status, and repair-then-clean
//   - integration: real git + real fs + the registered commander command
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-status-integrity.test.ts

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import { CODEGRAPH_INTEGRITY_EXIT_CODE } from '../../../src/services/codegraph/codegraph-exclude-integrity.js';
import { repairCodegraphExcludeFromProject } from '../../../src/services/codegraph/codegraph-exclude-repair.js';

declareDimensions('tests/unit/cli/codegraph-status-integrity.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const __m = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn()
}));

vi.mock('../../../src/services/codegraph/codegraph-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/codegraph/codegraph-service.js')
  >('../../../src/services/codegraph/codegraph-service.js');
  return { ...actual, executeCodegraphInvocation: __m.executeCodegraphInvocation };
});

import {
  attributeUpstreamUpToDateLine,
  registerCodegraphCommands
} from '../../../src/cli/commands/codegraph-commands.js';
import { HEAVY_SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

// Byte-for-byte the shape the real upstream binary prints on a clean run:
// ANSI-colored markers, an index-statistics block, then the `[OK]` marker.
// The defect this file guards is a *juxtaposition* defect, so the mock has
// to carry the color codes the real line carries — a plain string would let
// the fix pass without ever seeing the escape sequences.
const UPSTREAM_CLEAN_STDOUT =
  '\x1b[1mIndex Statistics:\x1b[0m\n  Files:     1,133\n\n\x1b[32m[OK]\x1b[0m Index is up to date\n';

// Test-local oracle: strip SGR sequences so assertions read what the user
// sees, not what the terminal needs.
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

async function runCodegraph(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', ...argv], { from: 'user' });
  return captured;
}

// A real temp git work tree with a tracked source file inside the
// vendor directory. `mode` picks the `.codegraph/config.json` it gets:
// one that blocks that file, one that blocks nothing, one that blocks it
// while ALSO carrying an empty rule (the pattern `picomatch` refuses to
// compile), or none at all (a project that never ran codegraph init).
//
// NOTE: glob literals contain the two-character sequence that ends a
// block comment, so every comment in this file uses `//` lines.
type ProjectMode = 'gapped' | 'clean' | 'uninitialized' | 'gapped-empty-rule';

function seedProject(ws: TmpWorkspace, mode: ProjectMode): string {
  execFileSync('git', ['-C', ws.path, 'init', '-q'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', ws.path, 'config', 'user.email', 'peaks-test@example.com'], {
    stdio: 'ignore',
    windowsHide: true
  });
  execFileSync('git', ['-C', ws.path, 'config', 'user.name', 'peaks test'], {
    stdio: 'ignore',
    windowsHide: true
  });

  mkdirSync(join(ws.path, 'src'), { recursive: true });
  mkdirSync(join(ws.path, 'vendor'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(ws.path, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  execFileSync('git', ['-C', ws.path, 'add', '-A'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', ws.path, 'commit', '-qm', 'fixture'], {
    stdio: 'ignore',
    windowsHide: true
  });

  if (mode === 'uninitialized') {
    return ws.path;
  }

  mkdirSync(join(ws.path, '.codegraph'), { recursive: true });
  writeFileSync(
    join(ws.path, '.codegraph', 'config.json'),
    `${JSON.stringify(
      {
        version: 1,
        include: ['**/*.ts'],
        exclude:
          mode === 'gapped'
            ? ['**/vendor/**', '**/node_modules/**']
            : mode === 'gapped-empty-rule'
              ? ['', '**/vendor/**', '**/node_modules/**']
              : ['**/node_modules/**']
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return ws.path;
}

function parseJson(captured: CapturedIo): {
  ok: boolean;
  code?: string;
  command?: string;
  warnings?: string[];
  data: {
    integrity?: { gap: boolean; rulesToRemove: string[]; excludedTrackedCount: number } | null;
    upstream?: { exitCode: number | null };
    applied?: boolean;
    rulesRemoved?: string[];
    includePatternsAdded?: string[];
    filesRecovered?: number;
    includeAdmittedAfter?: number;
    trackedSourceCount?: number;
    reindexed?: boolean;
    forcedRebuild?: boolean;
    configPath?: string;
    backupPath?: string | null;
  };
} {
  return JSON.parse(captured.stdout.join('\n')) as ReturnType<typeof parseJson>;
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-cg-status-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  __m.executeCodegraphInvocation.mockReset();
  __m.executeCodegraphInvocation.mockResolvedValue({
    exitCode: 0,
    stdout: UPSTREAM_CLEAN_STDOUT,
    stderr: ''
  });
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

// ── a11y: the gate actually blocks ───────────────────────────────────

describe('peaks codegraph status (integrity gate)', () => {
  it(
    'when a tracked source file is excluded, should print the gap and exit non-zero',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      const captured = await runCodegraph(['status', '--project', project]);

      const out = captured.stdout.join('\n');
      expect(out).toContain('Index is up to date'); // upstream text still proxied
      expect(out).toContain('[FAIL] codegraph index is incomplete');
      expect(out).toContain('vendor/lib.ts');
      expect(out).toContain('**/vendor/**');
      // The exit code is the contract — read the real one, not the text.
      expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
      expect(CODEGRAPH_INTEGRITY_EXIT_CODE).not.toBe(0);
    }
  );

  it(
    'when the config carries an empty rule, should still gate the real gap with exit 74',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // Regression from the picomatch delegation: `picomatch('')` throws,
      // the throw was caught as an integrity warning, and this returned
      // exit 0 with `[WARN] … not evaluated` printed over a real gap. A
      // junk rule must never buy the gap a clean exit code.
      const project = seedProject(ws, 'gapped-empty-rule');

      const captured = await runCodegraph(['status', '--project', project]);
      const out = captured.stdout.join('\n');

      expect(out).not.toContain('[WARN]');
      expect(out).toContain('[FAIL] codegraph index is incomplete');
      expect(out).toContain('vendor/lib.ts');
      expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
    }
  );

  it(
    'when nothing is excluded, should leave the exit code alone and stay quiet',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'clean');

      const captured = await runCodegraph(['status', '--project', project]);

      expect(captured.stdout.join('\n')).not.toContain('[FAIL]');
      expect(process.exitCode).toBe(0);
    }
  );

  it(
    'when codegraph was never initialized, should stay silent instead of warning',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'uninitialized');

      const captured = await runCodegraph(['status', '--project', project]);

      const out = captured.stdout.join('\n');
      expect(out).not.toContain('[FAIL]');
      expect(out).not.toContain('[WARN]');
      expect(process.exitCode).toBe(0);
    }
  );

  it(
    'should not write to the config on the read path',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');
      const configPath = join(project, '.codegraph', 'config.json');
      const before = readFileSync(configPath, 'utf8');

      await runCodegraph(['status', '--project', project]);

      expect(readFileSync(configPath, 'utf8')).toBe(before);
      expect(existsSync(`${configPath}.bak`)).toBe(false);
    }
  );
});

// ── render: the OK line may not contradict the FAIL line ─────────────

describe('peaks codegraph status (no unqualified OK next to a gap)', () => {
  it(
    'when a gap exists, should not print an unqualified [OK] Index is up to date',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      const captured = await runCodegraph(['status', '--project', project]);
      const visible = stripAnsi(captured.stdout.join('\n'));

      // Two correct verdicts about two different questions were printed as
      // one contradiction, and the green OK is the line the eye lands on
      // first. It must not survive as a bare, unqualified claim.
      expect(visible).not.toContain('[OK] Index is up to date');
      // Attributed, not deleted: upstream's wording stays recognizable and
      // the statistics block around it is untouched, so nothing upstream
      // actually said is lost.
      expect(visible).toContain('[i] Index is up to date');
      expect(visible).toContain('Files:     1,133');
      expect(visible).toContain('[FAIL] codegraph index is incomplete');
      expect(visible).toContain('vendor/lib.ts');
      // The contract is still the exit code, not the prose.
      expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
    }
  );

  it(
    'when nothing is excluded, should proxy the upstream output byte-for-byte',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'clean');

      const captured = await runCodegraph(['status', '--project', project]);
      const out = captured.stdout.join('\n');

      // Regression guard for the other half of the fix: a clean run is
      // untouched down to the byte, ANSI sequences included.
      expect(out).toBe(UPSTREAM_CLEAN_STDOUT.trimEnd());
      expect(stripAnsi(out)).toContain('[OK] Index is up to date');
      expect(process.exitCode).toBe(0);
    }
  );

  it('when the marker is on another up-to-date line, should not attribute it to the index', () => {
    // FAILS BEFORE THE CHANGE: the rewrite keyed on `includes('up to date')`,
    // which is content-blind — this language-server line was rewritten into
    // `[i] Index is up to date (...)`, a claim about the INDEX that upstream
    // never made. A misattribution introduced by the change whose whole purpose
    // was to stop misleading output is the same defect, mirrored.
    const stdout = [
      '\x1b[32m[OK]\x1b[0m Language servers are up to date',
      '\x1b[32m[OK]\x1b[0m Index is up to date',
      '[OK] Something else is up to date (built 3m ago)'
    ].join('\n');

    const rewritten = stripAnsi(attributeUpstreamUpToDateLine(stdout)).split('\n');

    expect(rewritten[0]).toBe('[OK] Language servers are up to date');
    expect(rewritten[2]).toBe('[OK] Something else is up to date (built 3m ago)');
    // Only the index line is downgraded — and its own tail note is kept.
    expect(rewritten[1]).toContain('[i] Index is up to date');
    expect(rewritten[1]).not.toContain('[OK]');
  });

  it('when the index line carries a tail note, should downgrade the marker without dropping it', () => {
    // FAILS BEFORE THE CHANGE: the whole line was replaced by a canned string,
    // so anything upstream printed after the phrase was silently discarded —
    // in a change whose stated contract is "nothing upstream actually said is
    // lost".
    const stdout = '[OK] Index is up to date (last scan 2026-09-12, 3 files ahead)';

    const rewritten = stripAnsi(attributeUpstreamUpToDateLine(stdout));

    expect(rewritten).toContain('Index is up to date (last scan 2026-09-12, 3 files ahead)');
    expect(rewritten).toContain('(upstream: matches the last scan only');
    expect(rewritten.startsWith('[i] ')).toBe(true);
  });
});

// ── render: the CI-parseable report ──────────────────────────────────

describe('peaks codegraph status --peaks-json (machine report)', () => {
  it(
    'when gapped, should emit a failed envelope naming the rules and block on exit code',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      const captured = await runCodegraph(['status', '--project', project, '--peaks-json']);

      const envelope = parseJson(captured);
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe('CODEGRAPH_INDEX_INCOMPLETE');
      expect(envelope.data.integrity?.gap).toBe(true);
      expect(envelope.data.integrity?.rulesToRemove).toEqual(['**/vendor/**']);
      expect(envelope.data.integrity?.excludedTrackedCount).toBe(1);
      expect(envelope.data.upstream?.exitCode).toBe(0);
      expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
    }
  );

  it(
    'when the config carries an empty rule, should still fail the envelope on the real gap',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped-empty-rule');

      const captured = await runCodegraph(['status', '--project', project, '--peaks-json']);

      const envelope = parseJson(captured);
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe('CODEGRAPH_INDEX_INCOMPLETE');
      expect(envelope.data.integrity?.gap).toBe(true);
      expect(envelope.data.integrity?.rulesToRemove).toEqual(['**/vendor/**']);
      expect(envelope.data.integrity?.excludedTrackedCount).toBe(1);
      expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
    }
  );

  it(
    'when clean, should emit an ok envelope carrying the upstream result',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'clean');

      const captured = await runCodegraph(['status', '--project', project, '--peaks-json']);

      const envelope = parseJson(captured);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.integrity?.gap).toBe(false);
      expect(envelope.data.upstream?.exitCode).toBe(0);
      expect(process.exitCode).toBe(0);
    }
  );
});

// ── behavior + integration: the explicit repair path ─────────────────

describe('peaks codegraph repair-exclude', () => {
  it(
    'should drop the offending rule, back up the config, reindex, and close the gap',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');
      const configPath = join(project, '.codegraph', 'config.json');
      const before = readFileSync(configPath, 'utf8');

      const captured = await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);

      const envelope = parseJson(captured);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.applied).toBe(true);
      expect(envelope.data.rulesRemoved).toEqual(['**/vendor/**']);
      expect(envelope.data.filesRecovered).toBe(1);
      expect(envelope.data.reindexed).toBe(true);
      expect(process.exitCode).toBe(0);

      // byte-exact rollback copy on disk
      expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe(before);

      // the gap is actually closed — verified by re-reading, not by trust
      const after = await runCodegraph(['status', '--project', project, '--peaks-json']);
      expect(parseJson(after).data.integrity?.gap).toBe(false);
    }
  );

  it(
    'should be a no-op on a second run',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);
      process.exitCode = 0;
      const second = await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);

      expect(parseJson(second).data.applied).toBe(false);
      expect(process.exitCode).toBe(0);
    }
  );

  it(
    'when the follow-up index fails, should report the repair but exit non-zero',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');
      __m.executeCodegraphInvocation.mockResolvedValue({
        exitCode: 5,
        stdout: '',
        stderr: 'boom\n'
      });

      const captured = await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);

      const envelope = parseJson(captured);
      expect(envelope.data.applied).toBe(true);
      expect(envelope.data.reindexed).toBe(false);
      expect(process.exitCode).toBe(1);
    }
  );

  it(
    'should expose exactly the report type — the envelope and the fields cannot drift',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');
      // The report's own key set, from a real run of the step the CLI wraps. The
      // runner is injected so this needs no upstream process, and the config it
      // repairs is the one the CLI run below then finds already clean — the KEY
      // SET is what is under test, and it does not depend on the values.
      const report = await repairCodegraphExcludeFromProject(
        project,
        async () => ({ exitCode: 0, stdout: '', stderr: '' }),
        { reindex: false }
      );
      process.exitCode = 0;

      const captured = await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);

      // `repair-exclude` and `repair-index` share ONE envelope builder, so this
      // covers both. Equality rather than a subset, in both directions: a key the
      // envelope carries that the report no longer has is a residual field name
      // (a removed feature's ghost, still in every consumer's JSON), and a report
      // field the envelope omits is a fact the JSON consumer cannot see at all.
      expect(Object.keys(parseJson(captured).data).sort()).toEqual(Object.keys(report).sort());
    }
  );
});

// ── behavior + integration: `repair-index`, the remedy for exit 75 ────

describe('peaks codegraph repair-index', () => {
  it(
    'should repair both axes and rebuild FORCED — the dead-row purge path',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      const captured = await runCodegraph(['repair-index', '--project', project, '--peaks-json']);

      const envelope = parseJson(captured);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('codegraph.repair-index');
      expect(envelope.data.applied).toBe(true);
      // Both axes moved in ONE run: the include patterns upstream's template
      // omits, and the exclude rule the widened include made harmful.
      expect(envelope.data.rulesRemoved).toEqual(['**/vendor/**']);
      expect(envelope.data.includePatternsAdded).toEqual([
        '**/*.mjs',
        '**/*.cjs',
        '**/*.pyw',
        '**/*.hxx',
        '**/*.rake'
      ]);
      expect(envelope.data.reindexed).toBe(true);
      expect(envelope.data.forcedRebuild).toBe(true);
      expect(process.exitCode).toBe(0);

      // The load-bearing half: the FORCE flag reached the upstream process's
      // argv. `index --force` is upstream's `clear()` + full re-index, and that
      // `clear()` is the only way rows for files deleted in an earlier commit
      // are ever dropped — an incremental index only upserts.
      const indexCalls = __m.executeCodegraphInvocation.mock.calls
        .map((call) => call[0] as { subcommand: string; args: string[]; force?: boolean })
        .filter((invocation) => invocation.subcommand === 'index');
      expect(indexCalls).toHaveLength(1);
      expect(indexCalls[0]?.args).toContain('--force');

      // …and the repair is real, not just reported: re-reading `status` shows
      // the exclude gate closed.
      const after = await runCodegraph(['status', '--project', project, '--peaks-json']);
      expect(parseJson(after).data.integrity?.gap).toBe(false);

      const config = JSON.parse(
        readFileSync(join(project, '.codegraph', 'config.json'), 'utf8')
      ) as {
        include: string[];
        exclude: string[];
      };
      expect(config.include).toContain('**/*.mjs');
      expect(config.exclude).toEqual(['**/node_modules/**']);
      expect(existsSync(join(project, '.codegraph', 'config.json.bak'))).toBe(true);
    }
  );

  it(
    'should write nothing on a second run, and still rebuild — the documented exemption',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      await runCodegraph(['repair-index', '--project', project, '--peaks-json']);
      process.exitCode = 0;
      __m.executeCodegraphInvocation.mockClear();

      const second = await runCodegraph(['repair-index', '--project', project, '--peaks-json']);

      // Nothing left to write: no config rewrite, no new backup.
      expect(parseJson(second).data.applied).toBe(false);
      expect(parseJson(second).data.includePatternsAdded).toEqual([]);
      expect(parseJson(second).data.rulesRemoved).toEqual([]);

      // …but the forced rebuild still runs. Asserted rather than assumed,
      // because it is a deliberate asymmetry: a clean reconciliation does NOT
      // prove the index is complete (the coverage verdict is admission-only —
      // slice-001's known limitation), and it is the only run in which rows for
      // an earlier-deleted file are dropped. `repair-exclude` (the cheap verb)
      // is the one that skips the rebuild when there is nothing to write.
      expect(parseJson(second).data.reindexed).toBe(true);
      expect(parseJson(second).data.forcedRebuild).toBe(true);
      expect(__m.executeCodegraphInvocation).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(0);
    }
  );

  it(
    'should leave the gap CLOSED after repair-index — the invariant this verb exists for',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      // Before: the config blocks a tracked source file, and the gate says so —
      // the non-vacuity control, because a gate that reported `false` for
      // everything would satisfy the assertion below without measuring anything.
      const before = parseJson(
        await runCodegraph(['status', '--project', project, '--peaks-json'])
      );
      expect(before.data.integrity?.gap).toBe(true);

      await runCodegraph(['repair-index', '--project', project, '--peaks-json']);
      process.exitCode = 0;

      // After: the gap is CLOSED, which is the whole point of the verb (exit 75's
      // cause is gone). It is asserted by RE-READING `status` rather than by
      // trusting the repair's own envelope, and it is the assertion a
      // self-cancelling `'force'` — one that restored the pre-repair config —
      // would fail: the config would be gapped again and this would report true.
      const after = parseJson(await runCodegraph(['status', '--project', project, '--peaks-json']));
      expect(after.data.integrity?.gap).toBe(false);
      // The gate RAN and returned a real verdict, rather than being absent
      // (`null`) in a way that `?.gap` would have turned into `undefined`.
      expect(typeof after.data.integrity?.gap).toBe('boolean');

      // …and the bytes it is judged on are the ones the run wrote.
      const config = JSON.parse(
        readFileSync(join(project, '.codegraph', 'config.json'), 'utf8')
      ) as {
        include: string[];
        exclude: string[];
      };
      expect(config.include).toContain('**/*.mjs');
      expect(config.exclude).not.toContain('**/vendor/**');
    }
  );

  it(
    'on the human path, should name what changed on both axes',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');

      const captured = await runCodegraph(['repair-index', '--project', project]);
      const printed = captured.stdout.join('\n');

      expect(printed).toContain('Added 5 include pattern(s)');
      expect(printed).toContain('removed 1 exclude rule(s)');
    }
  );

  it(
    'on the human path, should report the real coverage RATIO, not "N of N"',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');
      // An UPPERCASE extension: `detectLanguage` lowercases, so `.MJS` IS
      // extractor-supported, while every `include` pattern in both templates
      // matches case-SENSITIVELY, so no repair admits it. That is slice-002's
      // declared limitation 1, and the one shape in which an honest coverage
      // ratio must report a shortfall.
      //
      // The denominator used to be the reconciler's ADMITTED count — the
      // numerator's own expression — so the clause could only ever print
      // "N of N"; on this fixture it printed NOTHING (before and after were both
      // 2), telling the operator the gap was closed when one supported file was
      // still unadmitted.
      writeFileSync(join(project, 'src', 'Tool.MJS'), 'export const tool = 1;\n', 'utf8');
      execFileSync('git', ['-C', project, 'add', '-A'], { stdio: 'ignore', windowsHide: true });

      const captured = await runCodegraph(['repair-index', '--project', project]);
      const printed = captured.stdout.join('\n');

      // 3 supported tracked files (ok.ts, vendor/lib.ts, Tool.MJS), 2 admitted.
      expect(printed).toContain('Include now admits 2 of 3 extractor-supported tracked file(s).');
      expect(printed).not.toContain('of 2 extractor-supported');
    }
  );

  it(
    'should refuse a LINK planted at the backup path, leaving the victim and the config intact',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');
      const configPath = join(project, '.codegraph', 'config.json');
      const before = readFileSync(configPath, 'utf8');
      // The exploit the security audit reproduced: a repo commits
      // `.codegraph/config.json.bak` as a link to an arbitrary file plus a
      // config that merely OMITS an extension, and a normal repair run writes
      // the config's bytes through the link. The repair verbs are the seam an
      // operator (or the LLM, per Human-NL-Choice-Only) is explicitly told to
      // run, so the refusal has to hold here, not only in the writer.
      const victimPath = join(project, 'victim.txt');
      writeFileSync(victimPath, 'ORIGINAL VICTIM\n', 'utf8');
      linkSync(victimPath, `${configPath}.bak`);

      const captured = await runCodegraph(['repair-index', '--project', project, '--peaks-json']);
      const envelope = parseJson(captured);

      // Fails CLOSED and loudly: no repair claimed, a named reason, exit 1.
      expect(envelope.ok).toBe(true);
      expect(envelope.data.applied).toBe(false);
      expect(envelope.warnings?.join('\n')).toContain('refusing to write through');
      expect(readFileSync(victimPath, 'utf8')).toBe('ORIGINAL VICTIM\n');
      expect(readFileSync(configPath, 'utf8')).toBe(before);
      expect(process.exitCode).toBe(1);
    }
  );

  it(
    'should write and report under the CANONICAL project root when --project is an alias',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws, 'gapped');
      // A directory alias for the same tree: a junction where the OS allows one
      // without elevation (Windows), a plain directory symlink otherwise.
      const aliasRoot = join(ws.path, '..', `peaks-cg-alias-${process.pid}-${Date.now()}`);
      try {
        symlinkSync(project, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
          return;
        }
        throw error;
      }

      try {
        // Non-vacuity control: the alias really is a different path string for
        // the same tree, so the assertion below can fail.
        expect(realpathSync.native(aliasRoot)).not.toBe(aliasRoot);

        const captured = await runCodegraph([
          'repair-index',
          '--project',
          aliasRoot,
          '--peaks-json'
        ]);
        const envelope = parseJson(captured);

        // Before the fix this reported (and wrote through) the alias path,
        // because the repair verb hand-rolled `resolve()` and skipped the
        // canonicalizer every codegraph invocation goes through.
        expect(envelope.data.configPath).toBe(
          join(realpathSync.native(project), '.codegraph', 'config.json')
        );
        expect(envelope.data.backupPath).toBe(
          join(realpathSync.native(project), '.codegraph', 'config.json.bak')
        );
        expect(existsSync(envelope.data.backupPath ?? '')).toBe(true);
      } finally {
        rmSync(aliasRoot, { recursive: true, force: true });
      }
    }
  );
});
