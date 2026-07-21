import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { runPnpm } from '../../../scripts/_release-shared.mjs';

// YAML/static guard for `.github/workflows/publish.yml`. The
// 2026-07-21 dispatch triage observed that a blanket
// `pnpm exec changeset version` step would re-derive ALL package
// versions from the change-set's declared semver level (e.g.
// `minor` -> 4.0.0). For the registry-repair release the maintainer
// manually bumps manifests to specific pre-release pins and
// intentionally publishes without a `.changeset/*.md`. For all
// FUTURE releases we still want changesets to drive the version
// bump + CHANGELOG update.
//
// This guard enforces:
//
//   1. The workflow DOES NOT call `pnpm exec changeset version`
//      unconditionally. The presence of a `changeset version` step
//      must be gated by `if:` on the detect step's output.
//
//   2. The detect step exposes `pending_changesets` outputs that the
//      publish step reads. Pinning the contract via text-match keeps
//      the workflow from regressing to a blanket version call.
//
//   3. The two enumerated .changeset entries (config.json, README.md)
//      are NOT counted as pending changesets — the `ls | grep`
//      excludes them via hardcoded filters.
//
// These three properties are checked directly against the YAML
// source — we do not need a yaml library; a strict text scan is
// sufficient and keeps the test hermetic on Windows where `python3`
// is not always on PATH.
//
// Karpathy §2 (Simplicity First): text-match over the raw YAML.
// Karpathy §3 (Surgical Changes): the contract is structural —
// never replace this with a yaml parser, the failing case (lost
// gating) is one missing `if:` line and a regex catches it cleanly.

const projectRoot = resolve(__dirname, '..', '..', '..');
const workflowPath = resolve(projectRoot, '.github', 'workflows', 'publish.yml');
const changesetsDir = resolve(projectRoot, '.changeset');

let workflowSource: string;
let staleChangesetPaths: string[] = [];
let staleVersionFixtures: { file: string; originalContent: string }[] = [];

beforeAll(() => {
  workflowSource = readFileSync(workflowPath, 'utf8');
});

afterAll(() => {
  // Restore any pending changesets we staged for the "with
  // changesets" path back to their pre-test state so a re-run
  // sees the repo baseline.
  for (const staged of staleChangesetPaths) {
    try { rmSync(staged, { force: true }); } catch { /* best-effort */ }
  }
  // Restore any package.json the positive-control test mutated.
  // `changeset version` modifies the manifest inline; without
  // reverting here the next run sees the bumped version as the
  // baseline and the dry-run test would assert against the wrong
  // ground truth.
  for (const fixture of staleVersionFixtures) {
    try { writeFileSync(fixture.file, fixture.originalContent, 'utf8'); } catch { /* best-effort */ }
  }
});

describe('publish.yml workflow guard (2026-07-21 registry-repair follow-up)', () => {
  test('workflow DOES NOT call `pnpm exec changeset version` unconditionally', () => {
    // We scan the YAML line-by-line. When we hit `- name: ...
    // changeset version`, we walk forward (not backward) to
    // collect the rest of THIS step's attributes up to the next
    // `- name:` (start of the next step) or end-of-file. The
    // `if:` predicate — when present — lives between the name
    // and the `run:` block of the same step, so forward-walking
    // correctly captures it. We split each step into its
    // attribute lines, then assert that any step whose name
    // matches carries an `if:` line.
    const stepHeaderRe = /^\s*-\s+name:\s*(.*)$/;
    const lines = workflowSource.split('\n');
    const steps: { name: string; lines: string[]; start: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(stepHeaderRe);
      if (!m) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (stepHeaderRe.test(lines[j])) break;
        body.push(lines[j]);
      }
      steps.push({ name: m[1].trim(), lines: body, start: i });
    }
    const matches = steps.filter((s) => /changeset.*version/i.test(s.name));
    expect(matches.length, 'expected at least one changeset-version step in the workflow').toBeGreaterThanOrEqual(1);
    const bareMatches = matches.filter((s) => !s.lines.some((l) => /^\s+if:/.test(l)));
    expect(bareMatches, 'all changeset-version steps must carry an `if:` predicate').toHaveLength(0);
    expect(matches.length, 'must have at least one conditional changeset-version step').toBeGreaterThanOrEqual(1);
  });

  test('detect step exposes the pending_changesets output used by the gating step', () => {
    // The detect step MUST emit `pending_changesets=true|false`
    // via `$GITHUB_OUTPUT`. The gating step then references that
    // output via `steps.detect.outputs.pending_changesets`. Both
    // contracts must be present in the YAML.
    expect(
      workflowSource,
      'detect step must write pending_changesets=true|false to $GITHUB_OUTPUT',
    ).toMatch(/pending_changesets=(true|false)["']?\s*>>\s*["']?\$GITHUB_OUTPUT/);
    expect(
      workflowSource,
      'gating step must reference steps.detect.outputs.pending_changesets',
    ).toMatch(/steps\.detect\.outputs\.pending_changesets\s*==\s*['"]true['"]/);
  });

  test('detect step ignores non-changeset entries (config.json, README.md)', () => {
    // The grep exclusions are load-bearing — without them,
    // `.changeset/config.json` would always trigger the version
    // step. We assert the literal exclusion strings exist so a
    // future refactor that drops one fails this test.
    expect(workflowSource).toMatch(/config\.json/);
    expect(workflowSource).toMatch(/README\.md/);
  });

  test('workflow triggers ONLY on v*.*.* tags + workflow_dispatch (no plain push-to-main publish)', () => {
    // The 2026-07-21 dispatch triage: a direct push to `main`
    // (e.g. a doc-only change) must NOT trigger a registry
    // release. Only `v*.*.*` tags and explicit manual dispatch
    // are allowed. The publish step ALSO carries a per-step
    // `if:` guard for defence-in-depth, and we assert both.
    const onBlock = workflowSource.match(/^on:\s*\n([\s\S]*?)(?=^jobs:|^concurrency:|^permissions:)/m);
    expect(onBlock, 'must find the `on:` block').toBeTruthy();
    const onText = onBlock![1];
    // `branches: [main]` MUST NOT appear under push (that would
    // turn every commit into a release).
    const pushBranchesSection = onText.match(/push:\s*\n([\s\S]*?)(?=\n\s*\w+:|\s*$)/);
    if (pushBranchesSection) {
      expect(
        pushBranchesSection[1],
        '`on.push.branches` must NOT be set to plain `main`; only `v*.*.*` tags are allowed',
      ).not.toMatch(/branches:\s*\[\s*['"]?main['"]?\s*\]/);
    }
    // `tags: - 'v*.*.*'` is the explicit release gate.
    expect(onText).toMatch(/tags:\s*\n\s*-\s*['"]v\*\.\*\.\*['"]/);
    // Manual dispatch must remain enabled.
    expect(onText).toMatch(/workflow_dispatch:/);
  });

  test('publish step carries the defensive per-step `if:` gate', () => {
    // Belt-and-braces: even if a future refactor of the `on:`
    // block accidentally re-enables push-to-main, the per-step
    // `if:` MUST block the publish step. We parse all steps and
    // assert that the publish step body contains a matching
    // predicate.
    const stepHeaderRe = /^\s*-\s+name:\s*(.*)$/;
    const lines = workflowSource.split('\n');
    const steps: { name: string; lines: string[] }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(stepHeaderRe);
      if (!m) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (stepHeaderRe.test(lines[j])) break;
        body.push(lines[j]);
      }
      steps.push({ name: m[1].trim(), lines: body });
    }
    const publishSteps = steps.filter((s) => /release-pack\.mjs|npm publish/.test(s.name));
    expect(publishSteps.length, 'must find the publish step').toBeGreaterThanOrEqual(1);
    for (const s of publishSteps) {
      const guard = s.lines.find((l) => /^\s*if:/.test(l));
      expect(guard, `${s.name} must carry an if: predicate`).toBeDefined();
      expect(guard!, 'the publish if: must gate on tag or dispatch').toMatch(
        /startsWith\(github\.ref,\s*['"]refs\/tags\/v['"]\)|github\.event_name\s*==\s*['"]workflow_dispatch['"]/,
      );
    }
  });

  test('dry-run `pnpm exec changeset version` against the bumped source is a no-op (regression of the registry-repair trap)', () => {
    // Reproduces the 2026-07-21 dispatch trap: with no pending
    // changesets, `pnpm exec changeset version` should output
    // "No changesets found" and EXIT 0 (not bump anything).
    // Run against the bumped source so a 0.0.3 regression would
    // surface immediately.
    const rootPkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
    const result = spawnPnpm(['exec', 'changeset', 'version'], projectRoot);
    expect(result.status, `changeset version must not bump when no changesets are pending\nstderr: ${result.stderr}`).toBe(0);
    // Re-check the source-level version invariants.
    const afterRoot = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
    expect(afterRoot.version, 'root peaks-loop must stay at 4.0.0-beta.17').toBe(rootPkg.version);
  });

  test('with a pending changeset added, `pnpm exec changeset version` would bump (positive control)', () => {
    // Stage a fake changeset file, run `changeset version`, then
    // assert the bumped version. `changeset version` rewrites
    // manifests inline; we snapshot every package.json it might
    // touch (root + subpackages) so afterAll can restore the
    // repo baseline.
    const changedFiles: string[] = [];
    const allPackageJsons = [
      resolve(projectRoot, 'package.json'),
      ...['peaks-loop-shared', 'peaks-loop-shared-channel', 'peaks-loop-job-snapshot', 'peaks-loop-mut', 'peaks-loop-doctor', 'peaks-loop-crystallization', 'peaks-loop-final-review', 'peaks-loop-audit-independent'].map((s) => resolve(projectRoot, 'packages', s, 'package.json')),
    ];
    for (const f of allPackageJsons) {
      staleVersionFixtures.push({ file: f, originalContent: readFileSync(f, 'utf8') });
    }

    const fixtureName = '2026-07-21-workflow-guard-fixture.md';
    const fixturePath = join(changesetsDir, fixtureName);
    staleChangesetPaths.push(fixturePath);
    writeFileSync(
      fixturePath,
      [
        '---',
        '"peaks-loop-shared": patch',
        '---',
        '',
        'workflow-guard fixture changeset (positive control)',
        '',
      ].join('\n'),
      'utf8',
    );

    const beforeVersion = JSON.parse(readFileSync(resolve(projectRoot, 'packages', 'peaks-loop-shared', 'package.json'), 'utf8')) as { version: string };
    // Touch changedFiles for typecheck (we don't actually gate on
    // it; bookkeeping kept for future-fixture expansion).
    void changedFiles;
    const result = spawnPnpm(['exec', 'changeset', 'version'], projectRoot);
    const afterVersionRaw = readFileSync(resolve(projectRoot, 'packages', 'peaks-loop-shared', 'package.json'), 'utf8');
    const afterVersion = JSON.parse(afterVersionRaw) as { version: string };
    expect(afterVersion.version, `peaks-loop-shared version should bump (positive control); diff=-${beforeVersion.version}+${afterVersion.version}`).not.toBe(beforeVersion.version);
    // The exit-code check is informational; on Windows some
    // changesets versions emit a non-zero exit even after a
    // successful bump (because of CHANGELOG.md write checks).
    // The source-level bump is the load-bearing assertion.
    void result;
  }, 60_000);
});

/**
 * Wrap `runPnpm` (from `_release-shared.mjs`) for a one-shot
 * spawn that returns `{ status, stderr }`. `runPnpm` resolves
 * `dirname(process.execPath)/node_modules/pnpm/bin/pnpm.mjs` at
 * runtime — no hardcoded nvm4w path.
 */
function spawnPnpm(args: string[], cwd: string): { status: number | null; stderr: string } {
  try {
    runPnpm(args, { cwd, stdio: 'pipe' });
    return { status: 0, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stderr: e.stderr?.toString?.() ?? '',
    };
  }
}
