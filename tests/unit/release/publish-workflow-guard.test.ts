import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { runPnpm } from '../../../scripts/_release-shared.mjs';

// YAML/static guard for `.github/workflows/publish.yml`. The
// 2026-07-22 follow-up removed the `pnpm exec changeset version`
// step from the workflow entirely. The maintainer's manual version
// pin in `package.json` + `peaks-loop-shared/src/version.ts` is
// now authoritative. To keep this safe (a future contributor
// re-introducing a changeset-version step would re-create the
// 4.0.0-beta.21 → 4.0.2 → 4.0.0 accident), the workflow now HARD-
// GATES on `.changeset/*.md` presence instead: if a pending
// changeset file exists, the publish step fails fast with an
// actionable ::error pointing the operator at either delete-the-
// file or `pnpm changeset version` to consume it locally.
//
// This guard enforces:
//
//   1. There is NO `pnpm exec changeset version` step in the
//      workflow. Any such step (whether conditional or unconditional)
//      would re-introduce the bug we just escaped; the loader is the
//      single source of truth for the published version.
//
//   2. There IS a hard-gate step named "Refuse to publish if any
//      .changeset/*.md is staged", with `exit 1` + `::error` when a
//      stale changeset is present.
//
//   3. The hard gate's filter excludes the same two enumerated
//      .changeset entries (config.json, README.md) the prior
//      detect-step handled. Without that exclusion, `.changeset/
//      config.json` would always trip the gate.
//
// These properties are checked directly against the YAML source —
// we do not need a yaml library; a strict text scan is sufficient
// and keeps the test hermetic on Windows where `python3` is not
// always on PATH.
//
// Karpathy §2 (Simplicity First): text-match over the raw YAML.
// Karpathy §3 (Surgical Changes): the contract is structural —
// never replace this with a yaml parser, the failing case (re-added
// changeset-version step OR lost gate) is one stray `run:` /
// `exit 1` line and a regex catches it cleanly.

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

describe('publish.yml workflow guard (2026-07-22 CLI_VERSION alignment + reject-on-stale-changeset)', () => {
  test('publish.yml parses as valid YAML and exposes the publish steps', () => {
    const workflow = parseYaml(workflowSource) as { jobs?: { publish?: { steps?: unknown[] } } };
    expect(workflow.jobs?.publish?.steps, 'publish workflow must expose a steps array').toBeInstanceOf(Array);
    expect(workflow.jobs!.publish!.steps!.length, 'publish workflow must contain release steps').toBeGreaterThan(0);
  });

  test('workflow does NOT have any step whose `run:` body invokes `pnpm exec changeset version`', () => {
    // Strategy: strip YAML comments (lines whose first non-blank
    // character is `#`) before scanning. Author prose mentions of
    // the deprecated behavior are allowed in comments; the term is
    // forbidden in actual `run:` invocations only.
    const stripped = workflowSource
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(
      stripped,
      `no surviving (non-comment) line should invoke 'pnpm exec changeset version'`,
    ).not.toMatch(/\bpnpm\s+exec\s+changeset\s+version\b/);
  });

  test('refuse-gate step exists with name starting with `Refuse to publish if any .changeset/.md is staged`', () => {
    // Match the step name prefix rather than the full substring — avoids
    // false-positives from the CLI_VERSION gate's prose mentions.
    expect(
      workflowSource,
      'publish.yml must contain a refuse-on-stale-changeset step',
    ).toMatch(/- name: Refuse to publish if any \.changeset\/\*\.md is staged/);
    expect(workflowSource, 'the refuse gate must call `exit 1`').toMatch(/exit 1/);
  });

  test('CLI_VERSION alignment gate exists and gates on shared dist/version.js vs root package.json', () => {
    // 2026-07-22 Bug-04 follow-up: peaks-loop imports CLI_VERSION from
    // peaks-loop-shared at runtime. npm pack rewrites the
    // `workspace:*` dependency to whatever subpackage version is
    // committed at pack time — so if peaks-loop-shared@<old> is
    // committed, peaks-loop@<new> pins peaks-loop-shared@<old> and
    // the resolved CLI_VERSION lags the root version. This gate
    // refuses to publish when the on-disk
    // peaks-loop-shared/dist/version.js has not been refreshed to
    // match the root package.json version.
    //
    // 2026-07-23 peaks-publish-stale fix: the step now ALSO packs
    // shared and verifies the tarball's package/dist/version.js
    // (Layer 5 fix — on-disk != tarball). The step name changed
    // accordingly.
    expect(
      workflowSource,
      'publish.yml must contain a CLI_VERSION alignment step',
    ).toMatch(/Verify peaks-loop-shared tarball CLI_VERSION parity/);
    expect(
      workflowSource,
      'the CLI_VERSION gate must exit 1 when the shared CLI_VERSION lags the root version',
    ).toMatch(/CLI_VERSION drift|peaks-loop-shared carries.*but root package\.json is/);
    expect(workflowSource, 'gate should reference the shared chicken-egg memory').toMatch(/peaks-cli-version-shared-chicken-egg/);
  });

  test('CLI_VERSION gate ALSO packs the shared tarball and verifies tarball content (Layer 5 fix, AC1/AC4)', () => {
    // The 2026-07-23 peaks-publish-stale fix (Layer 5) extends the
    // on-disk gate to ALSO run `pnpm --filter peaks-loop-shared pack`
    // and verify the packed tarball's package/dist/version.js
    // carries the expected CLI_VERSION. Without this, the on-disk
    // gate can pass while the tarball ships stale content (Layer 3
    // root cause — silent tsc skip).
    expect(
      workflowSource,
      'gate must invoke pnpm pack for peaks-loop-shared',
    ).toMatch(/pnpm --filter peaks-loop-shared pack/);
    expect(
      workflowSource,
      'gate must extract and read package/dist/version.js from the packed tarball',
    ).toMatch(/package\/dist\/version\.js/);
    expect(
      workflowSource,
      'gate must surface a stale-tarball error when the tarball is missing dist/version.js',
    ).toMatch(/stale-tarball/);
    expect(
      workflowSource,
      'gate must reference the 5-layer diagnosis memory',
    ).toMatch(/peaks-stale-cli-version-2026-07-23-diagnosis/);
  });

  test('AC4 — the exact publish.yml gate shell block exits non-zero for a tampered on-disk CLI_VERSION after build', () => {
    const gateStart = workflowSource.indexOf('          # ---- (A) On-disk gate: defensive file presence + value check');
    const publishStep = workflowSource.indexOf('      - name: Publish to npm', gateStart);
    expect(gateStart, 'must find gate shell block start').toBeGreaterThan(-1);
    expect(publishStep, 'must find step following gate shell block').toBeGreaterThan(gateStart);
    const gateBlock = workflowSource
      .slice(gateStart, publishStep)
      .split('\n')
      .map((line) => line.startsWith('          ') ? line.slice(10) : line)
      .join('\n');
    const repo = mkdtempSync(join(tmpdir(), 'peaks-gate-ac4-'));
    try {
      const scriptPath = join(repo, 'gate.sh');
      const fixtureDist = join(repo, 'packages', 'peaks-loop-shared', 'dist');
      const fixtureShared = join(repo, 'packages', 'peaks-loop-shared');
      const fixtureBin = join(repo, 'bin');
      mkdirSync(fixtureDist, { recursive: true });
      mkdirSync(fixtureBin, { recursive: true });
      writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'peaks-loop', version: '4.0.0-beta.34' }), 'utf8');
      writeFileSync(join(fixtureShared, 'package.json'), JSON.stringify({ name: 'peaks-loop-shared', version: '0.0.25' }), 'utf8');
      writeFileSync(join(fixtureDist, 'version.js'), 'export const CLI_VERSION = "0.0.0-wrong";\n', 'utf8');
      writeFileSync(scriptPath, ['#!/bin/sh', 'set -e', gateBlock].join('\n'), 'utf8');
      const result = spawnSync('sh', [scriptPath], {
        cwd: repo,
        env: { ...process.env, PATH: `${fixtureBin}:${process.env.PATH ?? ''}` },
        stdio: 'pipe',
      });
      expect(result.status, `tampered gate must fail; stdout=${result.stdout?.toString('utf8') ?? ''}`).not.toBe(0);
      expect(
        `${result.stdout?.toString('utf8') ?? ''}\n${result.stderr?.toString('utf8') ?? ''}`,
        'gate must explain CLI_VERSION drift',
      ).toMatch(/CLI_VERSION drift|refuses to publish/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  test('publish workflow has an idempotency guard step at the top (AC7)', () => {
    // The 2026-07-23 peaks-publish-stale fix adds an idempotency
    // guard step BEFORE the auto-bump step: it checks
    // `npm view peaks-loop dist-tags.latest` against the local
    // package.json#version and exits 0 with a ::notice when they
    // match. Without this guard, re-running workflow_dispatch with
    // the same INPUT_TARGET could publish a redundant version
    // (the 33 -> 35 version-skip root cause).
    expect(
      workflowSource,
      'publish.yml must contain an idempotency guard step before the auto-bump step',
    ).toMatch(/Idempotency guard: skip bump when local root version already equals dist-tags\.latest/);
    expect(
      workflowSource,
      'idempotency guard must check npm view peaks-loop dist-tags.latest',
    ).toMatch(/npm view peaks-loop dist-tags\.latest/);
    // The idempotency guard must appear BEFORE the Auto-bump step
    // in the workflow source (defensive ordering — guards must fire
    // first).
    const idempotencyIdx = workflowSource.indexOf('Idempotency guard: skip bump when local root version already equals dist-tags.latest');
    const autoBumpIdx = workflowSource.indexOf('Auto-bump version per smallest-semver policy');
    expect(idempotencyIdx, 'idempotency guard step must be present').toBeGreaterThan(-1);
    expect(autoBumpIdx, 'auto-bump step must be present').toBeGreaterThan(-1);
    expect(idempotencyIdx, 'idempotency guard must precede auto-bump').toBeLessThan(autoBumpIdx);
  });

  test('PEAKS_AUTO_BUMP_SHARED env var is no longer required (AC6 — bump-version.mjs owns the bump)', () => {
    // The 2026-07-23 fix moves the shared/package.json#version
    // bump from sync-version.mjs (env-gated) to bump-version.mjs
    // (always-on). The publish workflow must no longer require
    // PEAKS_AUTO_BUMP_SHARED in its Build step env block.
    // We assert this by checking that no env: block in the Build
    // step sets this var. (Loose regex — only fails if the var
    // appears in a yaml env block context.)
    expect(
      workflowSource,
      'publish.yml must not require PEAKS_AUTO_BUMP_SHARED in Build env',
    ).not.toMatch(/PEAKS_AUTO_BUMP_SHARED:\s*['"]?1['"]?/);
  });

  test('refuse-gate step excludes config.json + README.md', () => {
    // Strip YAML comments. The refuse-gate step's `run:` block lists
    // exclusions for config.json and README.md. We accept either the
    // literal string or its regex-escaped form (^config\.json$ is the
    // literal source pattern).
    const stripped = workflowSource
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    // Match on the exclusion-pattern lines specifically to avoid the
    // file-head prose comment that mentions config.json.
    const gateRunBlock = stripped.split(/- name: Refuse to publish if any \.changeset\/\*\.md is staged/, 2)[1] || '';
    expect(gateRunBlock.length, 'gate run-block must exist').toBeGreaterThan(0);
    expect(gateRunBlock, 'gate must exclude config.json').toMatch(/grep -v.*config[\\]?\.json/);
    expect(gateRunBlock, 'gate must exclude README.md').toMatch(/grep -v.*README[\\]?\.md/);
  });

  test('dry-run `pnpm exec changeset version` against the bumped source is a no-op (defense in depth)', () => {
    // Even though publish.yml no longer runs it, a future contributor
    // who re-adds a changeset-version step must see a no-op exit 0
    // here. We re-snapshot every package.json + subpackage
    // package.json so the run is hermetic.
    if (!existsSync(changesetsDir)) {
      return; // nothing to do; the no-op assertion is trivially true
    }
    for (const f of [resolve(projectRoot, 'package.json'), ...['peaks-loop-shared', 'peaks-loop-shared-channel', 'peaks-loop-job-snapshot', 'peaks-loop-mut', 'peaks-loop-doctor', 'peaks-loop-crystallization', 'peaks-loop-final-review', 'peaks-loop-audit-independent'].map((s) => resolve(projectRoot, 'packages', s, 'package.json'))]) {
      staleVersionFixtures.push({ file: f, originalContent: readFileSync(f, 'utf8') });
    }
    const rootPkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
    const result = spawnPnpm(['exec', 'changeset', 'version'], projectRoot);
    const afterRoot = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };
    expect(afterRoot.version, `root peaks-loop must stay at ${rootPkg.version}`).toBe(rootPkg.version);
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
    const pushBranchesSection = onText!.match(/push:\s*\n([\s\S]*?)(?=\n\s*\w+:|\s*$)/);
    if (pushBranchesSection) {
      expect(
        pushBranchesSection[1]!,
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
      const m = lines[i]!.match(stepHeaderRe);
      if (!m) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (stepHeaderRe.test(lines[j]!)) break;
        body.push(lines[j]!);
      }
      steps.push({ name: m[1]!.trim(), lines: body });
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
    // Stage a complete temporary changesets repository instead of
    // mutating the live workspace. The previous positive control wrote
    // package.json + CHANGELOG.md files in-place and raced with the other
    // release test files under Vitest's default parallel execution.
    const repo = mkdtempSync(join(tmpdir(), 'peaks-changeset-positive-'));
    try {
      const changesetDir = join(repo, '.changeset');
      const sharedDir = join(repo, 'packages', 'peaks-loop-shared');
      mkdirSync(changesetDir, { recursive: true });
      mkdirSync(sharedDir, { recursive: true });
      writeFileSync(join(repo, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8');
      writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture-root', version: '1.0.0', private: true }, null, 2) + '\n', 'utf8');
      writeFileSync(join(sharedDir, 'package.json'), JSON.stringify({ name: 'peaks-loop-shared', version: '0.0.25' }, null, 2) + '\n', 'utf8');
      writeFileSync(join(changesetDir, 'config.json'), JSON.stringify({
        $schema: 'https://unpkg.com/@changesets/config@3.1.1/schema.json',
        changelog: false,
        commit: false,
        fixed: [],
        linked: [],
        access: 'public',
        baseBranch: 'main',
        updateInternalDependencies: 'patch',
        ignore: [],
      }, null, 2) + '\n', 'utf8');
      writeFileSync(
        join(changesetDir, 'positive-control.md'),
        ['---', '"peaks-loop-shared": patch', '---', '', 'workflow-guard fixture changeset', ''].join('\n'),
        'utf8',
      );

      const beforeVersion = JSON.parse(readFileSync(join(sharedDir, 'package.json'), 'utf8')) as { version: string };
      const cliPath = resolve(projectRoot, 'node_modules', '@changesets', 'cli', 'bin.js');
      const result = spawnSync(process.execPath, [cliPath, 'version'], { cwd: repo, stdio: 'pipe' });
      const afterVersion = JSON.parse(readFileSync(join(sharedDir, 'package.json'), 'utf8')) as { version: string };
      expect(result.status, `changeset positive control must exit 0; stderr=${result.stderr?.toString('utf8') ?? ''}`).toBe(0);
      expect(afterVersion.version, `peaks-loop-shared should bump from ${beforeVersion.version}`).toBe('0.0.26');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
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
