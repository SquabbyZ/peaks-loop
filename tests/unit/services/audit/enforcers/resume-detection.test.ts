import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkResume } from '../../../../../src/services/audit/enforcers/resume-detection.js';

describe('resume-detection.checkResume', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-resume-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns canResume=false when session binding is missing', () => {
    const result = checkResume({ projectRoot, sessionId: '2026-06-11-session-f0312d' });
    expect(result.sessionBindingExists).toBe(false);
    expect(result.canResume).toBe(false);
  });

  it('returns canResume=false when session binding exists but no rd request', () => {
    mkdirSync(join(projectRoot, '.peaks/_runtime/2026-06-11-session-f0312d'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks/_runtime/2026-06-11-session-f0312d/session.json'), '{}');
    const result = checkResume({ projectRoot, sessionId: '2026-06-11-session-f0312d' });
    expect(result.sessionBindingExists).toBe(true);
    expect(result.requestState).toBeNull();
    expect(result.canResume).toBe(false);
  });

  it('returns canResume=true when session binding + rd request in spec-locked', () => {
    mkdirSync(join(projectRoot, '.peaks/_runtime/2026-06-11-session-f0312d/rd/requests'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks/_runtime/2026-06-11-session-f0312d/session.json'), '{}');
    writeFileSync(
      join(projectRoot, '.peaks/_runtime/2026-06-11-session-f0312d/rd/requests/001-test.md'),
      '# RD Request\n\n- state: spec-locked\n',
    );
    const result = checkResume({ projectRoot, sessionId: '2026-06-11-session-f0312d' });
    expect(result.canResume).toBe(true);
    expect(result.requestState).toBe('spec-locked');
  });
});
