/**
 * Slice 3/6 — karpathy-enforcement api-surface-cli
 * 守护测试：`peaks scan api-surface` 命令 + 服务实现 + runbook 占位落实
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../..');
const SCAN_COMMANDS = join(REPO_ROOT, 'src/cli/commands/scan-commands.ts');
const SERVICE_FILE = join(REPO_ROOT, 'src/services/scan/api-surface-service.ts');
const RUNBOOK_FILE = join(REPO_ROOT, 'skills/bee/peaks-rd/references/rd-runbook.md');

describe('peaks scan api-surface (Slice 3/6 — karpathy-enforcement)', () => {
  test('AC-1: scan-commands.ts registers the api-surface subcommand', () => {
    const content = readFileSync(SCAN_COMMANDS, 'utf8');
    expect(content).toMatch(/\.command\(\s*['"]api-surface['"]/);
  });

  test('AC-1: api-surface subcommand declares --project, --format, --include-dirs, --max-per-kind, --json', () => {
    const content = readFileSync(SCAN_COMMANDS, 'utf8');
    // Find the block between the api-surface command registration and the .action call
    const start = content.indexOf(".command('api-surface')");
    expect(start).toBeGreaterThan(0);
    const end = content.indexOf('.action(', start);
    expect(end).toBeGreaterThan(start);
    const block = content.slice(start, end);
    expect(block).toMatch(/--project\s+<path>/);
    expect(block).toMatch(/--format\s+<fmt>/);
    expect(block).toMatch(/--include-dirs\s+<globs>/);
    expect(block).toMatch(/--max-per-kind\s+<n>/);
  });

  test('AC-1: subcommand description references tech-doc Existing API / Component Inventory', () => {
    const content = readFileSync(SCAN_COMMANDS, 'utf8');
    const start = content.indexOf(".command('api-surface')");
    expect(start).toBeGreaterThan(0);
    const end = content.indexOf('.action(', start);
    const block = content.slice(start, end);
    expect(block).toMatch(/Existing API \/ Component Inventory/);
  });

  test('AC-2: api-surface-service.ts exports scanApiSurface and formatApiSurfaceMarkdown', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    expect(content).toMatch(/export\s+async\s+function\s+scanApiSurface/);
    expect(content).toMatch(/export\s+function\s+formatApiSurfaceMarkdown/);
    expect(content).toMatch(/export\s+type\s+ApiSurfaceReport/);
  });

  test('AC-2: service type definitions cover 4 kinds (cli / service / type / constant)', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    expect(content).toMatch(/export\s+type\s+CliEntry/);
    expect(content).toMatch(/export\s+type\s+ServiceEntry/);
    expect(content).toMatch(/export\s+type\s+TypeEntry/);
    expect(content).toMatch(/export\s+type\s+ConstantEntry/);
  });

  test('AC-3: formatApiSurfaceMarkdown produces a `## API surface inventory` markdown block', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    // The function body should contain the literal `## API surface inventory` string
    const fnStart = content.indexOf('export function formatApiSurfaceMarkdown');
    const fnEnd = content.indexOf('\n}\n', fnStart);
    const fnBody = content.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/## API surface inventory/);
    expect(fnBody).toMatch(/CLI subcommands/);
    expect(fnBody).toMatch(/Service exports/);
    expect(fnBody).toMatch(/Public types/);
    expect(fnBody).toMatch(/Module constants/);
  });

  test('AC-4: scanApiSurface signature accepts projectRoot, maxPerKind, includeDirs options', () => {
    const content = readFileSync(SERVICE_FILE, 'utf8');
    expect(content).toMatch(/export\s+type\s+ApiSurfaceOptions\s*=\s*\{[\s\S]*projectRoot:\s*string/);
    expect(content).toMatch(/maxPerKind\?:\s*number/);
    expect(content).toMatch(/includeDirs\?:\s*string/);
  });

  test('AC-5: rd-runbook Step 1.x no longer says "Slice 2/6 placeholder" and references api-surface CLI', () => {
    const content = readFileSync(RUNBOOK_FILE, 'utf8');
    // Slice 3落地后应移除 "Slice 2/6 placeholder" 标记
    expect(content).not.toMatch(/Slice 2\/6 placeholder/);
    // Step 1.x 应已更新为 "Step 1.5 API surface scan" 或类似
    expect(content).toMatch(/API surface scan/);
    expect(content).toMatch(/peaks scan api-surface/);
  });
});
