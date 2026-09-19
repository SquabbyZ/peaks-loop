// tests/unit/cli/codegraph-config-restore.test.ts
//
// 4-dimension CLI test for `peaks codegraph config-restore` — the EXPLICIT undo
// of a codegraph config repair, and the only reader of the byte-exact
// `.codegraph/config.json.bak` a repair leaves behind.
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
// Run with: pnpm vitest run tests/unit/cli/codegraph-config-restore.test.ts

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
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

declareDimensions('tests/unit/cli/codegraph-config-restore.test.ts', [
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

import { registerCodegraphCommands } from '../../../src/cli/commands/codegraph-commands.js';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

// The restore's own exit code (its cause is operator-actionable, so it is not
// conflated with the generic 1 that a broken command produces).
const CONFIG_RESTORE_EXIT_CODE = 77;

async function runCodegraph(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', ...argv], { from: 'user' });
  return captured;
}

function parseJson(captured: CapturedIo): {
  ok: boolean;
  code?: string;
  message?: string;
  command?: string;
  data: {
    restored?: boolean;
    from?: string | null;
    to?: string | null;
    reason?: string | null;
    applied?: boolean;
  };
  nextActions?: string[];
} {
  return JSON.parse(captured.stdout.join('\n')) as ReturnType<typeof parseJson>;
}

// Canonicalized through `realpathSync.native`, because that is what the verb's
// own `resolveProjectRoot` does: on Windows an `mkdtemp` path arrives in 8.3
// short form (`SMALLM~1`) and the CLI reports the long form, so a comparison
// against the raw fixture path would fail on the platform rather than on the
// behaviour. Idempotent for an already-canonical path.
const configPathOf = (project: string): string =>
  join(realpathSync.native(project), '.codegraph', 'config.json');
const backupPathOf = (project: string): string => `${configPathOf(project)}.bak`;

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true });
}

// A real temp git work tree with a tracked source file the `exclude` config
// blocks (so a repair has work to do and therefore leaves a `.bak`).
function seedProject(ws: TmpWorkspace): string {
  git(ws.path, ['init', '-q']);
  git(ws.path, ['config', 'user.email', 'peaks-test@example.com']);
  git(ws.path, ['config', 'user.name', 'peaks test']);
  mkdirSync(join(ws.path, 'src'), { recursive: true });
  mkdirSync(join(ws.path, 'vendor'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(ws.path, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  git(ws.path, ['add', '-A']);
  git(ws.path, ['commit', '-qm', 'fixture']);

  mkdirSync(join(ws.path, '.codegraph'), { recursive: true });
  writeFileSync(
    configPathOf(ws.path),
    `${JSON.stringify(
      { version: 1, include: ['**/*.ts'], exclude: ['**/vendor/**', '**/node_modules/**'] },
      null,
      2
    )}\n`,
    'utf8'
  );

  return ws.path;
}

// The real repair verb, so the `.bak` under test is the one production writes.
async function repairOnce(project: string): Promise<void> {
  await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);
  process.exitCode = 0;
}

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
  it('should report the restored pair as `from` and `to`, with a null reason', async () => {
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
  });

  it('on the human path, should print the same fields and name the next step', async () => {
    const project = seedProject(ws);
    await repairOnce(project);

    const captured = await runCodegraph(['config-restore', '--project', project]);

    const printed = captured.text();
    expect(printed).toContain('"restored": true');
    expect(printed).toContain('"reason": null');
    // A restore does NOT rebuild the index, so the operator is told rather than
    // left to infer it.
    expect(printed).toContain('next: Run `peaks codegraph index`');
  });
});

// ── behavior: restored vs refused ────────────────────────────────────

describe('behavior — every refusal shape, and what survives it', () => {
  it('should refuse when there is no backup, and invent no restore point', async () => {
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
  });

  it('should refuse a HARD LINK at the backup path, leaving both files alone', async () => {
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
  });

  it('should refuse a SYMBOLIC LINK at the backup path — the write-side guard, mirrored', async () => {
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
  });

  it('should refuse a DIRECTORY at the backup path', async () => {
    const project = seedProject(ws);
    mkdirSync(backupPathOf(project));

    const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

    expect(parseJson(captured).ok).toBe(false);
    // "at", not "through": there is nowhere for the bytes to land.
    expect(parseJson(captured).data.reason).toContain('refusing to restore at a directory');
  });
});

// ── integration: the real round trip ─────────────────────────────────

describe('integration — repair then restore, against real files', () => {
  it('should put the config back byte-for-byte to where it was before the repair', async () => {
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
  });

  it('should hand the backup`s own mode back to the config', async () => {
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
  });

  it('should spawn NO upstream subprocess — it only touches the config file', async () => {
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
  });
});

// ── a11y: exit codes and the loud text ──────────────────────────────

describe('a11y — exit codes and the refusal text', () => {
  it('should exit 0 on a restore', async () => {
    const project = seedProject(ws);
    await repairOnce(project);

    await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

    expect(process.exitCode).toBe(0);
  });

  it('should exit with its OWN code, distinct from a broken invocation — measured at runtime', async () => {
    const project = seedProject(ws);
    mkdirSync(backupPathOf(project));

    // Both numbers come from REAL runs of this verb, not from comparing two
    // literals: `expect(77).not.toBe(1)` is decided by the compiler and can
    // never fail, so it proved nothing about what the command does. These two
    // runs are the two failure CLASSES the verb has to keep apart.
    process.exitCode = 0;
    await runCodegraph([
      'config-restore',
      '--project',
      join(ws.path, 'does-not-exist'),
      '--peaks-json'
    ]);
    const preconditionExit = process.exitCode;

    process.exitCode = 0;
    await runCodegraph(['config-restore', '--project', project, '--peaks-json']);
    const refusalExit = process.exitCode;

    expect(refusalExit).toBe(CONFIG_RESTORE_EXIT_CODE);
    expect(preconditionExit).toBe(1);
    // The claim the tautology was trying to make: a refused restore is NOT
    // reported with the code a mis-aimed invocation gets, so a CI job can tell
    // "your rollback point is unusable" from "your command was wrong".
    //
    // This is the SECOND assertion for that claim, not the first. Merging the
    // two codes trips the pin above — `expect(preconditionExit).toBe(1)` sees
    // 77 — and vitest stops there, so this line never runs. It adds no power of
    // its own; it is here to STATE the requirement, which the two pinned values
    // imply but never say out loud.
    expect(refusalExit).not.toBe(preconditionExit);
  });

  it('on the human path, should name the reason on STDERR (a refusal is not stdout news)', async () => {
    const project = seedProject(ws);

    const captured = await runCodegraph(['config-restore', '--project', project]);

    const stderr = captured.stderr.join('\n');
    expect(stderr).toContain('CODEGRAPH_CONFIG_RESTORE_FAILED');
    expect(stderr).toContain('cannot read');
    expect(captured.text()).not.toContain('"restored": true');
  });

  it('should carry a reason on the unusable-project path, not an empty data object', async () => {
    const captured = await runCodegraph([
      'config-restore',
      '--project',
      join(ws.path, 'does-not-exist'),
      '--peaks-json'
    ]);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_CONFIG_RESTORE_FAILED');
    // The requirement this case owns: EVERY failure path carries all four
    // `data` keys. A consumer reads `restored` and `reason` unconditionally, so
    // a `data: {}` envelope leaves it unable to tell a refused restore from a
    // mis-aimed command without string-matching the message.
    expect(envelope.data.restored).toBe(false);
    expect(envelope.data.from).toBeNull();
    expect(envelope.data.to).toBeNull();
    expect(envelope.data.reason).toBeTruthy();
    expect(envelope.data.reason).toContain('Project path must exist and be a directory');
    // The PRECONDITION class: nothing ever examined a rollback point, so the run
    // must not be reported with the code that means "your backup is unusable".
    // Same ordering as the case above: the pin is FIRST and the exclusion below
    // it is the second assertion for the same requirement — a merged code trips
    // the pin, so the exclusion cannot fail independently. It is kept as the
    // explicit statement of the requirement.
    expect(process.exitCode).toBe(1);
    expect(process.exitCode).not.toBe(CONFIG_RESTORE_EXIT_CODE);
  });

  it('should carry the containment guard`s own reason when `.codegraph` resolves outside the project', async () => {
    // A project root that is a SUBDIRECTORY of the workspace, so `.codegraph`
    // has a real directory outside it to point at. Junction on Windows (no
    // privilege needed), directory symlink on POSIX — the same shapes the repair
    // seam's own containment test uses.
    const project = join(ws.path, 'project');
    const outside = join(ws.path, 'outside', '.codegraph');
    mkdirSync(outside, { recursive: true });
    mkdirSync(project, { recursive: true });
    symlinkSync(
      outside,
      join(project, '.codegraph'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.data.restored).toBe(false);
    expect(envelope.data.reason).toBeTruthy();
    // The GUARD's own words, not a generic "something failed": that is what
    // makes the reason actionable, and it is why the envelope is built from the
    // thrown error rather than from a fixed string.
    expect(envelope.data.reason).toContain('refusing to write through it');
    expect(envelope.data.reason).toContain('which is not inside the project root');
    expect(process.exitCode).toBe(1);
  });
});
