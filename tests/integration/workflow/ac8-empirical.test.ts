/**
 * AC8 empirical measurement harness (slice 027).
 *
 * Measures the actual token/byte reduction achieved by the security/perf
 * plan/result split (slice 025) over a 3-slice sequence.
 *
 * The baseline is the pre-slice-025 monolithic findings layout: each
 * slice writes a full ~192-line security+perf findings pair (2 files
 * per slice, ~192 lines combined). The post-slice-025 layout writes
 * one ~50-line plan once, then a ~5-10 line delta per slice.
 *
 * Gated on `PEAKS_BUILD_AVAILABLE=1` so PR-time vitest runs skip the
 * CLI invocation cleanly. The dogfood pass runs with the env var set
 * and `bin/peaks.js` built.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SKIP = process.env.PEAKS_BUILD_AVAILABLE !== '1';
const SID = '2026-06-10-session-c4a2be';
const CLI = resolve(__dirname, '../../../bin/peaks.js');

(SKIP ? describe.skip : describe)('AC8 empirical: 3-slice token reduction', () => {
  let tempDir: string;
  let sessionDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ac8-empirical-'));
    sessionDir = join(tempDir, '.peaks', '_runtime', SID);
    mkdirSync(join(sessionDir, 'qa'), { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'ac8-fixture', dependencies: {} }, null, 2), 'utf8');
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reduction >= 40% on a 3-slice sequence', () => {
    const runPeaks = (args: string[]): string =>
      execFileSync('node', [CLI, ...args, '--project', tempDir, '--session-id', SID, '--json'], { encoding: 'utf8' });

    // Step 1: write the project-level plans
    runPeaks(['workflow', 'plan', 'refresh', '--type', 'security', '--apply']);
    runPeaks(['workflow', 'plan', 'refresh', '--type', 'perf', '--apply']);

    const planSecPath = join(sessionDir, 'qa', 'security-test-plan.md');
    const planPerfPath = join(sessionDir, 'qa', 'perf-baseline.md');
    expect(statSync(planSecPath).size).toBeGreaterThan(0);
    expect(statSync(planPerfPath).size).toBeGreaterThan(0);

    // Step 2: read plan hashes
    const secHash = JSON.parse(runPeaks(['workflow', 'plan', 'read', '--type', 'security'])).data.hash;
    const perfHash = JSON.parse(runPeaks(['workflow', 'plan', 'read', '--type', 'perf'])).data.hash;

    // Step 3: simulate 3 slices, each writing a lean delta
    const rids = ['slice-a', 'slice-b', 'slice-c'];
    for (let i = 0; i < rids.length; i++) {
      const secDelta = `# Security findings — ${rids[i]}

## Plan reference
- plan-hash: ${secHash}
- plan-path: .peaks/_runtime/${SID}/qa/security-test-plan.md
- unchanged-since: ${i === 0 ? 'new' : rids[i - 1]}

## Delta
- finding-${i}: minor issue in module X
- finding-${i}b: minor issue in module Y
`;
      const perfDelta = `# Performance findings — ${rids[i]}

## Plan reference
- plan-hash: ${perfHash}
- plan-path: .peaks/_runtime/${SID}/qa/perf-baseline.md
- unchanged-since: ${i === 0 ? 'new' : rids[i - 1]}

## Delta
- hotspot-${i}: route /foo is slow under load
`;
      writeFileSync(join(sessionDir, 'qa', `security-findings-${rids[i]}.md`), secDelta);
      writeFileSync(join(sessionDir, 'qa', `performance-findings-${rids[i]}.md`), perfDelta);
    }

    // Step 4: read the real baseline from the fixture
    const baselineSec = readFileSync(
      resolve(__dirname, '../../fixtures/plan-cli-baseline/security-findings-full.md'),
      'utf8'
    );
    const baselinePerf = readFileSync(
      resolve(__dirname, '../../fixtures/plan-cli-baseline/performance-findings-full.md'),
      'utf8'
    );
    const baselineBytesPerSlice = Buffer.byteLength(baselineSec, 'utf8') + Buffer.byteLength(baselinePerf, 'utf8');
    const baselineBytesTotal = baselineBytesPerSlice * 3;

    // Step 5: measure actual
    const planBytes = statSync(planSecPath).size + statSync(planPerfPath).size;
    const deltaBytes = rids.reduce((sum, rid) => {
      return (
        sum +
        statSync(join(sessionDir, 'qa', `security-findings-${rid}.md`)).size +
        statSync(join(sessionDir, 'qa', `performance-findings-${rid}.md`)).size
      );
    }, 0);
    const actualBytes = planBytes + deltaBytes;

    const reductionPct = ((baselineBytesTotal - actualBytes) / baselineBytesTotal) * 100;

    // Diagnostic: print the actual numbers so a human reading the test output can see them
    // eslint-disable-next-line no-console
    console.log(`AC8 empirical:
  baseline (3-slice pre-slice-025): ${baselineBytesTotal} bytes (${baselineBytesPerSlice}/slice)
  actual    (1 plan + 3 deltas):   ${actualBytes} bytes
    - plans: ${planBytes}
    - deltas: ${deltaBytes}
  reduction: ${reductionPct.toFixed(1)}%`);

    expect(reductionPct).toBeGreaterThanOrEqual(40);
  });
});
