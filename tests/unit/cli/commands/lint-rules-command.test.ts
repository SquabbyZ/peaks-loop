// tests/unit/cli/commands/lint-rules-command.test.ts
//
// The `peaks lint rules` verb — the CLI surface of the rule pre-read.
//
// WHAT IS ASSERTED HERE is the WIRING, not the read: the service behind it is
// replaced by a seam, because the real read asks the project's own tooling
// and the language rule channel, and a test that spawned those would measure
// the network rather than the verb.
//
//   - the files and the project root reach the service as the user named them
//   - the answer comes back as the standard envelope
//   - a call with no files is REFUSED with a named code, because "no files"
//     and "no rules" are different answers
//
// Dimensions covered:
//   - behavior:    the options the verb forwards and the envelope it prints
//   - integration: the verb's boundary with the rule-pre-read service
//   - a11y:        the refusal a caller sees when the call is incomplete
// Omitted:
//   - render:      the envelope shape is asserted, not rendered by a human

import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const seam = vi.hoisted(() => ({
  calls: [] as Array<{ projectRoot: string; files: readonly string[] }>
}));

vi.mock('../../../../src/services/lint/rule-pre-read.js', () => ({
  RULES_RESOLVED_REASON: 'all three layers resolved',
  readEffectiveRules: (projectRoot: string, files: readonly string[]) => {
    seam.calls.push({ projectRoot, files });
    return {
      files: [...files],
      rules: [
        {
          layer: 'language' as const,
          source: 'ocr:system',
          pattern: '**/*.ts',
          rule: '#### Code Quality Checks'
        }
      ],
      detectedTools: ['eslint'],
      reason: 'all three layers resolved'
    };
  }
}));

import { registerLintCommands } from '../../../../src/cli/commands/lint-commands.js';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';

type Capture = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: typeof process.exitCode;
};

function makeIo(): { io: { stdout(s: string): void; stderr(s: string): void }; capture: Capture } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s)
    },
    capture: {
      get stdout() {
        return stdout.join('');
      },
      get stderr() {
        return stderr.join('');
      },
      get exitCode() {
        return process.exitCode;
      }
    }
  };
}

describe('peaks lint rules', () => {
  beforeEach(() => {
    seam.calls.length = 0;
  });

  it('when files and a project are named, should read the rules for exactly those files', async () => {
    // given: a fresh program and a service seam
    const { io } = makeIo();
    const program = new Command();
    registerLintCommands(program, io);
    const project = join(process.cwd(), 'scratch', 'rule-project');
    // when: the verb runs
    await program.parseAsync(
      ['lint', 'rules', '--files', 'src/a.ts', 'src/b.ts', '--project', project, '--json'],
      { from: 'user' }
    );
    // then: the service was asked for those files against that project
    expect(seam.calls).toHaveLength(1);
    expect(seam.calls[0]?.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(seam.calls[0]?.projectRoot).toBe(project);
  });

  it('when the verb runs, should print the rule set as the standard envelope', async () => {
    // given: a fresh program and a service seam
    const { io, capture } = makeIo();
    const program = new Command();
    registerLintCommands(program, io);
    // when: the verb runs
    await program.parseAsync(['lint', 'rules', '--files', 'src/a.ts', '--json'], { from: 'user' });
    // then: the envelope carries the layers' rules
    const envelope = parseCliEnvelope(capture.stdout.trim());
    expect(envelope.command).toBe('code.lint.rules');
    const data = envelope.data as { rules: Array<{ layer: string }>; detectedTools: string[] };
    expect(data.rules[0]?.layer).toBe('language');
    expect(data.detectedTools).toEqual(['eslint']);
  });

  it('when no files are named, should refuse with a named code instead of reading nothing', async () => {
    // given: a fresh program and a service seam
    const { io, capture } = makeIo();
    const program = new Command();
    registerLintCommands(program, io);
    // when: the verb runs without --files
    await program.parseAsync(['lint', 'rules', '--json'], { from: 'user' });
    // then: the refusal names the missing input, and nothing was read
    expect(capture.stdout).toContain('NO_FILES');
    expect(seam.calls).toHaveLength(0);
  });
});
