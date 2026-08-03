import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(__dirname, '..', '..', 'openspec', 'baselines', 'inputs', '4.0.8-baseline-input.json');

describe('4.0.8 baseline input shape', () => {
  it('exists and has all 15 P0 rows', () => {
    expect(existsSync(FILE)).toBe(true);
    const data = JSON.parse(readFileSync(FILE, 'utf8')) as { rows: Array<{ journeyId: string }> };
    expect(data.rows).toHaveLength(15);
    const ids = new Set(data.rows.map((r) => r.journeyId));
    for (const j of ['J01','J02','J03','J04','J05','J06','J07','J08','J09','J10','J11','J12','J13','J14','J15']) {
      expect(ids.has(j)).toBe(true);
    }
  });
});
