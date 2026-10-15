// tests/unit/cli/commands/best-practice-scan-envelope.test.ts
//
// The failure envelope's own surface: what it carries, and what it must never
// carry. Two arms added in repair round 2 — a stack trace on the render path
// when the artifact path is not a file, and document-supplied text reaching a
// terminal unescaped. Split from `best-practice-scan-refusals.test.ts` because
// the 500-line test cap is real.
//
// Dimensions covered:
//   - a11y:        the envelope's fields and the exact text a terminal receives
//   - render:      (omitted — no table is rendered on either path here)
//   - behavior:    (omitted — both arms assert the failure surface, not control flow)
//   - integration: (omitted — the failing write is the subject, and it is asserted
//                   through the envelope rather than by inspecting the filesystem)

import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { registerBestPracticeScanCommand } from '../../../../src/cli/commands/best-practice-scan-command.js';

declareDimensions(
  'tests/unit/cli/commands/best-practice-scan-envelope.test.ts',
  ['a11y'],
  [
    { dim: 'render', reason: 'neither path renders a table — both refuse' },
    { dim: 'behavior', reason: 'both arms assert the failure surface, not control flow' },
    { dim: 'integration', reason: 'the failing write is asserted through the envelope' }
  ]
);

const INTENT = 'add a caching layer';
const STDIN_SEAM = 'PEAKS_BEST_PRACTICE_STDIN';

let projectRoot: string;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bps-envelope-'));
  exitBefore = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
});

/** `<project>/best-practice/<date>-<slug>.md` — the primary artifact path. */
function primary(slug: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(projectRoot, 'best-practice', `${date}-${slug}.md`);
}

function writeResults(name: string, raw: string): string {
  const path = join(projectRoot, name);
  writeFileSync(path, raw, 'utf8');
  return path;
}

/** A results file that a valid scan would render from. */
function hitFile(): string {
  return writeResults(
    'hit.json',
    JSON.stringify({
      intent: INTENT,
      context7: { ok: true, results: [{ title: 't', url: 'https://d/a', snippet: 's' }] }
    })
  );
}

async function runCli(
  args: readonly string[]
): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerBestPracticeScanCommand(program, io);
  await program.parseAsync(['best-practice-scan', ...args], { from: 'user' });
  return captured;
}

describe('a11y — the failure envelope carries no stack and echoes no document text', () => {
  it('when the artifact path is a directory, should fail without a stack and name the path', async () => {
    // given: a VALID injected scan and a directory sitting where the artifact goes
    const file = hitFile();
    mkdirSync(primary('add-a-caching-layer'), { recursive: true });
    withEnv(STDIN_SEAM, '');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      file,
      '--json'
    ]);

    // then: it fails, the message names what is wrong, and no stack leaks
    const out = captured.text();
    expect(process.exitCode).toBe(1);
    expect(out).toContain('BEST_PRACTICE_SCAN_FAILED');
    expect(out).not.toContain('"stack"');
    expect(out).toContain('EISDIR');
  });

  it('when an unknown key carries an escape and a newline, should sanitise it out of the message', async () => {
    // given: a document-supplied key name hostile to a terminal — the escape
    // paints it, the newline forges a line this command did not author
    const file = writeResults(
      'hostile-key.json',
      `{"intent":${JSON.stringify(INTENT)},"\\u001b[31mA\\nB":{"ok":true,"results":[]}}`
    );

    // when: non-JSON mode, where the message reaches a terminal unescaped
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      file
    ]);

    // then: no raw ESC, and no line the command did not author
    const stderr = captured.stderrText();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('unknown top-level key');
    expect(stderr).not.toContain('\u001b');
    expect(stderr.split('\n')).toHaveLength(2);
  });
});
