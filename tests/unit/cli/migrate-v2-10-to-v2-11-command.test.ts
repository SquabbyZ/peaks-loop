/**
 * TDD coverage for `peaks migrate v2-10-to-v2-11` CLI
 * (`src/cli/commands/migrate-v2-10-to-v2-11-command.ts`).
 *
 * Verifies:
 *   - Dry-run default: applied=false, writtenCount=0, but plan populated
 *   - `--apply`: applied=true, writtenCount>0, file actually has banner
 *   - `--json` envelope shape: top-level ok/data/warnings
 *   - Help text does NOT mention `peaks workspace migrate-1-4-1`
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import { registerMigrateV2ToV11Command } from '../../../src/cli/commands/migrate-v2-10-to-v2-11-command.js';
import type { ProgramIO } from '../../../src/cli/cli-helpers.js';

const TECH_DOC_BODY = [
  '# Tech doc',
  '',
  '## Architecture',
  '',
  'Module split: A / B / C',
  ''
].join('\n');

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'peaks-v2-cli-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeTechDoc(sid: string): string {
  const dir = join(workDir, '.peaks', sid, 'rd');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'tech-doc.md');
  writeFileSync(filePath, TECH_DOC_BODY, 'utf8');
  return filePath;
}

function makeProgram(): { program: Command; getOut: () => string; getErr: () => string } {
  const program = new Command();
  const out: string[] = [];
  const err: string[] = [];
  const io: ProgramIO = {
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s)
  };
  const workspace = program.command('workspace');
  registerMigrateV2ToV11Command(workspace, io);
  return { program, getOut: () => out.join(''), getErr: () => err.join('') };
}

describe('peaks migrate v2-10-to-v2-11 — CLI contract', () => {
  test('dry-run default: applied=false, writtenCount=0, plan populated', async () => {
    writeTechDoc('2026-06-25-session-cli-dry');
    const { program, getOut } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'workspace', 'migrate-v2-10-to-v2-11', '--project', workDir]);
    const envelope = JSON.parse(getOut());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.applied).toBe(false);
    expect(envelope.data.writtenCount).toBe(0);
    expect(envelope.data.plan.willDeprecateCount).toBe(1);
    expect(envelope.data.errors).toEqual([]);
  });

  test('--apply: applied=true, writtenCount>0, file actually has banner', async () => {
    const filePath = writeTechDoc('2026-06-25-session-cli-apply');
    const { program, getOut } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'workspace', 'migrate-v2-10-to-v2-11', '--project', workDir, '--apply']);
    const envelope = JSON.parse(getOut());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.applied).toBe(true);
    expect(envelope.data.writtenCount).toBe(1);
    const after = readFileSync(filePath, 'utf8');
    expect(after.startsWith('---\ndeprecated: historical\n')).toBe(true);
  });

  test('--json envelope shape: ok / data / warnings at top level', async () => {
    writeTechDoc('2026-06-25-session-cli-json');
    const { program, getOut } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'workspace', 'migrate-v2-10-to-v2-11', '--project', workDir]);
    const envelope = JSON.parse(getOut());
    expect(typeof envelope.ok).toBe('boolean');
    expect(envelope.data).toBeDefined();
    expect(envelope.data.plan).toBeDefined();
    expect(Array.isArray(envelope.warnings)).toBe(true);
  });

  test('help text does NOT mention peaks workspace migrate-1-4-1', () => {
    const program = new Command();
    const io: ProgramIO = { stdout: () => {}, stderr: () => {} };
    const workspace = program.command('workspace');
    registerMigrateV2ToV11Command(workspace, io);
    const migrateCmd = workspace.commands.find((c) => c.name() === 'migrate-v2-10-to-v2-11');
    expect(migrateCmd).toBeDefined();
    const help = migrateCmd?.helpInformation() ?? '';
    expect(help).not.toContain('migrate-1-4-1');
  });

  test('handles empty project (no sessions): applied=false, all counts 0', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'peaks-cli-empty-'));
    try {
      const { program, getOut } = makeProgram();
      await program.parseAsync(['node', 'peaks', 'workspace', 'migrate-v2-10-to-v2-11', '--project', emptyDir]);
      const envelope = JSON.parse(getOut());
      expect(envelope.ok).toBe(true);
      expect(envelope.data.applied).toBe(false);
      expect(envelope.data.plan.willDeprecateCount).toBe(0);
      expect(envelope.data.plan.alreadyDeprecatedCount).toBe(0);
      expect(envelope.data.plan.notTechDocCount).toBe(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
