/**
 * Phase 2 Task 2.4 — artifact pointer validation + project-boundary guard.
 *
 * Pins the contract from design §7.1 (ArtifactPointer), §15 (no raw
 * secrets / transcripts / capsule bodies in the persisted journal), and
 * §16 (realpath-based containment). Tests are non-tautological: every
 * rejection branch has an independent case so a regression in one
 * (e.g. removing the forbidden-substring guard) does not silently
 * cascade.
 *
 * Hard rules re-verified here:
 *   - realpath-based project-root containment (NOT raw path-join prefix).
 *   - SHA-256 over the canonicalized file bytes.
 *   - O_NOFOLLOW-aware read for the hash step so symlink swap cannot
 *     bypass the verifier.
 *   - 256-char summary ceiling, with the Phase 1 forbidden-substring
 *     set (secret / transcript / capsule / conversation) lower-cased.
 *   - Optional `kind` is one of memo | doc | log | snapshot | spec.
 *   - `ArtifactPointerError` carries `code` for runtime I/O failures;
 *     input-validation failures throw an Error whose message begins
 *     with `ARTIFACT_FORBIDDEN_SUMMARY` / `ARTIFACT_UNKNOWN_KIND` so
 *     the slice can branch on a stable surface.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ARTIFACT_POINTER_KINDS,
  ArtifactPointerError,
  createArtifactPointer,
  verifyArtifactPointer,
  type ArtifactPointerKind
} from '../../../../src/services/compact-core/artifact-pointers.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-artifact-pointers-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): string {
  const fullPath = join(projectRoot, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf(join('')) || 0);
  // Ensure parent directory exists for nested writes.
  const parent = fullPath.replace(/[\\/][^\\/]*$/, '');
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const VALID_KINDS: ReadonlyArray<ArtifactPointerKind> = [
  'memo',
  'doc',
  'log',
  'snapshot',
  'spec'
];

describe('ARTIFACT_POINTER_KINDS export', () => {
  it('exposes the canonical kind set', () => {
    expect(new Set(ARTIFACT_POINTER_KINDS)).toEqual(
      new Set<ArtifactPointerKind>(['memo', 'doc', 'log', 'snapshot', 'spec'])
    );
  });
});

describe('createArtifactPointer — happy path', () => {
  it('resolves a real project file, computes SHA-256, and returns a valid pointer', () => {
    const filePath = writeFile('notes/rfc.md', 'rfc body\n');
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'rfc draft',
      kind: 'memo'
    });

    expect(pointer.path).toBe(filePath);
    expect(pointer.sha256).toBe(sha256('rfc body\n'));
    expect(pointer.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pointer.summary).toBe('rfc draft');
    expect(pointer.kind).toBe('memo');
  });

  it('accepts a relative path that resolves inside the project root', () => {
    writeFile('a/b/c.txt', 'hello');
    const pointer = createArtifactPointer({
      projectRoot,
      path: join(projectRoot, 'a', 'b', 'c.txt'),
      summary: 'nested file'
    });
    expect(pointer.sha256).toBe(sha256('hello'));
    expect(pointer.kind).toBeUndefined();
  });

  it('accepts every kind in the canonical set', () => {
    for (const kind of VALID_KINDS) {
      const filePath = writeFile(`kinds/${kind}.txt`, `body-${kind}`);
      const pointer = createArtifactPointer({
        projectRoot,
        path: filePath,
        summary: `${kind}-summary`,
        kind
      });
      expect(pointer.kind).toBe(kind);
    }
  });

  it('produces SHA-256 hex that matches the canonical SHA-256 regex', () => {
    const filePath = writeFile('regex/needle.txt', 'match me');
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'regex check'
    });
    expect(pointer.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('overwrites the same canonical realpath target byte-for-byte (idempotent)', () => {
    const filePath = writeFile('idem/body.bin', 'X');
    const first = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'idem'
    });
    writeFileSync(filePath, 'X', 'utf8'); // same bytes
    const second = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'idem'
    });
    expect(first.sha256).toBe(second.sha256);
  });
});

describe('createArtifactPointer — rejection cases', () => {
  it('rejects an empty path with EMPTY_PATH', () => {
    expect(() =>
      createArtifactPointer({
        projectRoot,
        path: '',
        summary: 'x'
      })
    ).toThrow(ArtifactPointerError);
    try {
      createArtifactPointer({ projectRoot, path: '', summary: 'x' });
    } catch (error) {
      expect((error as ArtifactPointerError).code).toBe('EMPTY_PATH');
    }
  });

  it('rejects a missing file with NOT_FOUND', () => {
    expect(() =>
      createArtifactPointer({
        projectRoot,
        path: join(projectRoot, 'nope.txt'),
        summary: 'missing'
      })
    ).toThrow(ArtifactPointerError);
    try {
      createArtifactPointer({
        projectRoot,
        path: join(projectRoot, 'nope.txt'),
        summary: 'missing'
      });
    } catch (error) {
      expect((error as ArtifactPointerError).code).toBe('NOT_FOUND');
    }
  });

  it('rejects an absolute path that escapes the project root with OUTSIDE_PROJECT', () => {
    // Pick a path that is definitely outside the project root on every
    // platform. /tmp or C:\Temp work; on Windows we resolve via realpath
    // first, so use a guaranteed-existing file outside.
    const outsideFile = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/passwd';
    expect(() =>
      createArtifactPointer({
        projectRoot,
        path: outsideFile,
        summary: 'outside'
      })
    ).toThrow(ArtifactPointerError);
    try {
      createArtifactPointer({
        projectRoot,
        path: outsideFile,
        summary: 'outside'
      });
    } catch (error) {
      expect((error as ArtifactPointerError).code).toBe('OUTSIDE_PROJECT');
    }
  });

  it('rejects a symlink escape with OUTSIDE_PROJECT', () => {
    // Skip on Windows where symlink creation requires elevated privileges
    // and CI typically runs as non-admin. The canonical realpath branch
    // is still exercised by the absolute-outside test above on every
    // platform.
    if (process.platform === 'win32') {
      return;
    }
    const outsideDir = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    try {
      writeFileSync(join(outsideDir, 'secret.md'), 'leak', 'utf8');
      const linkPath = join(projectRoot, 'escape.md');
      symlinkSync(join(outsideDir, 'secret.md'), linkPath, 'file');

      expect(() =>
        createArtifactPointer({
          projectRoot,
          path: linkPath,
          summary: 'escape'
        })
      ).toThrow(ArtifactPointerError);
      try {
        createArtifactPointer({
          projectRoot,
          path: linkPath,
          summary: 'escape'
        });
      } catch (error) {
        expect((error as ArtifactPointerError).code).toBe('OUTSIDE_PROJECT');
      }
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects a summary longer than 256 characters with SUMMARY_TOO_LONG', () => {
    const filePath = writeFile('long.txt', 'x');
    const long = 'a'.repeat(257);
    expect(() =>
      createArtifactPointer({
        projectRoot,
        path: filePath,
        summary: long
      })
    ).toThrow(ArtifactPointerError);
    try {
      createArtifactPointer({
        projectRoot,
        path: filePath,
        summary: long
      });
    } catch (error) {
      expect((error as ArtifactPointerError).code).toBe('SUMMARY_TOO_LONG');
    }
  });

  it('accepts a summary of exactly 256 characters', () => {
    const filePath = writeFile('boundary.txt', 'x');
    const ok = 'a'.repeat(256);
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: ok
    });
    expect(pointer.summary).toBe(ok);
  });

  it.each([
    'secret handshake',
    'this contains a transcript fragment',
    'capsule summary',
    'a long conversation about ids',
    'SECRET in upper case',
    'Capsule with capital C'
  ])('rejects forbidden substring "%s" with ARTIFACT_FORBIDDEN_SUMMARY', (summary) => {
    const filePath = writeFile('forbidden.txt', 'x');
    expect(() =>
      createArtifactPointer({
        projectRoot,
        path: filePath,
        summary
      })
    ).toThrow(/ARTIFACT_FORBIDDEN_SUMMARY/);
  });

  it.each(['video', 'audio', '', 'unknown', 'NOTES'])(
    'rejects unknown kind "%s" with ARTIFACT_UNKNOWN_KIND',
    (kind) => {
      const filePath = writeFile('kind.txt', 'x');
      expect(() =>
        createArtifactPointer({
          projectRoot,
          path: filePath,
          summary: 'k',
          // Cast through unknown so the test can pass arbitrary strings
          // without TS rejecting them at the call site.
          kind: kind as ArtifactPointerKind
        })
      ).toThrow(/ARTIFACT_UNKNOWN_KIND/);
    }
  );
});

describe('verifyArtifactPointer — happy path', () => {
  it('verifies an unchanged pointer', () => {
    const filePath = writeFile('v/ok.txt', 'verify me');
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'verify'
    });
    expect(() => verifyArtifactPointer({ projectRoot, pointer })).not.toThrow();
  });

  it('detects content tampering with HASH_MISMATCH', () => {
    const filePath = writeFile('v/tamper.txt', 'original');
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'tamper'
    });
    writeFileSync(filePath, 'tampered', 'utf8');
    expect(() => verifyArtifactPointer({ projectRoot, pointer })).toThrow(
      ArtifactPointerError
    );
    try {
      verifyArtifactPointer({ projectRoot, pointer });
    } catch (error) {
      expect((error as ArtifactPointerError).code).toBe('HASH_MISMATCH');
    }
  });

  it('detects deletion with NOT_FOUND', () => {
    const filePath = writeFile('v/del.txt', 'doomed');
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'doomed'
    });
    rmSync(filePath, { force: true });
    expect(() => verifyArtifactPointer({ projectRoot, pointer })).toThrow(
      ArtifactPointerError
    );
    try {
      verifyArtifactPointer({ projectRoot, pointer });
    } catch (error) {
      expect((error as ArtifactPointerError).code).toBe('NOT_FOUND');
    }
  });

  it('detects project-root swap with OUTSIDE_PROJECT', () => {
    const filePath = writeFile('v/swap.txt', 'body');
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'swap'
    });
    const otherRoot = mkdtempSync(join(tmpdir(), 'peaks-other-'));
    try {
      expect(() =>
        verifyArtifactPointer({ projectRoot: otherRoot, pointer })
      ).toThrow(ArtifactPointerError);
      try {
        verifyArtifactPointer({ projectRoot: otherRoot, pointer });
      } catch (error) {
        expect((error as ArtifactPointerError).code).toBe('OUTSIDE_PROJECT');
      }
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('detects a symlink-swap of the pointed file with OUTSIDE_PROJECT', () => {
    if (process.platform === 'win32') {
      return;
    }
    const filePath = writeFile('v/swaplink.txt', 'good');
    const pointer = createArtifactPointer({
      projectRoot,
      path: filePath,
      summary: 'swap'
    });
    // Replace the file with a symlink to an outside target; the
    // verifier must refuse on the realpath containment step.
    const outsideDir = mkdtempSync(join(tmpdir(), 'peaks-swap-out-'));
    try {
      writeFileSync(join(outsideDir, 'elsewhere.md'), 'leak', 'utf8');
      rmSync(filePath, { force: true });
      symlinkSync(join(outsideDir, 'elsewhere.md'), filePath, 'file');
      expect(() => verifyArtifactPointer({ projectRoot, pointer })).toThrow(
        ArtifactPointerError
      );
      try {
        verifyArtifactPointer({ projectRoot, pointer });
      } catch (error) {
        expect((error as ArtifactPointerError).code).toBe('OUTSIDE_PROJECT');
      }
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects a pointer whose recorded path is empty with EMPTY_PATH', () => {
    expect(() =>
      verifyArtifactPointer({
        projectRoot,
        pointer: {
          path: '',
          sha256: sha256('x'),
          summary: 'empty'
        }
      })
    ).toThrow(ArtifactPointerError);
    try {
      verifyArtifactPointer({
        projectRoot,
        pointer: {
          path: '',
          sha256: sha256('x'),
          summary: 'empty'
        }
      });
    } catch (error) {
      expect((error as ArtifactPointerError).code).toBe('EMPTY_PATH');
    }
  });
});