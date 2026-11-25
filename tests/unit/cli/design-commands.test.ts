import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  registerDesignCommands,
  runDesignCheck,
  runDesignInit,
  runDesignStatus
} from '../../../src/cli/commands/design-commands.js';
import { checkInput } from '../../../src/cli/commands/design-check-input.js';
import { SOURCE_ONLY_DIAGNOSTIC } from '../../../src/services/design/acceptance.js';
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

/** The `design check` command as Commander registers it — the `--help` surface. */
function checkCommand(): Command {
  const program = new Command();
  registerDesignCommands(program, makeCapturedIo().io);
  const design = program.commands.find((command) => command.name() === 'design');
  const check = design?.commands.find((command) => command.name() === 'check');
  if (check === undefined) throw new Error('design check is not registered');
  return check;
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
      data: {
        written: string[];
        primaryColor: unknown;
        primarySource: unknown;
        gaps: Array<{ code: string }>;
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('design.init');
    expect(parsed.data.written).toContain(join('design', 'contract.md'));
    expect(parsed.data.primaryColor).toBeNull();
    expect(parsed.data.primarySource).toBeNull();
    expect(parsed.data.gaps.map((gap) => gap.code)).toEqual(['DESIGN_PRIMARY_COLOR_MISSING']);
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
      warnings: string[];
    };
    expect(parsed.data.verdict).toBe('blocked');
    expect(parsed.data.errorCode).toBe('DESIGN_RENDER_REQUIRED');
    expect(parsed.warnings).toContain(SOURCE_ONLY_DIAGNOSTIC);
    expect(process.exitCode).toBe(2);
  });
});

describe('Scenario: behavior — S4 flags and the exemplified acceptance', () => {
  it('when design check --help renders, should list --skip-exemplar and --baseline-url', () => {
    // given: the registered design check command
    // when: its help is rendered
    // then: both S4 flags appear
    const help = checkCommand().helpInformation();
    expect(help).toContain('--skip-exemplar');
    expect(help).toContain('--baseline-url <url>');
  });

  it('when --skip-exemplar has no session, should refuse with exit 3 and judge nothing', async () => {
    // given: an adopted app, no session and the skip flag
    // when: check runs
    // then: it refuses before the design check and writes nothing
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        skipExemplar: true,
        acceptNote: 'my words',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_EXEMPLAR_NOT_INTERACTIVE');
    expect(process.exitCode).toBe(3);
  });

  it('when --skip-exemplar has a session but no note, should refuse with exit 3', async () => {
    // given: an adopted app and a session, but no acceptance note
    // when: check runs with the skip flag
    // then: it refuses for the missing note before judging
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        skipExemplar: true,
        sessionId: 'session-1',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_ACCEPT_NOTE_REQUIRED');
    expect(process.exitCode).toBe(3);
  });

  it('when --skip-exemplar runs in CI, should refuse with exit 3', async () => {
    // given: an adopted app, a session, a note and a CI environment
    // when: check runs with the skip flag
    // then: the interactive-only rule refuses it
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        skipExemplar: true,
        sessionId: 'session-1',
        acceptNote: 'my words',
        json: true
      },
      io,
      { CI: 'true' }
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_EXEMPLAR_NOT_INTERACTIVE');
    expect(process.exitCode).toBe(3);
  });

  it('when both acceptances are recorded, should pass and name the session', async () => {
    // given: an adopted app, a session, a note and both acceptance flags
    // when: check runs with source-only and the exemplar skip
    // then: the accepted pass records the session and never runs G3
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        allowSourceOnly: true,
        skipExemplar: true,
        sessionId: 'session-1',
        acceptNote: 'I accept both for this pilot',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      data: { verdict: string; acceptedBy: string; checks: { g3_exemplar: unknown } };
    };
    expect(parsed.data.verdict).toBe('pass');
    expect(parsed.data.acceptedBy).toBe('session-1');
    expect(parsed.data.checks.g3_exemplar).toEqual({ g3a: [], g3b: [] });
    expect(process.exitCode).toBe(0);
  });

  it('when --baseline-url is given for two changed routes, should refuse and write nothing', async () => {
    // given: an adopted app whose change touches two pages and one explicit baseline URL
    // when: the gated check runs
    // then: the scope refusal exits 3 and no evidence pair is written
    const root = makeApp();
    writeFileSync(
      join(root, 'src', 'routes', 'b.tsx'),
      'export const B = () => <div />;\n',
      'utf8'
    );
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx,src/routes/b.tsx',
        baselineUrl: 'http://127.0.0.1:4311/',
        rid: 'r1',
        sessionId: 'session-1',
        gate: true,
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_BASELINE_URL_SCOPE');
    expect(process.exitCode).toBe(3);
    expect(existsSync(join(root, '.peaks', '_runtime', 'session-1', 'design', 'check-r1.md'))).toBe(
      false
    );
    expect(
      existsSync(join(root, '.peaks', '_runtime', 'session-1', 'design', 'check-r1.json'))
    ).toBe(false);
  });

  it('when the input builder runs, should carry the S4 flags through', () => {
    // given: the CLI option record with both S4 flags
    // when: the check input is built
    // then: the skip flag and the explicit baseline URL reach the check
    const input = checkInput(
      { project: 'repo', skipExemplar: true, baselineUrl: 'http://127.0.0.1:4311/' },
      false
    );
    expect(input.skipExemplar).toBe(true);
    expect(input.baselineUrl).toBe('http://127.0.0.1:4311/');
  });
});

describe('Scenario: behavior — the check exposes the G2 inputs', () => {
  it('when design check --help renders, should list --url, --pages, --start and --gate', () => {
    // given: the registered design check command
    // when: its help is rendered
    // then: the G2 inputs and the S3 gate all appear
    const help = checkCommand().helpInformation();
    expect(help).toContain('--url');
    expect(help).toContain('--pages');
    expect(help).toContain('--start');
    expect(help).toContain('--gate');
  });

  it('when a check runs without an acceptance, should not warn that S1 has no engine', async () => {
    // given: an adopted app and a trusted URL on a closed port
    // when: check runs with no source-only flag
    // then: it blocks on the render layer without the retired S1 warning
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const { io, captured } = makeCapturedIo();
    await runDesignCheck(
      {
        project: root,
        files: 'src/routes/a.tsx',
        url: 'http://127.0.0.1:1/',
        json: true
      },
      io,
      {}
    );
    const parsed = JSON.parse(captured.text()) as {
      data: { verdict: string };
      warnings: string[];
    };
    expect(parsed.data.verdict).toBe('blocked');
    expect(parsed.warnings.join(' ')).not.toContain('S1 has no render engine');
  });
});
