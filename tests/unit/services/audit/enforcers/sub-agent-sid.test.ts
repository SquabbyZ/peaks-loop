import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findInvalidSubAgentSids, findInvalidRuntimeSids } from '../../../../../src/services/audit/enforcers/sub-agent-sid.js';

describe('sub-agent-sid.findInvalidSubAgentSids', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-sub-agent-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns scanned=false when .peaks/_sub_agents/ is missing', () => {
    const result = findInvalidSubAgentSids(projectRoot);
    expect(result.scanned).toBe(false);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toEqual([]);
  });

  it('returns all-valid when every sid matches isValidSessionId', () => {
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/2026-06-11-session-f0312d'), { recursive: true });
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/2026-06-10-session-6bcac7'), { recursive: true });
    const result = findInvalidSubAgentSids(projectRoot);
    expect(result.scanned).toBe(true);
    expect(result.valid).toEqual(['2026-06-10-session-6bcac7', '2026-06-11-session-f0312d']);
    expect(result.invalid).toEqual([]);
  });

  it('flags bare sids (sid-3, sid-h, sid-r, unknown-sid) as invalid', () => {
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/sid-3'), { recursive: true });
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/sid-r'), { recursive: true });
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/unknown-sid'), { recursive: true });
    const result = findInvalidSubAgentSids(projectRoot);
    expect(result.invalid).toEqual(['sid-3', 'sid-r', 'unknown-sid']);
    expect(result.valid).toEqual([]);
  });

  it('flags mixed valid+invalid sids correctly', () => {
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/2026-06-11-session-abc123'), { recursive: true });
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/sid-h'), { recursive: true });
    // Invalid: 7-char session suffix exceeds the [0-9a-z]{3,6} limit
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/2026-06-09-session-toolong'), { recursive: true });
    const result = findInvalidSubAgentSids(projectRoot);
    expect(result.valid).toEqual(['2026-06-11-session-abc123']);
    expect(result.invalid).toEqual(expect.arrayContaining(['sid-h', '2026-06-09-session-toolong']));
  });
});

describe('sub-agent-sid.findInvalidRuntimeSids', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-runtime-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns scanned=false when .peaks/_runtime/ is missing', () => {
    const result = findInvalidRuntimeSids(projectRoot);
    expect(result.scanned).toBe(false);
  });

  it('flags invalid runtime sids', () => {
    mkdirSync(join(projectRoot, '.peaks/_runtime/sid-3'), { recursive: true });
    mkdirSync(join(projectRoot, '.peaks/_runtime/2026-06-11-session-f0312d'), { recursive: true });
    const result = findInvalidRuntimeSids(projectRoot);
    expect(result.invalid).toEqual(['sid-3']);
    expect(result.valid).toEqual(['2026-06-11-session-f0312d']);
  });
});
