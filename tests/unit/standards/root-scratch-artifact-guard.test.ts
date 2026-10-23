// tests/unit/standards/root-scratch-artifact-guard.test.ts
//
// The guard behind the scratch-path rule: a scratch capture must not sit at
// the repository root.
//
// WHY THIS FILE EXISTS. The rule "a leaf's scratch must not depend on the cwd
// it happens to be in" was prose in an orchestrator's brief, and the fix that
// pinned an absolute scratch directory into every dispatch prompt is one
// instruction to a model — it is not an executor. The shape it protects
// against is measurable, though: five zero-byte `*.err` captures once reached
// the repository root and were committed, `git status` stayed clean because the
// files were tracked, the file-size census does not read `.err`, and eslint
// does not lint it. Nothing in the tree noticed.
//
// So this file is the executor for the half of the rule that can fail. It runs
// the same detector the audit runs, over the real repository root, and it
// carries an injection control: five captures are written into a throwaway
// directory and the SAME detector is driven over it, so the arm is seen going
// red rather than only ever seen green.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY. Every fixture tree is built under
// `mkdtempSync(join(tmpdir(), ...))` and removed by the test.
//
// Dimensions covered:
//   - behavior:    the detector's two shapes and the boundary between them
//   - integration: the real repository root is clean, and the audit surfaces a
//                  capture as a failure
//   - a11y:        the failure names the file and the remedy
//
// Dimensions omitted:
//   - render:      the detector returns findings and renders no text of its own;
//                  the text a reader sees is the audit finding, judged in a11y.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { findRootScratchArtifacts } from '../../../src/services/audit/enforcers/root-scratch-artifacts.js';
import { runRedLines } from '../../../src/cli/commands/audit-red-lines-runners.js';

declareDimensions(
  'tests/unit/standards/root-scratch-artifact-guard.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the detector returns findings; the rendered text is the audit finding'
    }
  ]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The five capture names that reached a repository root and were committed. */
const CAPTURE_NAMES = [
  'final-review-service-delivery-judgement.err',
  'final-review-service-evidence-budget.err',
  'final-review-service-fact-states-and-guard.err',
  'final-review-service-provider-budget.err',
  'final-review-service-whole-or-nothing.err'
] as const;

/** The finding id the audit reports a root capture under. */
const FINDING_ID = 'rl-root-scratch-artifacts-001';

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'peaks-root-scratch-'));
});

afterEach(() => {
  try {
    rmSync(fixture, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the temp dir; it is reapable either way.
  }
});

/** Write a file at the root of the fixture tree. */
function writeAtRoot(name: string, content = ''): void {
  writeFileSync(join(fixture, name), content, 'utf8');
}

/**
 * The audit command's findings for the root sweep, in one place.
 *
 * The command is the surface, not the service behind it: the arm has to be
 * reachable by running `peaks audit red-lines`, so the arm is driven the way a
 * reader would drive it.
 */
function rootScratchFindings(projectRoot: string): readonly {
  readonly enforcerId: string;
  readonly severity: string;
  readonly file: string;
  readonly detail: string;
}[] {
  const { io, captured } = makeCapturedIo();
  runRedLines({ project: projectRoot, json: true }, io);
  const envelope = JSON.parse(captured.text()) as {
    data: {
      enforcerFindings: { enforcerId: string; severity: string; file: string; detail: string }[];
    };
  };
  return envelope.data.enforcerFindings.filter((finding) => finding.enforcerId === FINDING_ID);
}

describe('Scenario: behavior — the sweep names the two shapes', () => {
  it('when five captures sit at a root, should report each one', () => {
    // given: five capture files at the root of a throwaway tree
    // when: the sweep runs over that root
    // then: every one of them is reported, as the capture shape
    for (const name of CAPTURE_NAMES) writeAtRoot(name);
    const artifacts = findRootScratchArtifacts({ projectRoot: fixture });
    expect(artifacts.map((artifact) => artifact.name)).toEqual([...CAPTURE_NAMES]);
    expect(artifacts.every((artifact) => artifact.shape === 'stderr-capture')).toBe(true);
  });

  it('when a root file holds no bytes, should report the zero-byte shape', () => {
    // given: an empty file at the root of a throwaway tree
    // when: the sweep runs over that root
    // then: it is reported, as the other shape
    writeAtRoot('empty.txt');
    const artifacts = findRootScratchArtifacts({ projectRoot: fixture });
    expect(artifacts).toEqual([{ name: 'empty.txt', shape: 'zero-byte', size: 0 }]);
  });

  it('when a root file holds content, should report nothing', () => {
    // given: a root file with content, and the empty placeholder beside it
    // when: the sweep runs over that root
    // then: neither is reported
    writeAtRoot('README.md', '# a project\n');
    writeAtRoot('.gitkeep');
    const artifacts = findRootScratchArtifacts({ projectRoot: fixture });
    expect(artifacts).toEqual([]);
  });

  it('when a capture sits below the root, should not report it', () => {
    // given: a capture one directory down
    // when: the sweep runs over that root
    // then: it is out of the sweep's reach, and the boundary is the root itself
    mkdirSync(join(fixture, 'logs'), { recursive: true });
    writeFileSync(join(fixture, 'logs', 'run.err'), 'boom\n', 'utf8');
    const artifacts = findRootScratchArtifacts({ projectRoot: fixture });
    expect(artifacts).toEqual([]);
  });
});

describe('Scenario: integration — the arm runs, and it goes red', () => {
  it('when the real repository root is swept, should hold no scratch artifact', () => {
    // given: this repository's own root
    // when: the sweep runs over it
    // then: it is clean — and the sweep read a root, so the answer is not vacuous
    const artifacts = findRootScratchArtifacts({ projectRoot: REPO_ROOT });
    expect(
      readdirSync(REPO_ROOT).length,
      'the root must not be empty for this to mean anything'
    ).toBeGreaterThan(0);
    expect(artifacts).toEqual([]);
  });

  it('when the audit runs over a root with a capture, should report a failure', () => {
    // given: a root carrying one capture
    // when: the audit runs over that root
    // then: the capture is a failure, named as the file it is
    writeAtRoot(CAPTURE_NAMES[0]);
    const findings = rootScratchFindings(fixture);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('fail');
    expect(findings[0]?.file).toBe(CAPTURE_NAMES[0]);
  });

  it('when five captures are written into a root, should turn the arm red', () => {
    // given: a control root that is clean, and a root that carries the five
    //        captures
    // when: the audit runs over both roots
    // then: the control is silent and the injected root is red on all five —
    //        the arm is observed failing, not only ever observed passing
    const clean = mkdtempSync(join(tmpdir(), 'peaks-root-scratch-control-'));
    for (const name of CAPTURE_NAMES) writeAtRoot(name);
    try {
      const controlFindings = rootScratchFindings(clean);
      const injectedFindings = rootScratchFindings(fixture);
      expect(controlFindings).toEqual([]);
      expect(injectedFindings).toHaveLength(CAPTURE_NAMES.length);
      expect(injectedFindings.map((finding) => finding.file)).toEqual([...CAPTURE_NAMES]);
      expect(injectedFindings.every((finding) => finding.severity === 'fail')).toBe(true);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });
});

describe('Scenario: a11y — the failure tells a reader what to do', () => {
  it('when the audit reports a capture, should name the shape and the remedy', () => {
    // given: a root carrying one capture
    // when: the audit runs over that root
    // then: the finding says what the file is and where scratch belongs
    writeAtRoot(CAPTURE_NAMES[0]);
    const findings = rootScratchFindings(fixture);
    const detail = findings[0]?.detail ?? '';
    expect(detail).toContain('stderr capture');
    expect(detail).toContain('session runtime dir');
  });
});
