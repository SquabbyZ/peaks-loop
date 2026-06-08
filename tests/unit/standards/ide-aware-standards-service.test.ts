/**
 * Slice #011-2026-06-07-ide-adapter-resource-profile: unit tests for the
 * IDE-aware wrapper around `peaks standards init` / `peaks standards update`.
 *
 * The wrapper is a thin dispatch layer:
 *   - It calls `IdeRegistry.detect()` (via `detectInstalledIde`) to get the
 *     current IDE from the project root's settings directory.
 *   - It looks up the IDE's `standardsProfile` via the resource-profile
 *     accessor.
 *   - If the profile is non-null, it delegates to the underlying writer
 *     (which currently matches the legacy Claude Code path; future per-IDE
 *     writers plug in here).
 *   - If the profile is null (Trae in slice 1.3.2), it falls back to the
 *     legacy Claude Code path AND emits a stderr warning.
 *   - Explicit `ideId` in options bypasses detection.
 *
 * These tests focus on the dispatch decision (`inspectStandardsDispatch`),
 * not on the write side. The write side is covered by the existing
 * `project-standards-service.test.ts` (not in scope for slice #011).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  _resetAdaptersForTesting,
  _setAdapterForTesting
} from '../../../src/services/ide/ide-registry.js';
import {
  inspectStandardsDispatch,
  resolveStandardsIdeId
} from '../../../src/services/standards/ide-aware-standards-service.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('resolveStandardsIdeId — detection precedence', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-stds-aware-'));
  });

  test('returns the explicit ideId override when provided', async () => {
    expect(resolveStandardsIdeId({ projectRoot: project, ideId: 'trae' })).toBe('trae');
  });

  test('detects Claude Code from .claude/ directory presence', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    expect(resolveStandardsIdeId({ projectRoot: project })).toBe('claude-code');
  });

  test('detects Trae from .trae/ directory presence', async () => {
    await mkdir(join(project, '.trae'), { recursive: true });
    expect(resolveStandardsIdeId({ projectRoot: project })).toBe('trae');
  });

  test('returns null when no IDE directory is present', async () => {
    expect(resolveStandardsIdeId({ projectRoot: project })).toBeNull();
  });
});

describe('inspectStandardsDispatch — Claude Code path (slice #011 byte-stability)', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-stds-aware-'));
  });

  test('Claude Code detection returns the Claude Code profile (no warning needed)', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    const dispatch = inspectStandardsDispatch({ projectRoot: project });
    expect(dispatch.ideId).toBe('claude-code');
    expect(dispatch.profile).not.toBeNull();
    expect(dispatch.profile?.rootFile).toBe('CLAUDE.md');
    expect(dispatch.profile?.rulesDir).toBe('.claude/rules');
  });

  test('explicit --ide claude-code bypasses detection', async () => {
    // No .claude/ directory present, but explicit override is honored.
    const dispatch = inspectStandardsDispatch({ projectRoot: project, ideId: 'claude-code' });
    expect(dispatch.ideId).toBe('claude-code');
    expect(dispatch.profile).not.toBeNull();
  });
});

describe('inspectStandardsDispatch — Trae fallback path (slice #011 UNVERIFIED)', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-stds-aware-'));
  });

  test('Trae detection returns Trae id with null profile (fallback path triggers)', async () => {
    await mkdir(join(project, '.trae'), { recursive: true });
    const dispatch = inspectStandardsDispatch({ projectRoot: project });
    expect(dispatch.ideId).toBe('trae');
    expect(dispatch.profile).toBeNull();
  });

  test('explicit --ide trae returns Trae id with null profile', async () => {
    const dispatch = inspectStandardsDispatch({ projectRoot: project, ideId: 'trae' });
    expect(dispatch.ideId).toBe('trae');
    expect(dispatch.profile).toBeNull();
  });
});

describe('inspectStandardsDispatch — no IDE detected (legacy fallback)', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-stds-aware-'));
  });

  test('returns null ideId and null profile when no IDE is present', async () => {
    const dispatch = inspectStandardsDispatch({ projectRoot: project });
    expect(dispatch.ideId).toBeNull();
    expect(dispatch.profile).toBeNull();
  });
});

describe('inspectStandardsDispatch — test-seam: custom adapter registration', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-stds-aware-'));
  });

  test('a custom adapter registered via _setAdapterForTesting surfaces its profile', async () => {
    _setAdapterForTesting('cursor', {
      id: 'cursor',
      displayName: 'Cursor (test fixture)',
      settings: {
        dirName: '.cursor',
        settingsFileName: 'settings.json',
        resolveSettingsFile: (scope, projectRoot) => {
          const root = scope === 'global' ? resolve('C:/home') : resolve(projectRoot ?? 'C:/home');
          return join(root, '.cursor', 'settings.json');
        },
        supportsScope: () => true,
      },
      envVar: 'CURSOR_PROJECT_DIR',
      hookEvent: 'beforeShellCommand',
      toolMatcher: 'terminal',
      subAgentDispatcher: { label: 'cursor', supportsRole: () => false, buildToolCall: () => ({ name: 'subagent', args: {} }) },
      promptSizeAware: false,
       capabilities: { gateEnforce: true, statusline: true },

      installHints: [],
      // Slice #011: a custom test adapter can fill the resource profile to
      // verify the dispatch shape. Cursor itself is a follow-up slice.
      standardsProfile: {
        rootFile: 'AGENTS.md',
        rulesDir: '.cursor/rules',
        rulesFileGlob: '**/*.mdc',
        autoLoaded: true,
        format: 'markdown+frontmatter',
        migrationHint: 'Cursor reads AGENTS.md + .cursor/rules/**.mdc',
      },
      skillInstall: {
        skillsDir: join(resolve('C:/home'), '.cursor', 'skills'),
        outputStylesDir: null,
        installStrategy: 'copy',
        envVarOverride: null,
      },
    });

    const dispatch = inspectStandardsDispatch({ projectRoot: project, ideId: 'cursor' });
    expect(dispatch.ideId).toBe('cursor');
    expect(dispatch.profile).not.toBeNull();
    expect(dispatch.profile?.rootFile).toBe('AGENTS.md');
    expect(dispatch.profile?.format).toBe('markdown+frontmatter');
  });
});
