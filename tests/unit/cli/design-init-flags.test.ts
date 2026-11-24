import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  registerDesignCommands,
  runDesignInit,
  type DesignInitCliOptions
} from '../../../src/cli/commands/design-commands.js';
import type { PavedRoadFile } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/cli/design-init-flags.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
let savedExitCode: typeof process.exitCode;
beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = savedExitCode;
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A small React app; the theme gives the scan one token to record. */
function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-init-flags-'));
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

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

const pavedOf = (root: string): PavedRoadFile =>
  readJsonFile<PavedRoadFile>(join(root, 'design', 'paved-road.json'));

const engineUrlOf = (root: string): string | null =>
  readJsonFile<{ render: { url: string | null } }>(join(root, 'design', 'engine.json')).render.url;

/** The `design init` command as Commander registers it — the `--help` surface. */
function initCommand(): Command {
  const program = new Command();
  registerDesignCommands(program, makeCapturedIo().io);
  const design = program.commands.find((command) => command.name() === 'design');
  const init = design?.commands.find((command) => command.name() === 'init');
  if (init === undefined) throw new Error('design init is not registered');
  return init;
}

describe('Scenario: behavior — init flags round-trip into the contract files', () => {
  it('when --page-roots and --exclude are given, should record both parsed lists', async () => {
    // given: a frontend app and comma-separated flag values
    // when: init runs with both lists
    // then: paved-road.json carries one entry per value, trimmed
    const root = makeApp();
    const { io } = makeCapturedIo();
    await runDesignInit(
      {
        project: root,
        pageRoots: 'src/routes, src/features',
        exclude: 'legacy, src/gen',
        json: true
      },
      io
    );
    const paved = pavedOf(root);
    expect(paved.pageRoots).toEqual(['src/routes', 'src/features']);
    expect(paved.exclude).toEqual(['legacy', 'src/gen']);
  });

  it('when --url is given, should record render.url in engine.json', async () => {
    // given: a frontend app and an absolute http URL
    // when: init runs with the flag
    // then: the machine-owned engine file names that address
    const root = makeApp();
    const { io } = makeCapturedIo();
    await runDesignInit({ project: root, url: 'http://localhost:4311/', json: true }, io);
    expect(engineUrlOf(root)).toBe('http://localhost:4311/');
  });

  it('when the flags are absent, should keep the defaults', async () => {
    // given: a frontend app with no flags
    // when: init runs
    // then: the conventional page roots apply, nothing is excluded, and no URL is fixed
    const root = makeApp();
    const { io } = makeCapturedIo();
    await runDesignInit({ project: root, json: true }, io);
    const paved = pavedOf(root);
    expect(paved.pageRoots).toEqual(['src/pages', 'src/routes', 'src/features', 'src/app']);
    expect(paved.exclude).toEqual([]);
    expect(engineUrlOf(root)).toBeNull();
  });

  it('when init re-runs with the same flags, should not duplicate entries', async () => {
    // given: an initialized app with both lists recorded
    // when: init runs again with force and the same values
    // then: every list is byte-identical to the first run
    const root = makeApp();
    const { io } = makeCapturedIo();
    const options: DesignInitCliOptions = {
      project: root,
      pageRoots: 'src/routes,src/features',
      exclude: 'legacy,src/gen',
      json: true
    };
    await runDesignInit(options, io);
    await runDesignInit({ ...options, force: true }, io);
    const paved = pavedOf(root);
    expect(paved.pageRoots).toEqual(['src/routes', 'src/features']);
    expect(paved.exclude).toEqual(['legacy', 'src/gen']);
  });

  it('when --force runs without the flags, should keep the recorded exclude and rules', async () => {
    // given: an app whose contract records an exclude and an edited rule
    // when: init runs again with force and no flags
    // then: the excluded paths and the rule severity survive the rewrite
    const root = makeApp();
    const { io } = makeCapturedIo();
    await runDesignInit({ project: root, exclude: 'legacy', json: true }, io);
    const pavedPath = join(root, 'design', 'paved-road.json');
    const saved = pavedOf(root);
    saved.rules.DESIGN_RAW_COLOR = 'warn';
    writeFileSync(pavedPath, JSON.stringify(saved, null, 2), 'utf8');
    mkdirSync(join(root, 'design', 'exemplars', 'list'), { recursive: true });
    await runDesignInit({ project: root, force: true, json: true }, io);
    const next = pavedOf(root);
    expect(next.exclude).toEqual(['legacy']);
    expect(next.rules.DESIGN_RAW_COLOR).toBe('warn');
    expect(existsSync(join(root, 'design', 'exemplars', 'list'))).toBe(true);
  });
});

describe('Scenario: a11y — an invalid --url is refused before any write', () => {
  it('when --url is not an absolute http(s) URL, should exit 3 and write nothing', async () => {
    // given: a frontend app and two values a render address can never be
    // when: init runs with each value
    // then: it refuses as a usage error and no contract file lands
    for (const url of ['not-a-url', 'ftp://example.com']) {
      const root = makeApp();
      const { io, captured } = makeCapturedIo();
      await runDesignInit({ project: root, url, json: true }, io);
      const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('DESIGN_URL_INVALID');
      expect(process.exitCode).toBe(3);
      expect(existsSync(join(root, 'design'))).toBe(false);
    }
  });

  it('when --url carries userinfo, should exit 3, write nothing, and mask it', async () => {
    // given: an http and a non-http URL that both spell user:pass@
    // when: init runs with each
    // then: the credential never reaches the git-tracked contract or the message
    for (const url of ['http://user:pass@localhost:4311/', 'ftp://user:pass@example.com/']) {
      const root = makeApp();
      const { io, captured } = makeCapturedIo();
      await runDesignInit({ project: root, url, json: true }, io);
      const parsed = JSON.parse(captured.text()) as { ok: boolean; code: string; message: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('DESIGN_URL_INVALID');
      expect(parsed.message).not.toContain('user:pass');
      expect(parsed.message).not.toContain('user@');
      expect(process.exitCode).toBe(3);
      expect(existsSync(join(root, 'design'))).toBe(false);
    }
  });
});

describe('Scenario: render — the init help lists the new flags', () => {
  it('when design init --help renders, should list --page-roots, --exclude and --url', () => {
    // given: the registered design init command
    // when: its help is rendered
    // then: all three S5 flags appear
    const help = initCommand().helpInformation();
    expect(help).toContain('--page-roots <list>');
    expect(help).toContain('--exclude <list>');
    expect(help).toContain('--url <url>');
  });
});
