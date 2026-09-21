// tests/integration/_adapter-commands-harness.ts
//
// Shared fixture + helper module for the `peaks` adapter/distribution CLI e2e
// suite (P2-B.4). Extracted by slice rid-b1 when the single
// `adapter-commands-e2e.test.ts` reached 848 lines and crossed the 800-line
// cap that `peaks request transition` enforces.
//
// The three files it split into —
//   adapter-skill-commands-e2e.test.ts
//   adapter-hooks-statusline-e2e.test.ts
//   adapter-dispatch-capability-e2e.test.ts
// — share THIS module instead of restating three times the same spawn helper,
// the same 19 payload schemas, the same tmp-project lifecycle and the same two
// registration probes. No assertion moved out of the individual test bodies:
// this module holds setup, not expectations.
//
// NOT a test file. `vitest.config.integration.ts` includes only
// `**/*.test.ts` and `**/*.e2e.test.ts`, so a bare `.ts` sibling is never
// collected — the same convention `tests/integration/_dist-freshness-global-setup.ts`
// already uses at this directory level.
//
// `cleanupProjects` is exported rather than registered here on purpose: each
// test file calls `afterEach(cleanupProjects)` itself, so the hook is visibly
// owned by the file it cleans up for.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';
import { z } from 'zod';
import { parseCliEnvelopeWith } from '../../src/cli/cli-envelope.js';
import { parseJson } from '../../src/shared/json-parse.js';

export const BIN = resolve(__dirname, '../../bin/peaks.js');
export const REPO = resolve(__dirname, '../..');
export const BIN_TIMEOUT_MS = 120_000;
export const REQUEST_ID = '2026-07-25-p2-b4-adapter-e2e';

/**
 * The unicode capability tier is ANSI-colored whether or not stdout is a TTY
 * ("still ANSI-colored; only `ascii` is color-free" —
 * `src/services/skills/skill-statusline-renderer.ts:414-417`), so the brand
 * assertions strip SGR rather than loosening what they match.
 *
 * The `⛰` / `🏔` mountain glyphs they used to name were deliberately removed
 * in the 2026-07-22 ice-cola a11y pass: `BRAND` is the plain-ASCII `Peaks`
 * (`src/services/skills/statusline-palette.ts:10-16`), and the rendered prefix
 * is `Peaks <glyph> [...]` — brand first, glyph second.
 */
const ANSI_ESC = String.fromCharCode(27);
const ANSI_SGR = new RegExp(`${ANSI_ESC}\\[[0-9;]*m`, 'g');

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, '');
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

// The `data` payloads this suite reads at depth >= 2, one per invocation.
//
// WHAT THIS REPLACES, AND WHY IT MOVES NO NUMBER (S15). The former helper was
//
//   function parseJson<T>(result: RunResult): T {
//     return JSON.parse(result.stdout) as T;
//   }
//
// Its `as T` hid the missing check from the ratchet: `any` never entered the
// type flow, so `no-unsafe-*` reported zero here and still reports zero after.
// The value of naming a schema per call site is that the claim is now CHECKED
// at run time; it is deliberately not counted as a finding reduction. Three of
// these calls are NOT `ResultEnvelope`s and must not go through
// `parseCliEnvelope` — see the comments at each one. (S15.)
export const workspaceInitPayload = z.looseObject({ sessionId: z.string(), bound: z.boolean() });
export const skillListPayload = z.looseObject({
  skills: z.array(z.looseObject({ name: z.string() }))
});
export const skillSyncPayload = z.looseObject({
  applied: z.boolean(),
  dryRun: z.boolean(),
  perPlatform: z.array(z.unknown()),
  failedCount: z.number()
});
export const skillSearchPayload = z.array(
  z.looseObject({ name: z.string(), matchScore: z.number() })
);
export const skillVisibilityPayload = z.looseObject({
  ok: z.boolean(),
  skills: z.array(z.looseObject({ name: z.string(), visibility: z.string() }))
});
export const auditConformancePayload = z.looseObject({
  checked: z.number(),
  checks: z.array(z.unknown())
});
export const skillDoctorPayload = z.looseObject({ checks: z.array(z.unknown()), ok: z.boolean() });
export const skillRunbookPayload = z.looseObject({
  name: z.string(),
  hasRunbook: z.boolean(),
  peaksCommandCount: z.number()
});
export const skillActivePayload = z.looseObject({ active: z.boolean() });
export const presenceSetPayload = z.looseObject({
  active: z.boolean(),
  skill: z.string(),
  mode: z.string(),
  gate: z.string()
});
export const presenceClearPayload = z.looseObject({
  active: z.boolean(),
  removed: z.boolean(),
  cleared: z.boolean(),
  reason: z.string().optional(),
  projectContextUpdated: z.boolean().optional()
});
export const hooksInstallPayload = z.looseObject({
  ide: z.string(),
  applied: z.boolean(),
  settingsPath: z.string().optional(),
  entries: z.array(z.looseObject({ matcher: z.string(), sentinel: z.string() })).optional()
});
export const hooksStatusPayload = z.looseObject({
  ide: z.string().optional(),
  installed: z.boolean(),
  supportsHooks: z.boolean(),
  entries: z.array(z.unknown()).optional()
});
export const hooksUninstallPayload = z.looseObject({ ide: z.string(), removed: z.boolean() });
export const statuslineInstallPayload = z.looseObject({
  scope: z.string(),
  settingsPath: z.string(),
  applied: z.boolean(),
  dryRun: z.boolean()
});
export const statuslineStatusPayload = z.looseObject({
  scope: z.string(),
  installed: z.boolean(),
  ide: z.string(),
  command: z.string()
});
export const statuslineRenderPayload = z.looseObject({ text: z.string() });
export const subAgentDispatchPayload = z.looseObject({
  role: z.string(),
  ide: z.string(),
  toolCall: z.looseObject({ name: z.string() }),
  dispatchRecordPath: z.string(),
  batchId: z.string()
});
export const adapterListPayload = z.looseObject({
  file: z.string(),
  records: z.array(z.unknown()),
  count: z.number()
});

export function runCli(args: readonly string[], cwd = REPO): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'adapter-commands-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number | null;
    };
    return {
      stdout:
        typeof caught.stdout === 'string' ? caught.stdout : (caught.stdout?.toString('utf8') ?? ''),
      stderr:
        typeof caught.stderr === 'string' ? caught.stderr : (caught.stderr?.toString('utf8') ?? ''),
      code: typeof caught.status === 'number' ? caught.status : 1
    };
  }
}

/**
 * The bin wrapper currently appends a false COMMAND_NOT_FOUND error to every
 * positional `--help` request. Exact Usage text remains reliable registration
 * evidence, so accept either a clean exit or that known wrapper drift.
 */
export function expectRegisteredHelp(
  args: readonly string[],
  expectedUsage: string,
  cwd = REPO
): RunResult {
  const result = runCli([...args, '--help'], cwd);
  expect(result.stdout).toContain(`Usage: ${expectedUsage}`);
  expect(
    result.code === 0 ||
      (result.stderr.includes('COMMAND_NOT_FOUND') && result.stderr.includes('combinedWithHelp'))
  ).toBe(true);
  return result;
}

export function expectCommandNotRegistered(
  args: readonly string[],
  parentUsage: string,
  cwd = REPO
): { readonly help: RunResult; readonly action: RunResult } {
  const help = runCli([...args, '--help'], cwd);
  // Post-Fix-5: there are two real outcomes for `X Y --help` where Y is unregistered:
  //   (a) X is a registered top-level parent (e.g. `peaks skill install --help`):
  //       commander falls through to `peaks skill --help` → exit 0 + parent usage
  //       on stdout + empty stderr (no COMMAND_NOT_FOUND envelope).
  //   (b) Y is the first positional of an unregistered top-level (e.g.
  //       `peaks dispatch --help`): Fix-5's registered.has(Y) is false → setImmediate
  //       emits COMMAND_NOT_FOUND envelope + exit 1.
  // Accept either: just require `parentUsage` on stdout and the action call returns
  // a structured COMMAND_NOT_FOUND.
  expect(help.stdout).toContain(`Usage: ${parentUsage}`);

  const action = runCli(args, cwd);
  expect(action.code).not.toBe(0);
  expect(action.stdout + action.stderr).toContain('COMMAND_NOT_FOUND');
  return { help, action };
}

const projects: string[] = [];

export function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  return project;
}

export function initWorkspace(project: string): string {
  const result = runCli(['workspace', 'init', '--project', project, '--json'], project);
  expect(result.code).toBe(0);
  const envelope = parseCliEnvelopeWith(result.stdout, workspaceInitPayload);
  expect(envelope.ok).toBe(true);
  expect(envelope.command).toBe('workspace.init');
  expect(envelope.data.bound).toBe(true);
  return envelope.data.sessionId;
}

/**
 * Registered by every file in the split as `afterEach(cleanupProjects)`. The
 * registry is module-scoped, so each test file gets its own instance of this
 * module and therefore its own list — vitest isolates per file.
 */
export function cleanupProjects(): void {
  for (const project of projects) {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
}

export { parseCliEnvelopeWith, parseJson };
