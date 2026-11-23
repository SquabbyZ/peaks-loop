import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  runDesignCheck,
  runDesignInit,
  runDesignStatus
} from '../../../src/cli/commands/design-commands.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';

declareDimensions('tests/unit/cli/design-commands.test.ts', [
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

describe('Scenario: render — JSON envelopes', () => {
  it('when init succeeds, should print an ok envelope with the written files', async () => {
    // given: a frontend app and a captured io sink
    // when: init runs as JSON
    // then: the envelope names the command and the files
    const root = makeApp();
    const { io, captured } = makeCapturedIo();
    await runDesignInit({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as {
      ok: boolean;
      command: string;
      data: { written: string[] };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('design.init');
    expect(parsed.data.written).toContain(join('design', 'contract.md'));
  });

  it('when status runs on a missing contract, should report adopted false', async () => {
    // given: a frontend app with no contract and a captured io sink
    // when: status runs
    // then: the envelope reports not adopted
    const root = makeApp();
    const { io, captured } = makeCapturedIo();
    await runDesignStatus({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as { data: { adopted: boolean } };
    expect(parsed.data.adopted).toBe(false);
  });
});

describe('Scenario: behavior — the source-only acceptance is interactive-only', () => {
  it('when the acceptance runs in CI, should refuse with exit 3', async () => {
    // given: an adopted app, a session, and a CI environment
    // when: check runs with --allow-source-only
    // then: it refuses before judging anything
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        sessionId: 'session-1',
        json: true
      },
      io,
      { CI: 'true' }
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_SOURCE_ONLY_NOT_INTERACTIVE');
    expect(process.exitCode).toBe(3);
  });

  it('when the acceptance has no session, should refuse with exit 3', async () => {
    // given: an adopted app and no session id
    // when: check runs with --allow-source-only
    // then: it refuses before judging anything
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_SOURCE_ONLY_NOT_INTERACTIVE');
    expect(process.exitCode).toBe(3);
  });

  it('when only an active binding supplies the session, should record it', async () => {
    // given: an adopted app with a project session binding and no --session-id
    // when: check runs with the acceptance
    // then: the bound session is recorded and the clean page passes
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    bindSession(root, 'bound-session-7');
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { data: { verdict: string; acceptedBy: string } };
    expect(parsed.data.verdict).toBe('pass');
    expect(parsed.data.acceptedBy).toBe('bound-session-7');
    expect(process.exitCode).toBe(0);
  });

  it('when the acceptance is interactive, should record the pass', async () => {
    // given: an adopted app, a session, and no CI
    // when: check runs with --allow-source-only and the note
    // then: the clean page passes
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        sessionId: 'session-1',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { data: { verdict: string; acceptedBy: string } };
    expect(parsed.data.verdict).toBe('pass');
    expect(parsed.data.acceptedBy).toBe('session-1');
    expect(process.exitCode).toBe(0);
  });
});

describe('Scenario: behavior — --source-only is a diagnostic, never an acceptance', () => {
  it('when only --source-only is given, should block instead of passing', async () => {
    // given: an adopted app, a clean page, and the diagnostic flag
    // when: check runs
    // then: it reports the source layer but cannot pass
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        sourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        sessionId: 'session-1',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      data: { verdict: string; errorCode: string };
    };
    expect(parsed.data.verdict).toBe('blocked');
    expect(parsed.data.errorCode).toBe('DESIGN_RENDER_NOT_IMPLEMENTED');
    expect(process.exitCode).toBe(2);
  });
});
