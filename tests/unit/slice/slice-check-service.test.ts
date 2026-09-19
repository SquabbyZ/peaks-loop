// tests/unit/slice/slice-check-service.test.ts
//
// 2026-09-10 G5 — the `typecheck` stage of `peaks slice check` used to run a
// bare `tsc --noEmit`, which picks up the DEFAULT tsconfig.json (src/** AND
// tests/**). That tree carries pre-existing errors in tests/ that no slice
// caused, so the stage was permanently red and its one real signal — "did
// this slice break src/?" — was buried under them.
//
// The stage now:
//   gate   — `tsc -p tsconfig.build.json --noEmit` must exit 0 (src/** only,
//            the type contract the package actually ships; clean today).
//   report — the wider `tsc -p tsconfig.json` error count is MEASURED and
//            surfaced, then compared against TYPECHECK_PREEXISTING_BASELINE;
//            the stage fails only when that count GROWS. Always-red and
//            silently-green are both wrong; this is neither.
//
// Dimensions covered:
//   - render:      stage envelope shape (name/description/status/data keys)
//   - behavior:    pass / fail decisions on synthetic projects
//   - integration: a real `sliceCheck` run against this repository's own
//                  tsconfigs (spawns the project-local tsc)
//   - a11y:        the human-readable `detail` names the pre-existing count
//                  rather than hiding it
//
// 2026-09-10 C6 — the stage now spawns the package's JS entry through
// `process.execPath` instead of the `node_modules/.bin` `.cmd` shim, which no
// Node >= 20 can spawn without `shell: true`. `shell: true` split any project
// path containing a space, so a clean project reported a phantom typecheck
// failure. The `behavior` dimension covers that path.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import {
  BINARY_UNRESOLVED_CODE,
  sliceCheck,
  TYPECHECK_PREEXISTING_BASELINE
} from '~/src/services/slice/slice-check-service';
import type { SliceCheckStage } from '~/src/services/slice/slice-check-types';

declareDimensions('tests/unit/slice/slice-check-service.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const RID = 'd1-g5-typecheck-stage';

/**
 * One real run against this repository, shared by every test that needs it.
 * The stage spawns `tsc` twice (~10 s), so it is memoized rather than repeated
 * per dimension.
 */
let repoStage: Promise<SliceCheckStage> | null = null;
function repoTypecheckStage(): Promise<SliceCheckStage> {
  repoStage ??= sliceCheck({
    projectRoot: REPO_ROOT,
    rid: RID,
    refreshFanout: false,
    skipTests: true
  }).then((result) => {
    const stage = result.stages.find((s) => s.name === 'typecheck');
    if (stage === undefined) throw new Error('slice check produced no typecheck stage');
    return stage;
  });
  return repoStage;
}

/**
 * The project-local `tsc` entry in the tmp project, forwarding to this repo's
 * installed TypeScript through an absolute path. Written as a real file rather
 * than a symlink so the tmp-workspace cleanup can never reach the real
 * `node_modules`.
 *
 * 2026-09-10 C6: `slice check` spawns this through `process.execPath`, so the
 * shim is a plain JS file at the package's declared bin path — no `.cmd`, no
 * shell, and therefore no platform branch.
 */
function writeTscShim(ws: TmpWorkspace): void {
  const binDir = join(ws.path, 'node_modules', 'typescript', 'bin');
  mkdirSync(binDir, { recursive: true });
  const tscJs = join(REPO_ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');
  writeFileSync(join(binDir, 'tsc'), `require(${JSON.stringify(tscJs)});\n`);
}

/**
 * The `node_modules/.bin/tsc.cmd` shim the pre-C6 resolver spawned with
 * `shell: true`. Only the spaced-path test writes one: it keeps the shape that
 * broke demonstrably present on disk while the JS entry is the one that runs.
 * With the old resolver this file is what gets spawned, and the shell splits
 * its path at the space.
 */
function writeLegacyTscCmdShim(ws: TmpWorkspace): void {
  const binDir = join(ws.path, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const tscJs = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  writeFileSync(join(binDir, 'tsc.cmd'), `@echo off\r\n"${process.execPath}" "${tscJs}" %*\r\n`);
}

/**
 * Synthetic project: `tsconfig.build.json` covers `clean.ts` (always clean),
 * `tsconfig.json` additionally covers `broken.ts`, whose every declaration is
 * one type error. `types: []` keeps @types/node out of the picture so the
 * counts are exactly what this function writes.
 */
function writeSyntheticProject(
  ws: TmpWorkspace,
  opts: { wideErrors: number; buildErrors?: number }
): void {
  mkdirSync(ws.peaksDir, { recursive: true });
  writeTscShim(ws);
  const compilerOptions = {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    skipLibCheck: true,
    types: []
  };
  writeFileSync(ws.rel('clean.ts'), 'export const ok: number = 1;\n');
  const buildErrors = opts.buildErrors ?? 0;
  writeFileSync(
    ws.rel('build-broken.ts'),
    Array.from({ length: buildErrors }, (_, i) => `export const b${i}: string = 1;`).join('\n')
  );
  writeFileSync(
    ws.rel('broken.ts'),
    Array.from({ length: opts.wideErrors }, (_, i) => `export const a${i}: string = 1;`).join('\n')
  );
  writeFileSync(
    ws.rel('tsconfig.build.json'),
    JSON.stringify({
      compilerOptions,
      include: buildErrors > 0 ? ['clean.ts', 'build-broken.ts'] : ['clean.ts']
    })
  );
  writeFileSync(
    ws.rel('tsconfig.json'),
    JSON.stringify({ compilerOptions, include: ['clean.ts', 'broken.ts', 'build-broken.ts'] })
  );
}

function typecheckStageOf(stages: readonly SliceCheckStage[]): SliceCheckStage {
  const stage = stages.find((s) => s.name === 'typecheck');
  if (stage === undefined) throw new Error('slice check produced no typecheck stage');
  return stage;
}

describe('Scenario: render — typecheck stage envelope', () => {
  it('when slice check runs, should expose the pre-existing count and its baseline in structured data', async () => {
    // given: a run against this repository, whose tests/** residue is known
    // when: the typecheck stage is inspected
    // then: the residue is structured data, not free text only
    const stage = await repoTypecheckStage();
    expect(stage.name).toBe('typecheck');
    expect(stage.data?.wideTsconfigErrors).toBeTypeOf('number');
    expect(stage.data?.preExistingBaseline).toBe(TYPECHECK_PREEXISTING_BASELINE);
    expect(stage.data?.exitCode).toBe(0);
  }, 120_000);
});

describe('Scenario: behavior — typecheck stage decisions on synthetic projects', () => {
  let ws: TmpWorkspace;
  beforeEach(() => {
    ws = useTmpWorkspace('peaks-slice-check-');
  });
  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when both tsconfigs are clean, should pass the typecheck stage', async () => {
    // given: a project whose build config and wider config are both clean
    writeSyntheticProject(ws, { wideErrors: 0 });
    // when: slice check runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: the stage passes and reports zero pre-existing errors
    const stage = typecheckStageOf(result.stages);
    expect(stage.status).toBe('pass');
    expect(stage.data?.wideTsconfigErrors).toBe(0);
  }, 120_000);

  it('when the wider tsconfig count grows past the baseline, should fail the typecheck stage', async () => {
    // given: a clean build config but a wider count above the recorded baseline
    writeSyntheticProject(ws, { wideErrors: TYPECHECK_PREEXISTING_BASELINE + 8 });
    // when: slice check runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: the growth is the failure, and it is named
    const stage = typecheckStageOf(result.stages);
    expect(stage.status).toBe('fail');
    expect(stage.detail).toContain('grew to');
    expect(stage.data?.regression).toBe(8);
  }, 120_000);

  it('when the build tsconfig itself is broken, should fail the typecheck stage', async () => {
    // given: a src-side (build config) type error, which is the real gate
    writeSyntheticProject(ws, { wideErrors: 0, buildErrors: 2 });
    // when: slice check runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: the gate fails on its own, independently of the wider count
    const stage = typecheckStageOf(result.stages);
    expect(stage.status).toBe('fail');
    expect(stage.detail).toContain('tsconfig.build.json');
    expect(stage.data?.exitCode).not.toBe(0);
  }, 120_000);
});

describe('Scenario: behavior — a project path containing a space', () => {
  let ws: TmpWorkspace;
  beforeEach(() => {
    // The prefix carries the space (mkdtemp appends its own suffix), so the
    // project root — and therefore the resolved tsc entry — contains one. A
    // path without a space is the case that already worked, so it proves
    // nothing about this defect.
    ws = useTmpWorkspace('peaks slice check-');
  });
  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when the project path contains a space, should still run the typecheck stage', async () => {
    // given: a clean project whose path contains a space, with BOTH shapes of
    //        local tsc on disk — the `.bin/tsc.cmd` shim the old resolver
    //        spawned with `shell: true`, and the package's JS entry
    writeSyntheticProject(ws, { wideErrors: 0 });
    writeLegacyTscCmdShim(ws);
    expect(ws.path).toContain(' ');
    // when: slice check runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: the gate passes — a spaced path is an argument, not a shell word
    const stage = typecheckStageOf(result.stages);
    expect(stage.status).toBe('pass');
    expect(stage.data?.exitCode).toBe(0);
  }, 120_000);
});

describe('Scenario: integration — typecheck stage against this repository', () => {
  it('when slice check runs on this repo, should pass on the clean build tsconfig instead of being permanently red', async () => {
    // given: this repository, whose tsconfig.build.json is clean but whose
    //        tsconfig.json carries pre-existing tests-only errors
    // when: the typecheck stage runs (twice, once per tsconfig)
    // then: the stage passes — the residue is a baseline, not a blocker
    const stage = await repoTypecheckStage();
    expect(stage.status).toBe('pass');
    expect(stage.data?.wideTsconfigErrors as number).toBeLessThanOrEqual(
      TYPECHECK_PREEXISTING_BASELINE
    );
  }, 120_000);
});

describe('Scenario: a11y — an unresolvable CLI is named, not an ENOENT', () => {
  let ws: TmpWorkspace;
  beforeEach(() => {
    ws = useTmpWorkspace();
  });
  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when the project has no installed tsc, should name the missing binary and the path searched', async () => {
    // given: a project whose dependencies were never installed
    mkdirSync(ws.peaksDir, { recursive: true });
    // when: slice check runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: a named code and the searched path — not an ENOENT-shaped exit 1
    //       that reads like a genuine typecheck failure
    const stage = typecheckStageOf(result.stages);
    expect(stage.status).toBe('fail');
    expect(stage.data?.code).toBe(BINARY_UNRESOLVED_CODE);
    expect(stage.detail).toContain(BINARY_UNRESOLVED_CODE);
    expect(stage.detail).toContain(join('node_modules', 'typescript', 'bin', 'tsc'));
  });
});

describe('Scenario: a11y — the pre-existing count is surfaced, not hidden', () => {
  it('when slice check runs, should name the pre-existing error count and its baseline in the stage detail', async () => {
    // given: the typecheck stage output a human reads
    // when: the detail line is inspected
    // then: both numbers are visible, so a stale baseline is detectable
    const stage = await repoTypecheckStage();
    expect(stage.detail).toContain('tsconfig.json');
    expect(stage.detail).toContain(String(stage.data?.wideTsconfigErrors));
    expect(stage.detail).toContain('baseline');
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// rid=2026-09-14-audit-artifact-rid-scoping, repair cycle 1.
//
// QA measured this: when slice `2026-09-14-audit-artifact-rid-scoping` made
// the rid-scoped evidence names canonical, the `review-fanout` stage of
// `peaks slice check` kept probing ONLY the pre-rid names. Measured on a tree
// holding exactly the evidence that slice made canonical:
//
//   review-fanout => fail | Missing or empty: code-review, security-review, perf-baseline.
//
// `peaks slice check` is a registered CLI verb whose help text promises
// "exit 0 only if every stage passes or is skipped", and it runs after the
// peaks-code micro-loop — so it rejected work that satisfied its own gate.
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario: behavior — the review-fanout stage reads rid-scoped evidence', () => {
  const EVIDENCE_RID = '2026-09-14-audit-artifact-rid-scoping';

  let ws: TmpWorkspace;
  beforeEach(() => {
    ws = useTmpWorkspace('peaks-slice-check-fanout-');
  });
  afterEach(() => {
    cleanupTmpWorkspace();
  });

  /** Write evidence at `.peaks/<rid>/<relativePath>` — the scope the stage probes. */
  function writeEvidence(relativePath: string, body: string): void {
    const absolute = join(ws.peaksDir, EVIDENCE_RID, relativePath);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, body, 'utf8');
  }

  function fanoutStageOf(stages: readonly SliceCheckStage[]): SliceCheckStage {
    const stage = stages.find((s) => s.name === 'review-fanout');
    if (stage === undefined) throw new Error('slice check produced no review-fanout stage');
    return stage;
  }

  function writeRidScopedEvidence(): void {
    writeEvidence(
      `rd/code-review-${EVIDENCE_RID}.md`,
      '# Code review\n\n## Findings\n\nCRITICAL: none.\n'
    );
    writeEvidence(`audit/security-${EVIDENCE_RID}.md`, '# Security audit\n\n## Verdict\n\npass\n');
    writeEvidence(
      `audit/perf-${EVIDENCE_RID}.md`,
      '# Performance audit\n\n## Baseline\n\n| m | b | a |\n'
    );
  }

  it('when only the rid-scoped evidence exists, should pass the review-fanout stage', async () => {
    // given: exactly the layout the peaks-rd SKILL now instructs the LLM to
    //        write — every evidence file carries the rid, none the bare name
    writeRidScopedEvidence();
    // when: the boundary gate runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: EVIDENCE_RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: it passes. Pre-repair this same tree reported
    //       "Missing or empty: code-review, security-review, perf-baseline".
    const stage = fanoutStageOf(result.stages);
    expect(stage.status).toBe('pass');
    // and it passes for the right reason: each artifact resolved to THIS
    // rid's file, not to some other name that happened to exist.
    const found = stage.data?.found as ReadonlyArray<{ name: string; path: string }> | undefined;
    for (const name of ['code-review', 'security-review', 'perf-baseline']) {
      expect(found?.find((entry) => entry.name === name)?.path).toContain(EVIDENCE_RID);
    }
  }, 120_000);

  it('when a slice produced no evidence at all, should still fail the review-fanout stage', async () => {
    // given: nothing on disk — the clean control group proving the stage can
    //        still reject, rather than having been loosened into always-pass
    mkdirSync(ws.peaksDir, { recursive: true });
    // when: the boundary gate runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: EVIDENCE_RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: all three are named missing
    const stage = fanoutStageOf(result.stages);
    expect(stage.status).toBe('fail');
    expect(stage.data?.missing).toEqual(['code-review', 'security-review', 'perf-baseline']);
  }, 120_000);

  it('when a stale bare file sits beside this rid evidence, should resolve the rid-scoped one', async () => {
    // given: a bare `rd/code-review.md` from a sibling slice, plus this rid's
    //        own files. Ordering matters — the sibling's file must not win.
    writeEvidence(
      'rd/code-review.md',
      '# Code review (sibling slice)\n\n## Findings\n\nCRITICAL: none.\n'
    );
    writeRidScopedEvidence();
    // when: the boundary gate runs
    const result = await sliceCheck({
      projectRoot: ws.path,
      rid: EVIDENCE_RID,
      refreshFanout: false,
      skipTests: true
    });
    // then: the reported path for code-review is this rid's own file
    const stage = fanoutStageOf(result.stages);
    expect(stage.status).toBe('pass');
    const found = stage.data?.found as ReadonlyArray<{ name: string; path: string }> | undefined;
    expect(found?.find((entry) => entry.name === 'code-review')?.path).toContain(
      `code-review-${EVIDENCE_RID}.md`
    );
  }, 120_000);
});
