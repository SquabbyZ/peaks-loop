import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { runDesignCheck } from '../../../src/cli/commands/design-commands.js';
import {
  CHECK_BLOCKED_ACTIONS,
  SOURCE_ONLY_DIAGNOSTIC
} from '../../../src/services/design/acceptance.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';

declareDimensions('tests/unit/cli/design-gate-evidence-write.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
let savedExitCode: typeof process.exitCode;
beforeEach(() => {
  savedExitCode = process.exitCode;
});
afterEach(() => {
  process.exitCode = savedExitCode;
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-cli-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'routes'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0' } }),
    'utf8'
  );
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(join(root, 'src', 'routes', 'a.tsx'), 'export const A = () => <div />;\n', 'utf8');
  return root;
}

/** The project binding `getSessionIdCanonical` reads, i.e. what `session info --active` reports. */
function bindSession(root: string, sessionId: string): void {
  const runtime = join(root, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
  writeFileSync(
    join(runtime, 'session.json'),
    JSON.stringify({ sessionId, projectRoot: root }),
    'utf8'
  );
}

describe('Scenario: behavior — --gate writes conformance evidence', () => {
  it('when --gate has a rid and a session, should write the pair and name the markdown', async () => {
    // given: an adopted app, a session, a request id, and a clean page
    // when: the gated check runs source-only
    // then: both files exist and the envelope names the project-relative markdown
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r1',
        sessionId: 'session-1',
        sourceOnly: true,
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      data: { verdict: string; evidencePath: string; sha256: string };
    };
    const designDir = join(root, '.peaks', '_runtime', 'session-1', 'design');
    expect(existsSync(join(designDir, 'check-r1.md'))).toBe(true);
    expect(existsSync(join(designDir, 'check-r1.json'))).toBe(true);
    expect(parsed.data.verdict).toBe('blocked');
    expect(parsed.data.evidencePath.endsWith('design/check-r1.md')).toBe(true);
    expect(parsed.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(process.exitCode).toBe(2);
  });

  it('when G1 fails, should still write the evidence and exit 1 with a fail marker', async () => {
    // given: an adopted app whose page carries an inline style
    // when: the gated check runs without an acceptance
    // then: the verdict fails, the pair is written, and the markdown says so
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(
      join(root, 'src', 'routes', 'a.tsx'),
      "export const A = () => <div style={{ color: 'red' }} />;\n",
      'utf8'
    );
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r2',
        sessionId: 'session-1',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { data: { verdict: string } };
    const markdown = readFileSync(
      join(root, '.peaks', '_runtime', 'session-1', 'design', 'check-r2.md'),
      'utf8'
    );
    expect(parsed.data.verdict).toBe('fail');
    expect(markdown).toContain('design-conformance: fail');
    expect(process.exitCode).toBe(1);
  });

  it('when G1 fails under an acceptance, should keep the fail marker and exit 1', async () => {
    // given: an adopted app whose page carries an inline style, and a user
    //        acceptance recorded through --allow-source-only
    // when: the gated check runs
    // then: the acceptance cannot upgrade the fail — the result and the markdown
    //       both stay fail, and the exit code is the fail code
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(
      join(root, 'src', 'routes', 'a.tsx'),
      "export const A = () => <div style={{ color: 'red' }} />;\n",
      'utf8'
    );
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r9',
        sessionId: 'session-1',
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      data: { verdict: string; acceptedBy: string };
    };
    const markdown = readFileSync(
      join(root, '.peaks', '_runtime', 'session-1', 'design', 'check-r9.md'),
      'utf8'
    );
    expect(parsed.data.verdict).toBe('fail');
    expect(parsed.data.acceptedBy).toBe('session-1');
    expect(markdown).toContain('design-conformance: fail');
    expect(markdown).not.toContain('design-conformance: accepted');
    expect(process.exitCode).toBe(1);
  });

  it('when only the active binding supplies the session, should write the evidence', async () => {
    // given: an adopted app with a project session binding and no --session-id
    // when: the gated check runs
    // then: the bound session owns the pair
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    bindSession(root, 'bound-session-7');
    const { io } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r3',
        sourceOnly: true,
        json: true
      },
      io,
      {}
    );
    const designDir = join(root, '.peaks', '_runtime', 'bound-session-7', 'design');
    expect(existsSync(join(designDir, 'check-r3.md'))).toBe(true);
    expect(existsSync(join(designDir, 'check-r3.json'))).toBe(true);
    expect(process.exitCode).toBe(2);
  });

  it('when the gated check passes its own warning set, should print it once', async () => {
    // given: an adopted app, a session, and the source-only diagnostic flag
    // when: the gated check writes its evidence
    // then: the envelope names the command and carries exactly the check warning
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r4',
        sessionId: 'session-1',
        sourceOnly: true,
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      command: string;
      warnings: string[];
      nextActions: string[];
    };
    expect(parsed.command).toBe('design.check');
    expect(parsed.warnings).toEqual([SOURCE_ONLY_DIAGNOSTIC]);
    expect(parsed.nextActions).toEqual(CHECK_BLOCKED_ACTIONS.DESIGN_RENDER_REQUIRED);
  });

  it('when --gate carries an acceptance in CI, should refuse it before the check', async () => {
    // given: an adopted app, a session, an acceptance note and a CI environment
    // when: the gated check runs with --allow-source-only
    // then: it refuses with the acceptance code instead of writing evidence
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r5',
        sessionId: 'session-1',
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        json: true
      },
      io,
      { CI: 'true' }
    );
    const parsed = JSON.parse(captured.text()) as { code: string; nextActions: string[] };
    expect(parsed.code).toBe('DESIGN_SOURCE_ONLY_NOT_INTERACTIVE');
    expect(parsed.nextActions.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(3);
    expect(existsSync(join(root, '.peaks', '_runtime', 'session-1', 'design'))).toBe(false);
  });

  it('when --gate carries an acceptance interactively, should record it as accepted', async () => {
    // given: an adopted app, a session and the user's own acceptance words
    // when: the gated check runs with --allow-source-only outside CI
    // then: the written evidence says a human accepted it and names the session
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r6',
        sessionId: 'session-1',
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { data: { acceptedBy: string } };
    const markdown = readFileSync(
      join(root, '.peaks', '_runtime', 'session-1', 'design', 'check-r6.md'),
      'utf8'
    );
    expect(parsed.data.acceptedBy).toBe('session-1');
    expect(markdown).toContain('design-conformance: accepted');
    expect(process.exitCode).toBe(0);
  });

  it('when a non-frontend project runs --gate, should write not-applicable and exit 0', async () => {
    // given: a Go repository with no frontend app root
    // when: the gated check runs
    // then: the evidence says the contract does not apply and the exit code is pass
    const root = mkdtempSync(join(tmpdir(), 'peaks-design-cli-'));
    roots.push(root);
    writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      { project: root, gate: true, rid: 'r10', sessionId: 'session-1', json: true },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      data: { verdict: string; errorCode: string };
    };
    const markdown = readFileSync(
      join(root, '.peaks', '_runtime', 'session-1', 'design', 'check-r10.md'),
      'utf8'
    );
    expect(parsed.data.verdict).toBe('not-applicable');
    expect(parsed.data.errorCode).toBe('DESIGN_NOT_FRONTEND');
    expect(markdown).toContain('design-conformance: not-applicable');
    expect(process.exitCode).toBe(0);
  });

  it('when the gated check prints as text, should render the data with its warning', async () => {
    // given: an adopted app and a gated source-only check with JSON off
    // when: the check writes its evidence
    // then: stdout carries the result data itself and the warning is on stderr
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r8',
        sessionId: 'session-1',
        sourceOnly: true
      },
      io,
      {}
    );
    const printed = JSON.parse(captured.lines()[0] ?? 'null') as Record<string, unknown>;
    expect(printed).not.toHaveProperty('command');
    expect(printed.verdict).toBe('blocked');
    expect(captured.stderrText()).toContain(`warning: ${SOURCE_ONLY_DIAGNOSTIC}`);
    expect(captured.text()).toContain('next: ');
    expect(process.exitCode).toBe(2);
  });
});
