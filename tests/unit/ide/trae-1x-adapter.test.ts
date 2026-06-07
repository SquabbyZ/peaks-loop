/**
 * Trae 1.x adapter verification tests — slice 009-009-2026-06-07-trae-dogfood.
 *
 * Fixture: tests/fixtures/trae/trae-1x-payload.json
 *   - The fixture mimics a real Trae 1.x install's hook payload shape.
 *   - The user does NOT have a real Trae 1.x install available in CI (per
 *     slice 009 PRD R-1), so this test suite is the strongest non-live
 *     verification we can produce. A follow-up slice should re-run the same
 *     5+ dogfood paths on a real Trae 1.x install once one is available.
 *
 * Scope: pin the 4 UNVERIFIED fields (slice #3 closeout M-1) to their
 * verified values:
 *   - hookEvent: 'beforeToolCall'
 *   - toolMatcher: 'terminal'
 *   - settingsFileName: 'settings.json'
 *   - TRAE_DENY_SHAPE: hookSpecificOutput.{hookEventName, permissionDecision,
 *     permissionDecisionReason}
 *
 * These tests are ADDITIVE — they do not modify the pre-existing 7 Trae
 * tests in tests/unit/ide/trae-adapter.test.ts (slice #3 closeout).
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { TRAE_ADAPTER } from '../../../src/services/ide/adapters/trae-adapter.js';
import { _resetAdaptersForTesting, getAdapter } from '../../../src/services/ide/ide-registry.js';
import {
  formatDecisionResponse,
  TRAE_DENY_SHAPE
} from '../../../src/services/ide/hook-protocol.js';
import {
  applyHookInstall,
  planHookInstall,
  readHookStatus
} from '../../../src/services/skills/hooks-settings-service.js';

const FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/fixtures/trae/trae-1x-payload.json'
);

interface FixtureRoot {
  _meta: { purpose: string; traeVersion: string; shapeSource: string; usage: string; lastUpdated: string; owners: string };
  realInstallShape: {
    settingsJson: { model: string; mcpServers: { github: { type: string; command: string; args: string[] } }; existingField: string };
    hookStdinDenyPath: { eventName: string; parameters: { command: string; cwd: string } };
    hookStdinAllowPath: { eventName: string; parameters: { command: string; cwd: string } };
    hookStdinEmpty: { eventName: string; parameters: Record<string, never> };
    hookStdinTerminal: { eventName: string; parameters: { tool: string; command: string } };
  };
  expectedAdapterValues: {
    hookEvent: string;
    toolMatcher: string;
    settingsFileName: string;
    TRAE_DENY_SHAPE_NAME: string;
    TRAE_DENY_SHAPE_FIELDS: string[];
  };
}

function loadFixture(): FixtureRoot {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureRoot;
}

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('Trae 1.x adapter — VERIFIED field pins (slice 009)', () => {
  // F-1: hookEvent
  test('F-1: hookEvent is "beforeToolCall" (verified against Trae 1.x fixture)', () => {
    const fixture = loadFixture();
    expect(fixture.expectedAdapterValues.hookEvent).toBe('beforeToolCall');
    expect(TRAE_ADAPTER.hookEvent).toBe('beforeToolCall');
    // The fixture's deny-path payload must use the same hookEvent.
    expect(fixture.realInstallShape.hookStdinDenyPath.eventName).toBe(TRAE_ADAPTER.hookEvent);
    expect(fixture.realInstallShape.hookStdinAllowPath.eventName).toBe(TRAE_ADAPTER.hookEvent);
    expect(fixture.realInstallShape.hookStdinTerminal.eventName).toBe(TRAE_ADAPTER.hookEvent);
  });

  // F-2: toolMatcher
  test('F-2: toolMatcher is "terminal" (verified against Trae 1.x fixture)', () => {
    const fixture = loadFixture();
    expect(fixture.expectedAdapterValues.toolMatcher).toBe('terminal');
    expect(TRAE_ADAPTER.toolMatcher).toBe('terminal');
    // The fixture pins the tool name at `parameters.tool: 'terminal'`.
    expect(fixture.realInstallShape.hookStdinTerminal.parameters.tool).toBe('terminal');
  });

  // F-3: settingsFileName
  test('F-3: settingsFileName is "settings.json" (verified against Trae 1.x fixture)', () => {
    const fixture = loadFixture();
    expect(fixture.expectedAdapterValues.settingsFileName).toBe('settings.json');
    expect(TRAE_ADAPTER.settings.settingsFileName).toBe('settings.json');
    // The fixture's realInstallShape.settingsJson mirrors a real Trae install.
    expect(fixture.realInstallShape.settingsJson.model).toBeDefined();
    expect(fixture.realInstallShape.settingsJson.mcpServers).toBeDefined();
  });

  // F-4: TRAE_DENY_SHAPE
  test('F-4: TRAE_DENY_SHAPE is the verified hookSpecificOutput envelope (cursor-sibling shape)', () => {
    const fixture = loadFixture();
    expect(fixture.expectedAdapterValues.TRAE_DENY_SHAPE_NAME).toBe('TRAE_DENY_SHAPE');
    // The constant NAME is preserved per slice 009 PRD R-3; only shape may change.
    expect(TRAE_DENY_SHAPE).toBeDefined();
    const shape = TRAE_DENY_SHAPE as { hookSpecificOutput: Record<string, unknown> };
    expect(shape.hookSpecificOutput).toBeDefined();
    expect(shape.hookSpecificOutput.hookEventName).toBe('beforeToolCall');
    expect(shape.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(typeof shape.hookSpecificOutput.permissionDecisionReason).toBe('string');
  });
});

describe('Trae 1.x adapter — round-trip integration (slice 009 AC-9)', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-trae-1x-roundtrip-'));
  });

  test('(a) peaks hooks install writes to <root>/.trae/settings.json with the verified hookEvent + toolMatcher', async () => {
    const result = applyHookInstall('project', project, { ide: 'trae' });
    expect(result.applied).toBe(true);
    expect(result.settingsPath).toBe(join(project, '.trae', 'settings.json'));
    // Plan must carry the verified matcher.
    const plan = planHookInstall('project', project, { ide: 'trae' });
    expect(plan.matcher).toBe('terminal');
    expect(plan.desiredCommand).toContain('peaks hook handle');
    expect(plan.desiredCommand).toContain('${TRAE_PROJECT_DIR}');
    // On-disk settings.json must use 'beforeToolCall' as the hook key.
    const onDisk = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as { hooks: Record<string, unknown[]> };
    expect(onDisk.hooks).toHaveProperty('beforeToolCall');
    expect(onDisk.hooks).not.toHaveProperty('PreToolUse');
  });

  test('(b) readHookStatus reports installed=true after the Trae install', () => {
    applyHookInstall('project', project, { ide: 'trae' });
    const status = readHookStatus('project', project, { ide: 'trae' });
    expect(status.installed).toBe(true);
    expect(status.exists).toBe(true);
  });

  test('(c) a second peaks hooks install preserves the first install + third-party fields (round-trip)', async () => {
    // Simulate the fixture's realInstallShape.settingsJson — third-party fields
    // a real Trae 1.x install would have on disk before peaks is installed.
    const fixture = loadFixture();
    await mkdir(join(project, '.trae'), { recursive: true });
    await writeFile(
      join(project, '.trae', 'settings.json'),
      JSON.stringify(
        {
          model: fixture.realInstallShape.settingsJson.model,
          mcpServers: fixture.realInstallShape.settingsJson.mcpServers,
          existingField: fixture.realInstallShape.settingsJson.existingField
        },
        null,
        2
      ),
      'utf8'
    );
    // First install (peaks adds its hook entries).
    applyHookInstall('project', project, { ide: 'trae' });
    // Second install (peaks must NOT clobber third-party fields).
    applyHookInstall('project', project, { ide: 'trae' });
    const after = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as { model: string; mcpServers: unknown; existingField: string; hooks: unknown };
    expect(after.model).toBe(fixture.realInstallShape.settingsJson.model);
    expect(after.mcpServers).toEqual(fixture.realInstallShape.settingsJson.mcpServers);
    expect(after.existingField).toBe(fixture.realInstallShape.settingsJson.existingField);
    expect(after.hooks).toBeDefined();
    // The hook entries must still use the verified key + matcher.
    const hooks = after.hooks as { beforeToolCall: { matcher: string }[] };
    expect(hooks.beforeToolCall.map((e) => e.matcher)).toContain('terminal');
  });
});

describe('Trae 1.x adapter — formatDecisionResponse + registry', () => {
  test('formatDecisionResponse("trae", "deny", "<reason>") returns the verified envelope with reason substituted', () => {
    const out = formatDecisionResponse('trae', 'deny', 'rm -rf is dangerous');
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBeTruthy();
    const parsed = JSON.parse(out.stdout) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('beforeToolCall');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('rm -rf is dangerous');
  });

  test('formatDecisionResponse("trae", "allow") returns empty stdout (no envelope needed)', () => {
    const out = formatDecisionResponse('trae', 'allow');
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe('');
  });

  test('getAdapter("trae") returns the verified Trae adapter with all 4 pinned fields', () => {
    const got = getAdapter('trae');
    expect(got.hookEvent).toBe('beforeToolCall');
    expect(got.toolMatcher).toBe('terminal');
    expect(got.settings.settingsFileName).toBe('settings.json');
    // Sanity: the slim shape is preserved (slice #1 / slice #2 contract).
    expect(got.id).toBe('trae');
    expect(got.envVar).toBe('TRAE_PROJECT_DIR');
  });
});
