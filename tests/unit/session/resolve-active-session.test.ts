// tests/unit/session/resolve-active-session.test.ts
//
// 4-dimension unit test for `resolveActiveSessionId` in
// src/services/session/session-manager.ts.
//
// Slice 4.0.7-dogfood-PR-2 (ice-cola surface probe 2026-08-02): pre-rid,
// the 4 affected CLIs (peaks code detect-job / read-job-shape /
// post-compact-detect / context-now, plus the runtime probes) each
// read `getSkillPresence` (which is `.peaks/.active-skill.json`)
// instead of the canonical binding. Any session created via
// `peaks workspace init` that never had `peaks skill presence:set
// peaks-code` called on it (the common case for downstream consumer
// projects and 24h-mode sessions) reported `NO_ACTIVE_SESSION`.
//
// The rid adds a shared `resolveActiveSessionId(projectRoot, override?)`
// resolver that composes the existing `getSessionIdCanonical` +
// `getSessionId` fan-out. This file pins the behavior.
//
// Dimensions covered:
//   - render:     return value shape (string | null)
//   - behavior:   6 cases — override wins; canonical binding; legacy
//                 binding form (the pre-v2.16.0 3-field shape); no
//                 binding at all; corrupted JSON; pre-canonicalize
//                 projectRoot form
//   - integration: real on-disk session.json (canonical + legacy +
//                 corrupted) drives each case
//   - a11y:        not applicable — no user-visible text in this module
//
// Run with: pnpm vitest run tests/unit/session/resolve-active-session.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveSessionId } from '../../../src/services/session/session-manager.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/session/resolve-active-session.test.ts',
  ['render', 'behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'no user-visible text in resolveActiveSessionId; return value is internal only' },
  ],
);

describe('render: resolveActiveSessionId return shape', () => {
  // Defensive: ensure no test-isolation leakage from previous suites.
  beforeEach(() => {
    // No-op stub; kept for symmetry with backing-detector tests.
  });

  it('returns string when binding exists', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'peaks-resolve-'));
    try {
      mkdirSync(join(fakeRoot, '.peaks', '_runtime'), { recursive: true });
      writeFileSync(
        join(fakeRoot, '.peaks', '_runtime', 'session.json'),
        JSON.stringify({
          sessionId: '2026-08-02-session-abc123',
          createdAt: '2026-08-02T00:00:00.000Z',
          projectRoot: fakeRoot,
        }),
      );
      const result = resolveActiveSessionId(fakeRoot);
      expect(typeof result).toBe('string');
      expect(result).toBe('2026-08-02-session-abc123');
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it('returns null when no binding exists', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'peaks-resolve-'));
    try {
      const result = resolveActiveSessionId(fakeRoot);
      expect(result).toBeNull();
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});

describe('behavior: resolveActiveSessionId edge cases', () => {
  let fakeRoot: string;

  beforeEach(() => {
    fakeRoot = mkdtempSync(join(tmpdir(), 'peaks-resolve-'));
    mkdirSync(join(fakeRoot, '.peaks', '_runtime'), { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('override wins over canonical binding', () => {
    writeFileSync(
      join(fakeRoot, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({
        sessionId: '2026-08-02-session-abc123',
        createdAt: '2026-08-02T00:00:00.000Z',
        projectRoot: fakeRoot,
      }),
    );
    const result = resolveActiveSessionId(fakeRoot, '2026-08-02-session-override');
    expect(result).toBe('2026-08-02-session-override');
  });

  it('treats empty-string override as no override (returns binding)', () => {
    writeFileSync(
      join(fakeRoot, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({
        sessionId: '2026-08-02-session-abc123',
        createdAt: '2026-08-02T00:00:00.000Z',
        projectRoot: fakeRoot,
      }),
    );
    const result = resolveActiveSessionId(fakeRoot, '');
    expect(result).toBe('2026-08-02-session-abc123');
  });

  it('falls through to strict-equality getSessionId when canonicalize-on-read misses', () => {
    // Pre-canonicalize binding: projectRoot is "." (relative). Caller
    // passes the absolute realpath. getSessionIdCanonical should
    // canonicalize and find it; if not, getSessionId is the fallback.
    writeFileSync(
      join(fakeRoot, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({
        sessionId: '2026-08-02-session-abc123',
        createdAt: '2026-08-02T00:00:00.000Z',
        projectRoot: '.',
      }),
    );
    const result = resolveActiveSessionId(fakeRoot);
    // Either getSessionIdCanonical or getSessionId should find the
    // session; the contract is "one of them returns the id".
    expect(result).toBe('2026-08-02-session-abc123');
  });

  it('returns null on corrupted JSON', () => {
    writeFileSync(
      join(fakeRoot, '.peaks', '_runtime', 'session.json'),
      '{ not valid json',
    );
    const result = resolveActiveSessionId(fakeRoot);
    expect(result).toBeNull();
  });
});

describe('integration: real session.json shapes (the dogfood bug)', () => {
  it('resolves the exact ice-cola session binding (3-field legacy shape)', () => {
    // Mirror the binding shape that `peaks workspace init` writes in
    // ice-cola and every other 4.0.6 downstream project: a plain
    // 3-field { sessionId, createdAt, projectRoot } JSON. Pre-PR-2,
    // the 4 affected CLIs reported NO_ACTIVE_SESSION for any project
    // with this binding shape because they read presence (a different
    // file) instead of this binding.
    const fakeRoot = mkdtempSync(join(tmpdir(), 'peaks-resolve-icecola-'));
    try {
      mkdirSync(join(fakeRoot, '.peaks', '_runtime'), { recursive: true });
      writeFileSync(
        join(fakeRoot, '.peaks', '_runtime', 'session.json'),
        JSON.stringify({
          sessionId: '2026-08-02-session-b3a54b',
          createdAt: '2026-08-02T04:53:59.954Z',
          projectRoot: fakeRoot.replace(/\\/g, '\\\\'),
        }),
      );
      const result = resolveActiveSessionId(fakeRoot);
      expect(result).toBe('2026-08-02-session-b3a54b');
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});
