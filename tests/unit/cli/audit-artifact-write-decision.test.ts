// tests/unit/cli/audit-artifact-write-decision.test.ts
//
// rid-AA-001 — wire `peaks audit artifact write --kind decision` to the writer
// that already exists.
//
// `writeDecision` (src/services/audit/artifact-writer.ts:189) renders a
// RedLineAudit snapshot with the same renderer `peaks audit static --record`
// uses, and the other three kinds each call their own named writer from the
// same switch in `audit-commands.ts`. `decision` was the one case left as a
// stub refusing with "reserved for future direct-snapshot writes", so a caller
// already holding a RedLineAudit JSON (an archived scan, a machine-output
// envelope it wants to promote) had no path to archive it as a decision.
//
// What is mocked and why: nothing. The commander wiring, the writers, the
// memory-index read and the filesystem all run for real against a temp
// workspace. The only input is the JSON file handed to `--input`.
//
// Dimensions covered:
//   - behavior:    valid input writes; malformed input is refused by field
//                  name and writes nothing
//   - render:      the frontmatter the record carries, and dry-run's shape
//   - integration: real fs + the registered commander command
//   - a11y:        the refusal a good input gets must not claim the feature is
//                  unshipped, and `--input` must say JSON covers decision too
//
// Run with:
//   pnpm vitest run tests/unit/cli/audit-artifact-write-decision.test.ts

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/audit-artifact-write-decision.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

import { registerAuditCommands } from '../../../src/cli/commands/audit-commands.js';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

/** A minimal but structurally complete RedLineAudit, as a scan would emit it. */
function redLineAuditJson(): string {
  return `${JSON.stringify(
    {
      totalRedLines: 2,
      cliBacked: 1,
      partial: 0,
      proseOnly: 1,
      audit: [
        {
          id: 'rl-code-ban-001',
          rule: 'Code Commit Ban',
          source: 'catalog',
          backing: 'cli-backed',
          enforcerRef: 'tests/unit/standards/commit-ban.test.ts'
        },
        {
          id: 'rl-doc-lag-002',
          rule: 'Shipped Docs Lag',
          source: 'catalog',
          backing: 'prose-only',
          enforcerRef: null
        }
      ],
      enforcerFindings: [
        {
          enforcerId: 'enf-1',
          rule: 'Code Commit Ban',
          severity: 'pass',
          file: 'src/cli/commands/audit-commands.ts',
          detail: 'enforcer present'
        }
      ]
    },
    null,
    2
  )}\n`;
}

function writeInput(ws: TmpWorkspace, text: string): string {
  const path = ws.rel('audit-input.json');
  writeFileSync(path, text, 'utf8');
  return path;
}

async function runArtifactWrite(
  argv: readonly string[]
): Promise<{ captured: CapturedIo; envelope: Record<string, unknown> }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerAuditCommands(program, io);
  await program.parseAsync(['audit', ...argv], { from: 'user' });
  const text = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON envelope in output: ${text}`);
  return { captured, envelope: JSON.parse(text.slice(start)) as Record<string, unknown> };
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-audit-decision-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

describe('audit artifact write --kind decision (rid-AA-001) — behavior', () => {
  it('writes a decision record for a structurally valid RedLineAudit', async () => {
    const input = writeInput(ws, redLineAuditJson());

    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--rid',
      'rid-AA-001',
      '--json'
    ]);

    expect(envelope['ok']).toBe(true);
    const data = envelope['data'] as { filePath: string; kind: string; memoryDir: string };
    expect(data.kind).toBe('decision');
    // `memoryDir` is the memory root for every kind (resolvePath in
    // artifact-writer.ts:176); the kind's own directory rides in `filePath`.
    expect(data.memoryDir).toBe(join(ws.path, '.peaks', 'memory'));
    expect(data.filePath).toContain(join('memory', 'audit-decisions'));
    expect(existsSync(data.filePath)).toBe(true);
  });

  it('refuses an input missing a required count, naming the field', async () => {
    const broken = JSON.parse(redLineAuditJson()) as Record<string, unknown>;
    delete broken['totalRedLines'];
    const input = writeInput(ws, `${JSON.stringify(broken, null, 2)}\n`);

    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--json'
    ]);

    expect(envelope['ok']).toBe(false);
    expect(String(envelope['message'])).toContain('totalRedLines');
    const files = readFileSync(input, 'utf8');
    expect(files.length).toBeGreaterThan(0);
    expect(existsSync(join(ws.path, '.peaks', 'memory', 'audit-decisions'))).toBe(false);
  });

  it('refuses an audit entry that is not an object rather than writing junk', async () => {
    const broken = JSON.parse(redLineAuditJson()) as Record<string, unknown>;
    broken['audit'] = ['rl-code-ban-001'];
    const input = writeInput(ws, `${JSON.stringify(broken, null, 2)}\n`);

    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--json'
    ]);

    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('AUDIT_ARTIFACT_INPUT_INVALID');
    expect(String(envelope['message'])).toContain('audit');
    expect(String(envelope['message'])).not.toMatch(/reserved for future/i);
  });

  it('refuses input that is not JSON at all, without writing a record', async () => {
    const input = writeInput(ws, 'not json at all\n');

    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--json'
    ]);

    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('AUDIT_ARTIFACT_INPUT_INVALID');
    expect(existsSync(join(ws.path, '.peaks', 'memory', 'audit-decisions'))).toBe(false);
  });
});

describe('audit artifact write --kind decision (rid-AA-001) — render', () => {
  it('carries the decision frontmatter the static --record path carries', async () => {
    const input = writeInput(ws, redLineAuditJson());

    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--rid',
      'rid-AA-001',
      '--input',
      input,
      '--json'
    ]);

    const data = envelope['data'] as { filePath: string };
    const body = readFileSync(data.filePath, 'utf8');
    const frontmatter = body.slice(0, body.indexOf('---', 3));
    expect(frontmatter).toContain('  type: decision');
    expect(frontmatter).toContain('  auditType: red-lines');
    expect(frontmatter).toContain('  totalRedLines: 2');
    expect(frontmatter).toContain('  proseOnly: 1');
  });

  it('is queryable by artifactType like the other three kinds', async () => {
    const input = writeInput(ws, redLineAuditJson());

    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--json'
    ]);

    const data = envelope['data'] as { filePath: string };
    const body = readFileSync(data.filePath, 'utf8');
    expect(body.slice(0, body.indexOf('---', 3))).toContain('  artifactType: decision');
  });

  it('reports the path it would write and writes nothing under --dry-run', async () => {
    const input = writeInput(ws, redLineAuditJson());

    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--dry-run',
      '--json'
    ]);

    expect(envelope['ok']).toBe(true);
    const data = envelope['data'] as { filePath: string };
    expect(data.filePath.length).toBeGreaterThan(0);
    expect(existsSync(data.filePath)).toBe(false);
  });
});

describe('audit artifact write --kind decision (rid-AA-001) — integration', () => {
  it('lands in the same audit-decisions directory as peaks audit static --record', async () => {
    // given: a decision written through this path
    const input = writeInput(ws, redLineAuditJson());
    const { envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--json'
    ]);
    const data = envelope['data'] as { memoryDir: string; filePath: string };

    // then: the directory is the convention's, and the file sits inside it
    expect(data.memoryDir).toBe(join(ws.path, '.peaks', 'memory'));
    expect(
      data.filePath.startsWith(join(data.memoryDir, 'audit-decisions', 'audit-decision'))
    ).toBe(true);
    expect(readFileSync(data.filePath, 'utf8')).toContain('Code Commit Ban');
  });
});

describe('audit artifact write --kind decision (rid-AA-001) — a11y', () => {
  it('no longer tells a valid caller the feature is unshipped', async () => {
    const input = writeInput(ws, redLineAuditJson());

    const { captured, envelope } = await runArtifactWrite([
      'artifact',
      'write',
      '--project',
      ws.path,
      '--kind',
      'decision',
      '--input',
      input,
      '--json'
    ]);

    const text = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
    expect(envelope['ok']).toBe(true);
    expect(text).not.toMatch(/not implemented|reserved for future/i);
  });

  it('names JSON as the input shape for decision in the help text', () => {
    const program = new Command();
    const { io } = makeCapturedIo();
    registerAuditCommands(program, io);
    const audit = program.commands.find((command) => command.name() === 'audit');
    const artifact = audit?.commands.find((command) => command.name() === 'artifact');
    const write = artifact?.commands.find((command) => command.name() === 'write');
    const inputOption = write?.options.find((option) => option.long === '--input');
    expect(inputOption?.description).toContain('JSON for machine-output and decision');
  });
});
