import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/design/page-probe-refusal.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

import type { DesignlangRunResult } from '../../../src/services/design/designlang.js';
import { unusable } from '../../../src/services/design/page-probe-block.js';
import { probePageUsable } from '../../../src/services/design/page-probe.js';
import { rgbPng } from './_png-bytes.js';

const BLANK_PNG = rgbPng({ width: 40, height: 40, pixel: () => [255, 255, 255] });
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** One capture dir holding the blank PNG the fake screenshot arm writes. */
function blankCapture(): {
  outDir: string;
  runIdentity: () => Promise<DesignlangRunResult>;
  runScreenshot: () => Promise<DesignlangRunResult>;
} {
  const outDir = mkdtempSync(join(tmpdir(), 'peaks-probe-refusal-'));
  roots.push(outDir);
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  writeFileSync(join(outDir, 'screenshots', 'full-page.png'), BLANK_PNG);
  return {
    outDir,
    runIdentity: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        componentScreenshots: {},
        meta: { title: 'Ledgerly' },
        voice: { sampleHeadings: ['Reconciliation'] }
      }),
      stderr: '',
      timedOut: false
    }),
    runScreenshot: async () => ({
      exitCode: 0,
      stdout: 'capture-out/screenshots/full-page.png\n',
      stderr: '',
      timedOut: false
    })
  };
}

/** A stats runner that reports a rendered page. */
function passingStats(): Promise<DesignlangRunResult> {
  return Promise.resolve({
    exitCode: 0,
    stdout: JSON.stringify({ fontFamilyCount: 2, typeScale: 4 }),
    stderr: '',
    timedOut: false
  });
}

describe('Scenario: behavior — every echoed URL is redacted', () => {
  it('when a redirect crossed to an untrusted host, should block and mask its userinfo', async () => {
    // given: a probe URL and a final URL that both carry user:pass@
    // when: Stage A reports the hop as untrusted
    // then: the block names the host and no credential reaches the message
    const result = await probePageUsable({
      url: 'http://user:pass@127.0.0.1:7611/',
      outDir: '.',
      runIdentity: async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false }),
      runScreenshot: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
      runStats: passingStats,
      fetchPage: async () => ({
        status: 200,
        finalUrl: 'http://user:pass@evil.test/x',
        textChars: 695,
        hasPasswordField: false,
        untrustedRedirect: 'http://user:pass@evil.test/x'
      })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('untrusted host');
    expect(result.message).toContain('http://evil.test/x');
    expect(result.message).not.toContain('user:pass');
    expect(result.message).not.toContain('user@');
  });

  it('when a blank capture ends on a credentialed URL, should mask it in the paint block', async () => {
    // given: a uniform capture whose reported final URL carries userinfo
    // when: the paint stage blocks the page
    // then: the paint message carries the masked address and the elapsed time
    const injected = blankCapture();
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      outDir: injected.outDir,
      runIdentity: injected.runIdentity,
      runScreenshot: injected.runScreenshot,
      runStats: passingStats,
      fetchPage: async () => ({
        status: 200,
        finalUrl: 'http://user:pass@127.0.0.1:7611/',
        textChars: 695,
        hasPasswordField: false
      })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('near-uniform');
    expect(result.message).toContain('http://127.0.0.1:7611/');
    expect(result.message).not.toContain('user:pass');
    expect(result.message).not.toContain('user@');
    expect(result.message).toContain('elapsedMs');
  });

  it('when the final URL is the opaque user:pass@host shape, should still mask it', async () => {
    // given: an opaque URL that parses WITHOUT userinfo but spells one in text
    // when: the changed-path Stage A refusal renders it
    // then: the textual pass masks the credentials
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      outDir: '.',
      runIdentity: async () => ({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false }),
      runScreenshot: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
      runStats: passingStats,
      fetchPage: async () => ({
        status: 200,
        finalUrl: 'opaque:user:pass@host',
        textChars: 695,
        hasPasswordField: false
      })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('opaque:***@host');
    expect(result.message).not.toContain('user:pass');
  });

  it('when a measured URL carries an ESC sequence, should keep its byte out of the block', () => {
    // given: a requested URL and a page-controlled finalUrl, each with a CSI sequence
    // when: the unusable-page block renders its measured fields
    // then: both echoes lose the whole sequence and keep the host a reader needs
    const result = unusable('http://127.0.0.1:7611/\u001b[2J', 'it rendered nothing', {
      status: 200,
      finalUrl: 'http://127.0.0.1:7611/\u001b[1m',
      fontFamilyCount: 2,
      elapsedMs: 5
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).not.toMatch(/\p{Cc}/u);
    expect(result.message).not.toContain('[2J');
    expect(result.message).not.toContain('[1m');
    expect(result.message).toContain('The page http://127.0.0.1:7611/');
    expect(result.message).toContain('finalUrl http://127.0.0.1:7611/');
  });
});
