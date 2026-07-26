/**
 * rid-008 Phase 2 E2E critical-path coverage thickener.
 *
 * Runs the 5 critical CLI paths in-process via `runCli` from
 * `tests/integration/_cli-helper.js`. The helper loads
 * `src/cli/program.js` directly (no spawn, no tsx) and returns
 * `{ stdout, stderr, code }`. We feed each call a tmp cwd so the
 * `peaks workspace init` side-effect does not pollute the project
 * root.
 *
 * Each test asserts:
 *   - functional exit code (0 for happy paths; documented non-zero
 *     where the CLI rejects a required flag and writes a JSON envelope
 *     before the action runs — see per-test comments)
 *   - presence of a canonical surface marker on stdout (the JSON
 *     envelope field or human-readable banner the real CLI prints)
 *
 * IMPORTANT: surface markers are the ACTUAL markers produced by the
 * CLI on 2026-07-27 (commit 7716e6d5 baseline). Do not "improve"
 * them without re-preflighting the real CLI.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../integration/_cli-helper.js';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
let tmpRoot = '';

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'peaks-e2e-'));
});

afterAll(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe('Phase 2 critical paths', () => {
  // 1. peaks workspace init — happy path. Creates the runtime dir
  // under the per-test tmp cwd, not the project root. Real CLI
  // prints a JSON envelope on stdout (see src/cli/index.ts +
  // src/cli/commands/workspace.ts); envelope includes
  // "sessionId" and "sessionRoot" fields.
  test('peaks workspace init', async () => {
    const result = await runCli(
      ['workspace', 'init', '--session-id', '2026-07-27-rid008-e2e', '--project', tmpRoot],
      tmpRoot
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"sessionId"');
    expect(result.stdout).toContain('2026-07-27-rid008-e2e');
    expect(result.stdout).toContain('"sessionRoot"');
    // No JSON envelope on stderr for a successful init.
    expect(result.stderr).not.toContain('"ok": false');
  });

  // 2. peaks slice check — runs the 4-stage boundary gate. We pass
  // --skip-tests so the test stage does not re-run the full vitest
  // suite inside an e2e file (would compound flakiness). The CLI
  // always prints a JSON envelope with "stages" (typecheck /
  // unit-tests / review-fanout / gate-verify-pipeline) and the
  // active "rid".
  //
  // Exit code: preflight-verified 1. A freshly-invented rid has no
  // review-fanout or QA evidence, so the gate-verify-pipeline stage
  // reports "fail" and the CLI calls process.exit(1). This is the
  // documented behavior (see slice-check-service.ts); we assert on
  // the non-zero exit + the JSON envelope shape, NOT on per-stage
  // pass/fail (that belongs to slice-check-service.test.ts).
  test('peaks slice check', async () => {
    const result = await runCli(
      ['slice', 'check', '--rid', 'rid-008-e2e-probe', '--skip-tests', '--project', PROJECT_ROOT],
      tmpRoot
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"rid"');
    expect(result.stdout).toContain('rid-008-e2e-probe');
    expect(result.stdout).toContain('"stages"');
    // Stage names from src/cli/commands/slice.ts boundary pipeline.
    expect(result.stdout).toContain('"typecheck"');
    expect(result.stdout).toContain('"unit-tests"');
    expect(result.stdout).toContain('"review-fanout"');
    expect(result.stdout).toContain('"gate-verify-pipeline"');
  });

  // 3. peaks workflow plan read — reads the project-level plan
  // envelope. We use --type perf because the actual perf-baseline
  // artifact lives under .peaks/_runtime/<sid>/qa/perf-baseline.md;
  // a freshly-initialized workspace has no envelope, so the CLI
  // prints { "exists": false, "source": "missing" } which is the
  // canonical surface marker for "no plan yet".
  test('peaks workflow plan read', async () => {
    const result = await runCli(
      ['workflow', 'plan', 'read', '--type', 'perf', '--project', PROJECT_ROOT],
      tmpRoot
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"type"');
    expect(result.stdout).toContain('"perf"');
    expect(result.stdout).toContain('"exists"');
    // Canonical "missing" marker — the CLI distinguishes missing
    // vs. present envelopes by `source: "missing"` in
    // src/cli/commands/workflow.ts.
    expect(result.stdout).toContain('"source"');
    expect(result.stdout).toContain('"missing"');
  });

  // 4. peaks audit red-lines — scans skills/, .claude/rules/, and
  // openspec/changes/ for MANDATORY / BLOCKING / MUST NOT / RED LINE
  // markers. With --json the CLI prints the audit envelope
  // (ok/command/data/totalRedLines/...). The project has prose-only
  // and partial == 0 post-rid-007, but the surface marker we assert
  // is the envelope shape (not the per-row content). Exit code 0.
  test('peaks audit red-lines', async () => {
    const result = await runCli(
      ['audit', 'red-lines', '--json', '--project', PROJECT_ROOT],
      PROJECT_ROOT
    );

    expect(result.code).toBe(0);
    // Envelope header from src/cli/commands/audit.ts.
    expect(result.stdout).toContain('"ok": true');
    expect(result.stdout).toContain('"command"');
    expect(result.stdout).toContain('audit.red-lines');
    // The data payload always carries these counters; even when
    // both partial and proseOnly are 0 the keys are present.
    expect(result.stdout).toContain('"totalRedLines"');
    expect(result.stdout).toContain('"partial"');
    expect(result.stdout).toContain('"proseOnly"');
  });

  // 5. peaks release plan <version> — starts a new release. The
  // CLI writes a JSON envelope with "version", "currentStage", and
  // "projectRoot", followed by a human-readable next-action line
  // ("Run `peaks release canary --percent 10` ...").
  //
  // We point --project at the per-test tmpRoot so we do NOT collide
  // with any active release in the project root (the CLI keeps a
  // single canary pipeline state per project; if there's already an
  // active release there, plan fails with CONFLICT — see
  // src/cli/commands/release.ts). The tmpRoot has never run a
  // release, so plan succeeds.
  test('peaks release plan <version>', async () => {
    const result = await runCli(
      ['release', 'plan', '9.9.9-rid008-probe', '--project', tmpRoot],
      tmpRoot
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"version"');
    expect(result.stdout).toContain('9.9.9-rid008-probe');
    expect(result.stdout).toContain('"currentStage"');
    expect(result.stdout).toContain('"projectRoot"');
    // Human-readable next-action line that follows the JSON envelope.
    expect(result.stdout).toContain('peaks release canary');
  });
});