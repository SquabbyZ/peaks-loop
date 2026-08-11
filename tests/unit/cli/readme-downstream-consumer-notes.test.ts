// tests/unit/cli/readme-downstream-consumer-notes.test.ts
//
// rid-CG-008 — Downstream consumer notes section (doc-only).
//
// Verifies that both README files (English canonical + Chinese mirror)
// expose the "Downstream consumer notes" section that downstream
// consumers need in order to know that `codegraph` is a transitive
// dep, that `.codegraph/` is a shared-naming directory, and that
// session binding lives under `.peaks/_runtime/<sessionId>/`.
//
// The test reads the README files via `node:fs` + a workspace alias
// (no mocking) and asserts:
//   1. The English README has the section heading.
//   2. The English README body has at least 10 lines after the heading.
//   3. Keywords `codegraph`, `init`, `conflict`, `session` all hit.
//   4. No references to user-internal absolute paths (only relative
//      paths inside the project).
//   5. The Chinese mirror (README.md) has the same keywords.
//
// Run with:
//   pnpm vitest run tests/unit/cli/readme-downstream-consumer-notes.test.ts

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/cli/readme-downstream-consumer-notes.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const EN_README_PATH = resolve(projectRoot, 'README-en.md');
const ZH_README_PATH = resolve(projectRoot, 'README.md');

function readReadme(path: string): string {
  return readFileSync(path, 'utf8');
}

function sectionBody(markdown: string, heading: string): string {
  const headingIndex = markdown.indexOf(heading);
  if (headingIndex < 0) {
    return '';
  }
  // Capture from the heading line forward until the next `---` divider
  // or the next `## ` heading of equal weight. The section lives between
  // dividers in the canonical README layout.
  const afterHeading = markdown.slice(headingIndex + heading.length);
  const nextDivider = afterHeading.indexOf('\n---\n');
  if (nextDivider < 0) {
    return afterHeading;
  }
  return afterHeading.slice(0, nextDivider);
}

describe('README Downstream consumer notes (rid-CG-008)', () => {
  it('English README contains the "Downstream consumer notes" heading', () => {
    const body = readReadme(EN_README_PATH);
    expect(body).toContain('Downstream consumer notes');
  });

  it('English README section body has at least 10 lines of prose', () => {
    const body = readReadme(EN_README_PATH);
    const section = sectionBody(body, 'Downstream consumer notes');
    const nonEmptyLines = section
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(10);
  });

  it('English README section hits all 4 required keywords (codegraph, init, conflict, session)', () => {
    const body = readReadme(EN_README_PATH);
    const section = sectionBody(body, 'Downstream consumer notes');
    const lowered = section.toLowerCase();
    expect(lowered).toContain('codegraph');
    expect(lowered).toContain('init');
    expect(lowered).toContain('conflict');
    expect(lowered).toContain('session');
  });

  it('English README references the verify script path relatively', () => {
    const body = readReadme(EN_README_PATH);
    const section = sectionBody(body, 'Downstream consumer notes');
    expect(section).toContain('scripts/verify-codegraph-tarball.mjs');
    // Must NOT reference user-internal absolute paths.
    expect(section).not.toMatch(/[A-Z]:\\Users\\/i);
    expect(section).not.toMatch(/\/Users\//i);
  });

  it('Chinese README mirror contains the same heading + keywords', () => {
    const body = readReadme(ZH_README_PATH);
    expect(body).toContain('下游消费者须知');
    const section = sectionBody(body, '下游消费者须知');
    // Section must mention codegraph in English (CLI name stays English
    // even in the Chinese mirror) and the 4 canonical keywords in
    // their Chinese forms where applicable.
    expect(section).toContain('codegraph');
    expect(section).toContain('session');
  });

  it('English README mentions exit code 73 in the conflict-pitfall block', () => {
    const body = readReadme(EN_README_PATH);
    const section = sectionBody(body, 'Downstream consumer notes');
    expect(section).toContain('73');
  });
});
