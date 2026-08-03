import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..');
const CURRENT = join(REPO, 'openspec', 'baselines', 'current', 'capability-baseline.json');
const CURRENT_LOCK = join(REPO, 'openspec', 'baselines', 'current', 'capability-baseline.lock');
const HIST_DIR = join(REPO, 'openspec', 'baselines', 'history', '4.0.8');

describe('4.0.8 frozen baseline', () => {
  it('has both current file and lock', () => {
    expect(existsSync(CURRENT)).toBe(true);
    expect(existsSync(CURRENT_LOCK)).toBe(true);
  });
  it('history snapshot exists and matches current', () => {
    expect(existsSync(join(HIST_DIR, 'capability-baseline.json'))).toBe(true);
    expect(existsSync(join(HIST_DIR, 'capability-baseline.lock'))).toBe(true);
    const cur = readFileSync(CURRENT, 'utf8');
    const hist = readFileSync(join(HIST_DIR, 'capability-baseline.json'), 'utf8');
    expect(cur).toBe(hist);
  });
});
