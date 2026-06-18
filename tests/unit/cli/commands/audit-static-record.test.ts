/**
 * Slice K1 (2.8.0) — CLI integration test for `peaks audit static --record`.
 *
 * Verifies that the new `--record` / `--rid` flags on the existing
 * `peaks audit static` subcommand correctly persist an audit decision
 * to `.peaks/memory/audit-decisions/<slug>.md`. Per the K1 design,
 * `--record` is added to the existing command (NOT a new top-level
 * subcommand) so the dev-preference red line "Default-no on new CLI
 * commands" is honored.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerAuditCommands, type StaticAuditData } from '../../../../src/cli/commands/audit-commands.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';
import type { ResultEnvelope } from '../../../../src/shared/result.js';

function captureIo(): { io: ProgramIO; stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  const io: ProgramIO = {
    stdout: (text: string) => out.push(text),
    stderr: (text: string) => err.push(text)
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cli/audit-commands: peaks audit static --record', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-k1-audit-cli-'));
  });

  afterEach(() => {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes a decision record when --record is passed', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'audit',
      'static',
      '--project',
      projectRoot,
      '--record',
      '--json'
    ]);

    const envelope = JSON.parse(stdout()) as ResultEnvelope<StaticAuditData>;
    expect(envelope.ok).toBe(true);
    expect(envelope.data.decision).toBeDefined();
    // Path is OS-native — assert via path.normalize on both sides so the test
    // works on Windows (backslashes) and POSIX (forward slashes) alike.
    const filePath = envelope.data.decision!.filePath;
    const normalized = filePath.replaceAll('\\', '/');
    expect(normalized).toContain('.peaks/memory/audit-decisions/audit-decision-');
    expect(existsSync(filePath)).toBe(true);

    // Body has the canonical sections and the locked no-context invariant.
    const body = readFileSync(envelope.data.decision!.filePath, 'utf8');
    expect(body).toContain('  type: decision');
    expect(body).toContain('## Summary');
    expect(body).toContain('## Per-Rule Decisions');
    expect(body).toContain('## Enforcer Findings');
    expect(body).not.toMatch(/\bcontext\s*:/);
  });

  it('omits the decision record when --record is NOT passed (no regression)', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'audit',
      'static',
      '--project',
      projectRoot,
      '--json'
    ]);

    const envelope = JSON.parse(stdout()) as ResultEnvelope<StaticAuditData>;
    expect(envelope.ok).toBe(true);
    expect(envelope.data.decision).toBeUndefined();
    // Decision file was NOT created.
    expect(existsSync(join(projectRoot, '.peaks', 'memory', 'audit-decisions'))).toBe(false);
  });

  it('uses --rid to disambiguate the slug', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'audit',
      'static',
      '--project',
      projectRoot,
      '--record',
      '--rid',
      'redline-snapshot',
      '--json'
    ]);

    const envelope = JSON.parse(stdout()) as ResultEnvelope<StaticAuditData>;
    expect(envelope.ok).toBe(true);
    // Slug format: `audit-decision-<date>-<rid>` — date is between prefix and rid.
    expect(envelope.data.decision?.name).toMatch(
      /^audit-decision-\d{4}-\d{2}-\d{2}-redline-snapshot$/
    );
    const filePath = envelope.data.decision!.filePath.replaceAll('\\', '/');
    expect(filePath).toMatch(
      /audit-decision-\d{4}-\d{2}-\d{2}-redline-snapshot\.md$/
    );
  });

  it('returns FLAGS_CONFLICT when --rid is passed without --record', async () => {
    const { io, stdout, stderr } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    // The action sets `process.exitCode = 1` (soft exit) and returns —
    // exitOverride does NOT intercept that, so parseAsync resolves normally.
    await program.parseAsync([
      'node',
      'peaks',
      'audit',
      'static',
      '--project',
      projectRoot,
      '--rid',
      'orphan',
      '--json'
    ]);

    // Failure envelope is written to stderr in JSON mode; check both.
    const output = stdout() + stderr();
    expect(output).toContain('FLAGS_CONFLICT');
    expect(output).toContain('`--rid` requires `--record`');
    expect(process.exitCode).toBe(1);
  });
});