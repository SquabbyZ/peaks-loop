import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTechDocPresence } from '../../../../../src/services/audit/enforcers/tech-doc-presence.js';

describe('tech-doc-presence.checkTechDocPresence', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-techdoc-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns exists=false when the file is missing', () => {
    const result = checkTechDocPresence({ projectRoot, sessionId: '2026-06-11-session-abc123' });
    expect(result.exists).toBe(false);
    expect(result.isEmpty).toBe(false);
  });

  it('returns exists=true when the file is present and non-empty', () => {
    const docDir = join(projectRoot, '.peaks/_runtime/2026-06-11-session-abc123/rd');
    require('node:fs').mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, 'tech-doc.md'), '# Tech Doc\n');
    const result = checkTechDocPresence({ projectRoot, sessionId: '2026-06-11-session-abc123' });
    expect(result.exists).toBe(true);
    expect(result.isEmpty).toBe(false);
  });

  it('returns isEmpty=true when the file is 0 bytes', () => {
    const docDir = join(projectRoot, '.peaks/_runtime/2026-06-11-session-abc123/rd');
    require('node:fs').mkdirSync(docDir, { recursive: true });
    writeFileSync(join(docDir, 'tech-doc.md'), '');
    const result = checkTechDocPresence({ projectRoot, sessionId: '2026-06-11-session-abc123' });
    expect(result.exists).toBe(true);
    expect(result.isEmpty).toBe(true);
  });
});
