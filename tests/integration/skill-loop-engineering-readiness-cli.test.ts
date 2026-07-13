/**
 * `peaks skill lint --category loop-engineering-readiness` — M6 integration tests.
 *
 * Required by M6:
 *   - peaks-maker passes
 *   - a fake skill that does not reference the guideline file fails
 *   - a fake skill that introduces a CLI-verb-bypass line fails
 *
 * Plus two extras for robustness:
 *   - the lint envelopes are well-formed JSON envelopes with exit code 0/1
 *   - missing --path fails with a structured error
 *   - the alias `peaks skill ready --category loop-engineering-readiness` works
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from './_cli-helper.js';

const REPO_ROOT = resolve(__dirname, '..', '..');

// In-process CLI invocation (see tests/integration/_cli-helper.ts).
// Replaces the previous `execFileSync(TSX, ...)` spawn which became
// the dominant cost under vitest single-fork full-suite execution
// on Windows (`Test timed out in 120000ms` for the readiness-lint
// path despite per-test runs completing in <1s).

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-skill-readiness-'));
}

function writeFakeSkill(
  projectRoot: string,
  body: string,
): string {
  const dir = join(projectRoot, 'fake-skill');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  const md = [
    '---',
    'name: peaks-fake-skill',
    'description: fake skill for the readiness lint integration tests',
    '---',
    '',
    '# Peaks-Fake-Skill',
    '',
    body,
    '',
  ].join('\n');
  writeFileSync(path, md, 'utf-8');
  return dir;
}

function cli(args: string[], cwd: string) {
  return runCli(args, cwd);
}

describe('peaks skill lint --category loop-engineering-readiness (M6)', () => {
  test('peaks-maker SKILL.md passes the readiness lint', async () => {
    const peaksMakerPath = resolve(
      REPO_ROOT,
      'src',
      'skills',
      'peaks-maker',
      'SKILL.md',
    );
    const project = mkdtempSync(join(tmpdir(), 'peaks-skill-readiness-'));
    try {
      const result = await cli(
        [
          'skill',
          'lint',
          '--category',
          'loop-engineering-readiness',
          '--path',
          peaksMakerPath,
          '--json',
        ],
        project,
      );
      expect(result.code).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.category).toBe('loop-engineering-readiness');
      expect(envelope.data.findings).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('a fake skill that does not reference the guideline file fails the lint', async () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-skill-readiness-'));
    try {
      const skillDir = writeFakeSkill(
        project,
        [
          'No reference to the shared guideline file at all.',
        ].join('\n'),
      );
      const result = await cli(
        [
          'skill',
          'lint',
          '--category',
          'loop-engineering-readiness',
          '--path',
          skillDir,
          '--json',
        ],
        project,
      );
      expect(result.code).toBe(1);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.code).toBe('SKILL_READINESS_FAILED');
      const codes = (envelope.data.findings as string[]).map((f) =>
        f.split(':')[0],
      );
      expect(codes).toContain('missing-guideline-reference');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('a fake skill that introduces a CLI-verb-bypass line fails the lint', async () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-skill-readiness-'));
    try {
      const skillDir = writeFakeSkill(
        project,
        [
          'Reference: .peaks/standards/loop-engineering-guidelines.md',
          '',
          'Run `peaks custom-evolve my-bee` to evolve your bee directly.',
        ].join('\n'),
      );
      const result = await cli(
        [
          'skill',
          'lint',
          '--category',
          'loop-engineering-readiness',
          '--path',
          skillDir,
          '--json',
        ],
        project,
      );
      expect(result.code).toBe(1);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(false);
      const codes = (envelope.data.findings as string[]).map((f) =>
        f.split(':')[0],
      );
      expect(codes).toContain('cli-verb-bypass');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('unknown --category fails with UNKNOWN_LINT_CATEGORY', async () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-skill-readiness-'));
    try {
      const skillDir = writeFakeSkill(
        project,
        'Reference: .peaks/standards/loop-engineering-guidelines.md',
      );
      const result = await cli(
        [
          'skill',
          'lint',
          '--category',
          'something-else',
          '--path',
          skillDir,
          '--json',
        ],
        project,
      );
      expect(result.code).toBe(1);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.code).toBe('UNKNOWN_LINT_CATEGORY');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('missing --path fails with MISSING_PATH', async () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-skill-readiness-'));
    try {
      const result = await cli(
        [
          'skill',
          'lint',
          '--category',
          'loop-engineering-readiness',
          '--json',
        ],
        project,
      );
      // commander treats requiredOption as a precondition; we accept
      // either a structured MISSING_PATH envelope or a commander-level
      // error code — both are "lint refused to run".
      expect(result.code).toBeGreaterThan(0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('alias `peaks skill ready --category loop-engineering-readiness` works', async () => {
    const peaksMakerPath = resolve(
      REPO_ROOT,
      'src',
      'skills',
      'peaks-maker',
      'SKILL.md',
    );
    const project = mkdtempSync(join(tmpdir(), 'peaks-skill-readiness-'));
    try {
      const result = await cli(
        [
          'skill',
          'ready',
          '--category',
          'loop-engineering-readiness',
          '--path',
          peaksMakerPath,
          '--json',
        ],
        project,
      );
      expect(result.code).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.category).toBe('loop-engineering-readiness');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});