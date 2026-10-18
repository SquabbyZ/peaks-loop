// tests/unit/cli/commands/skill-doctor-severity.test.ts
//
// `peaks skill doctor` must honour the doctor severity contract: a
// `severity: 'warning'` finding is displayed but does not fail the command.
//
// The parity check (`skills:reference-parity:*`) is a warning producer whose id
// starts with `skill`, so it flows through `runSkillDoctor`. Before the fix the
// command counted every `!check.ok` as a failure and exited 1 on a warning —
// contradicting `doctor-service/types.ts` and the PRD ("a missing reference
// degrades a skill but does not fail the install").
//
// Dimensions covered:
//   - render:      the JSON envelope (`ok`, `warnings`, the displayed checks)
//   - behavior:    exit code as a function of severity (warning vs error)
//   - integration: the real `registerSkillRegistryCommands` + real doctor report
//                  shape; only `runDoctor` is replaced
//   - a11y:        the human output marks the warning and says "warning(s)"
//
// Run with: pnpm vitest run tests/unit/cli/commands/skill-doctor-severity.test.ts

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSkillRegistryCommands } from '~/src/cli/commands/core/skill-registry-commands';
import type { DoctorCheck, DoctorReport } from '~/src/services/doctor/doctor-service/types';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, type CapturedIo } from '../../_setup/io.js';

declareDimensions('tests/unit/cli/commands/skill-doctor-severity.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const __doctor = vi.hoisted(() => ({
  report: {
    checks: [] as DoctorCheck[],
    summary: { ok: true, passed: 0, failed: 0, warnings: 0 }
  } as DoctorReport
}));

vi.mock('../../../../src/services/doctor/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/services/doctor/index.js')>()),
  runDoctor: () => Promise.resolve(__doctor.report)
}));

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  __doctor.report = {
    checks: [],
    summary: { ok: true, passed: 0, failed: 0, warnings: 0 }
  };
});

function reportWith(checks: DoctorCheck[]): DoctorReport {
  const failed = checks.filter((check) => !check.ok && check.severity !== 'warning').length;
  const warnings = checks.filter((check) => !check.ok && check.severity === 'warning').length;
  return {
    checks,
    summary: { ok: failed === 0, passed: checks.length - failed - warnings, failed, warnings }
  };
}

async function runCli(args: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSkillRegistryCommands(program.command('skill'), io);
  await program.parseAsync(['node', 'peaks', 'skill', 'doctor', ...args]);
  return captured;
}

const PARITY_WARNING: DoctorCheck = {
  id: 'skills:reference-parity:claude-code:peaks-code',
  ok: false,
  severity: 'warning',
  message:
    'Skill peaks-code under IDE claude-code diverges from the canonical store; missing: references/fast-lane-norm.md. Ask the LLM to run `peaks skill sync`.'
};

const REAL_FAILURE: DoctorCheck = {
  id: 'skill:peaks-code',
  ok: false,
  message: 'Missing required skill peaks-code'
};

describe('(render) skill doctor JSON envelope', () => {
  it('reports a warning-only report as ok:true with the warning counted separately', async () => {
    __doctor.report = reportWith([
      { id: 'skill:peaks-code', ok: true, message: 'Required skill peaks-code exists' },
      PARITY_WARNING
    ]);

    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as {
      ok: boolean;
      data: { ok: boolean; warnings: number; checks: DoctorCheck[] };
    };

    expect(envelope.ok).toBe(true);
    expect(envelope.data.ok).toBe(true);
    expect(envelope.data.warnings).toBe(1);
    expect(envelope.data.checks.map((check) => check.id)).toContain(PARITY_WARNING.id);
  });

  it('reports a genuine failure as ok:false', async () => {
    __doctor.report = reportWith([REAL_FAILURE]);

    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as { data: { ok: boolean } };

    expect(envelope.data.ok).toBe(false);
  });
});

describe('(behavior) skill doctor exit code follows severity', () => {
  it('keeps exit code 0 when the only finding is a warning', async () => {
    __doctor.report = reportWith([PARITY_WARNING]);

    await runCli(['--json']);

    expect(process.exitCode).toBe(originalExitCode);
  });

  it('sets exit code 1 when a genuine (non-warning) failure is present', async () => {
    __doctor.report = reportWith([REAL_FAILURE]);

    await runCli(['--json']);

    expect(process.exitCode).toBe(1);
  });
});

describe('(integration) skill doctor registry filter', () => {
  it('includes skills:-prefixed checks and leaves unrelated ids out', async () => {
    __doctor.report = reportWith([
      { id: 'build:dist-version-matches-source', ok: false, message: 'unrelated failure' },
      PARITY_WARNING
    ]);

    const captured = await runCli(['--json']);
    const envelope = JSON.parse(captured.text()) as { data: { checks: DoctorCheck[] } };

    expect(envelope.data.checks.map((check) => check.id)).toEqual([PARITY_WARNING.id]);
    expect(process.exitCode).toBe(originalExitCode);
  });
});

describe('(a11y) skill doctor human output', () => {
  it('shows the warning message and a warning count without a failure line', async () => {
    __doctor.report = reportWith([PARITY_WARNING]);

    const captured = await runCli([]);

    expect(captured.text()).toContain('references/fast-lane-norm.md');
    expect(captured.text()).toContain('0 failed, 1 warning(s)');
    expect(captured.text()).toContain('!');
    expect(captured.stderrText()).not.toContain('One or more skill checks failed');
  });
});
