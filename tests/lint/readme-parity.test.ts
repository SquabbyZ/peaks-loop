// tests/lint/readme-parity.test.ts
//
// rid 2026-10-16-readme-en-sync — README.md <-> README-en.md parity.
// rid 2026-10-16-readme-usage-rewrite — retargeted to the usage-document structure.
//
// Why this file exists: the two READMEs drifted apart by a whole section
// (`## 装上以后，文件放在哪` was in README.md and nowhere in README-en.md) and
// by three version claims, and nothing noticed. `scripts/sync-readme-version.mjs`
// could not have noticed: `publish.yml` ran it under
// `permissions: contents: read` and had no commit-back step, so its edit reached
// the CI runner and the npm tarball but never the tracked file. The guard
// therefore has to live in the repository, and that is this file.
//
// Why this file lives OUTSIDE `tests/unit/**`: diagnosis E8 (2026-09-15, see
// `vitest.config.lint.ts`). The sibling README linter was moved out of the unit
// glob because a README check collected as a unit test made doc drift and code
// regression indistinguishable in the report, and counted coverage that does not
// exist. `pnpm test:lint` runs in CI's `test` job (ci.yml, "Lint README/doc
// contracts") with no `continue-on-error`.
//
// Retired with the 2026-10-16 usage rewrite: the version-parity arm. Both
// surfaces it read — the `**最新版本**` / `**Latest**` row and the
// `## 当前状态 · X` / `## Status · shipping X` heading — lived INSIDE the
// `## 当前状态` section the rewrite dropped, so the script that rewrote them, its
// unit test, and its `publish.yml` step were retired together. The npm shields
// badge answers the same question and cannot rot. What replaces the arm is an
// absence control (the surfaces have not crept back) plus an injection control
// that proves the detectors still fire.
//
// Three arms, and the third is load-bearing:
//   1. structural parity   — the same H2 sections, in the same order
//   2. absence             — the retired version row, status heading and
//                            test-case count are gone from both files
//   3. controls that fail  — the same extraction over a document with one
//                            section removed MUST report a mismatch, and the
//                            absence detectors MUST fire on an injected fixture.
//                            Without them a green says nothing (see
//                            `.peaks/memory/a-probe-that-always-says-caught-is-
//                            indistinguishable-from-a-working-guard.md`).
//
// Run with: pnpm test:lint

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declareDimensions } from '../unit/_setup/4dim-template.js';

declareDimensions('tests/lint/readme-parity.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ZH_README = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');
const EN_README = readFileSync(resolve(projectRoot, 'README-en.md'), 'utf8');

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/** Every `## ` heading, in document order. */
function h2Headings(markdown: string): string[] {
  return markdown.match(/^## .*$/gm) ?? [];
}

/**
 * README.md H2 -> README-en.md H2, in order — the eight sections the two usage
 * documents ship. Matched by equality: no heading carries a per-release token
 * any more, so a suffix that this table does not name is a drift, not noise.
 */
const H2_PAIRS: ReadonlyArray<readonly [zh: string, en: string]> = [
  ['## 它是什么', '## What it is'],
  ['## 30 秒上手', '## Up and running in 30 seconds'],
  ['## 装上以后，文件放在哪', '## Where files land after install'],
  ['## 它能为你做什么', '## What it does for you'],
  ['## 为什么大家会选它', '## Why people pick it'],
  ['## 强烈推荐 · 三个项目组合起来用', '## Strongly recommended · compose these three'],
  ['## FAQ', '## FAQ'],
  ['## 链接', '## Links']
];

/** `null` when the two documents are structurally parallel; otherwise the first divergence. */
function parityMismatch(zh: string, en: string): string | null {
  const zhH2 = h2Headings(zh);
  const enH2 = h2Headings(en);
  if (zhH2.length !== H2_PAIRS.length) {
    return `README.md has ${zhH2.length} H2 sections, expected ${H2_PAIRS.length}`;
  }
  if (enH2.length !== H2_PAIRS.length) {
    return `README-en.md has ${enH2.length} H2 sections, expected ${H2_PAIRS.length}`;
  }
  for (let i = 0; i < H2_PAIRS.length; i += 1) {
    const pair = H2_PAIRS[i];
    const zhHeading = zhH2[i];
    const enHeading = enH2[i];
    if (pair === undefined || zhHeading === undefined || enHeading === undefined) {
      return `section ${i + 1} is missing from one of the two READMEs`;
    }
    if (zhHeading !== pair[0]) {
      return `README.md section ${i + 1}: expected a heading equal to "${pair[0]}", found "${zhHeading}"`;
    }
    if (enHeading !== pair[1]) {
      return `README-en.md section ${i + 1}: expected a heading equal to "${pair[1]}", found "${enHeading}"`;
    }
  }
  return null;
}

/** The `**<label>**` table row, or `''` when the label is absent. */
function tableRow(markdown: string, label: string): string {
  return markdown.split('\n').find((line) => line.includes(`**${label}**`)) ?? '';
}

/** The version in the `## 当前状态 · X` / `## Status · shipping X` heading. */
function headingVersion(markdown: string): string | null {
  return (
    new RegExp(String.raw`^## (?:当前状态|Status)[^\n]*?(${SEMVER})`, 'm').exec(markdown)?.[1] ??
    null
  );
}

/**
 * Every case count stated in prose or tables — the same fact stated twice must
 * be stated once. The lookbehind keeps a percent-encoded count out of the
 * census (the READMEs once carried a shields.io `tests-1096%20cases` badge, in
 * which the trailing `0` of `%20` would read as the count `0`); it stays so a
 * number embedded in a URL can never register as a prose claim.
 */
function statedCaseCounts(markdown: string): string[] {
  return [...markdown.matchAll(/(?<![\w%.])(\d[\d.,]*\+?)\s*(?:test\s+)?(?:cases|测试用例)/gi)].map(
    (match) => match[1] ?? ''
  );
}

// ---- render dimension ------------------------------------------------------

describe('(render) — both READMEs expose the same ordered H2 sections', () => {
  it('should report no mismatch for the two real READMEs', () => {
    expect(parityMismatch(ZH_README, EN_README)).toBeNull();
  });

  it('should measure all 8 sections in both files (a green from measuring nothing is not a green)', () => {
    expect(H2_PAIRS).toHaveLength(8);
    expect(h2Headings(ZH_README)).toHaveLength(H2_PAIRS.length);
    expect(h2Headings(EN_README)).toHaveLength(H2_PAIRS.length);
  });
});

// ---- behavior dimension ----------------------------------------------------

describe('(behavior) — the parity check reports the first divergence', () => {
  it('should report a mismatch when a section is removed from the English document', () => {
    const withoutOneSection = EN_README.replace(/^## Where files land after install[ \t]*\n/m, '');
    expect(withoutOneSection).not.toBe(EN_README);
    expect(parityMismatch(ZH_README, withoutOneSection)).not.toBeNull();
  });

  it('should report a mismatch when a section is renamed', () => {
    const firstHeading = h2Headings(EN_README)[0] ?? '';
    expect(firstHeading).not.toBe('');
    const renamed = EN_README.replace(firstHeading, '## Not a section of this document');
    expect(parityMismatch(ZH_README, renamed)).not.toBeNull();
  });
});

// ---- integration dimension -------------------------------------------------

describe('(integration) — the retired version and number surfaces stay retired', () => {
  it('should carry no version row and no status heading in either file', () => {
    expect(tableRow(ZH_README, '最新版本')).toBe('');
    expect(tableRow(EN_README, 'Latest')).toBe('');
    expect(headingVersion(ZH_README)).toBeNull();
    expect(headingVersion(EN_README)).toBeNull();
  });

  it('should state no test-case count in either file', () => {
    expect(statedCaseCounts(ZH_README)).toEqual([]);
    expect(statedCaseCounts(EN_README)).toEqual([]);
  });

  it('should still fire on an injected fixture (an absence a dead detector reports proves nothing)', () => {
    const zhFixture = ['| **最新版本** | x — 4.1.5(2026-10-14) |', '## 当前状态 · 4.1.5', '1096 test cases'].join('\n');
    const enFixture = ['| **Latest** | x — 4.1.5 (2026-10-14) |', '## Status · shipping 4.1.5', '1096 cases'].join('\n');

    expect(tableRow(zhFixture, '最新版本')).not.toBe('');
    expect(tableRow(enFixture, 'Latest')).not.toBe('');
    expect(headingVersion(zhFixture)).toBe('4.1.5');
    expect(headingVersion(enFixture)).toBe('4.1.5');
    expect(statedCaseCounts(zhFixture)).toEqual(['1096']);
    expect(statedCaseCounts(enFixture)).toEqual(['1096']);
  });
});

// ---- a11y dimension --------------------------------------------------------

describe('(a11y) — a divergence names the file and the section it expected', () => {
  it('should name the file and the missing heading in the message', () => {
    const firstHeading = h2Headings(EN_README)[0] ?? '';
    const renamed = EN_README.replace(firstHeading, '## Not a section of this document');
    const message = parityMismatch(ZH_README, renamed);
    expect(message).toContain('README-en.md');
    expect(message).toContain('## What it is');
  });
});
