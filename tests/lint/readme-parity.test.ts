// tests/lint/readme-parity.test.ts
//
// rid 2026-10-16-readme-en-sync — README.md <-> README-en.md parity.
//
// Why this file exists: the two READMEs drifted apart by a whole section
// (`## 装上以后，文件放在哪` was in README.md and nowhere in README-en.md) and
// by three version claims, and nothing noticed. `scripts/sync-readme-version.mjs`
// could not have noticed: `publish.yml` runs it under
// `permissions: contents: read` and has no commit-back step, so its edit
// reaches the CI runner and the npm tarball but never the tracked file. The
// guard therefore has to live in the repository, and that is this file.
//
// Why it lives OUTSIDE `tests/unit/**`: diagnosis E8 (2026-09-15, see
// `vitest.config.lint.ts`). The sibling README linter was moved out of the unit
// glob because a README check collected as a unit test made doc drift and code
// regression indistinguishable in the report, and counted coverage that does not
// exist. `pnpm test:lint` runs in CI's `test` job (ci.yml, "Lint README/doc
// contracts") with no `continue-on-error`.
//
// Three arms, and the third is load-bearing:
//   1. structural parity   — the same H2 sections, in the same order
//   2. version parity      — every version claim equals package.json#version,
//                            and the two files agree on the test-case count
//   3. controls that fail  — the same extraction over a document with one
//                            section removed MUST report a mismatch. Without
//                            one, a green says nothing (see
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
const PKG_VERSION = (
  JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string }
).version;

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;

/** Every `## ` heading, in document order. */
function h2Headings(markdown: string): string[] {
  return markdown.match(/^## .*$/gm) ?? [];
}

/**
 * README.md H2 -> README-en.md H2, in order.
 *
 * Matched by *prefix*, not equality, because two headings legitimately carry a
 * number: the status heading (`## 当前状态 · 4.1.5`), which
 * `scripts/sync-readme-version.mjs` rewrites on every release, and the ship
 * summary's rid count. A prefix match keeps this table from encoding a version
 * a fourth time and having to be updated alongside it.
 */
const H2_PAIRS: ReadonlyArray<readonly [zh: string, en: string]> = [
  ['## 它是什么', '## What it is'],
  ['## 30 秒上手', '## Up and running in 30 seconds'],
  ['## 装上以后，文件放在哪', '## Where files land after install'],
  ['## 它能为你做什么', '## What it does for you'],
  ['## 为什么大家会选它', '## Why people pick it'],
  ['## 装上以后的几道闸门', '## What gates ship by default'],
  ['## 当前状态 · ', '## Status · shipping '],
  ['## 强烈推荐 · 三个项目组合起来用', '## Strongly recommended · compose these four'],
  ['## 开发者 · 24h 模式 / 批量工具', '## For developers · 24h mode and batch tooling'],
  ['## FAQ', '## FAQ'],
  ['## 全量 skill 索引', '## Full skill index'],
  ['## Ship 摘要(4.x · 19 rid)', '## Ship summary (4.x · 19 rids)'],
  ['## 下游消费者须知', '## Downstream consumer notes'],
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
    if (!zhHeading.startsWith(pair[0])) {
      return `README.md section ${i + 1}: expected a heading starting "${pair[0]}", found "${zhHeading}"`;
    }
    if (!enHeading.startsWith(pair[1])) {
      return `README-en.md section ${i + 1}: expected a heading starting "${pair[1]}", found "${enHeading}"`;
    }
  }
  return null;
}

/** The `**<label>**` table row, or `''` when the label is absent. */
function tableRow(markdown: string, label: string): string {
  return markdown.split('\n').find((line) => line.includes(`**${label}**`)) ?? '';
}

/** The version in the `**最新版本**` / `**Latest**` row's `— <version>` label. */
function badgeVersion(markdown: string, label: string): string | null {
  return new RegExp(String.raw`—\s*(${SEMVER})`).exec(tableRow(markdown, label))?.[1] ?? null;
}

/** The version in the `## 当前状态 · X` / `## Status · shipping X` heading. */
function headingVersion(markdown: string): string | null {
  return (
    new RegExp(String.raw`^## (?:当前状态|Status)[^\n]*?(${SEMVER})`, 'm').exec(markdown)?.[1] ??
    null
  );
}

/** The leading count token of the `**测试套件**` / `**Test suite**` row (`1096`, `285+`). */
function caseCount(markdown: string, label: string): string | null {
  return /(\d[\d.,]*\+?)\s*(?:test\s+)?cases/i.exec(tableRow(markdown, label))?.[1] ?? null;
}

/**
 * Every case count stated in prose or tables — the same fact stated twice must
 * be stated once. The lookbehind keeps the percent-encoded shields.io badge URL
 * out of the census: in `tests-1096%20cases` the trailing `0` of `%20` would
 * otherwise read as the count `0`.
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

  it('should measure all 14 sections in both files (a green from measuring nothing is not a green)', () => {
    expect(H2_PAIRS).toHaveLength(14);
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

describe('(integration) — version claims are read from the real tree', () => {
  it('should equal package.json#version in the badge row and the status heading of each file', () => {
    expect(badgeVersion(ZH_README, '最新版本')).toBe(PKG_VERSION);
    expect(headingVersion(ZH_README)).toBe(PKG_VERSION);
    expect(badgeVersion(EN_README, 'Latest')).toBe(PKG_VERSION);
    expect(headingVersion(EN_README)).toBe(PKG_VERSION);
  });

  it('should agree on the test-suite case count across the two files', () => {
    const zhCount = caseCount(ZH_README, '测试套件');
    expect(zhCount).not.toBeNull();
    expect(caseCount(EN_README, 'Test suite')).toBe(zhCount);
  });

  it('should state one case count in README.md, not two', () => {
    const counts = statedCaseCounts(ZH_README);
    expect(counts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(counts).size).toBe(1);
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
