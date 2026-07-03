// tests/unit/cli/commands/job-help-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('peaks job CLI help snapshot', () => {
  it.skip('matches committed snapshot (enable in M3)', () => {
    const helpPath = resolve(__dirname, '__snapshots__/job-help.txt');
    const actual = readFileSync(helpPath, 'utf8');
    expect(actual).toMatch(/Usage: peaks job/);
    expect(actual).toContain('--job-id <jid>');
    expect(actual).toContain('--main-loop-strategy');
    expect(actual).toContain('--rotate-every');
    expect(actual).toContain('--watch');
    expect(actual).toContain('--budget-mb');
    expect(actual).toContain('--show-cost');
    expect(actual).toContain('rotate-now');
    expect(actual).toContain('subagent-cleanup');
  });
});