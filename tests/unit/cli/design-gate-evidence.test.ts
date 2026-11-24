import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { runDesignCheck } from '../../../src/cli/commands/design-commands.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';

declareDimensions('tests/unit/cli/design-gate-evidence.test.ts', [
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

describe('Scenario: behavior — --gate refusals name their reason and leave no evidence', () => {
  it('when --gate runs without --rid, should exit 3 and write no evidence', async () => {
    // given: an adopted app, a session, and no request id
    // when: the gated check runs
    // then: it refuses before judging and records nothing
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        sessionId: 'session-1',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_GATE_REQUIRES_RID');
    expect(process.exitCode).toBe(3);
    expect(existsSync(join(root, '.peaks', '_runtime', 'session-1', 'design'))).toBe(false);
  });

  it('when --gate runs with no session, should exit 3 and write no evidence', async () => {
    // given: an adopted app, a request id, and no session or binding
    // when: the gated check runs
    // then: it refuses before judging and records nothing
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      { project: root, files: 'src/routes/a.tsx', gate: true, rid: 'r1', json: true },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_GATE_REQUIRES_SESSION');
    expect(process.exitCode).toBe(3);
    expect(existsSync(join(root, '.peaks', '_runtime'))).toBe(false);
  });

  it('when the evidence path is refused, should exit 3 without a pass envelope', async () => {
    // given: an adopted app and a request id that is not one path segment
    // when: the gated check runs
    // then: the write is refused with the evidence code and nothing lands
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: '..',
        sessionId: 'session-1',
        sourceOnly: true,
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      ok: boolean;
      command: string;
      code: string;
      message: string;
      data: { projectRoot: string };
      nextActions: string[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.command).toBe('design.check');
    expect(parsed.code).toBe('DESIGN_EVIDENCE_WRITE_FAILED');
    expect(parsed.message).toContain('single path segment');
    expect(parsed.data).toEqual({ projectRoot: root });
    expect(parsed.nextActions).toEqual([
      'Fix the evidence path or the filesystem, then re-run the gated check.'
    ]);
    expect(process.exitCode).toBe(3);
    expect(existsSync(join(root, '.peaks', '_runtime', 'session-1', 'design'))).toBe(false);
  });

  it('when --gate has a blank rid, should refuse it like a missing one', async () => {
    // given: an adopted app, a session, and a whitespace-only request id
    // when: the gated check runs
    // then: the blank id is refused rather than used as a path segment
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: '   ',
        sessionId: 'session-1',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { code: string; message: string };
    expect(parsed.code).toBe('DESIGN_GATE_REQUIRES_RID');
    expect(parsed.message).toBe('--gate needs the request id the evidence belongs to.');
    expect(process.exitCode).toBe(3);
  });

  it('when --gate has a blank session, should refuse it like a missing one', async () => {
    // given: an adopted app with a request id and a whitespace-only session id
    // when: the gated check runs
    // then: the blank session is refused before any directory is created
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        gate: true,
        rid: 'r1',
        sessionId: '   ',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      code: string;
      message: string;
      data: { projectRoot: string };
      nextActions: string[];
    };
    expect(parsed.code).toBe('DESIGN_GATE_REQUIRES_SESSION');
    expect(parsed.message).toBe(
      '--gate records the evidence under the session runtime dir; no session resolved.'
    );
    expect(parsed.data).toEqual({ projectRoot: root });
    expect(parsed.nextActions).toEqual([
      'Pass --session-id, or run this work inside an active peaks session.'
    ]);
    expect(process.exitCode).toBe(3);
  });

  it('when a refusal renders as text, should print the code, message and action', async () => {
    // given: an adopted app with no rid and no JSON flag
    // when: the gated check refuses
    // then: the human-readable line and the action reach stderr, not stdout
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      { project: root, files: 'src/routes/a.tsx', gate: true, sessionId: 'session-1' },
      io,
      {}
    );
    expect(captured.text()).toBe('');
    expect(captured.stderrText()).toContain(
      'DESIGN_GATE_REQUIRES_RID: --gate needs the request id the evidence belongs to.'
    );
    expect(captured.stderrText()).toContain('- Re-run with --gate and --rid <rid>.');
    expect(process.exitCode).toBe(3);
  });

  it('when the judge itself throws, should refuse with DESIGN_CHECK_FAILED', async () => {
    // given: an adopted app and a design judge that throws instead of judging
    // when: the gated check runs
    // then: the throw becomes a named refusal, not a crash or a pass
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    vi.resetModules();
    vi.doMock('../../../src/services/design/design-check.js', () => ({
      checkDesign: async () => {
        throw new Error('engine crashed');
      },
      exitCodeForVerdict: () => 2
    }));
    try {
      const { runDesignCheck: freshRunDesignCheck } =
        await import('../../../src/cli/commands/design-commands.js');
      const { io, captured } = makeCapturedIo();
      await freshRunDesignCheck(
        {
          project: root,
          files: 'src/routes/a.tsx',
          gate: true,
          rid: 'r7',
          sessionId: 'session-1',
          json: true
        },
        io,
        {}
      );
      const parsed = JSON.parse(captured.text()) as {
        ok: boolean;
        code: string;
        message: string;
        nextActions: string[];
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('DESIGN_CHECK_FAILED');
      expect(parsed.message).toContain('engine crashed');
      expect(parsed.nextActions).toEqual([]);
      expect(process.exitCode).toBe(3);
    } finally {
      vi.doUnmock('../../../src/services/design/design-check.js');
      vi.resetModules();
    }
  });
});
