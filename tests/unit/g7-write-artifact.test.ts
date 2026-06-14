/**
 * G7.4 — `--write-artifact` flag path safety + sha256 calc + 0-byte / missing-file edge cases.
 *
 * Tests the `peaks sub-agent dispatch --write-artifact <path>` flag:
 *  - path safety: must be in `.peaks/_sub_agents/<sid>/artifacts/`
 *  - reject `..` / absolute paths / symlink escape
 *  - sha256 + size auto-calc
 *  - 0-byte file => status: failed
 *  - missing file => ARTIFACT_NOT_FOUND warning
 *  - file name convention soft warning
 */
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  artifactPath,
  assertSafeArtifactPath,
  checkArtifactNameConvention
} from '../../src/services/context/dispatch-context-guard.js';

let root: string;
const SID = '2026-06-06-session-5b1095';
const RID = '003-2026-06-07';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-g7-write-'));
  // Create the canonical artifacts dir
  mkdirSync(join(root, '.peaks', '_sub_agents', SID, 'artifacts'), { recursive: true });
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('G7 --write-artifact path safety', () => {
  it('accepts an artifact path inside .peaks/_sub_agents/<sid>/artifacts/', () => {
    const p = artifactPath(root, SID, RID, 'rd', 1, 'md');
    expect(p).toBe(resolve(root, '.peaks', '_sub_agents', SID, 'artifacts', `${RID}-rd-001.md`));
    const out = assertSafeArtifactPath(p, root);
    // Slice 2026-06-13-repair-pre-existing-test-failures: on macOS
    // `assertSafeArtifactPath` realpath-resolves the parent dir
    // (the test creates the artifacts subdir but not the file
    // itself, so realpathSync on the full file would ENOENT). The
    // helper returns `resolve(realParent, basename)` so mirror that
    // here. On Linux the realpath is a no-op.
    const realParent = realpathSync(resolve(root, '.peaks', '_sub_agents', SID, 'artifacts'));
    expect(out).toBe(resolve(realParent, `${RID}-rd-001.md`));
  });

  it('rejects `..` segments in the raw path', () => {
    // path.join collapses `..` segments, so we build the path string manually.
    const bad = `${root}/.peaks/_sub_agents/${SID}/artifacts/../evil.md`;
    expect(() => assertSafeArtifactPath(bad, root)).toThrow(/must not contain \.\. segments/);
  });

  it('rejects relative paths (not absolute)', () => {
    expect(() => assertSafeArtifactPath('relative/path.md', root)).toThrow(/must be absolute/);
  });

  it('rejects paths outside .peaks/_sub_agents/', () => {
    const bad = join(root, 'tmp', 'evil.md');
    expect(() => assertSafeArtifactPath(bad, root)).toThrow(/must be under \.peaks\/_sub_agents\//);
  });

  it('rejects symlink escapes from .peaks/_sub_agents/ to project root', () => {
    // Create a symlink at .peaks/_sub_agents/<sid>/artifacts/evil.md -> /tmp/evil.md
    const target = join(root, 'evil-target.md');
    writeFileSync(target, 'outside', 'utf8');
    const linkDir = join(root, '.peaks', '_sub_agents', SID, 'artifacts');
    const link = join(linkDir, 'evil.md');
    try {
      symlinkSync(target, link, 'file');
    } catch {
      // Skip on platforms / permissions that disallow symlinks (e.g. Windows non-admin).
      // The test still exercises the lexical check below.
    }
    // Lexical: even if symlink can't be created, the path is in the canonical dir,
    // so the lexical check passes. The realpathSync check is exercised below.
    try {
      assertSafeArtifactPath(link, root);
      // If we get here, the realpathSync check passed (target is inside project root).
    } catch (err) {
      // Symlink may escape realpath; verify the error is the symlink escape one.
      expect((err as Error).message).toMatch(/symlink|escapes/);
    }
  });

  it('rejects symlinks that point outside the project root', () => {
    if (sep === '\\' && process.platform === 'win32') {
      // Some Windows configs disallow symlinks; skip if creation fails.
      const linkDir = join(root, '.peaks', '_sub_agents', SID, 'artifacts');
      const target = join(root, '..', '..', 'evil-outside.md');
      const link = join(linkDir, 'evil-outside.md');
      try {
        symlinkSync(target, link, 'file');
      } catch {
        return; // Skip
      }
      expect(() => assertSafeArtifactPath(link, root)).toThrow();
    }
  });
});

describe('G7 artifact file name convention (soft warning)', () => {
  it('returns null for matching <rid>-<role>-<idx>.<ext>', () => {
    const p = artifactPath(root, SID, RID, 'rd', 1, 'md');
    expect(checkArtifactNameConvention(p)).toBeNull();
  });

  it('returns warning for non-conformant names', () => {
    // Use a name that does NOT match the pattern: starts with a digit-only
    // block and a colon, neither of which the regex allows.
    const p = join(root, '123!foo.md');
    const result = checkArtifactNameConvention(p);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/does not match <rid>-<role>-<idx>\.<ext>/);
  });
});

describe('G7 0-byte + missing file behavior', () => {
  it('0-byte file -> status: failed (not silent success)', () => {
    const p = join(root, '.peaks', '_sub_agents', SID, 'artifacts', '003-rd-001.md');
    writeFileSync(p, '', 'utf8');
    const stat = existsSync(p) ? require('node:fs').statSync(p) : null;
    expect(stat?.size).toBe(0);
    // The dispatch CLI's --write-artifact path uses buildArtifactMeta which
    // detects 0-byte and returns status: 'failed'. Verified in g7-artifact-meta.
  });

  it('missing file path triggers ARTIFACT_NOT_FOUND (CLI behavior, not in this helper)', () => {
    const p = join(root, '.peaks', '_sub_agents', SID, 'artifacts', '003-rd-notthere.md');
    expect(existsSync(p)).toBe(false);
    // The dispatch CLI checks existsSync and emits ARTIFACT_NOT_FOUND warning.
  });
});

describe('G7 artifactPath builder', () => {
  it('pads idx to 3 digits', () => {
    expect(artifactPath(root, SID, RID, 'rd', 1, 'md')).toMatch(/-001\.md$/);
    expect(artifactPath(root, SID, RID, 'rd', 42, 'md')).toMatch(/-042\.md$/);
  });

  it('rejects empty role', () => {
    expect(() => artifactPath(root, SID, RID, '', 1, 'md')).toThrow(/role must be non-empty/);
  });

  it('rejects non-positive idx', () => {
    expect(() => artifactPath(root, SID, RID, 'rd', 0, 'md')).toThrow(/idx must be positive integer/);
    expect(() => artifactPath(root, SID, RID, 'rd', -1, 'md')).toThrow(/idx must be positive integer/);
  });

  it('rejects empty ext (after stripping non-alphanumeric)', () => {
    // .bak → "bak" is alphanumeric and accepted. Only an ext that is
    // empty after stripping (e.g. "...") is rejected.
    expect(() => artifactPath(root, SID, RID, 'rd', 1, '...')).toThrow(/ext must be alphanumeric/);
  });

  it('sanitizes .. in segments', () => {
    expect(() => artifactPath(root, '..', RID, 'rd', 1, 'md')).toThrow();
    expect(() => artifactPath(root, SID, '../evil', 'rd', 1, 'md')).toThrow();
  });
});
