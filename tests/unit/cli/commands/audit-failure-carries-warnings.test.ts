// tests/unit/cli/commands/audit-failure-carries-warnings.test.ts
//
// The two audit CLIs' FAILURE envelopes must carry the detector's own diagnosis.
//
// `fail()` builds a fresh envelope whose `warnings` is hard-coded `[]`, so
// `printResult` had nothing to print on the human surface while `--json` kept the
// sentence one level down at `data.detect.warnings`. The service produced the
// warning — "peaks-prd handoff not found under <dir>" — and the caller dropped it
// before it was printed. The commands now spread `detect.warnings` over the
// failed envelope. These arms watch the whole surface:
//   - the failure envelope carries the service's warning, on BOTH surfaces (the
//     human stderr line and the `--json` top level)
//   - RED DIRECTION: a failure the service produced no warning for still reports
//     `warnings: []`, so the field stays a statement rather than a constant
//   - the success-path warning list is unchanged
//
// Dimensions:
//   - a11y:     the human-readable refusal, as printed to stderr
//   - behavior: the envelope's `warnings` against the service's own array
//   - render:   the `--json` envelope shape
//   - integration: the registered commander commands, a real temp project tree

import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { registerPerfAuditCommands } from '../../../../src/cli/commands/perf-audit-commands.js';
import { registerSecurityAuditCommands } from '../../../../src/cli/commands/security-audit-commands.js';

declareDimensions('tests/unit/cli/commands/audit-failure-carries-warnings.test.ts', [
  'a11y',
  'behavior',
  'render',
  'integration'
]);

const SID = '2026-10-12-session-audit-warn';
const RID = 'rid-audit-warn';

/** An envelope both strict-shape predicates accept. */
const VALID_ENVELOPE = { verdict: 'pass', violations: [], summary: 'clean' };

type AuditCli = {
  readonly label: string;
  readonly command: string;
  readonly register: (
    program: Command,
    io: { stdout(s: string): void; stderr(s: string): void }
  ) => void;
};

const AUDIT_CLIS: ReadonlyArray<AuditCli> = [
  {
    label: 'perf-audit',
    command: 'perf-audit',
    register: registerPerfAuditCommands
  },
  {
    label: 'security-audit',
    command: 'security-audit',
    register: registerSecurityAuditCommands
  }
];

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
  process.exitCode = 0;
});

beforeEach(() => {
  process.exitCode = 0;
});

/** A project tree with the `prd/` directory present and empty — a missing
 *  handoff, not a missing tree. The detector carries the warning for it. */
function treeWithoutHandoff(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-audit-warn-'));
  tempRoots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime', SID, 'prd'), { recursive: true });
  const envelopePath = join(root, 'envelope.json');
  writeFileSync(envelopePath, JSON.stringify(VALID_ENVELOPE), 'utf8');
  return root;
}

/** Run one audit CLI through its real commander wiring and capture both streams. */
async function runCli(
  cli: AuditCli,
  argv: readonly string[]
): Promise<{ stdout: string[]; stderr: string[] }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  cli.register(program, io);
  await program.parseAsync([cli.command, ...argv], { from: 'user' });
  return { stdout: [...captured.stdout], stderr: [...captured.stderr] };
}

describe('(behavior) a failed audit envelope carries the service diagnosis', () => {
  for (const cli of AUDIT_CLIS) {
    it(`should carry it in the ${cli.label} run arm, on the human surface`, async () => {
      const root = treeWithoutHandoff();
      const { stderr } = await runCli(cli, [
        'run',
        '--sid',
        SID,
        '--rid',
        RID,
        '--project',
        root,
        '--envelope',
        join(root, 'envelope.json')
      ]);

      const text = stderr.join('\n');
      // The refusal still refuses, by its own code...
      expect(text).toContain('HANDOFF_MISSING:');
      // ...and now prints the sentence the service produced, rather than dropping
      // it. `printResult` renders a failed envelope's warnings as `warning: …`.
      expect(text).toContain('warning: peaks-prd handoff not found under');
      // The non-vacuity control: the envelope's nextActions reach the same stream,
      // so this arm is not passing by printing an unrelated warning.
      expect(text).toContain('Missing peaks-prd handoff:');
    });

    it(`should keep the same warning on the ${cli.label} --json surface`, async () => {
      const root = treeWithoutHandoff();
      const { stdout } = await runCli(cli, [
        'run',
        '--sid',
        SID,
        '--rid',
        RID,
        '--project',
        root,
        '--envelope',
        join(root, 'envelope.json'),
        '--json'
      ]);

      const envelope = JSON.parse(stdout.join('\n')) as {
        ok: boolean;
        warnings: string[];
        data: { detect: { warnings: string[] } };
      };
      expect(envelope.ok).toBe(false);
      expect(envelope.warnings.length).toBeGreaterThan(0);
      // The top level now says what `data.detect` always said.
      expect(envelope.warnings).toEqual(envelope.data.detect.warnings);
      expect(envelope.warnings.join('\n')).toContain('peaks-prd handoff not found under');
    });

    it(`should also carry it in the ${cli.label} detect arm`, async () => {
      const root = treeWithoutHandoff();
      const { stdout } = await runCli(cli, [
        'detect',
        '--sid',
        SID,
        '--rid',
        RID,
        '--project',
        root,
        '--json'
      ]);

      const envelope = JSON.parse(stdout.join('\n')) as {
        ok: boolean;
        warnings: string[];
        data: { warnings: string[] };
      };
      expect(envelope.ok).toBe(false);
      expect(envelope.warnings).toEqual(envelope.data.warnings);
      expect(envelope.warnings.join('\n')).toContain('peaks-prd handoff not found under');
    });

    it(`should keep warnings empty on the ${cli.label} arm that has none`, async () => {
      // RED DIRECTION, and the field's whole meaning. This failure is raised by
      // the command itself before any detector ran, so the service produced no
      // warning at all — and `warnings: []` must stay the honest answer rather
      // than becoming a constant the arms above would also accept.
      const { stdout } = await runCli(cli, ['run', '--rid', RID, '--json']);
      const envelope = JSON.parse(stdout.join('\n')) as {
        ok: boolean;
        code: string;
        warnings: string[];
      };
      expect(envelope.code).toBe('SID_REQUIRED');
      expect(envelope.warnings).toEqual([]);
    });
  }
});
