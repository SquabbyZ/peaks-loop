import { describe, it, expect } from 'vitest';
import { ResourceBudgetGuard } from '../../../../packages/peaks-loop-internal-runtime/src/guards/resource-budget';

describe('ResourceBudgetGuard', () => {
  it('reports own rss and cpu%', () => {
    const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
    const s = g.sample();
    expect(s.rssMb).toBeGreaterThan(0);
    expect(s.cpuPct).toBeGreaterThanOrEqual(0);
  });

  it('throttles when concurrent fan-out exceeds limit', () => {
    const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
    const r = g.enforce({ active: 9 }, { maxConcurrent: 8 });
    expect(r.throttle).toBe(true);
  });

  it('does not throttle under limit', () => {
    const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
    const r = g.enforce({ active: 4 }, { maxConcurrent: 8 });
    expect(r.throttle).toBe(false);
  });
});