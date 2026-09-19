// tests/unit/cli/skill-presence-generated-config-drift.test.ts
//
// S6 (2026-09-15) — D1: the staleness verdict has to REACH someone.
//
// G4 gives the project a stamp and `detectStaleGeneratedArtifacts` gives a
// decidable answer, but a detector nobody calls is a comment. The brief's D1
// requirement is "let the stale config be discoverable" — and the channel
// chosen is `peaks skill presence`, because CLAUDE.md makes it the one peaks
// call the LLM makes at the start of EVERY response. A rule that lives only in
// a SKILL.md body is compacted away; a warning riding the per-turn tool output
// is not (`.peaks/memory/per-turn-obligations-belong-in-per-turn-output.md`).
//
// These tests pin both renderings of that channel: the `--json` envelope the
// LLM parses, and the stderr line a human sees.
//
// Dimensions covered:
//   - render:      the drift notice as the LLM sees it (envelope) and as a
//                  human sees it (stderr)
//   - behavior:    stale vs current branch; the field is absent when current
//   - integration: real commander command + real project tree on disk
//   - a11y:        the notice is a single plain sentence, not a JSON blob
//                  stuffed into a human-facing line

import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { registerSkillCommand } from '../../../src/cli/commands/core/skill-command.js';
import {
  generatedArtifactsStampPath,
  writeGeneratedArtifactsStamp
} from '../../../src/services/workspace/generated-artifacts-stamp.js';

declareDimensions('tests/unit/cli/skill-presence-generated-config-drift.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const getWs = withTmpWorkspacePerTest('peaks-presence-drift-');

/** A project that has been initialized: a generated artifact exists on disk. */
function seedGeneratedArtifact(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.local.json'), '{}\n', 'utf8');
}

async function runPresence(
  projectRoot: string,
  extraArgs: readonly string[] = []
): Promise<{ stdout: string; stderr: string }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSkillCommand(program, io);
  await program.parseAsync(['skill', 'presence', '--project', projectRoot, ...extraArgs], {
    from: 'user'
  });
  return { stdout: captured.text(), stderr: captured.stderrText() };
}

describe('Scenario: render — generated-config drift rides `skill presence`', () => {
  it('reports the drift in the --json envelope the LLM reads', async () => {
    const ws = getWs();
    seedGeneratedArtifact(ws.path);
    // Forge the stamp `npm i -g peaks-loop@4.0.40` would have left behind.
    writeGeneratedArtifactsStamp(ws.path, { packageVersion: '4.0.40' });

    const { stdout } = await runPresence(ws.path, ['--json']);
    const envelope = JSON.parse(stdout) as {
      ok: boolean;
      warnings: string[];
      data: {
        generatedArtifacts?: { stale: boolean; reasons: string[]; onDiskPackageVersion: string };
      };
    };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.generatedArtifacts?.stale).toBe(true);
    expect(envelope.data.generatedArtifacts?.reasons).toContain('package-upgraded');
    expect(envelope.data.generatedArtifacts?.onDiskPackageVersion).toBe('4.0.40');
    // The remedy has to be IN the message, not inferable from it — the reader
    // is an LLM that must be able to act without guessing a command.
    expect(envelope.warnings.join('\n')).toContain('4.0.40');
    expect(envelope.warnings.join('\n')).toContain('peaks workspace init');
    expect(envelope.warnings.join('\n')).toContain('peaks upgrade --apply-init');
  });

  it('prints the same notice to stderr for a human running the command by hand', async () => {
    const ws = getWs();
    seedGeneratedArtifact(ws.path);
    writeGeneratedArtifactsStamp(ws.path, { packageVersion: '4.0.40' });

    const { stderr } = await runPresence(ws.path);

    expect(stderr).toContain('produced by peaks-loop 4.0.40');
    expect(stderr).toContain('peaks workspace init');
  });

  it('says NOTHING when the config is current — no field, no warning', async () => {
    const ws = getWs();
    seedGeneratedArtifact(ws.path);
    writeGeneratedArtifactsStamp(ws.path);

    const { stdout, stderr } = await runPresence(ws.path, ['--json']);
    const envelope = JSON.parse(stdout) as { data: Record<string, unknown> };

    expect(envelope.data.generatedArtifacts).toBeUndefined();
    expect(stderr).toBe('');
  });

  it('reports UNSTAMPED generated config — the population that reported the defect', async () => {
    const ws = getWs();
    seedGeneratedArtifact(ws.path);

    const { stdout } = await runPresence(ws.path, ['--json']);
    const envelope = JSON.parse(stdout) as {
      data: {
        generatedArtifacts?: {
          stale: boolean;
          reasons: string[];
          onDiskPackageVersion: string | null;
        };
      };
    };

    expect(envelope.data.generatedArtifacts?.stale).toBe(true);
    expect(envelope.data.generatedArtifacts?.reasons).toEqual(['unstamped']);
    expect(envelope.data.generatedArtifacts?.onDiskPackageVersion).toBeNull();
  });

  it('says nothing for a project with no generated config at all', async () => {
    const ws = getWs();

    const { stdout } = await runPresence(ws.path, ['--json']);
    const envelope = JSON.parse(stdout) as { data: Record<string, unknown> };

    expect(envelope.data.generatedArtifacts).toBeUndefined();
  });

  it('the stamp file is NOT one of the artifacts it inspects (no self-reference)', async () => {
    const ws = getWs();
    // A stamp with no artifact beside it: the project never generated anything,
    // so there is nothing to be behind.
    writeGeneratedArtifactsStamp(ws.path, { packageVersion: '0.0.1-does-not-exist' });

    const { stdout } = await runPresence(ws.path, ['--json']);
    const envelope = JSON.parse(stdout) as { data: Record<string, unknown> };

    expect(envelope.data.generatedArtifacts).toBeUndefined();
    // Sanity: the stamp really is on disk.
    expect(generatedArtifactsStampPath(ws.path)).toContain('generated-artifacts.json');
  });
});
