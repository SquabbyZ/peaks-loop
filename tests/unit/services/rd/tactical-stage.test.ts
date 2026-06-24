import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStrategicStage } from '../../../../src/services/rd/strategic-stage.js';
import { runTacticalStage, registerStratSig, STRAT_SIG_REGISTRY } from '../../../../src/services/rd/tactical-stage.js';
import type { ImplOutput } from '../../../../src/services/rd/types.js';

/**
 * H8 (audit trail hashable) — spec §3.2 mandates that `impl.json.inputSig`
 * EQUALS `strat.sha256`. The existing 64-hex format pin in this file is
 * necessary but not sufficient: a buggy orchestrator that fabricates any
 * 64-hex string as inputSig would still pass the format check while
 * breaking the STRAT → TACT chain. These two tests pin the EQUALITY.
 *
 * Invariant phrase (documented for the future enforcement slice, see
 * R1-W3): the spec-mandated error is "STRAT.sig chain broken". The
 * negative test currently FAILS (TDD red) because `impl.ts` does not
 * yet verify the chain — that is exactly the gap R1-W2 flagged and the
 * R1-W3 enforcement slice will close. This test pins the spec invariant
 * so the fix cannot ship without a green test.
 */
const STRAT_SIG_CHAIN_INVARIANT = 'STRAT.sig chain broken';

describe('runTacticalStage', () => {
  it('runs AST gate then writes TACT.sig when gate passes', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-'));
    try {
      // H8 chain: real STRAT.sig upstream so chain check passes.
      const strat = await runStrategicStage({
        goal: 'add OAuth callback',
        rootCauseAnalysis: 'callback URL unknown',
        impactSurface: ['LoginForm.tsx'],
        designRationale: 'option B',
        out: join(workdir, 'strategy.md'),
      });
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { add } from './local';
        export const x = add(1, 2);
      `);
      const out = join(workdir, 'impl.json');
      const result = await runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: strat.sha256,
        context: { deps: {}, docSummaries: [] },
        out,
      });
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('throws when AST gate fails — does NOT write TACT.sig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-fail-'));
    try {
      // H8 chain: real STRAT.sig upstream so AST gate is the failure surface.
      const strat = await runStrategicStage({
        goal: 'fix callback',
        rootCauseAnalysis: 'unknown api used',
        impactSurface: ['A.ts'],
        designRationale: 'remove unknown import',
        out: join(workdir, 'strategy.md'),
      });
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { unknownApi } from 'oauth-client';
        unknownApi();
      `);
      await expect(runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: strat.sha256,
        context: {
          deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
          docSummaries: [{ dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback'] }],
        },
        out: join(workdir, 'impl.json'),
      })).rejects.toThrow(/AST gate/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  // --- H8 STRAT.sig chain equality (R1-W2 HIGH) ---

  it('TACT.inputSig EQUALS STRAT.sha256 — chain holds end-to-end', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-h8-'));
    try {
      // 1. Run the strategic stage to produce a real STRAT.sig upstream.
      const stratOut = join(workdir, 'strategy.md');
      const strat = await runStrategicStage({
        goal: 'add OAuth callback',
        rootCauseAnalysis: 'callback URL unknown',
        impactSurface: ['LoginForm.tsx'],
        designRationale: 'option B',
        out: stratOut,
      });
      expect(strat.sha256).toMatch(/^[a-f0-9]{64}$/);

      // 2. Run the tactical stage with strat.sha256 as inputSig.
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { add } from './local';
        export const x = add(1, 2);
      `);
      const tactOut = join(workdir, 'impl.json');
      const tact: ImplOutput = await runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: strat.sha256,
        context: { deps: {}, docSummaries: [] },
        out: tactOut,
      });

      // 3. Chain equality is the spec mandate — not just format.
      expect(tact.inputSig).toBe(strat.sha256);

      // 4. Cross-check: on-disk impl.json carries the same chain.
      const onDisk = JSON.parse(readFileSync(tactOut, 'utf8')) as ImplOutput;
      expect(onDisk.inputSig).toBe(strat.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it(`rejects fabricated inputSig not chained to a real STRAT — throws "${STRAT_SIG_CHAIN_INVARIANT}"`, async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-h8neg-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { add } from './local';
        export const x = add(1, 2);
      `);
      // No runStrategicStage call: no real STRAT upstream exists.
      // A 64-hex string is not enough — spec H8 mandates it chain to a real STRAT.sig.
      await expect(runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: 'a'.repeat(64),
        context: { deps: {}, docSummaries: [] },
        out: join(workdir, 'impl.json'),
      })).rejects.toThrow(STRAT_SIG_CHAIN_INVARIANT);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// C11 STRAT.sig chain contract — call-order & mismatch coverage
// (PRD: 2026-06-24-c11-ast-gate-strat-sig; AC-1.2 / AC-1.3 / AC-1.5 + JSDoc-derived)
// =============================================================================
//
// The chain check is per-process (STRAT_SIG_REGISTRY: Map<projectDir, sig>).
// Tests must isolate entries between cases to avoid bleed-through, since
// the map is a process-wide singleton. Using a fresh workdir per test is
// enough because registerStratSig keys by dirname(input.out) which is the
// unique workdir. Still, a beforeEach/afterEach pair is added as defense
// against any future test that reuses a workdir.
let c11Workdir = '';
beforeEach(() => {
  c11Workdir = mkdtempSync(join(tmpdir(), 'peaks-c11-chain-'));
});
afterEach(() => {
  // Wipe the c11 workdir entry from the chain registry (defense in depth).
  if (c11Workdir) STRAT_SIG_REGISTRY.delete(c11Workdir);
  rmSync(c11Workdir, { recursive: true, force: true });
});

describe('runTacticalStage (★ C11 STRAT.sig chain contract)', () => {
  it('AC-1.2 — throws STRAT_SIG_CHAIN_INVARIANT when inputSig mismatches registered STRAT.sig', async () => {
    mkdirSync(join(c11Workdir, 'src'), { recursive: true });
    writeFileSync(join(c11Workdir, 'src', 'A.ts'), `
      import { add } from './local';
      export const x = add(1, 2);
    `);
    // Register sig b…
    registerStratSig(c11Workdir, 'b'.repeat(64));
    // …but pass sig a. Chain check must reject.
    await expect(runTacticalStage({
      project: c11Workdir,
      changedFiles: ['src/A.ts'],
      inputSig: 'a'.repeat(64),
      context: { deps: {}, docSummaries: [] },
      out: join(c11Workdir, 'impl.json'),
    })).rejects.toThrow(STRAT_SIG_CHAIN_INVARIANT);
  });

  it('AC-1.3 — chain check fires even when AST gate would pass (no 6.x API used)', async () => {
    mkdirSync(join(c11Workdir, 'src'), { recursive: true });
    // Valid 5.x-only code — AST gate would pass.
    writeFileSync(join(c11Workdir, 'src', 'A.ts'), `
      import { add } from './local';
      export const x = add(1, 2);
    `);
    // Register sig b, but pass sig a (mismatch). The chain check fires AFTER
    // the AST gate but BEFORE writeImpl. Even with no AST violations, the
    // mismatch must surface the chain error — chain is its own gate.
    registerStratSig(c11Workdir, 'b'.repeat(64));
    await expect(runTacticalStage({
      project: c11Workdir,
      changedFiles: ['src/A.ts'],
      inputSig: 'a'.repeat(64),
      context: { deps: {}, docSummaries: [] },
      out: join(c11Workdir, 'impl.json'),
    })).rejects.toThrow(STRAT_SIG_CHAIN_INVARIANT);
    // Defense: confirm impl.json was NOT written.
    expect(existsSync(join(c11Workdir, 'impl.json'))).toBe(false);
  });

  it('AC-1.5 — positive happy-path: register STRAT.sig, valid 5.x-only code, resolves', async () => {
    mkdirSync(join(c11Workdir, 'src'), { recursive: true });
    // Valid 5.x-only code, locked-version doc summary allows it.
    writeFileSync(join(c11Workdir, 'src', 'A.ts'), `
      import { add } from './local';
      export const x = add(1, 2);
    `);
    const sig = 'c'.repeat(64);
    registerStratSig(c11Workdir, sig);
    const out = join(c11Workdir, 'impl.json');
    const result = await runTacticalStage({
      project: c11Workdir,
      changedFiles: ['src/A.ts'],
      inputSig: sig,
      context: { deps: {}, docSummaries: [] },
      out,
    });
    expect(result.inputSig).toBe(sig);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(out)).toBe(true);
  });

  it('JSDoc contract — runTacticalStage without prior registerStratSig throws "<unregistered>" chain error', async () => {
    mkdirSync(join(c11Workdir, 'src'), { recursive: true });
    writeFileSync(join(c11Workdir, 'src', 'A.ts'), `
      import { add } from './local';
      export const x = add(1, 2);
    `);
    // No registerStratSig call — the @remarks JSDoc contract says this must
    // throw the chain error with stratSig=<unregistered>. Pins the documented
    // call-order so future refactors cannot silently weaken it.
    await expect(runTacticalStage({
      project: c11Workdir,
      changedFiles: ['src/A.ts'],
      inputSig: 'd'.repeat(64),
      context: { deps: {}, docSummaries: [] },
      out: join(c11Workdir, 'impl.json'),
    })).rejects.toThrow(/<unregistered>/);
  });
});
