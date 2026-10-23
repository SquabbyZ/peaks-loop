// tests/unit/workspace/runtime-root-census.test.ts
//
// The census of the runtime root — the missing half of the registry's promise.
//
// THE DEFECT THIS FILE IS THE CONTROL FOR
//
// `RUNTIME_SYSTEM_ENTRIES` called itself "an honest census of the tree rather
// than half of one" (`src/services/workspace/runtime-layout.ts`), and it was
// half of one. Two guards looked at the tree and NEITHER could see a stray
// FILE sitting at the runtime root:
//
//   - `L3:l3-orphan-sessions` reads DIRECTORIES only.
//   - `tests/unit/workspace/runtime-layout-drift-guard.test.ts` walks `src/**`,
//     never the working tree.
//
// Measured on 2026-10-24: 206 files lay at the runtime root, 204 of them
// unregistered, and the drift guard was still 14/14 green.
//
// WHAT IS ASSERTED HERE (the pure decision — no filesystem)
//
//   - a registered name is legal, whatever its kind;
//   - a session-shaped DIRECTORY is legal;
//   - a session-shaped FILE is NOT — only a directory can be a session home;
//   - anything else is a violation, reported with its name AND its kind;
//   - a root that could not be read is UNDETERMINED, never clean.
//
// Omitting `a11y`: this module is pure and owns no user-facing text. The
// operator-facing message belongs to the doctor check and is asserted in
// `tests/unit/doctor/l3-runtime-root-census.test.ts`.
//
// The on-disk behaviour of the doctor check is NOT asserted against this
// repository's own runtime root: that tree is session-scoped and moves under
// the operator's feet, so a test bound to it would go red for reasons that
// have nothing to do with the product. The repo's own tree is measured by
// running `peaks doctor --json`, not by a fixture-bound assertion.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  censusRuntimeRoot,
  RUNTIME_SYSTEM_ENTRIES,
  RUNTIME_SYSTEM_ENTRY_NAMES,
  type RuntimeRootEntry
} from '~/src/services/workspace/runtime-layout';
import { isValidSessionId } from '~/src/services/workspace/sid-naming-guard';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/workspace/runtime-root-census.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'pure decision module: no message, no exit code, no user-facing text of its own'
    }
  ]
);

/** A read that saw exactly these entries. */
function read(entries: readonly RuntimeRootEntry[]): {
  status: 'read';
  entries: readonly RuntimeRootEntry[];
} {
  return { status: 'read', entries };
}

let root: string;
let runtimeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-runtime-census-'));
  runtimeDir = join(root, '.peaks', '_runtime');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── render: the verdict shape ─────────────────────────────────────────

describe('Scenario: render — the verdict shape', () => {
  it('when every entry at the runtime root is registered, should report a clean census', () => {
    // given: a runtime root holding one registered directory and one registered file
    // when: the runtime root is censused
    // then: the census is clean and counts both entries
    const census = censusRuntimeRoot({
      read: read([
        { name: 'change', kind: 'dir' },
        { name: 'session.json', kind: 'file' }
      ])
    });
    expect(census).toEqual({ status: 'clean', entryCount: 2 });
  });

  it('when the runtime root holds unregistered entries, should name each with its kind', () => {
    // given: a runtime root holding one stray file and one stray directory
    // when: the runtime root is censused
    // then: the census names both violations with their kinds
    const census = censusRuntimeRoot({
      read: read([
        { name: 'stray.log', kind: 'file' },
        { name: 'stray-dir', kind: 'dir' }
      ])
    });
    expect(census).toEqual({
      status: 'violations',
      violations: [
        { name: 'stray.log', kind: 'file' },
        { name: 'stray-dir', kind: 'dir' }
      ]
    });
  });

  it('when the runtime root cannot be read, should report undetermined with the reason', () => {
    // given: a runtime root whose read fails
    // when: the runtime root is censused
    // then: the census is undetermined and carries the read reason
    const census = censusRuntimeRoot({
      read: { status: 'unreadable', reason: 'EACCES: permission denied' }
    });
    expect(census).toEqual({ status: 'undetermined', reason: 'EACCES: permission denied' });
  });
});

// ── behavior: the classification decision ─────────────────────────────

describe('Scenario: behavior — the classification decision', () => {
  // Driven off the registry itself, so adding an entry cannot leave this
  // file asserting the old behaviour.
  it('when the registry holds entries of every kind, should accept every registered name', () => {
    // given: the runtime-layout registry entries
    // when: the runtime root is censused against them
    // then: the census is clean
    const entries = RUNTIME_SYSTEM_ENTRIES.map((entry) => ({
      name: entry.name,
      kind: entry.kind
    }));
    const census = censusRuntimeRoot({ read: read(entries) });
    expect(census.status).toBe('clean');
  });

  it('when the runtime root holds a session-shaped directory, should accept it', () => {
    // given: a runtime root holding one session-shaped directory
    // when: the runtime root is censused
    // then: the census is clean
    const census = censusRuntimeRoot({
      read: read([{ name: '2026-09-16-session-5bcf09', kind: 'dir' }])
    });
    expect(census.status).toBe('clean');
  });

  it('when a session-shaped FILE sits at the runtime root, should reject it', () => {
    // given: a runtime root holding one session-shaped file
    // when: the runtime root is censused
    // then: the census reports the file as a violation
    const census = censusRuntimeRoot({
      read: read([{ name: '2026-09-16-session-5bcf09', kind: 'file' }])
    });
    expect(census).toEqual({
      status: 'violations',
      violations: [{ name: '2026-09-16-session-5bcf09', kind: 'file' }]
    });
  });

  it('when the runtime root holds unregistered entries of both kinds, should reject them', () => {
    // given: a runtime root holding one stray directory and one stray file
    // when: the runtime root is censused
    // then: the census names both violations with their kinds
    const census = censusRuntimeRoot({
      read: read([
        { name: 'stray-dir', kind: 'dir' },
        { name: 'stray-file.log', kind: 'file' }
      ])
    });
    expect(census).toEqual({
      status: 'violations',
      violations: [
        { name: 'stray-dir', kind: 'dir' },
        { name: 'stray-file.log', kind: 'file' }
      ]
    });
  });

  it('when the runtime root is empty, should treat the tree as clean', () => {
    // given: a runtime root holding no entries at all
    // when: the runtime root is censused
    // then: the census is clean and counts zero entries
    const census = censusRuntimeRoot({ read: read([]) });
    expect(census).toEqual({ status: 'clean', entryCount: 0 });
  });

  // The doctor injects its own validator; the census must use the one it
  // is handed, or the two could disagree about what a session id is.
  it('when a session-id validator is injected, should honour it instead of a private copy', () => {
    // given: an injected validator that rejects every session id
    // when: the runtime root is censused against a session-shaped directory
    // then: the census reports the directory as a violation
    const census = censusRuntimeRoot({
      read: read([{ name: '2026-09-16-session-5bcf09', kind: 'dir' }]),
      isValidSessionId: () => false
    });
    expect(census.status).toBe('violations');
  });

  it('when no validator is injected, should default to the canonical session-id validator', () => {
    // given: a runtime root holding one session-shaped directory
    // when: the runtime root is censused with the default validator
    // then: the canonical validator accepts the session id and the census is clean
    expect(isValidSessionId('2026-09-16-session-5bcf09')).toBe(true);
    const census = censusRuntimeRoot({
      read: read([{ name: '2026-09-16-session-5bcf09', kind: 'dir' }])
    });
    expect(census.status).toBe('clean');
  });

  it('when the registry is read, should expose every registered name as one set', () => {
    // given: the runtime-layout registry entries
    // when: the registered-name set is compared with the entries
    // then: the set holds every entry name and no more
    expect(RUNTIME_SYSTEM_ENTRY_NAMES.size).toBe(RUNTIME_SYSTEM_ENTRIES.length);
    for (const entry of RUNTIME_SYSTEM_ENTRIES) {
      expect(RUNTIME_SYSTEM_ENTRY_NAMES.has(entry.name)).toBe(true);
    }
  });
});

// ── integration: a real tree on disk ──────────────────────────────────

describe('Scenario: integration — a real tree read off disk', () => {
  it('when a real directory tree is read off disk, should classify it as the pure cases do', () => {
    // given: a real runtime root holding a registered directory, a session dir and a stray file
    // when: the runtime root is read from disk and censused
    // then: only the stray file is reported as a violation
    mkdirSync(join(runtimeDir, 'change'), { recursive: true });
    mkdirSync(join(runtimeDir, '2026-09-16-session-5bcf09'), { recursive: true });
    writeFileSync(join(runtimeDir, 'session.json'), '{}', 'utf8');
    writeFileSync(join(runtimeDir, 'stray.log'), 'x', 'utf8');

    const entries = readdirSync(runtimeDir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? ('dir' as const) : ('file' as const)
    }));

    const census = censusRuntimeRoot({ read: read(entries) });
    expect(census).toEqual({
      status: 'violations',
      violations: [{ name: 'stray.log', kind: 'file' }]
    });
  });

  it('when a real tree holds registered entries only, should report a clean census', () => {
    // given: a real runtime root holding every registered entry
    // when: the runtime root is read from disk and censused
    // then: the census is clean
    mkdirSync(runtimeDir, { recursive: true });
    for (const entry of RUNTIME_SYSTEM_ENTRIES) {
      const full = join(runtimeDir, entry.name);
      if (entry.kind === 'dir') mkdirSync(full, { recursive: true });
      else writeFileSync(full, '{}', 'utf8');
    }

    const entries = readdirSync(runtimeDir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? ('dir' as const) : ('file' as const)
    }));

    const census = censusRuntimeRoot({ read: read(entries) });
    expect(census.status).toBe('clean');
  });
});
