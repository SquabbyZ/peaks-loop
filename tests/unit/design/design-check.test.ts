import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { CHECK_BLOCKED_ACTIONS, blockedMessage } from '../../../src/services/design/acceptance.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';

declareDimensions('tests/unit/design/design-check.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

/**
 * Imported per test after a module reset so the module-level constants
 * (`UI_EXTENSIONS`, the five message strings) are initialised INSIDE a test.
 * Under Stryker's per-test coverage a module-scope initialiser runs before any
 * test, so a mutant in it is never scheduled and reads as survived although no
 * test ever ran.
 */
import type * as DesignCheckModuleTypes from '../../../src/services/design/design-check.js';
type DesignCheckModule = typeof DesignCheckModuleTypes;

async function loadDesignCheck(): Promise<DesignCheckModule> {
  vi.resetModules();
  return import('../../../src/services/design/design-check.js');
}

const NOT_ADOPTED_MESSAGE =
  'No design contract is adopted for this app; run `peaks design init` first.';
const CHANGE_SET_UNKNOWN_MESSAGE =
  'The change set is empty, unreadable, or names no file in this app; an empty change set is blocked, not a pass.';
const RENDER_REQUIRED_MESSAGE =
  'G2 (render) did not run; a design check needs a render verdict. Re-run without --source-only, or record an acceptance with --allow-source-only --accept-note.';
const DEGRADED_MESSAGE =
  'The changed UI files could not be read by the source scanner (unsupported file family, deleted file, or outside pageRoots); a zero-file scan is blocked, never a pass.';
const CONTRACT_INVALID_MESSAGE =
  'design/tokens.json has no usable token groups; run `peaks design init` to rewrite design/tokens.json and design/engine.json.';

/** The result shape every early refusal shares: defaults from `makeResult`. */
const DEFAULT_SURFACE = { isUi: 'unknown', reasons: [] as string[] };
const DEFAULT_CHECKS = {
  g1_source: { status: 'not-applicable', findings: [] },
  g2_render: { status: 'skipped', reason: 's2-not-implemented' }
};

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-check-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'styles'), { recursive: true });
  mkdirSync(join(root, 'src', 'routes'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }),
    'utf8'
  );
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(
    join(root, 'src', 'styles', 'theme.css'),
    '@theme { --color-primary: #0f62fe; }\n',
    'utf8'
  );
  writeFileSync(join(root, 'src', 'routes', 'a.tsx'), 'export const A = () => <div />;\n', 'utf8');
  return root;
}

/** A repository whose only frontend app is `web/`, so paths are not app-relative. */
function makeMonorepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-mono-'));
  roots.push(root);
  const app = join(root, 'web');
  mkdirSync(join(app, 'src', 'styles'), { recursive: true });
  mkdirSync(join(app, 'src', 'routes'), { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }),
    'utf8'
  );
  writeFileSync(join(app, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(
    join(app, 'src', 'styles', 'theme.css'),
    '@theme { --color-primary: #0f62fe; }\n',
    'utf8'
  );
  writeFileSync(
    join(app, 'src', 'routes', 'a.tsx'),
    "export const A = () => <div style={{ color: 'red' }} />;\n",
    'utf8'
  );
  return root;
}

/** Two frontend apps under `apps/`, with the contract adopted for `apps/a`. */
function makeTwoApps(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-two-'));
  roots.push(root);
  for (const app of ['apps/a', 'apps/b']) {
    const dir = join(root, app);
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }),
      'utf8'
    );
    writeFileSync(join(dir, 'src', 'main.tsx'), 'export {}', 'utf8');
    writeFileSync(join(dir, 'src', 'routes', 'a.tsx'), 'export const A = () => <div />;\n', 'utf8');
  }
  return root;
}

/** An app with a components dir, so `scanExistingSystem` detects a componentDir. */
function makeAppWithComponents(): string {
  const root = makeApp();
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'components', 'Button.tsx'),
    'export const Button = () => <button />;\n',
    'utf8'
  );
  // `scanExistingSystem` skips extraction for a greenfield tree, so the fixture
  // carries enough sources to read as a legacy project.
  mkdirSync(join(root, 'src', 'lib'), { recursive: true });
  for (let index = 0; index < 24; index += 1) {
    writeFileSync(join(root, 'src', 'lib', `mod-${index}.ts`), 'export {};\n', 'utf8');
  }
  return root;
}

describe('Scenario: behavior — the verdict matrix', () => {
  it('when the contract is absent or incomplete, should return not-adopted', async () => {
    // given: an app without design/ and an adopted app whose engine.json was removed
    // when: check runs on each
    // then: it is not adopted, with the default surface/checks shape
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const noContract = makeApp();
    const absent = await checkDesignSourceOnly({
      projectRoot: noContract,
      changedFiles: ['src/routes/a.tsx']
    });
    expect(absent).toEqual({
      schemaVersion: 1,
      rid: null,
      verdict: 'not-adopted',
      surface: DEFAULT_SURFACE,
      checks: DEFAULT_CHECKS,
      findings: [],
      coverage: null,
      message: NOT_ADOPTED_MESSAGE
    });
    const incomplete = makeApp();
    await initDesignContract({ projectRoot: incomplete });
    rmSync(join(incomplete, 'design', 'engine.json'));
    const partial = await checkDesignSourceOnly({
      projectRoot: incomplete,
      changedFiles: ['src/routes/a.tsx']
    });
    expect(partial.verdict).toBe('not-adopted');
  });

  it('when the change set is empty or unreadable, should block rather than pass', async () => {
    // given: an empty change set and a directory git cannot read
    // when: each is checked
    // then: both are blocked, and the empty set carries the canonical reason
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const empty = await checkDesignSourceOnly({ projectRoot: root, changedFiles: [] });
    expect(empty).toEqual({
      schemaVersion: 1,
      rid: null,
      verdict: 'blocked',
      surface: DEFAULT_SURFACE,
      checks: DEFAULT_CHECKS,
      findings: [],
      coverage: null,
      errorCode: 'DESIGN_CHANGE_SET_UNKNOWN',
      message: CHANGE_SET_UNKNOWN_MESSAGE
    });
    const unreadable = await checkDesignSourceOnly({ projectRoot: root });
    expect(unreadable.verdict).toBe('blocked');
    expect(unreadable.errorCode).toBe('DESIGN_CHANGE_SET_UNKNOWN');
    expect(unreadable.message).toContain('git diff');
    const ridOnly = await checkDesignSourceOnly({ projectRoot: root, rid: 'r-123' });
    expect(ridOnly.verdict).toBe('blocked');
    expect(ridOnly.errorCode).toBe('DESIGN_CHANGE_SET_UNKNOWN');
  });

  it('when the change is not UI, should be not-applicable', async () => {
    // given: an adopted app with a README change
    // when: check runs on a non-UI file
    // then: it does not apply and the surface is measured as non-UI
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: ['README.md'] });
    expect(result.verdict).toBe('not-applicable');
    expect(result.surface).toEqual({ isUi: false, reasons: [] });
  });

  it('when a UI change is clean and source-only is accepted, should pass', async () => {
    // given: an adopted app with a clean page
    // when: check runs with an explicit acceptance
    // then: it passes, records the acceptance, and keeps g1 pass with no findings
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      allowSourceOnly: true,
      acceptNote: 'I accept source-only for this pilot'
    });
    expect(result).toEqual({
      schemaVersion: 1,
      rid: null,
      verdict: 'pass',
      surface: { isUi: true, reasons: ['changed: src/routes/a.tsx'] },
      checks: {
        g1_source: { status: 'pass', findings: [] },
        g2_render: { status: 'skipped', reason: 'explicitly-accepted' }
      },
      findings: [],
      coverage: { covered: 0, total: 0, ratio: 1 },
      acceptedBy: null
    });
  });

  it('when a UI change is dirty and source-only is accepted, should fail', async () => {
    // given: an adopted app with an inline style
    // when: check runs with an acceptance and a recording session
    // then: it fails on the finding and records who accepted
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(
      join(root, 'src', 'routes', 'a.tsx'),
      "export const A = () => <div style={{ color: 'red' }} />;\n",
      'utf8'
    );
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      sessionId: 'session-1',
      allowSourceOnly: true,
      acceptNote: 'I accept source-only for this pilot'
    });
    expect(result.verdict).toBe('fail');
    expect(result.checks.g1_source.status).toBe('fail');
    expect(result.findings.map((finding) => finding.code)).toEqual(['DESIGN_INLINE_STYLE']);
    expect(result.checks.g2_render).toEqual({
      status: 'skipped',
      reason: 'explicitly-accepted'
    });
    expect(result.acceptedBy).toBe('session-1');
    const mod = await loadDesignCheck();
    expect(mod.exitCodeForVerdict(result.verdict)).toBe(1);
  });

  it('when source-only is not accepted, should block instead of claiming a render pass', async () => {
    // given: an adopted app with a clean page, checked with no acceptance and
    //        with a note but allowSourceOnly false
    // when: each check runs
    // then: neither is an acceptance and both block because S1 cannot run G2
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    for (const acceptance of [{}, { allowSourceOnly: false as const, acceptNote: 'note' }]) {
      const result = await checkDesignSourceOnly({
        projectRoot: root,
        changedFiles: ['src/routes/a.tsx'],
        ...acceptance
      });
      expect(result.verdict).toBe('blocked');
      expect(result.errorCode).toBe('DESIGN_RENDER_REQUIRED');
      expect(result.message).toBe(RENDER_REQUIRED_MESSAGE);
      expect(result.checks.g2_render).toEqual({
        status: 'skipped',
        reason: 's2-not-implemented'
      });
    }
  });
});

describe('Scenario: behavior — exit codes name the verdict', () => {
  it('when each verdict is mapped, should give pass-like 0, fail 1, blocked 2', async () => {
    // given: every verdict the check can return
    // when: each is mapped to an exit code
    // then: only fail and blocked are non-zero
    const { exitCodeForVerdict } = await loadDesignCheck();
    expect(exitCodeForVerdict('pass')).toBe(0);
    expect(exitCodeForVerdict('not-adopted')).toBe(0);
    expect(exitCodeForVerdict('not-applicable')).toBe(0);
    expect(exitCodeForVerdict('fail')).toBe(1);
    expect(exitCodeForVerdict('blocked')).toBe(2);
  });
});

describe('Scenario: behavior — an acceptance must carry the user words', () => {
  it('when the accept note is blank or absent, should refuse as a usage error', async () => {
    // given: allow-source-only with a whitespace-only note and with no note
    // when: each check runs
    // then: a bad note is a usage error, never a verdict or a crash
    const { checkDesignSourceOnly, DesignCheckUsageError } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    for (const acceptNote of ['   ', undefined]) {
      await expect(
        checkDesignSourceOnly({
          projectRoot: root,
          changedFiles: ['src/routes/a.tsx'],
          allowSourceOnly: true,
          ...(acceptNote === undefined ? {} : { acceptNote })
        })
      ).rejects.toBeInstanceOf(DesignCheckUsageError);
    }
  });
});

describe('Scenario: integration — change-set paths are repository-relative', () => {
  it('when the page is spelled either way, should judge the same app file', async () => {
    // given: a `web/` app and the page spelled repository-relative and app-relative
    // when: each change set is checked
    // then: both translate to src/routes/a.tsx and its inline style fails it
    for (const file of ['web/src/routes/a.tsx', 'src/routes/a.tsx']) {
      const { checkDesignSourceOnly } = await loadDesignCheck();
      const root = makeMonorepo();
      await initDesignContract({ projectRoot: root, appPath: 'web' });
      const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: [file] });
      expect(result.surface.isUi, file).toBe(true);
      expect(result.surface.reasons, file).toContain('changed: src/routes/a.tsx');
      expect(result.verdict, file).toBe('fail');
    }
  });

  it('when the change set names nothing of the app, should distinguish blocked from non-UI', async () => {
    // given: a `web/` app and a root file in one set, its own README in another
    // when: each is checked
    // then: nothing measured is blocked, while a measured non-UI file is not-applicable
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeMonorepo();
    await initDesignContract({ projectRoot: root, appPath: 'web' });
    const outside = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['README.md']
    });
    expect(outside.verdict).toBe('blocked');
    expect(outside.errorCode).toBe('DESIGN_CHANGE_SET_UNKNOWN');
    const ownReadme = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['web/README.md']
    });
    expect(ownReadme.verdict).toBe('not-applicable');
  });

  it('when --app picks one of two apps, should not block as ambiguous', async () => {
    // given: two frontend apps and the contract adopted for apps/a
    // when: check runs with appPath naming apps/a
    // then: the appPath is passed through and the check reaches the verdict stage
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeTwoApps();
    await initDesignContract({ projectRoot: root, appPath: 'apps/a' });
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      appPath: 'apps/a',
      changedFiles: ['apps/a/src/routes/a.tsx']
    });
    expect(result.errorCode).toBe('DESIGN_RENDER_REQUIRED');
    expect(result.verdict).toBe('blocked');
  });
});

describe('Scenario: behavior — a UI path is matched against page roots exactly', () => {
  it('when a page root is spelled with dots or slashes, should normalize only its edges', async () => {
    // given: page roots with a leading ./, an inner ./, one or two trailing slashes,
    //        several roots, and a changed path equal to the root itself
    // when: each is checked against src/routes/page or src/routes
    // then: only edge normalization applies, and one matching root is enough
    const cases: ReadonlyArray<[roots: string[], file: string, degraded: boolean]> = [
      [['./src/routes'], 'src/routes/page', true],
      [['src/./routes'], 'src/routes/page', false],
      [['src/routes/'], 'src/routes/page', true],
      [['src/routes//'], 'src/routes/page', true],
      [['src/pages', 'src/routes'], 'src/routes/page', true],
      [['src/routes'], 'src/routes', true]
    ];
    for (const [pageRoots, file, degraded] of cases) {
      const root = makeApp();
      await initDesignContract({ projectRoot: root, pageRoots });
      const { checkDesignSourceOnly } = await loadDesignCheck();
      const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: [file] });
      if (degraded)
        expect(result.errorCode, String(pageRoots)).toBe('DESIGN_SOURCE_CHECK_DEGRADED');
      else expect(result.verdict, String(pageRoots)).toBe('not-applicable');
    }
  });
});

describe('Scenario: integration — the component dir is only detected when needed', () => {
  it('when a change sits in the component dir, should detect and judge it', async () => {
    // given: an app with src/components and a change there alone, then beside a page
    // when: each change set is checked
    // then: one file needing detection is enough to find the dir and judge it UI
    const root = makeAppWithComponents();
    await initDesignContract({ projectRoot: root });
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const alone = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/components/Icon']
    });
    expect(alone.errorCode).toBe('DESIGN_SOURCE_CHECK_DEGRADED');
    const mixed = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/components/Icon', 'src/routes/a.tsx']
    });
    expect(mixed.surface.reasons).toEqual([
      'changed: src/components/Icon',
      'changed: src/routes/a.tsx'
    ]);
  });
});

describe('Scenario: behavior — an uncovered or broken input is blocked, not a pass', () => {
  it('when a changed page cannot be scanned, should block as degraded', async () => {
    // given: a page outside every page root, a stylesheet, and a deleted page
    // when: each is checked with an acceptance
    // then: a zero-file scan is blocked, never a pass
    const cases: ReadonlyArray<[file: string]> = [
      ['app/page.tsx'],
      ['src/styles/theme.css'],
      ['src/routes/gone.tsx']
    ];
    for (const [file] of cases) {
      const root = makeApp();
      await initDesignContract({ projectRoot: root });
      mkdirSync(join(root, 'app'), { recursive: true });
      writeFileSync(
        join(root, 'app', 'page.tsx'),
        'export default () => <div style={{ color: \'red\' }} className="w-[123px]" />;\n',
        'utf8'
      );
      const { checkDesignSourceOnly } = await loadDesignCheck();
      const result = await checkDesignSourceOnly({
        projectRoot: root,
        changedFiles: [file],
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot'
      });
      expect(result.verdict, file).toBe('blocked');
      expect(result.errorCode, file).toBe('DESIGN_SOURCE_CHECK_DEGRADED');
      expect(result.message, file).toBe(DEGRADED_MESSAGE);
    }
  });

  it('when tokens cannot be read, should block the contract instead of throwing', async () => {
    // given: an adopted app whose tokens.json is empty then malformed
    // when: check runs on each
    // then: the contract is reported invalid, not a crash
    for (const tokens of ['{}\n', '{ oops\n']) {
      const root = makeApp();
      await initDesignContract({ projectRoot: root });
      writeFileSync(join(root, 'design', 'tokens.json'), tokens, 'utf8');
      const { checkDesignSourceOnly } = await loadDesignCheck();
      const result = await checkDesignSourceOnly({
        projectRoot: root,
        changedFiles: ['src/routes/a.tsx']
      });
      expect(result.verdict).toBe('blocked');
      expect(result.errorCode).toBe('DESIGN_CONTRACT_INVALID');
      expect(result.message).toBe(CONTRACT_INVALID_MESSAGE);
      expect(result.message).toContain('design/tokens.json');
      expect(result.message).toContain('design/engine.json');
      const action = (CHECK_BLOCKED_ACTIONS.DESIGN_CONTRACT_INVALID ?? []).join(' ');
      expect(action).toContain('design/tokens.json');
      expect(action).toContain('design/engine.json');
      expect(blockedMessage('DESIGN_CONTRACT_INVALID')).toContain('design/engine.json');
    }
  });
});
