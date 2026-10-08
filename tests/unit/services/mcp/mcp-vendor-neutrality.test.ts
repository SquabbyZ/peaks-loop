// tests/unit/services/mcp/mcp-vendor-neutrality.test.ts
//
// PRD rid-036 AC-11: no platform branch and no hard-coded harness in the new
// code.
//
// WHY A SOURCE SCAN AND NOT A TEST OF BEHAVIOUR. A platform branch is invisible
// on the platform it was written for — it behaves identically there either way.
// The only moment it becomes observable is on a machine nobody has, which is
// when it is also too late. So the property is asserted where it is decidable:
// the values a branch would have to compare.
//
// THE SCAN IS SCOPED TO THE NEUTRAL MODULES, and the scope is the point. The
// vendor's own spellings live in the adapter layer by design (spec §13) — so
// `claude-code-adapter.ts` naming `mcp__peaks__*` is correct, while the same
// string in the server would be a defect. These cases hold every module that is
// supposed to be vendor-free to that rule.
//
// Dimensions covered: render, behavior, integration, a11y.
// Omitted: none — a source scan is the behaviour, and the failure text is the a11y.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/mcp/mcp-vendor-neutrality.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Modules that must carry no vendor or platform spelling. */
const NEUTRAL_MODULES = [
  'src/services/mcp/json-rpc.ts',
  'src/services/mcp/cli-executor.ts',
  'src/services/mcp/surface.ts',
  'src/services/mcp/tools.ts',
  'src/services/mcp/tool-core.ts',
  'src/services/mcp/memory-tool.ts',
  'src/services/mcp/server.ts',
  'src/services/mcp/server-main.ts',
  'src/services/ide/mcp-tool-matcher.ts',
  'src/services/hooks/mcp-surface-gate.ts',
  'src/cli/commands/mcp-commands.ts'
];

/** Every module under the MCP root, so a new file cannot quietly escape the rule. */
function mcpRootModules(): string[] {
  const dir = join(REPO_ROOT, 'src', 'services', 'mcp');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `src/services/mcp/${name}`);
}

/**
 * The spellings a platform or harness branch would have to name. Quoted, so a
 * neutral IDENTIFIER that merely mentions a harness (the shared
 * `parseClaudeShapeStdin` the existing interceptor already uses) is not a hit —
 * what is forbidden is a decision keyed on one of these.
 */
const FORBIDDEN_VALUES = [
  "'win32'",
  "'darwin'",
  "'linux'",
  "'powershell'",
  "'claude-code'",
  "'codex'",
  "'cursor'",
  "'trae'",
  "'qoder'",
  "'tongyi-lingma'",
  "'hermes'",
  "'openclaw'",
  "'zcode'",
  'process.platform'
];

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

describe('Scenario: behavior - no module decides anything by platform', () => {
  it('when every neutral module is scanned, should name no platform value', () => {
    // given: the modules that must work the same everywhere
    // when:  each is scanned for a platform spelling a branch would compare
    // then:  none appears - the launch shape resolves an interpreter and an entry
    //        path instead, which needs no branch at all
    const platformOnly = FORBIDDEN_VALUES.slice(0, 4);
    for (const file of NEUTRAL_MODULES) {
      const source = read(file);
      for (const value of platformOnly) {
        expect(source.includes(value), `${file} names ${value}`).toBe(false);
      }
    }
  });

  it('when every neutral module is scanned, should name no harness', () => {
    // given: the same modules
    // when:  each is scanned for a harness id
    // then:  none appears - a harness is a string the ADAPTER returns, never one
    //        the server or the interceptor compares against
    const harnessOnly = FORBIDDEN_VALUES.slice(4);
    for (const file of NEUTRAL_MODULES) {
      const source = read(file);
      for (const value of harnessOnly) {
        expect(source.includes(value), `${file} names ${value}`).toBe(false);
      }
    }
  });
});

describe('Scenario: integration - the rule covers the whole MCP root', () => {
  it('when the MCP root is walked, should scan every module it contains', () => {
    // given: the files on disk
    const onDisk = mcpRootModules();
    // when:  they are compared with the declared list
    // then:  the list is the directory - a new file cannot opt out of the rule by
    //        not being listed, and the walk is not empty
    expect(onDisk.length).toBeGreaterThan(3);
    expect([...onDisk].sort()).toEqual(
      NEUTRAL_MODULES.filter((file) => file.startsWith('src/services/mcp/')).sort()
    );
  });
});

describe('Scenario: render - the scan can fail', () => {
  it('when a neutral module is given a platform literal, should report it', () => {
    // given: the control - the same predicate over text that DOES name one
    const planted = "if (process.platform === 'win32') { launch = shim; }";
    // when:  the forbidden values are looked for
    const found = FORBIDDEN_VALUES.filter((value) => planted.includes(value));
    // then:  the scan is not a scan that reports nothing
    expect(found).toEqual(["'win32'", 'process.platform']);
  });
});

describe('Scenario: a11y - the rule is stated where a reader will meet it', () => {
  it('when the launch shape is read, should say why there is no branch', () => {
    // given: the executor, which is where a platform branch would live
    const source = read('src/services/mcp/cli-executor.ts');
    // when:  its header is read
    // then:  the reason is written down, so the next reader does not "fix" the
    //        missing branch by adding one
    expect(source).toMatch(/NO SHELL, NO PLATFORM BRANCH/i);
    expect(source).toContain('process.execPath');
  });
});
