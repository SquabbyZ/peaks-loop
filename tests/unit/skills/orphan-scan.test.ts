/**
 * Slice 4/6 — karpathy-enforcement orphan-scan-cli
 * 守护测试：`peaks scan orphan` 命令 + 服务实现 + runbook 引用
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../..');
const SCAN_COMMANDS = join(REPO_ROOT, 'src/cli/commands/scan-commands.ts');
const SERVICE_FILE = join(REPO_ROOT, 'src/services/scan/orphan-service.ts');
const RUNBOOK_FILE = join(REPO_ROOT, 'skills/peaks-rd/references/rd-runbook.md');

describe('peaks scan orphan (Slice 4/6 — karpathy-enforcement)', () => {
  test('AC-1: scan-commands.ts registers the orphan subcommand', () => {
    const content = readFileSync(SCAN_COMMANDS, 'utf8');
    expect(content).toMatch(/\.command\(\s*['"]orphan['"]/);
  });

  test('AC-1: orphan subcommand declares --project, --format, --scope, --strict', () => {
    const content = readFileSync(SCAN_COMMANDS, 'utf8');
    const start = content.indexOf(".command('orphan')");
    expect(start).toBeGreaterThan(0);
    const end = content.indexOf('.action(', start);
    expect(end).toBeGreaterThan(start);
    const block = content.slice(start, end);
    expect(block).toMatch(/--project\s+<path>/);
    expect(block).toMatch(/--format\s+<fmt>/);
    expect(block).toMatch(/--scope\s+<scope>/);
    expect(block).toMatch(/--strict/);
  });

  test('AC-1: orphan subcommand description references karpathy §3 Surgical Changes', () => {
    const content = readFileSync(SCAN_COMMANDS, 'utf8');
    const start = content.indexOf(".command('orphan')");
    expect(start).toBeGreaterThan(0);
    const end = content.indexOf('.action(', start);
    const block = content.slice(start, end);
    expect(block).toMatch(/Surgical Changes/);
  });

  test('AC-2: orphan-service.ts exports scanOrphans and formatOrphanMarkdown', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    expect(content).toMatch(/export\s+async\s+function\s+scanOrphans/);
    expect(content).toMatch(/export\s+function\s+formatOrphanMarkdown/);
    expect(content).toMatch(/export\s+type\s+OrphanReport/);
  });

  test('AC-2: service type definitions cover 4 orphan kinds', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    expect(content).toMatch(/export\s+type\s+ExportOrphan/);
    expect(content).toMatch(/export\s+type\s+ImportOrphan/);
    expect(content).toMatch(/export\s+type\s+CliSubcommandOrphan/);
    expect(content).toMatch(/export\s+type\s+DocEndpointOrphan/);
  });

  test('AC-3: formatOrphanMarkdown produces a `## Orphan inventory` markdown block', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    const fnStart = content.indexOf('export function formatOrphanMarkdown');
    const fnEnd = content.indexOf('\n}\n', fnStart);
    const fnBody = content.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/## Orphan inventory/);
    expect(fnBody).toMatch(/Export orphans/);
    expect(fnBody).toMatch(/Import orphans/);
    expect(fnBody).toMatch(/CLI subcommand orphans/);
    expect(fnBody).toMatch(/Doc endpoint orphans/);
  });

  test('AC-4: scanOrphans signature accepts projectRoot, scope, strict options', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    expect(content).toMatch(/export\s+type\s+OrphanScanOptions\s*=\s*\{[\s\S]*projectRoot:\s*string/);
    expect(content).toMatch(/scope\?:\s*OrphanScope/);
    expect(content).toMatch(/strict\?:\s*boolean/);
  });

  test('AC-5: rd-runbook Step 1.x references `peaks scan orphan`', () => {
    const content = readFileSync(RUNBOOK_FILE, 'utf8');
    expect(content).toMatch(/peaks scan orphan/);
    expect(content).toMatch(/Slice 4\/6/);
  });
});
