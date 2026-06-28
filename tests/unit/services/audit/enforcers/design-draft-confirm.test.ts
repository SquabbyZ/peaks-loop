/**
 * design-draft-confirm enforcer tests — Slice C Group G3 (v2.14.0).
 * Required ≥5 cases per AC A3.3. Backed by 2 prose-only occurrences in the
 * peaks-cli catalog (rl-design-draft-confirm-001). Removing the DEFERRED_ENFORCERS
 * tag re-classifies these as cli-backed; this file proves the enforcer
 * itself behaves correctly so the tag-removal is well-founded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDesignDraftConfirmation } from '../../../../../src/services/audit/enforcers/design-draft-confirm.js';

let projectRoot: string;
const changeId = 'v2-14-0-test';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'design-draft-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function ensureDir(relPath: string): void {
  mkdirSync(join(projectRoot, relPath), { recursive: true });
}

describe('checkDesignDraftConfirmation', () => {
  it('case 1: draft does not exist → draftExists=false, confirmed=false', () => {
    const r = checkDesignDraftConfirmation({ projectRoot, sessionId: '', changeId });
    expect(r.draftExists).toBe(false);
    expect(r.confirmed).toBe(false);
    // Use posix-aware check: replace backslashes for cross-platform portability
    const normalized = r.draftPath.split(/[\\/]/).join('/');
    expect(normalized).toContain(`${changeId}/ui/design-draft.md`);
  });

  it('case 2: draft exists but no confirmed marker → confirmed=false', () => {
    ensureDir(`.peaks/${changeId}/ui`);
    writeFileSync(join(projectRoot, `.peaks/${changeId}/ui/design-draft.md`), '# Design\n\nNo confirmation marker here.');
    const r = checkDesignDraftConfirmation({ projectRoot, sessionId: '', changeId });
    expect(r.draftExists).toBe(true);
    expect(r.confirmed).toBe(false);
  });

  it('case 3: draft with `confirmed: true` marker → confirmed=true', () => {
    ensureDir(`.peaks/${changeId}/ui`);
    writeFileSync(join(projectRoot, `.peaks/${changeId}/ui/design-draft.md`), 'confirmed: true');
    const r = checkDesignDraftConfirmation({ projectRoot, sessionId: '', changeId });
    expect(r.draftExists).toBe(true);
    expect(r.confirmed).toBe(true);
  });

  it('case 4: draft with `status: confirmed-by-user` marker → confirmed=true', () => {
    ensureDir(`.peaks/${changeId}/ui`);
    writeFileSync(join(projectRoot, `.peaks/${changeId}/ui/design-draft.md`), '---\nstatus: confirmed-by-user\n---');
    const r = checkDesignDraftConfirmation({ projectRoot, sessionId: '', changeId });
    expect(r.confirmed).toBe(true);
  });

  it('case 5: draft with `# confirmed` H1 → confirmed=true', () => {
    ensureDir(`.peaks/${changeId}/ui`);
    writeFileSync(join(projectRoot, `.peaks/${changeId}/ui/design-draft.md`), '# Confirmed\n\nbody');
    const r = checkDesignDraftConfirmation({ projectRoot, sessionId: '', changeId });
    expect(r.confirmed).toBe(true);
  });

  it('case 6: confirmationPath equals draftPath on existing draft', () => {
    ensureDir(`.peaks/${changeId}/ui`);
    const draftPath = join(projectRoot, `.peaks/${changeId}/ui/design-draft.md`);
    writeFileSync(draftPath, 'confirmed: true');
    const r = checkDesignDraftConfirmation({ projectRoot, sessionId: '', changeId });
    expect(r.confirmationPath).toBe(draftPath);
  });
});
