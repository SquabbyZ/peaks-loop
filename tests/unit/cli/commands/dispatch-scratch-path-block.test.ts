// tests/unit/cli/commands/dispatch-scratch-path-block.test.ts
//
// The scratch-path block: the ABSOLUTE directory a dispatched sub-agent
// writes its temporary files to, machine-injected into every dispatch prompt.
//
// The rule it carries — "a leaf's scratch must not depend on the cwd it
// happens to be in" — used to live only in an orchestrator's brief. Measured
// 2026-10-02: five zero-byte `*.err` captures (the `2> name.err` of five
// per-file test runs) landed at the repository root and were committed;
// `git status` stayed clean because the files were tracked, and neither the
// file-size census nor eslint reads a `.err`. This file pins the executor
// that replaced the ritual, on the same three layers the Karpathy block is
// pinned on: the emitted path, the delivery into the composed prompt, and the
// byte-equality of the human-facing copy with the machine copy.
//
// Dimensions covered:
//   - render:      the block's own shape (heading, path line, the rule)
//   - behavior:    the path resolution, the cwd-independence, the directory
//   - integration: the composed dispatch prompt carries the block, for every
//                  role; the reference file's fenced block is byte-equal to
//                  the machine copy
//   - a11y:        the block is text a sub-agent READS — the obligation must
//                  be legible, and the path must be directly usable
//
// WHY THE DISPATCH ARMS CARRY AN EXPLICIT TIMEOUT. A dispatch runs a REAL
// codegraph init + index over the scratch project, so its cost is process
// work, not in-process work — the global 30 s `testTimeout` is a HANG
// detector, not a budget for that class. Measured 2026-10-23: one arm timed
// out at 30 014 ms under full-suite load while the file passed 16/16 in 14 s
// in isolation. The arms therefore carry the repository's own subprocess
// budget (tests/unit/_setup/subprocess-timeouts.ts) instead of inheriting the
// default.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';
import { registerSubAgentCommands } from '../../../../src/cli/commands/sub-agent-commands.js';
import {
  SCRATCH_DIR_PLACEHOLDER,
  SCRATCH_PATH_BLOCK_HEADING,
  SCRATCH_PATH_BLOCK_TEMPLATE,
  buildScratchPathBlock,
  buildScratchPathInjection,
  ensureScratchDir,
  resolveScratchDir,
  toShellPath
} from '../../../../src/cli/commands/dispatch-scratch-path-block.js';

declareDimensions('tests/unit/cli/commands/dispatch-scratch-path-block.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SESSION_ID = '2026-10-23-session-rd231';
const ROLES = ['rd', 'qa', 'sc', 'txt', 'ui', 'prd'] as const;

/** The path line the block carries — the absolute directory, verbatim. */
function scratchPathFromBlock(block: string): string {
  const marker = 'Write every temporary file for this task under this ABSOLUTE path:\n';
  const start = block.indexOf(marker);
  expect(start, 'the block must carry the path marker').toBeGreaterThanOrEqual(0);
  const rest = block.slice(start + marker.length);
  const end = rest.indexOf('\n');
  return rest.slice(0, end === -1 ? rest.length : end);
}

let project: string;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'rd231-scratch-block-'));
  exitBefore = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the temp dir; it is reapable either way.
  }
});

/**
 * Runs the real `peaks sub-agent dispatch` action in-process and returns the
 * prompt the sub-agent would receive (`toolCall.args.prompt`) plus the
 * envelope's warnings.
 */
async function runDispatch(
  role: string,
  extraArgs: readonly string[] = []
): Promise<{ readonly prompt: string; readonly warnings: readonly string[] }> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerSubAgentCommands(program, io);
  await program.parseAsync(
    [
      'sub-agent',
      'dispatch',
      role,
      '--prompt',
      'rd231 probe — the scratch path block',
      '--request-id',
      'rid-rd231-probe',
      '--session-id',
      SESSION_ID,
      '--project',
      project,
      ...extraArgs,
      '--json'
    ],
    { from: 'user' }
  );
  const envelope = JSON.parse(captured.text()) as {
    data: { toolCall: { args: { prompt: string } } };
    warnings: string[];
  };
  return { prompt: envelope.data.toolCall.args.prompt, warnings: envelope.warnings };
}

describe('Scenario: render — the block carries the path and the rule', () => {
  it('when the block is rendered, should carry its heading, the path line and the prohibition', () => {
    // given: the block for one absolute scratch directory
    // when:  the block is built and read
    // then:  it names the directory, and it forbids the cwd-relative form
    const block = buildScratchPathBlock('/tmp/project/.peaks/_runtime/sid/rd/scratch');
    expect(block).toContain(SCRATCH_PATH_BLOCK_HEADING);
    expect(scratchPathFromBlock(block)).toBe('/tmp/project/.peaks/_runtime/sid/rd/scratch');
    expect(block).toContain('Never redirect to a path that depends on the working directory');
    expect(block).toContain('2> out.err');
  });

  it('when the path is rendered, should spell it with forward slashes for every shell', () => {
    // given: a Windows-shaped path with backslashes
    // when:  the block is built and its path line read
    // then:  the line uses forward slashes — a backslash is an escape
    //        sequence to a POSIX shell, where `> D:\repo\x.log` writes a file
    //        named `D:repox.log` into the CURRENT directory
    const native = 'D:\\projects\\peaks-loop\\.peaks\\_runtime\\sid\\rd\\scratch';
    const block = buildScratchPathBlock(native);
    expect(scratchPathFromBlock(block)).toBe(
      'D:/projects/peaks-loop/.peaks/_runtime/sid/rd/scratch'
    );
    expect(scratchPathFromBlock(block)).not.toContain('\\');
  });
});

describe('Scenario: behavior — the path is absolute and cwd-independent', () => {
  it('when the scratch dir is resolved, should land under the session runtime dir for that role', () => {
    // given: a project root, a session id and a role
    // when:  the scratch directory is resolved
    // then:  it is the session's own runtime dir, per role
    const root = resolve(repoRoot);
    const dir = resolveScratchDir(root, SESSION_ID, 'rd');
    expect(dir).toBe(join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'scratch'));
    expect(dir).toContain(join('.peaks', '_runtime', SESSION_ID));
  });

  it('when the scratch dir is resolved, should be an absolute path', () => {
    // given: an absolute project root
    // when:  the scratch directory is resolved and rendered
    // then:  both spellings are absolute — a relative one is the defect
    const root = resolve(repoRoot);
    const dir = resolveScratchDir(root, SESSION_ID, 'qa');
    const rendered = scratchPathFromBlock(buildScratchPathBlock(dir));
    expect(isAbsolute(dir)).toBe(true);
    expect(isAbsolute(rendered)).toBe(true);
  });

  it('when the builder runs from two different working directories, should emit the same path', () => {
    // given: one absolute project root and two working directories
    // when:  the builder is driven from each working directory
    // then:  the emitted path does not depend on the cwd
    const root = resolve(repoRoot);
    const cwdBefore = process.cwd();
    const first = mkdtempSync(join(tmpdir(), 'rd231-cwd-a-'));
    const second = mkdtempSync(join(tmpdir(), 'rd231-cwd-b-'));
    let fromFirst = '';
    let fromSecond = '';
    try {
      process.chdir(first);
      fromFirst = buildScratchPathBlock(resolveScratchDir(root, SESSION_ID, 'rd'));
      process.chdir(second);
      fromSecond = buildScratchPathBlock(resolveScratchDir(root, SESSION_ID, 'rd'));
    } finally {
      process.chdir(cwdBefore);
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
    expect(fromFirst).toBe(fromSecond);
    expect(scratchPathFromBlock(fromFirst)).toBe(
      toShellPath(join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'scratch'))
    );
  });

  it('when the role is not a single safe path segment, should fall back instead of escaping the runtime dir', () => {
    // given: a role that would walk out of the session dir
    // when:  the scratch directory is resolved
    // then:  it stays under the session dir, on a sentinel segment
    const root = resolve(repoRoot);
    const dir = resolveScratchDir(root, SESSION_ID, '../../escape');
    expect(dir).toBe(join(root, '.peaks', '_runtime', SESSION_ID, 'unknown-role', 'scratch'));
  });

  it('when the session id is not a single safe path segment, should fall back to the unbound sentinel', () => {
    // given: a session id that would walk out of the runtime dir
    // when:  the scratch directory is resolved
    // then:  it stays under the runtime dir
    const root = resolve(repoRoot);
    const dir = resolveScratchDir(root, '../../escape', 'rd');
    expect(dir).toBe(join(root, '.peaks', '_runtime', 'unknown-sid', 'rd', 'scratch'));
  });

  it('when the scratch directory is created, should exist on disk afterwards', () => {
    // given: a scratch directory that does not exist yet
    // when:  it is created
    // then:  it exists and the outcome says so
    const dir = join(project, '.peaks', '_runtime', SESSION_ID, 'rd', 'scratch');
    expect(existsSync(dir)).toBe(false);
    const state = ensureScratchDir(dir);
    expect(state.ok).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it('when the scratch directory cannot be created, should report the reason instead of hiding it', () => {
    // given: a FILE where the role's directory belongs, so the scratch
    //        directory below it cannot be created
    // when:  the injection is built
    // then:  the warning names the failure, so the caller can surface it
    const roleDir = join(project, '.peaks', '_runtime', SESSION_ID, 'rd');
    mkdirSync(dirname(roleDir), { recursive: true });
    writeFileSync(roleDir, 'not a directory', 'utf8');
    const injection = buildScratchPathInjection({
      projectRoot: project,
      sid: SESSION_ID,
      role: 'rd'
    });
    expect(injection.warning).not.toBeNull();
    expect(injection.warning).toContain('scratch directory could not be created');
    // the block is still delivered — a missing directory does not remove the
    // rule, it makes it urgent
    expect(injection.block).toContain(SCRATCH_PATH_BLOCK_HEADING);
  });
});

describe('Scenario: integration — the composed dispatch prompt carries the block', () => {
  it(
    'when a dispatch is composed, should carry the block with the absolute scratch path',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a real dispatch for the rd role
      // when:  the action runs end to end
      // then:  the prompt carries the block, naming THIS session's directory
      const { prompt } = await runDispatch('rd');
      expect(prompt).toContain(SCRATCH_PATH_BLOCK_HEADING);
      const rendered = scratchPathFromBlock(prompt);
      expect(rendered).toBe(
        toShellPath(join(project, '.peaks', '_runtime', SESSION_ID, 'rd', 'scratch'))
      );
      expect(isAbsolute(rendered)).toBe(true);
    }
  );

  it(
    'when a dispatch is composed for any role, should carry the block for that role',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: the roles a dispatch can name
      // when:  the action runs end to end for each of them
      // then:  the block is present and names that role's directory
      for (const role of ROLES) {
        const { prompt } = await runDispatch(role);
        expect(prompt, `role ${role} must carry the block`).toContain(SCRATCH_PATH_BLOCK_HEADING);
        expect(scratchPathFromBlock(prompt)).toBe(
          toShellPath(join(project, '.peaks', '_runtime', SESSION_ID, role, 'scratch'))
        );
      }
    }
  );

  it(
    'when a dispatch is composed, should carry the block alongside the other injected blocks',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a real dispatch for the qa role
      // when:  the action runs end to end
      // then:  the scratch block and the Karpathy block coexist — one does not
      //        displace the other
      const { prompt } = await runDispatch('qa');
      expect(prompt).toContain(SCRATCH_PATH_BLOCK_HEADING);
      expect(prompt).toContain('Karpathy-guidelines context');
    }
  );

  it(
    'when a dispatch is composed, should create the scratch directory it names',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a real dispatch for the sc role
      // when:  the action runs end to end
      // then:  the named directory exists, so the first redirect into it works
      await runDispatch('sc');
      expect(existsSync(join(project, '.peaks', '_runtime', SESSION_ID, 'sc', 'scratch'))).toBe(
        true
      );
    }
  );
});

describe('Scenario: integration — the machine copy cannot drift from the reference', () => {
  const referencePath = join(
    repoRoot,
    'skills',
    'bee',
    'peaks-rd',
    'references',
    'rd-sub-agent-dispatch.md'
  );

  it('when the reference file and the constant are compared, should be byte-equal', () => {
    // given: the canonical human-facing block, fenced in the RD dispatch
    //        reference's scratch-path section
    // when:  it is compared with the constant the dispatch composer injects
    // then:  the two are the same bytes, so the machine copy cannot drift
    const reference = readFileSync(referencePath, 'utf8');
    const heading = '## Scratch path (absolute';
    const start = reference.indexOf(heading);
    expect(start, `the reference must carry ${heading}`).toBeGreaterThanOrEqual(0);
    const section = reference.slice(start);
    const fenced = /```\n([\s\S]*?)\n```/.exec(section);
    expect(fenced, 'the reference must still carry a fenced block').not.toBeNull();
    const referenceBlock = `${fenced?.[1] ?? ''}\n`;
    expect(referenceBlock).toBe(SCRATCH_PATH_BLOCK_TEMPLATE);
  });

  it('when the reference block is changed, should stop being byte-equal to the constant', () => {
    // given: the reference block with one word changed — the mutation the
    //        equality assertion above must be able to see
    // when:  it is compared with the constant
    // then:  the comparison fails — the pin is not vacuous
    const reference = readFileSync(referencePath, 'utf8');
    const heading = '## Scratch path (absolute';
    const section = reference.slice(reference.indexOf(heading));
    const fenced = /```\n([\s\S]*?)\n```/.exec(section);
    const mutated = `${fenced?.[1] ?? ''}\n`.replace(
      'never a cwd-relative redirect',
      'never a relative redirect'
    );
    expect(mutated).not.toBe(SCRATCH_PATH_BLOCK_TEMPLATE);
  });
});

describe('Scenario: a11y — the block is text the sub-agent reads', () => {
  it('when the block is rendered, should state the rule in a sentence a reader can act on', () => {
    // given: the block for one dispatch
    // when:  the reader-facing sentences are read
    // then:  the obligation and the destination are both legible, and the
    //        destination is a path the reader can use as it stands
    const block = buildScratchPathBlock('/tmp/project/.peaks/_runtime/sid/rd/scratch');
    expect(block).toContain('Never redirect to a path that depends on the working directory');
    expect(block).toContain('Write every temporary file for this task under this ABSOLUTE path:');
    expect(scratchPathFromBlock(block)).toBe('/tmp/project/.peaks/_runtime/sid/rd/scratch');
    // the placeholder never survives into a rendered block
    expect(block).not.toContain(SCRATCH_DIR_PLACEHOLDER);
  });
});
