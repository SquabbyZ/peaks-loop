// tests/unit/cli/commands/dispatch-prompt-file-ref.test.ts
//
// D2 (backlog 9.24): `peaks sub-agent dispatch --prompt "@<path>"` accepted the
// token as LITERAL text — the envelope reported `originalPromptSize` equal to
// the length of the string "@<path>" and the expanded prompt carried none of
// the brief, with no warning and exit 0. A sibling flag on a sibling command
// (`peaks prd handoff init --body`) already reads `@<file>`.
//
// Fix: `--prompt "@<path>"` is now a file reference, matching `--body`. A path
// that cannot be read is refused with PROMPT_FILE_NOT_FOUND naming `--prompt`;
// a `--prompt` that does not begin with `@` is returned byte-identical.
//
// RED-direction arm (the input the check exists to reject): an `@`-prefixed
// prompt whose path does not resolve. Controls: a real file is read, and a
// prompt with an `@` NOT at the start is untouched.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeCapturedIo } from '../../_setup/io.js';
import { registerSubAgentCommands } from '~/src/cli/commands/sub-agent-commands';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';

const SESSION_ID = '2026-10-12-session-74bd69';
const RID = 'rid-cli-says-what-it-requires';
const BRIEF_MARKER = 'D2-PROMPT-FILE-BRIEF-MARKER';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'dispatch-prompt-file-ref-'));
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the tmp dir; reapable either way.
  }
});

async function runDispatch(
  prompt: string
): Promise<{ envelope: ReturnType<typeof parseCliEnvelope>; stdout: string }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerSubAgentCommands(program, io);
  await program.parseAsync(
    [
      'sub-agent',
      'dispatch',
      'rd',
      '--prompt',
      prompt,
      '--request-id',
      RID,
      '--session-id',
      SESSION_ID,
      '--project',
      project,
      '--graph-node',
      'n1',
      '--json'
    ],
    { from: 'user' }
  );
  const stdout = captured.text();
  return { envelope: parseCliEnvelope(stdout.trim()), stdout };
}

describe('sub-agent dispatch --prompt @<file>', () => {
  it('when the path after @ does not resolve, should refuse with PROMPT_FILE_NOT_FOUND naming the flag', async () => {
    // given: a dispatch naming a brief file that is not on disk
    const missing = join(project, 'no-such-brief.md');

    // when: the real dispatch action runs
    const { envelope, stdout } = await runDispatch(`@${missing}`);

    // then: refused — not silently accepted as the literal token
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('PROMPT_FILE_NOT_FOUND');
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(envelope.message ?? '')).toContain('--prompt');
    // the refusal quotes the token the caller actually passed
    expect(stdout).toContain('@');
  });

  it('when the path after @ resolves to an EMPTY file, should refuse with MISSING_PROMPT naming the flag', async () => {
    // given: a brief file that exists and carries nothing — the input the
    // pre-read emptiness check cannot see, because it inspects the TOKEN not
    // the file. Before the post-read check, this dispatched ok: true with
    // originalPromptSize 0 and scaffolding only.
    const empty = join(project, 'empty.md');
    writeFileSync(empty, '', 'utf8');

    // when: the dispatch names it with @
    const { envelope } = await runDispatch(`@${empty}`);

    // then: refused, like the absent-prompt case, naming the flag
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('MISSING_PROMPT');
    expect(process.exitCode).toBe(1);
    expect(String(envelope.message)).toContain('--prompt');
  });

  it('when the path after @ resolves to a WHITESPACE-ONLY file, should refuse — same input, same door', async () => {
    // given: a file that trims to nothing
    const blank = join(project, 'blank.md');
    writeFileSync(blank, '   \n\t\n', 'utf8');

    // when: the dispatch names it with @
    const { envelope } = await runDispatch(`@${blank}`);

    // then: refused the same way
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('MISSING_PROMPT');
    expect(process.exitCode).toBe(1);
  });

  it('when a LITERAL prompt is whitespace only, should be accepted — the check is scoped to the file branch', async () => {
    // given: a whitespace-only prompt that does NOT begin with "@"
    const text = '   ';

    // when: the dispatch runs
    const { envelope } = await runDispatch(text);

    // then: untouched — the new post-read emptiness check did not widen to literals
    expect(envelope.ok).toBe(true);
    expect(envelope.data.originalPromptSize).toBe(text.length);
  });

  it('when the path after @ is a real file, should read it — the control', async () => {
    // given: a brief on disk
    const brief = join(project, 'brief.md');
    const body = `# brief\n${BRIEF_MARKER}\n`;
    writeFileSync(brief, body, 'utf8');

    // when: the dispatch names it with @
    const { envelope, stdout } = await runDispatch(`@${brief}`);

    // then: the file content is what was dispatched, not the token's length
    expect(envelope.ok).toBe(true);
    expect(envelope.data.originalPromptSize).toBe(body.length);
    expect(envelope.data.originalPromptSize).not.toBe(`@${brief}`.length);
    expect(stdout).toContain(BRIEF_MARKER);
  });

  it('when the prompt does not begin with @, should be untouched — byte-identical', async () => {
    // given: a prompt carrying an @ that is NOT a file reference
    const text = 'mail me at a@b.com — no file ref';

    // when: the dispatch runs
    const { envelope, stdout } = await runDispatch(text);

    // then: the text is sent verbatim, length intact
    expect(envelope.ok).toBe(true);
    expect(envelope.data.originalPromptSize).toBe(text.length);
    expect(stdout).toContain('mail me at a@b.com');
  });
});
