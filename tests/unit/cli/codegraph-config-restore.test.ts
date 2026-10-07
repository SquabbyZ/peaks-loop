// tests/unit/cli/codegraph-config-restore.test.ts
//
// 4-dimension CLI test for `peaks codegraph config-restore` — the EXPLICIT undo
// of a codegraph config repair, and the only reader of the byte-exact
// `codegraph.json.bak` a repair leaves behind.
//
// Why the verb exists at all, in one sentence: the repair seams must NOT
// restore their own write. A `'force'` repair that rolled its config write back
// would leave the config exactly as it found it, `peaks codegraph status` would
// still report the gap, and exit 75 would never clear — the verb would cancel
// itself out. So the `.bak` is written and left, and putting the config BACK is
// an operator decision: this command, and nothing else.
//
// What is mocked and why: only the upstream binary spawn
// (`executeCodegraphInvocation`), because most cases need a real `.bak` and the
// cheapest honest way to produce one is the real `repair-exclude` verb. The
// reconcile, the config write, the backup, the restore, the exit code and the
// envelopes all run for real against a real temp git work tree.
//
// Dimensions covered:
//   - render:      the `--peaks-json` envelope and the human-path output
//   - behavior:    restored vs refused, and every refusal shape
//   - integration: real git + real fs + a real repair→restore round trip
//   - a11y:        the exit codes (0 / 77 / 1) and the loud refusal text
//
// Split (b1 filesplit campaign): this file keeps render / behavior /
// integration; the a11y dimension (exit codes and the loud refusal text)
// lives in codegraph-config-restore-exit-codes.test.ts. Shared fixtures are
// in codegraph-config-restore-support.ts, moved verbatim.
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-config-restore.test.ts

import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import {
  backupPathOf,
  configPathOf,
  parseJson,
  repairOnce,
  runCodegraph,
  seedProject
} from './codegraph-config-restore-support.js';

declareDimensions(
  'tests/unit/cli/codegraph-config-restore.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the exit codes and the loud refusal text live in codegraph-config-restore-exit-codes.test.ts'
    }
  ]
);

const __m = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn()
}));

vi.mock('../../../src/services/codegraph/codegraph-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/codegraph/codegraph-service.js')
  >('../../../src/services/codegraph/codegraph-service.js');
  return { ...actual, executeCodegraphInvocation: __m.executeCodegraphInvocation };
});

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-cg-restore-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  __m.executeCodegraphInvocation.mockReset();
  __m.executeCodegraphInvocation.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

// ── render: the envelope ─────────────────────────────────────────────

describe('render — the config-restore envelope', () => {
  it(
    'should report the restored pair as `from` and `to`, with a null reason',
    async () => {
      const project = seedProject(ws);
      await repairOnce(project);

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);
      const envelope = parseJson(captured);

      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('codegraph.config-restore');
      expect(envelope.data.restored).toBe(true);
      // `from` is the rollback POINT the bytes came out of, `to` is the config
      // they landed in. Named individually rather than as one boolean, so a
      // consumer can tell a restore from a "nothing needed doing".
      expect(envelope.data.from).toBe(backupPathOf(project));
      expect(envelope.data.to).toBe(configPathOf(project));
      expect(envelope.data.reason).toBeNull();
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'on the human path, should print the same fields and name the next step',
    async () => {
      const project = seedProject(ws);
      await repairOnce(project);

      const captured = await runCodegraph(['config-restore', '--project', project]);

      const printed = captured.text();
      expect(printed).toContain('"restored": true');
      expect(printed).toContain('"reason": null');
      // A restore does NOT rebuild the index, so the operator is told rather than
      // left to infer it.
      expect(printed).toContain('next: Run `peaks codegraph index`');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ── behavior: restored vs refused ────────────────────────────────────

describe('behavior — every refusal shape, and what survives it', () => {
  it(
    'should refuse when there is no backup, and invent no restore point',
    async () => {
      const project = seedProject(ws);
      const before = readFileSync(configPathOf(project), 'utf8');
      expect(existsSync(backupPathOf(project))).toBe(false);

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);
      const envelope = parseJson(captured);

      // Loud, not silent: `ok: false`, a machine-readable reason, a named cause.
      expect(envelope.ok).toBe(false);
      expect(envelope.data.restored).toBe(false);
      expect(envelope.data.reason).toContain('cannot read');
      expect(envelope.data.reason).toContain(backupPathOf(project));
      expect(envelope.data.from).toBeNull();
      expect(envelope.data.to).toBeNull();
      // Fails closed: the config keeps the bytes it had.
      expect(readFileSync(configPathOf(project), 'utf8')).toBe(before);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'should refuse a HARD LINK at the backup path, leaving both files alone',
    async () => {
      const project = seedProject(ws);
      // The shape this platform always allows, and the one that matters: reading
      // through it would publish a file nobody reviewed into the config.
      const victim = join(project, 'victim.json');
      writeFileSync(victim, '{"INJECTED":true}\n', 'utf8');
      linkSync(victim, backupPathOf(project));
      const before = readFileSync(configPathOf(project), 'utf8');

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);
      const envelope = parseJson(captured);

      expect(envelope.ok).toBe(false);
      expect(envelope.data.reason).toContain('refusing to restore through a hard link');
      expect(readFileSync(configPathOf(project), 'utf8')).toBe(before);
      expect(readFileSync(victim, 'utf8')).toBe('{"INJECTED":true}\n');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'should refuse a SYMBOLIC LINK at the backup path — the write-side guard, mirrored',
    async () => {
      const project = seedProject(ws);
      const victim = join(project, 'victim.json');
      writeFileSync(victim, '{"INJECTED":true}\n', 'utf8');

      try {
        symlinkSync(victim, backupPathOf(project), 'file');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') {
          throw error;
        }
        // Windows without Developer Mode cannot create a file symlink. A junction
        // is the link this platform can always build and Node reports
        // `isSymbolicLink()` for it, so the case still exercises the branch it
        // names. The real file-symlink branch runs on POSIX CI.
        symlinkSync(join(project, '.codegraph'), backupPathOf(project), 'junction');
      }

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

      expect(parseJson(captured).ok).toBe(false);
      expect(parseJson(captured).data.reason).toContain(
        'refusing to restore through a symbolic link'
      );
      expect(readFileSync(configPathOf(project), 'utf8')).not.toContain('INJECTED');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'should refuse a DIRECTORY at the backup path',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws);
      mkdirSync(backupPathOf(project));

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

      expect(parseJson(captured).ok).toBe(false);
      // "at", not "through": there is nowhere for the bytes to land.
      expect(parseJson(captured).data.reason).toContain('refusing to restore at a directory');
    }
  );
});

// ── integration: the real round trip ─────────────────────────────────

describe('integration — repair then restore, against real files', () => {
  it(
    'should put the config back byte-for-byte to where it was before the repair',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedProject(ws);
      const original = readFileSync(configPathOf(project), 'utf8');

      await repairOnce(project);
      // Non-vacuity control: the repair really moved the file, so the assertion
      // below is a RESTORE and not a no-op that never had anything to undo.
      expect(readFileSync(configPathOf(project), 'utf8')).not.toBe(original);

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

      expect(parseJson(captured).data.restored).toBe(true);
      expect(readFileSync(configPathOf(project), 'utf8')).toBe(original);
      // The rollback point survives the restore, so a second restore is possible
      // and the operator can undo an accidental one by repairing again.
      expect(existsSync(backupPathOf(project))).toBe(true);
    }
  );

  it(
    'should hand the backup`s own mode back to the config',
    async () => {
      const project = seedProject(ws);
      await repairOnce(project);
      // READ-ONLY, chosen rather than arbitrary: `chmod` on Windows only toggles
      // the read-only bit (0o640 and 0o600 both read back as 0o666), so a 0o640
      // assertion would pass here whatever the restore did.
      chmodSync(backupPathOf(project), 0o444);
      const backupMode = statSync(backupPathOf(project)).mode & 0o777;

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

      expect(parseJson(captured).data.restored).toBe(true);
      expect(statSync(configPathOf(project)).mode & 0o777).toBe(backupMode);

      // cleanup: leave the fixture removable on Windows
      chmodSync(configPathOf(project), 0o666);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'should spawn NO upstream subprocess — it only touches the config file',
    async () => {
      const project = seedProject(ws);
      await repairOnce(project);
      __m.executeCodegraphInvocation.mockClear();

      const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

      expect(parseJson(captured).data.restored).toBe(true);
      expect(__m.executeCodegraphInvocation).not.toHaveBeenCalled();

      // Non-vacuity: the counter is live — the verb the `.bak` came from DID
      // spawn upstream, so "not called" is a property of this verb and not of a
      // counter that can never move.
      __m.executeCodegraphInvocation.mockClear();
      await runCodegraph(['repair-index', '--project', project, '--peaks-json']);
      expect(__m.executeCodegraphInvocation).toHaveBeenCalled();
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
