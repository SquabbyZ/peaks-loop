import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadBindingStatus,
  formatTable,
  formatJson,
  type BindingStatusView
} from '../../../../src/services/session/binding-status-service.js';
import { writeBinding, readBinding, type Binding } from '../../../../src/services/session/binding-store.js';

let projectRoot: string;
let savedPeaks: string | undefined;
let savedClaude: string | undefined;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-binding-status-'));
  savedPeaks = process.env.PEAKS_OUTER_SESSION_ID;
  savedClaude = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  if (savedPeaks === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = savedPeaks;
  if (savedClaude === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = savedClaude;
});

/**
 * v2.18.2 PATCH — `peaks binding status` read-only introspection
 * helper (follow-up issue #2: status CLI nice-to-have from
 * v2.18.0 PRD §3.4).
 *
 * The service MUST be read-only — no `registerInstance`, no
 * `heartbeat`, no `dropInstance`. The tests below assert that the
 * only side effect of `loadBindingStatus` is reading the binding
 * from disk.
 */
describe('loadBindingStatus — v2.18.2 PATCH (issue #2)', () => {
  test('empty project: returns null binding with source="none"', () => {
    const view = loadBindingStatus(projectRoot);
    expect(view.binding).toBeNull();
    expect(view.source).toBe('none');
    expect(view.projectRoot).toBe(projectRoot);
    expect(view.stale).toBe(false);
  });

  test('populated binding: returns the binding and the correct source', () => {
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-aaaaaa': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-solo', 'peaks-rd'],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    const view = loadBindingStatus(projectRoot);
    expect(view.binding).not.toBeNull();
    expect(view.source).toBe('canonical');
    expect(Object.keys(view.binding!.instances)).toHaveLength(1);
  });

  test('does not mutate the on-disk binding (read-only invariant)', () => {
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-bbbbbb': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-solo'],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const before = JSON.stringify(binding);

    loadBindingStatus(projectRoot);
    loadBindingStatus(projectRoot);

    const after = JSON.stringify(readBinding(projectRoot));
    expect(after).toBe(before);
  });
});

describe('formatTable — v2.18.2 PATCH (issue #2)', () => {
  test('empty binding: returns empty string (no header row)', () => {
    const view: BindingStatusView = {
      binding: null,
      source: 'none',
      projectRoot,
      stale: false,
      outerSessionId: 'unknown'
    };
    expect(formatTable(view)).toBe('');
  });

  test('binding with no instances: returns empty string (no header row)', () => {
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {}
    };
    writeBinding(projectRoot, binding);
    const view = loadBindingStatus(projectRoot);
    expect(formatTable(view)).toBe('');
  });

  test('single instance: 1-row table with the correct columns', () => {
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-cccccc': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-solo', 'peaks-rd'],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const view = loadBindingStatus(projectRoot);
    const table = formatTable(view);
    expect(table).toMatch(/sid\s+callerId\s+pid\s+roles\s+lastHeartbeat/);
    expect(table).toMatch(/2026-06-29-session-cccccc/);
    expect(table).toMatch(/shared-env#100/);
    expect(table).toMatch(/peaks-solo,peaks-rd/);
  });

  test('multiple instances: N rows in insertion order', () => {
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-aaaaaa': {
          startedAt: new Date().toISOString(),
          roles: [],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        },
        '2026-06-29-session-bbbbbb': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-rd'],
          callerId: 'shared-env#200',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const view = loadBindingStatus(projectRoot);
    const table = formatTable(view);
    const dataRows = table.split('\n').filter((l) => l.includes('2026-06-29-session-'));
    expect(dataRows).toHaveLength(2);
  });
});

describe('formatJson — v2.18.2 PATCH (issue #2)', () => {
  test('empty binding: payload has binding=null, source=none', () => {
    const view: BindingStatusView = {
      binding: null,
      source: 'none',
      projectRoot,
      stale: false,
      outerSessionId: 'unknown'
    };
    const payload = formatJson(view);
    expect(payload.binding).toBeNull();
    expect(payload.source).toBe('none');
    expect(payload.projectRoot).toBe(projectRoot);
  });

  test('populated binding: payload shape matches BindingSchema', () => {
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-dddddd': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-solo'],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const view = loadBindingStatus(projectRoot);
    const payload = formatJson(view);
    expect(payload.binding).toBeDefined();
    const b = payload.binding as Binding;
    expect(b.pid).toBe(100);
    expect(b.ownerHint).toBe('shared-env#100');
    const inst = b.instances['2026-06-29-session-dddddd'];
    expect(inst).toBeDefined();
    expect(inst!.callerId).toBe('shared-env#100');
    expect(inst!.roles).toEqual(['peaks-solo']);
  });
});

describe('staleness warning — v2.18.2 PATCH (issue #2)', () => {
  test('stale=true when current outer-session-id does not match any callerId', () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'current-env-value';
    const binding: Binding = {
      ownerHint: 'some-other-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-eeeeee': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-rd'],
          callerId: 'some-other-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const view = loadBindingStatus(projectRoot);
    expect(view.stale).toBe(true);
    expect(view.outerSessionId).toBe('current-env-value');
  });

  test('stale=false when current outer-session-id matches a callerId prefix', () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'shared-env';
    const binding: Binding = {
      ownerHint: 'shared-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-ffffff': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-rd'],
          callerId: 'shared-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);
    const view = loadBindingStatus(projectRoot);
    expect(view.stale).toBe(false);
    expect(view.outerSessionId).toBe('shared-env');
  });

  test('stale=false on empty binding (no instances to compare against)', () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'whatever';
    const view = loadBindingStatus(projectRoot);
    expect(view.binding).toBeNull();
    expect(view.stale).toBe(false);
  });
});

describe('--project flag resolution — v2.18.2 PATCH (issue #2)', () => {
  test('loadBindingStatus resolves the binding at the supplied projectRoot', () => {
    const binding: Binding = {
      ownerHint: 'project-A-env#100',
      pid: 100,
      lastHeartbeat: new Date().toISOString(),
      scope: projectRoot,
      instances: {
        '2026-06-29-session-aaaaaa': {
          startedAt: new Date().toISOString(),
          roles: ['peaks-solo'],
          callerId: 'project-A-env#100',
          lastHeartbeat: new Date().toISOString()
        }
      }
    };
    writeBinding(projectRoot, binding);

    // An unrelated project root MUST NOT see project A's binding.
    const otherRoot = mkdtempSync(join(tmpdir(), 'peaks-binding-status-other-'));
    try {
      const view = loadBindingStatus(otherRoot);
      expect(view.binding).toBeNull();
      expect(view.source).toBe('none');
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }

    // The original project root reads its own binding.
    const view = loadBindingStatus(projectRoot);
    expect(view.binding).not.toBeNull();
    expect(view.source).toBe('canonical');
  });
});
