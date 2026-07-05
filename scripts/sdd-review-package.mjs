#!/usr/bin/env node
/**
 * sdd-review-package.mjs — 替代 superpowers 的 scripts/review-package
 * 把 git diff <base>..<head> 写到唯一命名的临时文件,打印路径。
 * 用于 subagent-driven-development 的 reviewer dispatch。
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2];
const head = process.argv[3] ?? 'HEAD';

if (!base) {
  console.error('Usage: sdd-review-package.mjs <base> [<head>]');
  process.exit(2);
}

const tmp = join(tmpdir(), 'sdd-review');
mkdirSync(tmp, { recursive: true });

const stamp = Date.now();
const log = execSync(`git log --oneline ${base}..${head}`, { encoding: 'utf-8' });
const stat = execSync(`git diff --stat ${base}..${head}`, { encoding: 'utf-8' });
const diff = execSync(`git diff -U10 ${base}..${head}`, { encoding: 'utf-8' });

const outPath = join(tmp, `review-package-${stamp}.md`);
const body = [
  `# SDD Review Package`,
  ``,
  `**base:** \`${base}\``,
  `**head:** \`${head}\``,
  `**generatedAt:** ${new Date().toISOString()}`,
  ``,
  `## Commits`,
  ``,
  '```',
  log.trim(),
  '```',
  ``,
  `## Diff stat`,
  ``,
  '```',
  stat.trim(),
  '```',
  ``,
  `## Diff (-U10 context)`,
  ``,
  '```diff',
  diff.trim(),
  '```',
  ``,
].join('\n');

writeFileSync(outPath, body);
console.log(outPath);