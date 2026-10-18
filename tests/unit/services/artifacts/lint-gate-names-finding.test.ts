// tests/unit/services/artifacts/lint-gate-names-finding.test.ts
//
// The lint refusal must name the FINDING, not count it. Measured at HEAD 802862b9 on
// the artifact `peaks request init --role prd` writes: the body lint reports six
// error-severity findings — two unfilled `<placeholder>` tokens and four `- ...`
// stubs — and `LintGateError` carried only `errorCount`, so the whole refusal was
// `6 lint error(s) found in artifact`. The linter had already computed the line, the
// offending text and the rule's own reason for each one, and the throw discarded all
// three. A producer was told HOW MANY placeholders were wrong and not one of them
// WHERE or WHY.
//
// WHERE THE GATE IS REACHABLE, and why the case is at `confirmed-by-user` rather than
// at `handed-off`: the lint gate's condition is `existing.state === 'draft'`, and the
// state-order gate runs BEFORE it. For role `prd` the order is `draft` ->
// `confirmed-by-user` -> `handed-off`, so a `draft -> handed-off` call is refused as
// a forward jump and never reaches the lint at all. The single step out of `draft` is
// the only shape that can show this refusal — and it is the shape a producer
// actually takes. `prd:confirmed-by-user` carries no prerequisite row, so the
// prerequisite gate cannot answer in the lint gate's place.
//
// The artifact is produced by the REAL `request init`, not by a hand-written fixture:
// the defect is about the template the CLI writes, and a fixture would let this file
// pass against a template the CLI does not emit.
//
// Dimensions covered:
//   - integration: three real CLI actions over a real session tree
//   - a11y:        the refusal line a producer reads, and the machine-readable
//                  `data.findings` that rides beside it
//   - render:      OMITTED — the envelope shape is asserted inside a11y, where the
//                  same payload is read as text
//   - behavior:    OMITTED — no branch of the gate itself is exercised; the gate's
//                  condition and the bypass are pinned in
//                  tests/unit/services/artifacts/request-transition-state-order.test.ts
//
// Run with: pnpm exec vitest run tests/unit/services/artifacts/lint-gate-names-finding.test.ts

import { Command } from 'commander';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { registerRequestCommands } from '../../../../src/cli/commands/request-commands.js';

declareDimensions(
  'tests/unit/services/artifacts/lint-gate-names-finding.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the envelope shape is asserted inside a11y, where the same payload is read as text'
    },
    {
      dim: 'behavior',
      reason:
        "the gate's condition and its --allow-incomplete bypass are pinned in tests/unit/services/artifacts/request-transition-state-order.test.ts"
    }
  ]
);

const SESSION_ID = '2026-10-16-lint-gate-naming';
const RID = '2026-10-16-lint-gate-probe';
/**
 * `request init` resolves a CALLER id before it writes: flag, then
 * `PEAKS_CALLER_ID`, then the active IDE adapter. With none of the three the
 * adapter throws `PEAKS_CALLER_NOT_RESOLVED`, the action prints
 * `CALLER_ID_INVALID` and returns **without writing anything** — no throw, so a
 * caller that does not read `io` sees a silent no-op. Pinning the flag is what
 * makes this file hermetic: it ran green on a developer host purely because the
 * ambient harness exports `CLAUDE_CODE_SESSION_ID`, and red in CI where nothing
 * does. Same rule, same reason, as
 * `tests/unit/cli/commands/request-init-session-resolution.test.ts`.
 */
const CALLER_ID = 'lint-gate-test-caller';

type LintFinding = { line: number; text: string; reason: string };

/** True for a C0 / DEL / C1 code point — the range the CLI printer replaces. */
function hasControlCharacter(text: string): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });
}

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** One in-process CLI invocation against `project`, with its output captured. */
async function runCli(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerRequestCommands(program, io);
  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch {
    // `exitOverride` re-throws the code `process.exitCode` already carries; the
    // captured output and that exit code are the subject here, not the throw.
  }
  return captured;
}

/** The artifact `peaks request init --role prd` writes, in a fresh session tree. */
async function initPrdArtifact(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'peaks-lint-gate-'));
  roots.push(root);
  await runCli([
    'request',
    'init',
    '--role',
    'prd',
    '--id',
    RID,
    '--project',
    root,
    '--session-id',
    SESSION_ID,
    '--apply',
    '--caller-id',
    CALLER_ID,
    '--json'
  ]);
  return root;
}

/** The artifact's on-disk path — what `request lint` reports and the refusal must name. */
function artifactPath(root: string): string {
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
  return join(dir, readdirSync(dir).find((name) => name.endsWith('.md')) ?? '');
}

function transition(root: string, json: boolean): Promise<CapturedIo> {
  const argv = [
    'request',
    'transition',
    RID,
    '--role',
    'prd',
    '--state',
    'confirmed-by-user',
    '--project',
    root,
    '--session-id',
    SESSION_ID
  ];
  return runCli(json ? [...argv, '--json'] : argv);
}

function envelopeOf(captured: CapturedIo): {
  ok: boolean;
  code?: string;
  message?: string;
  data: { path?: string; findings?: LintFinding[]; errorCount?: number };
} {
  return JSON.parse(captured.text().trim()) as {
    ok: boolean;
    code?: string;
    message?: string;
    data: { path?: string; findings?: LintFinding[]; errorCount?: number };
  };
}

describe('Scenario: a11y — the lint refusal names the finding, not only its count', () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it('when the transition leaves draft with an unfilled template, should name the artifact and the first finding line, text and reason', async () => {
    // given: the template `request init --role prd` writes, which carries six
    //        unfilled placeholders
    const root = await initPrdArtifact();

    // when: the transition out of `draft` is attempted without the bypass
    const captured = await transition(root, false);

    // then: it is refused, and the operator reads WHICH line is wrong and WHY —
    //       three literals the previous refusal never carried
    expect(process.exitCode).toBe(1);
    const printed = captured.stderrText();
    // and the refusal names the file the producer must edit — the same path
    // `peaks request lint` reports for this rid
    expect(printed).toContain(`lint error(s) found in ${artifactPath(root)}.`);
    expect(printed).toContain('- Line 4: ');
    expect(printed).toContain('<ticket, message URL, or "verbal" with a short sanitized quote>');
    expect(printed).toContain('Contains an unfilled <placeholder> token');
    // and the second rule's own wording reaches the reader too, so the line above
    // is not the only rule that can name itself
    expect(printed).toContain('Bullet point is only "..."');
  });

  it('when --json is passed, should carry every error-severity finding on the envelope', async () => {
    // given: the same artifact and the same refusal
    const root = await initPrdArtifact();

    // when: the transition is asked for a machine-readable envelope
    const envelope = envelopeOf(await transition(root, true));

    // then: the findings ride the payload with all three fields, one per lint error
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('LINT_GATE_FAILED');
    // the refusal carries the linted artifact's path, in the message and in `data`,
    // matching what `request lint` reports for the same rid
    const path = artifactPath(root);
    expect(envelope.data.path).toBe(path);
    expect(envelope.message).toContain(path);
    const findings = envelope.data.findings ?? [];
    expect(findings).toHaveLength(6);
    expect(envelope.data.errorCount).toBe(6);
    for (const finding of findings) {
      expect(typeof finding.line).toBe('number');
      expect(finding.text.length).toBeGreaterThan(0);
      expect(finding.reason.length).toBeGreaterThan(0);
      // the line number names a real line of the artifact, not an offset
      expect(finding.line).toBeGreaterThan(0);
    }
    // the first finding is the one the human arm prints first
    expect(findings[0]?.reason).toBe('Contains an unfilled <placeholder> token');
    // and no finding is a bare count: the pair of counts above came FROM this list
    expect(new Set(findings.map((f) => f.line)).size).toBe(findings.length);
  });

  it('when an artifact line carries control characters, should print them as `?` and forge no line', async () => {
    // given: an artifact whose offending line holds a raw carriage return, a BEL and
    //        a NUL — the content this refusal now prints is a LINE OF A FILE, so it
    //        is the one field a crafted artifact gets to choose
    const root = await initPrdArtifact();
    const { readdirSync, readFileSync, writeFileSync } = await import('node:fs');
    const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
    const path = join(dir, readdirSync(dir).find((name) => name.endsWith('.md')) ?? '');
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(/- source: .*/, '- source: <a\rBEL\u0007and\u0000NUL>'),
      'utf8'
    );

    // when: the refusal is rendered on the human arm
    const captured = await transition(root, false);

    // then: no control character reaches the output, and the injected text cannot
    //       start a line of this command's own — one write per line, none forged
    expect(captured.stderr.every((line) => !hasControlCharacter(line))).toBe(true);
    expect(captured.stderrText()).toContain('a?BEL?and?NUL');
    expect(captured.stderr.some((line) => line.startsWith('forged'))).toBe(false);
  });

  it('when every placeholder is filled, should let the transition through — the control', async () => {
    // given: the same artifact with the lint's own rules satisfied
    const root = await initPrdArtifact();
    const { readdirSync, readFileSync, writeFileSync } = await import('node:fs');
    const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
    // The filename carries the `<NNN>-` prefix `request init` writes, so it is read
    // off the directory rather than spelled here.
    const path = join(dir, readdirSync(dir).find((name) => name.endsWith('.md')) ?? '');
    writeFileSync(
      path,
      readFileSync(path, 'utf8')
        .replace(/- source: .*/g, '- source: verbal (user), quoted in the request body')
        .replace(/- raw input \(sanitized\): .*/g, '- raw input (sanitized): a probe artifact')
        .replace(/^- \.\.\.$/gm, '- filled with real content'),
      'utf8'
    );

    // when: the same transition runs
    const captured = await transition(root, true);

    // then: no lint refusal is produced — so the two cases above are the lint's own
    //       findings rather than a gate that refuses everything
    expect(process.exitCode).toBeUndefined();
    const envelope = envelopeOf(captured);
    expect(envelope.code).not.toBe('LINT_GATE_FAILED');
    // and a clean transition is unchanged: it still reports the artifact it moved
    // under its existing `path`, with no lint findings and no lint sentence
    expect(envelope.data.path).toBe(artifactPath(root));
    expect(envelope.data.errorCount).toBeUndefined();
    expect(envelope.data.findings).toBeUndefined();
    expect(envelope.message ?? '').not.toContain('lint error(s)');
  });
});
