// tests/unit/hooks/edit-enforcement.test.ts
//
// Slice 4.0.7-PR-meta-1: verifies the Edit-enforcement hook contract.
// The hook itself is a pure bash script (pre-tool-edit-enforcement.sh);
// these tests assert the registration shape (matcher / sentinel /
// command / event) and the opt-in default. The script's runtime
// behavior is tested in tests/e2e (not in this unit suite — the
// script is a separate process that reads JSON from stdin and
// writes JSON to stdout, and the unit test harness is Node-based).
//
// Run with: pnpm vitest run tests/unit/hooks/edit-enforcement.test.ts

import { describe, expect, it } from 'vitest';
import {
  EDIT_ENFORCEMENT_HOOK_EVENT,
  EDIT_ENFORCEMENT_HOOK_MATCHER,
  EDIT_ENFORCEMENT_HOOK_SENTINEL,
  PEAKS_HOOK_ENTRIES,
} from '../../../src/services/skills/hooks-settings-service.js';

describe('Edit-enforcement hook constants (4.0.7-PR-meta-1)', () => {
  it('matcher targets Edit / Write / MultiEdit / NotebookEdit', () => {
    expect(EDIT_ENFORCEMENT_HOOK_MATCHER).toBe('Edit|Write|MultiEdit|NotebookEdit');
  });

  it('event is PreToolUse', () => {
    expect(EDIT_ENFORCEMENT_HOOK_EVENT).toBe('PreToolUse');
  });

  it('sentinel is unique and recognizably peaks-managed', () => {
    expect(EDIT_ENFORCEMENT_HOOK_SENTINEL).toBe('peaks edit enforcement');
  });
});

describe('PEAKS_HOOK_ENTRIES default (no edit enforcement)', () => {
  it('default is gate-enforce only (no edit enforcement)', () => {
    expect(PEAKS_HOOK_ENTRIES.length).toBe(1);
    expect(PEAKS_HOOK_ENTRIES[0]?.sentinel).not.toBe(EDIT_ENFORCEMENT_HOOK_SENTINEL);
  });
});

describe('PEAKS_HOOK_ENTRIES backward compat (claude-code default)', () => {
  it('still exports the gate-enforce-only default', () => {
    // Tests + downstream consumers reference PEAKS_HOOK_ENTRIES.
    // The 4.0.7 PR-meta-1 must NOT break this contract.
    expect(PEAKS_HOOK_ENTRIES.length).toBe(1);
    expect(PEAKS_HOOK_ENTRIES[0]?.sentinel).not.toBe(EDIT_ENFORCEMENT_HOOK_SENTINEL);
  });
});
