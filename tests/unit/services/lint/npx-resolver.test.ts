// tests/unit/services/lint/npx-resolver.test.ts
//
// PINS THE LAYOUT. Every standard Windows Node install — the MSI, the zip, and
// nvm-for-windows — puts `node_modules/npm` beside `node.exe`, at the ROOT of
// the install: the CLI script is ONE level up from `process.execPath`, not two.
// The win32 candidate list used to look two levels up, a directory that exists
// on no such install, so on a host without the hardcoded `C:/Program
// Files/nodejs` the resolver found nothing and silently returned the bare
// `npx`/`npm` — the `.cmd` shim this whole module exists to bypass.
//
// HOST-INDEPENDENT BY CONSTRUCTION. `process.platform` and `process.execPath`
// are stubbed to a tmp fixture, so the win32 branch runs on every platform and
// no arm reads this machine's real Node install. Each positive arm asserts the
// EXACT fixture path, so a resolve that fell through to a host's hardcoded
// install cannot satisfy it — that is what makes the arms able to go red when
// the one-level-up candidate is broken.
//
// Dimensions covered:
//   - behavior:    which invocation the resolver returns for a layout
//   - integration: real files under a real tmp directory, real existsSync
//   - render:      OMITTED — the resolver returns a typed invocation object; the caller renders it
//   - a11y:        OMITTED — the bare-name fallback is asserted as behavior, never as text a human reads

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  resolveNpmInvocation,
  resolveNpxInvocation
} from '../../../../src/services/lint/npx-resolver.js';

declareDimensions(
  'tests/unit/services/lint/npx-resolver.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the resolver returns a typed invocation; the caller renders it' },
    {
      dim: 'a11y',
      reason: 'the bare-name fallback is asserted as behavior, not as text a human reads'
    }
  ]
);

let fixtureRoot: string;
let stubbed: { execPath: PropertyDescriptor; platform: PropertyDescriptor } | null = null;

/**
 * Stub the host identity the resolver reads at call time, remembering the
 * descriptors to put back. `execPath` is a data property and `platform` is a
 * non-writable but configurable one; both accept `defineProperty`.
 */
function stubHost(execPath: string, platform: NodeJS.Platform): void {
  stubbed = {
    execPath: Object.getOwnPropertyDescriptor(process, 'execPath') as PropertyDescriptor,
    platform: Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
  };
  Object.defineProperty(process, 'execPath', { value: execPath, configurable: true });
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Write `npm-cli.js` + `npx-cli.js` at `<installDir>/node_modules/npm/bin`. */
function seedNpmInstall(installDir: string): string {
  const binDir = join(installDir, 'node_modules', 'npm', 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'npm-cli.js'), '// fixture npm cli\n');
  writeFileSync(join(binDir, 'npx-cli.js'), '// fixture npx cli\n');
  return binDir;
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'peaks-npx-resolver-'));
  stubbed = null;
});

afterEach(() => {
  if (stubbed !== null) {
    Object.defineProperty(process, 'execPath', stubbed.execPath);
    Object.defineProperty(process, 'platform', stubbed.platform);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('behavior — the invocation the resolver returns for a Windows layout', () => {
  it('when npm sits beside node.exe, should resolve npx to that install', () => {
    // given: a fixture install whose node.exe is at its root and whose npm is beside it
    // when: the win32 resolver is asked for the npx invocation
    // then: it returns `node <install>/node_modules/npm/bin/npx-cli.js`, argv intact
    const execPath = join(fixtureRoot, 'v9.9.9', 'node.exe');
    const binDir = seedNpmInstall(join(fixtureRoot, 'v9.9.9'));
    stubHost(execPath, 'win32');

    const invocation = resolveNpxInvocation(['--version']);

    expect(invocation.command).toBe(execPath);
    expect(invocation.args[0]).toBe(join(binDir, 'npx-cli.js'));
    expect(invocation.args.slice(1)).toEqual(['--version']);
    expect(invocation.baseEnv).toBe(process.env);
  });

  it('when npm sits beside node.exe, should resolve npm to that install', () => {
    // given: the same fixture install, whose npm is the sibling of node.exe
    // when: the win32 resolver is asked for the npm invocation
    // then: it returns `node <install>/node_modules/npm/bin/npm-cli.js`, argv intact
    const execPath = join(fixtureRoot, 'v9.9.9', 'node.exe');
    const binDir = seedNpmInstall(join(fixtureRoot, 'v9.9.9'));
    stubHost(execPath, 'win32');

    const invocation = resolveNpmInvocation(['view', 'x']);

    expect(invocation.command).toBe(execPath);
    expect(invocation.args[0]).toBe(join(binDir, 'npm-cli.js'));
    expect(invocation.args.slice(1)).toEqual(['view', 'x']);
    expect(invocation.baseEnv).toBe(process.env);
  });
});

describe('integration — the level the layout is found at', () => {
  it('when a decoy install sits two levels up, should still resolve to the one beside node.exe', () => {
    // given: the real npm beside node.exe, and a decoy npm two levels up
    // when: the win32 resolver is asked for the npx invocation
    // then: the one-level-up install wins, and the resolved path is on disk
    const installDir = join(fixtureRoot, 'v9.9.9');
    const realBinDir = seedNpmInstall(installDir);
    seedNpmInstall(fixtureRoot);
    stubHost(join(installDir, 'node.exe'), 'win32');

    const [cliScript] = resolveNpxInvocation([]).args;

    expect(cliScript).toBe(join(realBinDir, 'npx-cli.js'));
    expect(cliScript).not.toBe(join(fixtureRoot, 'node_modules', 'npm', 'bin', 'npx-cli.js'));
    // R3: a resolved path must be real — the resolver may not pretend it found a script
    expect(typeof cliScript === 'string' && existsSync(cliScript)).toBe(true);
  });
});
