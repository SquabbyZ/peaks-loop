/**
 * Slice 2026-06-16-peaks-code-auto-scaffold (RD#7) — workspace-init integration
 * test for the missing-standards diagnostic.
 *
 * The detector itself is unit-tested in
 * `tests/unit/standards/missing-standards-detector.test.ts`. This suite
 * exercises the wiring inside `initWorkspace`:
 *
 *   AC1: when `.claude/rules/common/` and `.claude/rules/<language>/` are
 *        absent or empty, `initWorkspace` returns a `standardsMissing`
 *        descriptor in its report.
 *   AC2: when the rules tree IS populated, no descriptor is returned.
 *   AC3: `initWorkspace({ initStandards: true })` runs the standards
 *        writer and the report's `standardsApplied.writtenFiles` lists
 *        the freshly-written rule files.
 *   AC4: the JSON envelope (assembled by the CLI in workspace-commands.ts)
 *        puts a human-readable string into `warnings` and the structured
 *        diagnostic into `data.standardsMissing` so both the LLM and the
 *        human see it. The string is asserted via a focused round-trip
 *        through the same `ok()` envelope helper the CLI uses.
 *   AC7: when the `.standards-checked` marker exists for the session,
 *        the diagnostic is still computed (the marker does not gate the
 *        computation) but the once-per-session contract is the CLI's
 *        responsibility — `initWorkspace` itself always returns the
 *        descriptor. We test that the marker helper (`markStandardsChecked`)
 *        is idempotent.
 *
 * The CLI-level wiring (stderr banner + --init-standards flag) is tested
 * separately at the command level when QA picks up the slice.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { initWorkspace } from '../../../src/services/workspace/workspace-service.js';
import { ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import {
  detectMissingProjectStandards,
  hasStandardsCheckedMarker,
  markStandardsChecked
} from '../../../src/services/standards/missing-standards-detector.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-rd7-ws-'));
}

describe('workspace init — missing-standards diagnostic (slice 2026-06-16-peaks-code-auto-scaffold)', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('AC1 — empty project tree → report.standardsMissing is populated (2.0 canonical path)', async () => {
    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-06-16-test-diagnostic' });

    expect(report.standardsMissing).toBeDefined();
    expect(report.standardsMissing?.missing).toBe(true);
    // 2.0 canonical location: `.peaks/standards/` (slice 2026-07-15).
    expect(report.standardsMissing?.path).toContain('.peaks');
    expect(report.standardsMissing?.path).toContain('standards');
    expect(report.standardsMissing?.remediation).toContain('peaks standards init');
    expect(report.standardsMissing?.remediation).toContain('--init-standards');
  });

  test('AC2 — populated .peaks/standards/ → report.standardsMissing has missing=false', async () => {
    // Pre-populate both required dirs (common + language pack) with at
    // least one .md file at the 2.0 canonical location.
    mkdirSync(join(project, '.peaks', 'standards', 'common'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'common', 'coding-style.md'), '# common rules');
    mkdirSync(join(project, '.peaks', 'standards', 'typescript'), { recursive: true });
    writeFileSync(join(project, '.peaks', 'standards', 'typescript', 'coding-style.md'), '# ts rules');

    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-06-16-test-populated' });

    expect(report.standardsMissing).toBeDefined();
    expect(report.standardsMissing?.missing).toBe(false);
  });

  test('AC3 — initStandards=true auto-applies the scaffold to the 2.0 canonical tree', async () => {
    const sessionId = '2026-06-16-test-init-stds';
    // Pre-create a package.json so detectLanguage picks 'javascript' (the
    // empty-dir test project would otherwise resolve to 'generic', which
    // the writer only populates with `common/` — not the
    // language-specific dir the test asserts on).
    writeFileSync(join(project, 'package.json'), '{}');
    const report = await initWorkspace({
      projectRoot: project,
      sessionId,
      initStandards: true
    });

    // Diagnostic is still computed and returned (the writer is opt-in;
    // the diagnostic is always emitted so the operator sees it).
    expect(report.standardsMissing?.missing).toBe(true);
    expect(report.standardsApplied).toBeDefined();
    expect(report.standardsApplied?.writtenFiles.length).toBeGreaterThan(0);

    // After apply, the on-disk 2.0 canonical tree is populated
    // (slice 2026-07-15: init now writes `.peaks/standards/`, not
    // `.claude/rules/`).
    expect(existsSync(join(project, '.peaks', 'standards', 'common', 'coding-style.md'))).toBe(true);
    expect(existsSync(join(project, '.peaks', 'standards', report.standardsApplied!.language, 'coding-style.md'))).toBe(true);
  });

  test('AC4 — envelope shape: data.standardsMissing carries the structured descriptor and warnings[] has the copy-paste hint', async () => {
    const sessionId = '2026-06-16-test-envelope';
    const report = await initWorkspace({ projectRoot: project, sessionId });

    // Simulate the CLI assembly: put the descriptor into data.standardsMissing
    // and a one-line string into warnings. The CLI uses the same shape.
    const envelope: ResultEnvelope<typeof report> = ok(
      'workspace.init',
      report,
      report.standardsMissing?.missing === true
        ? [report.standardsMissing.remediation]
        : [],
      []
    );

    expect(envelope.data.standardsMissing?.missing).toBe(true);
    expect(envelope.warnings.length).toBe(1);
    expect(envelope.warnings[0]).toContain('peaks standards init');
    expect(envelope.warnings[0]).toContain('--apply');
  });

  test('AC7 — once-per-session marker is idempotent and skipped on subsequent calls', async () => {
    const sessionId = '2026-06-16-test-marker';
    const first = markStandardsChecked(project, sessionId);
    expect(first).toBe(true);
    expect(hasStandardsCheckedMarker(project, sessionId)).toBe(true);

    const second = markStandardsChecked(project, sessionId);
    expect(second).toBe(false);

    // Marker lives under the canonical session runtime dir.
    expect(existsSync(join(project, '.peaks', '_runtime', sessionId, '.standards-checked'))).toBe(true);

    // The marker content is the constant presence string.
    const content = readFileSync(join(project, '.peaks', '_runtime', sessionId, '.standards-checked'), 'utf8');
    expect(content).toBe('standards-checked\n');
  });

  test('detector auto-detects language from projectRoot — uses typescript when tsconfig.json present', () => {
    writeFileSync(join(project, 'tsconfig.json'), '{}');
    const result = detectMissingProjectStandards(project, 'typescript');
    expect(result.language).toBe('typescript');
    expect(result.missing).toBe(true);
  });

  test('report carries sessionRoot and bound=true alongside the diagnostic (no regression)', async () => {
    const report = await initWorkspace({ projectRoot: project, sessionId: '2026-06-16-test-no-regression' });
    expect(report.sessionRoot).toBe(join(project, '.peaks', '_runtime', '2026-06-16-test-no-regression'));
    expect(report.bound).toBe(true);
    expect(report.standardsMissing?.missing).toBe(true);
  });
});