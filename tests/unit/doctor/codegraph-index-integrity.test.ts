// tests/unit/doctor/codegraph-index-integrity.test.ts
//
// 4-dimension unit test for the `capability:codegraph-index-integrity`
// doctor check (slice-001 of rid-2026-09-16-codegraph-index-integrity).
//
// The check is the always-on half of the gate: `peaks codegraph status`
// only fires when someone runs it, while `peaks doctor` runs on every
// project-health pass. It must:
//   - stay silent (ok) when codegraph was never initialized here, so a
//     fresh clone does not fail the doctor — the same posture the exclude
//     check takes, for the same reason;
//   - block when the index provably does not cover the repository, naming
//     WHICH axis fired (an include gap and a stale index are different
//     defects with different fixes);
//   - degrade to a non-blocking warning when it cannot evaluate at all;
//   - never write the config or the index — it consumes the same
//     read-only inspector `status` gates on.
//
// Controls (this repo's standard, non-negotiable):
//   - INJECTION control: each axis is injected via the probe and the check
//     must go `ok:false` naming that axis.
//   - CLEAN control: a defect-free report must be `ok:true`, and a `null`
//     report (no index) must be `ok:true` too — a check that always
//     reports a gap would pass the injection cases alone.
//
// Dimensions covered:
//   - behavior:    not-initialized / clean / include-gap / stale / both /
//                  unevaluable
//   - render:      check id + `ok` + `severity` shape
//   - a11y:        the gapped message names the axis AND a concrete path
//   - integration: the real check plugin is driven through the real doctor
//                  plugin registry (`PLUGINS`), and the real read-only
//                  inspector runs against a throwaway git project whose
//                  index is a real SQLite `files` table
//
// Run with: pnpm vitest run tests/unit/doctor/codegraph-index-integrity.test.ts

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { check } from '~/src/services/doctor/doctor-service/checks/codegraph-index-integrity';
import {
  CODEGRAPH_INDEX_STRICT_ENV_VAR,
  CODEGRAPH_REPAIR_INDEX_COMMAND,
  inspectCodegraphIndexIntegrity
} from '~/src/services/codegraph/codegraph-index-integrity';
import { PLUGINS } from '~/src/services/doctor/doctor-service/plugin-registry';
import type {
  CodegraphIndexIntegrityProbe,
  DoctorCheck,
  DoctorContext,
  DoctorOptions
} from '~/src/services/doctor/doctor-service/types';
import { isArray } from '~/src/shared/array-guards';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/doctor/codegraph-index-integrity.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const CHECK_ID = 'capability:codegraph-index-integrity';

// Minimal DoctorContext — this check only reads `options`.
function makeContext(options: DoctorOptions = {}): DoctorContext {
  return {
    options,
    registry: { skills: [], failures: [] },
    skills: [],
    schemaRoot: '',
    presence: null,
    workspaceInitialized: false,
    statusLineInstalled: false,
    platform: process.platform,
    resolvedL3Root: '',
    projectRootResolver: () => null,
    isValidSessionId: () => true,
    accumulatedChecks: []
  };
}

function runCheck(ctx: DoctorContext): readonly DoctorCheck[] {
  const result = check.run(ctx);

  // `isArray` and NOT `Array.isArray`. The built-in is declared
  // `(arg: any) => arg is any[]`, so its true branch narrows this union to
  // `any[]` and the `return` below became an unchecked `any` return — the
  // finding was about the RETURN, caused by the guard. `isArray` returns a
  // plain `boolean` and asserts nothing, so `result` keeps the union type and
  // the `instanceof` check is what removes the promise arm. A promise reaches
  // `[]` exactly as before: `Array.isArray(promise)` was also false.
  if (result instanceof Promise || !isArray(result)) return [];

  return result;
}

/**
 * Run `body` with the index gate opted in to blocking, then restore the
 * environment — the switch is read from the process, so a leaked value
 * would silently flip every later case in this file to blocking.
 */
async function withStrictMode<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR];
  process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR] = '1';
  try {
    return await body();
  } finally {
    if (previous === undefined) {
      delete process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR];
    } else {
      process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR] = previous;
    }
  }
}

const CLEAN_REPORT: CodegraphIndexIntegrityProbe = {
  gap: false,
  trackedSourceCount: 2,
  admittedTrackedCount: 2,
  includeGap: [],
  indexedFileCount: 2,
  deadRows: []
};

const INCLUDE_GAP_REPORT: CodegraphIndexIntegrityProbe = {
  ...CLEAN_REPORT,
  gap: true,
  trackedSourceCount: 2,
  admittedTrackedCount: 1,
  includeGap: ['scripts/release-pack.mjs']
};

const STALE_REPORT: CodegraphIndexIntegrityProbe = {
  ...CLEAN_REPORT,
  gap: true,
  indexedFileCount: 3,
  deadRows: ['src/cli/commands/deleted-commands.ts']
};

// ── behavior: CLEAN controls ─────────────────────────────────────────

describe('capability:codegraph-index-integrity (clean controls)', () => {
  it('when the index covers the repository, should be ok and name the counts', () => {
    const checks = runCheck(makeContext({ codegraphIndexIntegrityProbe: () => CLEAN_REPORT }));

    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe(CHECK_ID);
    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.message).toContain('covers the repository');
  });

  it('when codegraph was never initialized, should be ok and say why', () => {
    const checks = runCheck(makeContext({ codegraphIndexIntegrityProbe: () => null }));

    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.message).toContain('not initialized');
  });
});

// ── behavior: INJECTION controls ─────────────────────────────────────

describe('capability:codegraph-index-integrity (injection controls)', () => {
  it('when include does not admit a supported tracked file, should report it naming it', () => {
    const checks = runCheck(
      makeContext({ codegraphIndexIntegrityProbe: () => INCLUDE_GAP_REPORT })
    );

    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.message).toContain('not admitted');
    expect(checks[0]?.message).toContain('scripts/release-pack.mjs');
  });

  it('when the index holds a row for a missing file, should report it naming it', () => {
    const checks = runCheck(makeContext({ codegraphIndexIntegrityProbe: () => STALE_REPORT }));

    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.message).toContain('gone from disk');
    expect(checks[0]?.message).toContain('src/cli/commands/deleted-commands.ts');
  });

  it('when both axes are present, should name both rather than only the first', () => {
    const checks = runCheck(
      makeContext({
        codegraphIndexIntegrityProbe: () => ({
          ...STALE_REPORT,
          admittedTrackedCount: 1,
          includeGap: ['scripts/release-pack.mjs']
        })
      })
    );

    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.message).toContain('not admitted');
    expect(checks[0]?.message).toContain('gone from disk');
  });

  it('when either axis is gapped, should name the repair command that fixes it (slice-002)', () => {
    // Slice-001 deliberately named NO remediation command, because none
    // existed and a hint into "command not found" is the defect class this
    // gate exists to prevent. Slice-002 shipped the command, so the message
    // must name it — in BOTH modes, because the operator needs it whether or
    // not the project opted into blocking.
    const advisory = runCheck(
      makeContext({ codegraphIndexIntegrityProbe: () => INCLUDE_GAP_REPORT })
    );
    expect(advisory[0]?.message).toContain(CODEGRAPH_REPAIR_INDEX_COMMAND);

    const stale = runCheck(makeContext({ codegraphIndexIntegrityProbe: () => STALE_REPORT }));
    expect(stale[0]?.message).toContain(CODEGRAPH_REPAIR_INDEX_COMMAND);

    // Literal, not only the constant — see the twin pin in
    // `codegraph-status-index-integrity.test.ts`: a message that names a
    // constant pointing at a non-existent command is the defect, not the fix.
    // The FULL invocation is asserted rather than a prefix, so a drifted
    // constant cannot satisfy it by sharing a prefix.
    expect(advisory[0]?.message).toContain('peaks codegraph repair-index --project <root>');
  });
});

// ── a11y: severity — the user's option C policy ──────────────────────

describe('capability:codegraph-index-integrity (severity policy)', () => {
  it('when the project has not opted in, should tag the gap advisory so the doctor exit code is untouched', () => {
    const checks = runCheck(
      makeContext({ codegraphIndexIntegrityProbe: () => INCLUDE_GAP_REPORT })
    );

    // `severity: 'warning'` is what `buildReport` reads to keep the finding
    // out of `summary.ok`. Without this assertion, tagging the gap
    // `'warning'` (or dropping the tag) silently changes whether `peaks
    // doctor` fails on a downstream project — the exact blast radius the
    // user's advisory-by-default decision was taken to bound.
    expect(checks[0]?.severity).toBe('warning');
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.message).toContain('Advisory');
    expect(checks[0]?.message).toContain(`${CODEGRAPH_INDEX_STRICT_ENV_VAR}=1`);
  });

  it('when the project opts in, should drop the tag so the gap blocks', async () => {
    const checks = await withStrictMode(async () =>
      runCheck(makeContext({ codegraphIndexIntegrityProbe: () => INCLUDE_GAP_REPORT }))
    );

    // No tag == the dispatcher's default `'error'` == the doctor fails.
    expect(checks[0]?.severity).toBeUndefined();
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.message).toContain('not admitted');
    expect(checks[0]?.message).not.toContain('Advisory');
  });

  it('should keep the staled-row axis advisory on the same switch', async () => {
    const advisory = runCheck(makeContext({ codegraphIndexIntegrityProbe: () => STALE_REPORT }));
    expect(advisory[0]?.severity).toBe('warning');

    const strict = await withStrictMode(async () =>
      runCheck(makeContext({ codegraphIndexIntegrityProbe: () => STALE_REPORT }))
    );
    expect(strict[0]?.severity).toBeUndefined();
  });

  it('should keep "not initialized" ok in BOTH modes', async () => {
    const strict = await withStrictMode(async () =>
      runCheck(makeContext({ codegraphIndexIntegrityProbe: () => null }))
    );

    expect(strict[0]?.ok).toBe(true);
    expect(strict[0]?.severity).toBeUndefined();
  });
});

// ── behavior: unevaluable ────────────────────────────────────────────

describe('capability:codegraph-index-integrity (unevaluable)', () => {
  it('when the probe throws, should warn without blocking', () => {
    const checks = runCheck(
      makeContext({
        codegraphIndexIntegrityProbe: () => {
          throw new Error('not a git repository');
        }
      })
    );

    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.severity).toBe('warning');
    expect(checks[0]?.message).toContain('not a git repository');
  });

  it('should keep "could not evaluate" distinguishable from "covers the repository"', () => {
    // The doctor's R1(b) requirement: the two must never share an `ok`.
    const unevaluable = runCheck(
      makeContext({
        codegraphIndexIntegrityProbe: () => {
          throw new Error('no such table: files');
        }
      })
    );
    const clean = runCheck(makeContext({ codegraphIndexIntegrityProbe: () => CLEAN_REPORT }));

    expect(unevaluable[0]?.ok).toBe(false);
    expect(clean[0]?.ok).toBe(true);
  });

  it('should keep its advisory tag in strict mode, so it stays separable from a blocking gap', async () => {
    // R12-2, the polarity that does NOT collapse. In the advisory default
    // this branch and the gap branch both emit `(ok:false,
    // severity:'warning')` — `DoctorCheck` has no third field, so only the
    // message separates them there (recorded, not fixed: neither state is
    // `ok:true`, and neither moves the exit code in that mode). Under the
    // opt-in they separate in the machine fields: a real gap DROPS the tag
    // (blocking), while an unmeasured axis KEEPS it (never blocking, in
    // either mode) — so a machine consumer can still tell "measured and
    // gapped" from "not measured" instead of reading the two as one.
    const unevaluableStrict = await withStrictMode(async () =>
      runCheck(
        makeContext({
          codegraphIndexIntegrityProbe: () => {
            throw new Error('no such table: files');
          }
        })
      )
    );
    const gapStrict = await withStrictMode(async () =>
      runCheck(makeContext({ codegraphIndexIntegrityProbe: () => INCLUDE_GAP_REPORT }))
    );

    expect(unevaluableStrict[0]?.ok).toBe(false);
    expect(gapStrict[0]?.ok).toBe(false);
    expect(unevaluableStrict[0]?.severity).toBe('warning');
    expect(gapStrict[0]?.severity).toBeUndefined();
    // The message is the separator in the advisory default, so it must not
    // be the same sentence on both branches.
    expect(unevaluableStrict[0]?.message).toContain('could not be evaluated');
    expect(gapStrict[0]?.message).toContain('does not cover the repository');
  });
});

// ── integration: real registry + real inspector over a real index ────

describe('capability:codegraph-index-integrity (integration)', () => {
  it('is registered in the doctor plugin list, right after the exclude check', () => {
    const names = PLUGINS.map((plugin) => plugin.name);

    expect(names).toContain('codegraph-index-integrity');
    expect(names.indexOf('codegraph-index-integrity')).toBe(
      names.indexOf('codegraph-exclude-integrity') + 1
    );
  });

  it(
    'should report a real include gap and a real dead row from a real SQLite index',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // A throwaway git project with the exact defect shape: `include`
      // admits `.ts` but not `.mjs`, one tracked file is supported but not
      // admitted, and the index carries a row for a file that is gone.
      const root = mkdtempSync(join(tmpdir(), 'peaks-cg-index-integrity-'));
      try {
        execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore', windowsHide: true });
        execFileSync('git', ['-C', root, 'config', 'user.email', 'peaks-test@example.com'], {
          stdio: 'ignore',
          windowsHide: true
        });
        execFileSync('git', ['-C', root, 'config', 'user.name', 'peaks test'], {
          stdio: 'ignore',
          windowsHide: true
        });

        mkdirSync(join(root, 'src'), { recursive: true });
        mkdirSync(join(root, 'scripts'), { recursive: true });
        writeFileSync(join(root, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
        writeFileSync(join(root, 'scripts', 'tool.mjs'), 'export const tool = 1;\n', 'utf8');
        execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore', windowsHide: true });
        execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture'], {
          stdio: 'ignore',
          windowsHide: true
        });

        mkdirSync(join(root, '.codegraph'), { recursive: true });
        writeFileSync(
          join(root, '.codegraph', 'config.json'),
          `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: [] }, null, 2)}\n`,
          'utf8'
        );

        // A real index db with upstream's real `files` schema.
        const db = new Database(join(root, '.codegraph', 'codegraph.db'));
        db.exec(
          'CREATE TABLE files (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, node_count INTEGER DEFAULT 0, errors TEXT)'
        );
        const insert = db.prepare(
          'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at) VALUES (?, ?, ?, 0, 0, 0)'
        );
        insert.run('src/ok.ts', 'h', 'typescript');
        insert.run('src/deleted.ts', 'h', 'typescript');
        db.close();

        const report = inspectCodegraphIndexIntegrity(root);

        expect(report.gap).toBe(true);
        expect(report.includeGap).toEqual(['scripts/tool.mjs']);
        expect(report.deadRows).toEqual(['src/deleted.ts']);
        expect(report.trackedSourceCount).toBe(2);
        expect(report.admittedTrackedCount).toBe(1);
        expect(report.indexedFileCount).toBe(2);

        // And the check built on it blocks.
        const checks = runCheck(makeContext({ codegraphIndexIntegrityProbe: () => report }));
        expect(checks[0]?.ok).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it(
    'should find no index to inspect on a project whose codegraph dir holds only a config',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // This is WHY the default probe is guarded on the index's presence:
      // the inspector opens the db with `fileMustExist`, so a config-only
      // (pre-init / dangling) project throws instead of reporting a
      // 100%-stale index. The guard is load-bearing, not decoration.
      const root = mkdtempSync(join(tmpdir(), 'peaks-cg-noindex-'));
      try {
        // A git work tree, so the ONLY thing missing is the index itself.
        execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore', windowsHide: true });
        mkdirSync(join(root, '.codegraph'), { recursive: true });
        writeFileSync(
          join(root, '.codegraph', 'config.json'),
          `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: [] }, null, 2)}\n`,
          'utf8'
        );

        expect(existsSync(join(root, '.codegraph', 'codegraph.db'))).toBe(false);
        expect(() => inspectCodegraphIndexIntegrity(root)).toThrow(/codegraph\.db/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
