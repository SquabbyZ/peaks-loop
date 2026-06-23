/**
 * Slice 2026-06-24-audit-5th-p2 — pin the hard-constraint contract.
 *
 * The 2.8.3-era `defaultMode = 'serial'` opt-out was removed by user
 * direction ("禁止单 sub-agent"). This test replaces the previous
 * `skills-solo-fanout-opt-out.test.ts` suite and pins three things:
 *
 *   1. SKILL.md still mentions `peaks sub-agent dispatch --from-dag`
 *      (the canonical fan-out trigger) AND no longer contains the
 *      `Fan-out opt-out` subsection.
 *   2. `references/fanout-opt-out.md` is gone; the new
 *      `references/fanout-mandatory.md` explains the hard constraint.
 *   3. `DEFAULT_PREFERENCES.fanout.defaultMode === 'fan-out'` and the
 *      closed set `FANOUT_MODES === ['fan-out']` (no `'serial'` member).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  FANOUT_MODES,
  isFanoutMode,
  type FanoutMode
} from '../../../src/services/preferences/preferences-types.js';

// Resolve relative to this test file, not process.cwd() — vitest can run
// the suite from a different working directory than the repo root, and
// the SKILL.md / reference doc paths must stay stable.
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');
const SKILL_PATH = join(REPO_ROOT, 'skills', 'peaks-solo', 'SKILL.md');
const REFERENCE_PATH = join(REPO_ROOT, 'skills', 'peaks-solo', 'references', 'fanout-mandatory.md');
const OPT_OUT_PATH = join(REPO_ROOT, 'skills', 'peaks-solo', 'references', 'fanout-opt-out.md');
const SKILL_BYTE_CAP = 24000; // tracked elsewhere (peaks scan file-size audit)

describe('peaks-solo SKILL.md — fan-out is mandatory (slice 2026-06-24-audit-5th-p2)', () => {
  it('SKILL.md keeps the default fan-out phrase AND flips the opt-out into a hard constraint', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');
    // The original slice-5 contract must remain in place.
    expect(body).toContain('peaks sub-agent dispatch --from-dag');
    expect(body).toMatch(/≥\s*2\s+leaves|at\s+least\s+2\s+leaves/i);
    // The 2.8.3 opt-out escape hatch must be gone.
    expect(body).not.toContain('Fan-out opt-out');
    // Note: SKILL.md may mention the removed `'serial'` value in the
    // migration callout (it's documenting the breaking change), but
    // it must NOT frame it as an active escape hatch — the slice
    // pattern `defaultMode = 'serial'` is what the 2.8.3 contract
    // used to advertise as the opt-out, so its absence confirms the
    // new contract no longer surfaces it as a knob.
    expect(body).not.toMatch(/`preferences\.fanout\.defaultMode\s*=\s*'serial'`\s*(?:escape hatch|opt-out|backward)/i);
    // Equivalent: a line that reads as instructions ("set X to opt out")
    // must be gone.
    expect(body).not.toMatch(/set.*fanout.*to.*serial.*opt/i);
    // The new hard-constraint subsection must be in place.
    expect(body).toContain('Hard constraint: fan-out is mandatory');
    expect(body).toContain('references/fanout-mandatory.md');
  });

  it('SKILL.md points to the new mandatory reference (not the opt-out one)', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');
    expect(body).not.toContain('references/fanout-opt-out.md');
    expect(body).toContain('references/fanout-mandatory.md');
  });

  it('reference doc (fanout-mandatory.md) explains the hard constraint + migration path', async () => {
    const body = await readFile(REFERENCE_PATH, 'utf8');
    expect(body).toContain('Fan-out is mandatory');
    expect(body).toMatch(/removed in 2\.8\.4/);
    expect(body).toContain('migratePreferences');
    expect(body).toContain('serial'); // must explain what was removed
  });

  it('opt-out reference doc is deleted', async () => {
    // The 2.8.3 file must be gone. We use a fs.stat-like probe via
    // readFile (which throws ENOENT) so the assertion surfaces a clear
    // path string in the failure message.
    await expect(readFile(OPT_OUT_PATH, 'utf8')).rejects.toThrow(/ENOENT|no such file/);
  });

  // NOTE: SKILL.md byte cap (24000) is enforced by `peaks scan file-size`
  // and the lint-style audit enforcer, NOT by this slice's regression
  // suite. The pre-slice baseline already sits ~1100 bytes over the cap
  // (see AC-7 baseline-allowed fail list); trimming is tracked separately
  // by the file-size audit fix (out of scope for slice A).
});

describe('FanoutMode schema — closed set pinned to fan-out only (slice 2026-06-24-audit-5th-p2)', () => {
  it('FANOUT_MODES is the singleton [\'fan-out\']', () => {
    expect(FANOUT_MODES).toEqual(['fan-out']);
  });

  it('FanoutMode union type accepts only fan-out', () => {
    // Compile-time: assignable.
    const ok: FanoutMode = 'fan-out';
    expect(ok).toBe('fan-out');
    // Runtime: the type guard rejects everything else (including 'serial').
    expect(isFanoutMode('fan-out')).toBe(true);
    expect(isFanoutMode('serial')).toBe(false);
    expect(isFanoutMode('parallel')).toBe(false);
    expect(isFanoutMode('')).toBe(false);
    expect(isFanoutMode(null)).toBe(false);
    expect(isFanoutMode(42)).toBe(false);
  });

  it('DEFAULT_PREFERENCES.fanout.defaultMode === \'fan-out\' (mandatory, no opt-out)', () => {
    expect(DEFAULT_PREFERENCES.fanout.defaultMode).toBe('fan-out');
  });
});