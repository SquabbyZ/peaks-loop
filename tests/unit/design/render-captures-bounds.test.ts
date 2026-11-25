import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  captureMatchesRoute,
  MAX_RENDER_CAPTURE_BYTES,
  MAX_RENDER_FRAMES,
  readRenderDir
} from '../../../src/services/design/audit/render/render-captures.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';

declareDimensions('tests/unit/design/render-captures-bounds.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function captureDir(
  root: string,
  slug: string,
  layout = join('screenshots', 'full-page.png')
): string {
  const dir = join(root, slug, layout);
  mkdirSync(join(dir, '..'), { recursive: true });
  writeFileSync(dir, 'png');
  return dir;
}

function canCreateJunction(): boolean {
  const root = tempDir('peaks-render-junction-probe-');
  try {
    mkdirSync(join(root, 'target'), { recursive: true });
    symlinkSync(join(root, 'target'), join(root, 'link'), 'junction');
    return true;
  } catch {
    return false;
  }
}

const JUNCTIONS = canCreateJunction();

describe('Scenario: render — the frame and byte bounds are stated numbers', () => {
  it('when the constants are read, should be 32 frames and 64 MiB', () => {
    // given: the module's published bounds
    // when: they are read
    // then: 64 × 1024 × 1024 is 67,108,864 bytes
    expect(MAX_RENDER_FRAMES).toBe(32);
    expect(MAX_RENDER_CAPTURE_BYTES).toBe(67_108_864);
  });

  it('when exactly maxFrames captures exist, should not report truncation', () => {
    // given: two captures and a bound of two
    // when: the directory is read
    // then: the bound is inclusive and truncation is false
    const root = tempDir('peaks-render-exact-');
    captureDir(root, 'a');
    captureDir(root, 'b');
    const read = readRenderDir({ dir: root, appRoot: root, maxFrames: 2 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures).toHaveLength(2);
    expect(read.found).toBe(2);
    expect(read.truncated).toBe(false);
  });

  it('when one more capture exists than the bound, should report truncation', () => {
    // given: three captures and a bound of two
    // when: the directory is read
    // then: two are returned, three counted, truncated true
    const root = tempDir('peaks-render-over-');
    captureDir(root, 'a');
    captureDir(root, 'b');
    captureDir(root, 'c');
    const read = readRenderDir({ dir: root, appRoot: root, maxFrames: 2 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures.map((capture) => capture.slug)).toEqual(['a', 'b']);
    expect(read.found).toBe(3);
    expect(read.truncated).toBe(true);
  });
});

describe('Scenario: behavior — a capture file is a regular file in a probe layout', () => {
  it('when the screenshots path is a directory, should fall back to the bare layout', () => {
    // given: <slug>/screenshots/full-page.png is a directory and <slug>/full-page.png is a file
    // when: the directory is read
    // then: the bare file is the capture
    const root = tempDir('peaks-render-layout-');
    mkdirSync(join(root, 'slug', 'screenshots', 'full-page.png'), { recursive: true });
    writeFileSync(join(root, 'slug', 'full-page.png'), 'png');
    const read = readRenderDir({ dir: root, appRoot: root });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures[0]?.capture).toBe('slug/full-page.png');
    expect(read.found).toBe(1);
  });

  it('when a slug directory holds no capture, should skip it and keep the good one', () => {
    // given: an empty slug directory beside a real capture
    // when: the directory is read
    // then: the empty one contributes no capture and no note
    const root = tempDir('peaks-render-skip-');
    captureDir(root, 'good');
    mkdirSync(join(root, 'empty'), { recursive: true });
    const read = readRenderDir({ dir: root, appRoot: root });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures.map((capture) => capture.slug)).toEqual(['good']);
    expect(read.skipped).toEqual([]);
  });

  it('when a non-directory entry exists, should ignore it without a note', () => {
    // given: a plain file beside a capture
    // when: the directory is read
    // then: the file is not a capture and not a named skip
    const root = tempDir('peaks-render-file-');
    captureDir(root, 'good');
    writeFileSync(join(root, 'notes.txt'), 'x');
    const read = readRenderDir({ dir: root, appRoot: root });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures).toHaveLength(1);
    expect(read.skipped).toEqual([]);
  });

  it('when a capture is past the byte cap, should skip it by name and keep the rest', () => {
    // given: a sparse 64 MiB + 1 capture beside a real one
    // when: the directory is read
    // then: it is named in skipped and the real capture survives
    const root = tempDir('peaks-render-bytes-');
    captureDir(root, 'good');
    const big = captureDir(root, 'big');
    truncateSync(big, MAX_RENDER_CAPTURE_BYTES + 1);
    const read = readRenderDir({ dir: root, appRoot: root });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures.map((capture) => capture.slug)).toEqual(['good']);
    expect(read.found).toBe(1);
    expect(read.skipped).toEqual([
      `big (${MAX_RENDER_CAPTURE_BYTES + 1} bytes exceeds the ${MAX_RENDER_CAPTURE_BYTES}-byte cap)`
    ]);
  });

  it('when captures are unsorted on disk, should return them sorted by slug', () => {
    // given: capture directories created z then a
    // when: the directory is read
    // then: a comes before z
    const root = tempDir('peaks-render-sort-');
    captureDir(root, 'z');
    captureDir(root, 'a');
    const read = readRenderDir({ dir: root, appRoot: root });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures.map((capture) => capture.slug)).toEqual(['a', 'z']);
  });

  it.skipIf(!JUNCTIONS)(
    'when a slug is a directory junction, should name it and not follow it',
    () => {
      // given: a junction inside the render root pointing at a capture outside it,
      //        beside a real capture
      // when: the render directory is read
      // then: the link is skipped by NAME (a junction is not a directory entry)
      //       and only the real capture is returned
      const root = tempDir('peaks-render-junction-');
      const outside = tempDir('peaks-render-junction-target-');
      const target = join(outside, 'slug');
      mkdirSync(join(target, 'screenshots'), { recursive: true });
      writeFileSync(join(target, 'screenshots', 'full-page.png'), 'png');
      symlinkSync(target, join(root, 'linked'), 'junction');
      captureDir(root, 'good');
      const read = readRenderDir({ dir: root, appRoot: root });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.captures.map((capture) => capture.slug)).toEqual(['good']);
      expect(read.skipped).toEqual(['linked (directory link not followed)']);
    }
  );
});

describe('Scenario: integration — the render root is contained', () => {
  it('when a relative directory escapes the app root, should refuse with the full sentence', () => {
    // given: a sibling directory reachable through ..
    // when: it is passed relative
    // then: the message explains the relative/absolute rule
    const parent = tempDir('peaks-render-escape-');
    const appRoot = join(parent, 'app');
    const outside = join(parent, 'outside');
    mkdirSync(appRoot, { recursive: true });
    captureDir(outside, 'slug');
    const read = readRenderDir({ dir: join('..', 'outside'), appRoot });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.code).toBe('DESIGN_AUDIT_RENDER_ESCAPE');
    expect(read.message).toContain('resolves outside the app root');
    expect(read.message).toContain('pass an absolute path to choose it explicitly');
  });

  it('when the same directory is passed absolutely, should read it', () => {
    // given: the outside directory passed as an absolute path
    // when: the directory is read
    // then: an absolute path is an explicit choice and is allowed
    const parent = tempDir('peaks-render-absolute-');
    const appRoot = join(parent, 'app');
    const outside = join(parent, 'outside');
    mkdirSync(appRoot, { recursive: true });
    captureDir(outside, 'slug');
    const read = readRenderDir({ dir: outside, appRoot });
    expect(read.ok).toBe(true);
  });

  it('when the directory does not exist, should refuse by name', () => {
    // given: an absolute path to nowhere
    // when: the directory is read
    // then: the unavailable code carries the requested path
    const root = tempDir('peaks-render-missing-');
    const missing = resolve(root, 'gone');
    const read = readRenderDir({ dir: missing, appRoot: root });
    expect(read).toEqual({
      ok: false,
      code: 'DESIGN_AUDIT_RENDER_UNAVAILABLE',
      message: `The render directory ${missing} does not exist or cannot be resolved.`
    });
  });

  it('when the path is a file, should report that it cannot be listed', () => {
    // given: an absolute path to a regular file
    // when: the directory is read
    // then: the listing failure is a named refusal, not a throw
    const root = tempDir('peaks-render-notdir-');
    const file = join(root, 'file.txt');
    writeFileSync(file, 'x');
    const read = readRenderDir({ dir: file, appRoot: root });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.code).toBe('DESIGN_AUDIT_RENDER_UNAVAILABLE');
    expect(read.message).toContain('could not be listed');
  });

  it('when no capture exists, should refuse as empty with the expected layout', () => {
    // given: an existing empty directory
    // when: the directory is read
    // then: the empty code names the file it looked for
    const root = tempDir('peaks-render-empty-');
    const read = readRenderDir({ dir: root, appRoot: root });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.code).toBe('DESIGN_AUDIT_RENDER_EMPTY');
    expect(read.message).toContain('No page capture was found under');
    expect(read.message).toContain('expected <probe-slug>/screenshots/full-page.png');
  });
});

describe('Scenario: a11y — a slug binds to the exact route it names', () => {
  it('when the directory equals the probe slug, should match', () => {
    // given: slug "about" for route /about and slug "page" for /
    // when: each is matched
    // then: the exact-slug arm returns true
    expect(captureMatchesRoute('about', '/about')).toBe(true);
    expect(captureMatchesRoute('page', '/')).toBe(true);
  });

  it('when the root route meets a host directory, should match only a real port tail', () => {
    // given: localhost-7421 and localhost-1 for the root route
    // when: each is matched
    // then: a 2–5 digit port tail matches; a one-digit tail does not
    expect(captureMatchesRoute('localhost-7421', '/')).toBe(true);
    expect(captureMatchesRoute('localhost-1', '/')).toBe(false);
  });

  it('when a host-prefixed directory ends with the slug, should match', () => {
    // given: 127-0-0-1-7421-about for /about
    // when: it is matched
    // then: the -about suffix binds it
    expect(captureMatchesRoute('127-0-0-1-7421-about', '/about')).toBe(true);
  });
});
