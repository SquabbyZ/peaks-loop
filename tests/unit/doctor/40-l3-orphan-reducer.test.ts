import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runDoctor } from '../../../src/services/doctor/doctor-service.js';

// Slice 2026-06-24-doctor-1xdetector-residual regression suite.
// The `L3:l3-orphan-sessions` reducer must skip canonical system
// subdirs under `.peaks/_runtime/` (e.g. `change/`, which is the
// routing target for change-id reviewable artifacts per F3 audit-p1).
// Without the exclude-list the reducer flips the doctor summary to
// fail on every clean workspace, which broke 7 doctor-family tests
// across doctor.test.ts / 35-checks-aggregate.test.ts /
// cli-program.core.test.ts.

describe('doctor L3:l3-orphan-sessions reducer (round-2 regression)', () => {
  test('skips the canonical `change/` system subdir under .peaks/_runtime/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-orphan-'));
    const runtimeDir = join(root, '.peaks', '_runtime');
    await mkdir(runtimeDir, { recursive: true });
    // `change/` is a canonical system subdir (see
    // src/services/artifacts/change-scope-service.ts). It must NOT be
    // flagged as an orphan session.
    await mkdir(join(runtimeDir, 'change'), { recursive: true });
    // Two valid sids alongside the system subdir.
    await mkdir(join(runtimeDir, '2026-06-24-session-514c27'), { recursive: true });
    await mkdir(join(runtimeDir, '2026-06-23-session-dc4cbc'), { recursive: true });

    const report = await runDoctor({ l3ProjectRoot: root });

    const orphan = report.checks.find((check) => check.id === 'L3:l3-orphan-sessions');
    expect(orphan).toBeDefined();
    expect(orphan?.ok).toBe(true);
    expect(orphan?.message).toContain('All 2 session(s)');
    expect(orphan?.message).not.toContain('change');
  });

  test('still flags a real orphan session id under .peaks/_runtime/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-orphan-real-'));
    const runtimeDir = join(root, '.peaks', '_runtime');
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(join(runtimeDir, 'change'), { recursive: true });
    // Bogus session id: neither matches the date-session-hex format
    // nor is a known system subdir.
    await mkdir(join(runtimeDir, 'random-orphan-dir'), { recursive: true });

    const report = await runDoctor({ l3ProjectRoot: root });

    const orphan = report.checks.find((check) => check.id === 'L3:l3-orphan-sessions');
    expect(orphan).toBeDefined();
    expect(orphan?.ok).toBe(false);
    expect(orphan?.message).toContain('random-orphan-dir');
  });

  test('passes when .peaks/_runtime/ contains only valid sids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-doctor-orphan-clean-'));
    const runtimeDir = join(root, '.peaks', '_runtime');
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(join(runtimeDir, '2026-06-24-session-514c27'), { recursive: true });

    const report = await runDoctor({ l3ProjectRoot: root });

    const orphan = report.checks.find((check) => check.id === 'L3:l3-orphan-sessions');
    expect(orphan?.ok).toBe(true);
  });
});