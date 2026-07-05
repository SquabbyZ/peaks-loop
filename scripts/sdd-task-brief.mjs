#!/usr/bin/env node
/**
 * sdd-task-brief.mjs — 替代 superpowers 的 scripts/task-brief
 * 把 plan 文件里 ### Task N 段抽出到唯一命名的临时文件,打印路径。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const planFile = process.argv[2];
const taskNum = process.argv[3];

if (!planFile || !taskNum) {
  console.error('Usage: sdd-task-brief.mjs <plan.md> <N>');
  process.exit(2);
}

const content = readFileSync(planFile, 'utf-8');
const lines = content.split('\n');
const out = [];
let capture = false;
let level = 0;
for (const line of lines) {
  const taskHeading = new RegExp(`^### Task ${taskNum}(: |\\b)`);
  if (taskHeading.test(line)) {
    capture = true;
    level = 3;
    out.push(line);
    continue;
  }
  if (capture) {
    const h = /^(#+)\s/.exec(line);
    if (h && h[1].length <= level) break;
    out.push(line);
  }
}

if (!out.length) {
  console.error(`Task ${taskNum} not found in ${planFile}`);
  process.exit(3);
}

const tmp = join(tmpdir(), 'sdd-brief');
mkdirSync(tmp, { recursive: true });
const outPath = join(tmp, `task-${taskNum}-brief-${Date.now()}.md`);
writeFileSync(outPath, out.join('\n'));
console.log(outPath);