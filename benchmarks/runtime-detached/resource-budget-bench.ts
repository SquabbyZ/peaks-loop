/**
 * Resource budget bench — verifies §5.3 ceiling rails under idle.
 * N=8 fan-out bench deferred to Phase A E2E (not in this stub).
 */
import { ResourceBudgetGuard } from '../../packages/peaks-loop-internal-runtime/src/index';

const g = new ResourceBudgetGuard({ maxRssMb: 200, maxCpuPct: 5 });
const s = g.sample();
const ok = s.rssMb <= 200 && s.cpuPct <= 5;
console.log(JSON.stringify({ rssMb: s.rssMb, cpuPct: s.cpuPct, passesGate: ok }));
process.exit(ok ? 0 : 1);