// tests/unit/services/memory/memory-path-missing-vs-escape.test.ts
//
// Defect pinned (triage 2026-09-13, bug 1): `realPathOrThrow` threw the SAME
// message for "nothing exists at this path" and "this path escapes the project
// root / is a symlink". `assertInsideProject` passed the escape message for
// both, so `peaks memory extract --artifact <typo>` reported
//
//   MEMORY_EXTRACT_FAILED: Artifact path must stay inside the project root
//
// — a security-sounding sentence for what is really a missing file. The module
// doc comment claimed callers "can distinguish 'missing' from 'escape attempt'";
// it did not. These tests pin the distinction in both directions: a missing
// path must NOT read as an escape, and a real escape must still be refused with
// the escape message.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-path-missing-vs-escape.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectMemoryExtractPlan } from '~/src/services/memory/project-memory-service/index/kind-dispatch';
import { assertInsideProject } from '~/src/services/memory/project-memory-service/store/paths';

const ESCAPE_MESSAGE = 'Artifact path must stay inside the project root';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-missing-vs-escape-'));
  outside = mkdtempSync(join(tmpdir(), 'peaks-missing-vs-escape-outside-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('memory path guard — "missing" is distinguishable from "escape"', () => {
  it('a path that does not exist reports a MISSING path, not an escape attempt', () => {
    const missing = join(root, 'no-such-artifact.md');

    expect(() => assertInsideProject(missing, root)).toThrowError(/does not exist/i);
    expect(() => assertInsideProject(missing, root)).not.toThrowError(ESCAPE_MESSAGE);
  });

  it('a path that exists but escapes the project root still reports an escape attempt', () => {
    writeFileSync(join(outside, 'escaped.md'), '# escaped\n');

    expect(() => assertInsideProject(join(outside, 'escaped.md'), root)).toThrowError(
      ESCAPE_MESSAGE
    );
  });

  it('a missing project root reports the project root, not the artifact', () => {
    const missingRoot = join(root, 'no-such-project');

    expect(() => assertInsideProject(join(missingRoot, 'a.md'), missingRoot)).toThrowError(
      /project root/i
    );
    expect(() => assertInsideProject(join(missingRoot, 'a.md'), missingRoot)).not.toThrowError(
      ESCAPE_MESSAGE
    );
  });

  // The user-visible surface: this is the exact call `peaks memory extract` makes.
  it('peaks memory extract on a mistyped artifact path names the missing file, not a sandbox escape', () => {
    mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });

    let message = '';
    try {
      createProjectMemoryExtractPlan({ projectRoot: root, artifactPaths: [join(root, 'typo.md')] });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe('');
    expect(message).toMatch(/does not exist/i);
    expect(message).not.toBe(ESCAPE_MESSAGE);
  });
});
