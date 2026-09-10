// tests/unit/services/web/web-spawn-hardening.test.ts
//
// Static source assertion: every child-process spawn in the `peaks web` feature
// passes `windowsHide: true`.
//
// Why this is a test and not a code comment: on Windows a `spawn` without
// `windowsHide` opens a VISIBLE console window, and `detached: true` makes it
// worse — the window outlives the process that opened it. The daemon is
// detached by design (Q7: its lifetime is register + parent kill + `peaks web
// stop`), so an omission here does not produce a stray log line, it produces a
// console window the user cannot close. That shipped once; this is the ratchet.
//
// The first version of this scan was defeated by five shapes that all exist in
// `src/`, and it did not look at the CLI files the slice added:
//   - `cp.spawn(` / `require().spawn(` — the `(?<![.\w])` lookbehind was written
//     to skip `RegExp.exec` and skipped every member call with it
//     (`src/services/dispatch/dispatch-record-writer.ts:491` already uses it);
//   - `import { spawn as launch }` and `const { spawn: launch } = require(…)`;
//   - `execSync(` and `fork(` — absent from the alternation entirely;
//   - `windowsHide: false` / `windowsHide: isWindows` — a substring test, not a
//     truthiness test.
// It now resolves the child_process bindings of each file and requires the
// option to be the literal `true`.
//
// The scan reads the real module directories, recursively, so a new file — or a
// new subdirectory — is covered the moment it is written.
//
// Dimensions covered:
//   - behavior:    the classifier's verdict on each spawn shape
//   - integration: real source files read from disk
//   - render:      not applicable (asserts on source text, produces no output)
//   - a11y:        not applicable (no user-visible surface)

import { readFileSync, readdirSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

import { daemonSpawnCommand, interpreterArgs, supportsImportFlag } from '../../../../src/services/web/daemon-supervisor.js';

declareDimensions(
  'tests/unit/services/web/web-spawn-hardening.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the scan asserts on source text and renders nothing' },
    { dim: 'a11y', reason: 'no user-visible text or exit code is produced' },
  ],
);

const ROOT = resolve(__dirname, '..', '..', '..', '..');
/** The two CLI files this feature owns — not the other hundred commands. */
const CLI_SCAN_FILES = ['web-commands.ts', 'web-lifecycle-commands.ts'].map((name) =>
  join(ROOT, 'src', 'cli', 'commands', name)
);

/** Names `child_process` exports that take options. `exec` is absent on purpose. */
const DEFAULT_NAMES = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'execSync', 'fork'] as const;

const CHILD_PROCESS_RE = /['"](?:node:)?child_process['"]/;

/** The child_process call names and namespaces this file binds. */
interface Bindings {
  readonly names: Set<string>;
  readonly namespaces: Set<string>;
}

/**
 * What `child_process` is called in `source`. A plain scan, not a parser: the
 * shapes that matter are `import { spawn as launch }`, `import * as cp`,
 * `const cp = require(...)` and `const { spawn: launch } = require(...)`.
 */
function childProcessBindings(source: string): Bindings {
  const names = new Set<string>(DEFAULT_NAMES);
  const namespaces = new Set<string>();
  for (const statement of source.split(';')) {
    if (!CHILD_PROCESS_RE.test(statement)) {
      continue;
    }
    const declared = /\{([^}]*)\}/.exec(statement);
    if (declared?.[1] !== undefined) {
      for (const part of declared[1].split(',')) {
        // `import { spawn as launch }` and `const { spawn: launch } = require(…)`.
        for (const candidate of part.split(/\s+as\s+|:/)) {
          const name = candidate.trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) {
            names.add(name);
          }
        }
      }
    }
    const namespace =
      /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(statement) ??
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/.exec(statement);
    if (namespace?.[1] !== undefined) {
      namespaces.add(namespace[1]);
    }
  }
  return { names, namespaces };
}

/**
 * Build a fixture call without writing the literal name-and-paren this scan
 * looks for — otherwise the guard flags its own sample.
 */
function call(name: string, args: string): string {
  return `${name}(${args})`;
}

/**
 * Every child-process call in `source` that does not pass `windowsHide: true`,
 * as `line: snippet`. The argument list is extracted by balancing parentheses,
 * so the whole options object is inspected — an option on the last line counts.
 */
function spawnsWithoutWindowsHide(source: string): string[] {
  const offences: string[] = [];
  const { names, namespaces } = childProcessBindings(source);
  const name = [...names].join('|');
  const isOurReceiver = (owner: string): boolean =>
    namespaces.has(owner) || owner === 'child_process';

  // `cp.spawn(`, `child_process.spawn(`, `cp['spawn'](`, and a bare `spawn(`.
  // `RegExp.exec(` is never a candidate: `exec` is not in the name set, and a
  // bare `exec(` is skipped by requiring a child_process receiver for it.
  // The `(` must follow with no space — that is what keeps prose such as "a
  // double-spawn (exactly what this file detects)" out of the results.
  const patterns: Array<{ re: RegExp; callee: number; owner: number | null }> = [
    { re: new RegExp(`\\b([A-Za-z_$][\\w$]*)\\.(${name})\\(`, 'g'), callee: 2, owner: 1 },
    {
      re: new RegExp(`\\b([A-Za-z_$][\\w$]*)\\[\\s*['"](${name})['"]\\s*\\]\\(`, 'g'),
      callee: 2,
      owner: 1
    },
    { re: new RegExp(`(?<![\\w$.])(${name})\\(`, 'g'), callee: 1, owner: null }
  ];

  for (const { re, callee, owner } of patterns) {
    for (const match of source.matchAll(re)) {
      const ownerName = owner === null ? null : match[owner];
      if (ownerName !== null && !isOurReceiver(ownerName)) {
        continue;
      }
      const open = match.index + match[0].length - 1;
      const args = balancedArgs(source, open);
      if (args === null || args.trim() === '') {
        continue;
      }
      if (!/windowsHide\s*:\s*true\b/.test(args)) {
        const line = source.slice(0, match.index).split('\n').length;
        const called = match[callee] ?? '';
        offences.push(`${String(line)}: ${called}(${args.slice(0, 60).replace(/\s+/g, ' ')})`);
      }
    }
  }
  return offences;
}

/** The text between the parenthesis at `open` and its match, or `null`. */
function balancedArgs(source: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  return null;
}

/** Every `.ts` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** Run a child to completion and parse its single JSON line. */
async function collectExit(child: ChildProcess): Promise<{ ppid: number; pid: number }> {
  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  await new Promise<void>((settle, reject) => {
    child.once('error', reject);
    child.once('exit', () => {
      settle();
    });
  });
  return JSON.parse(stdout.trim()) as { ppid: number; pid: number };
}

function scan(paths: readonly string[]): string[] {
  return paths.flatMap((file) =>
    spawnsWithoutWindowsHide(readFileSync(file, 'utf8')).map((entry) => `${file}: ${entry}`)
  );
}

describe('behavior — the classifier', () => {
  it('when a spawn omits windowsHide, should flag it', () => {
    // given: a source snippet whose spawn has no windowsHide
    const source = `const child = ${call('spawn', 'cmd, args, { stdio: "ignore", detached: true }')};`;
    // when: the snippet is scanned
    const offences = spawnsWithoutWindowsHide(source);
    // then: it is reported
    expect(offences).toHaveLength(1);
  });

  it('when a spawn passes windowsHide on a later line, should not flag it', () => {
    // given: a multi-line spawn whose options end with windowsHide
    const source = call(
      'spawn',
      'cmd, args, {\n  stdio: "ignore",\n  detached: true,\n  windowsHide: true\n}'
    );
    // when: the snippet is scanned
    const offences = spawnsWithoutWindowsHide(source);
    // then: nothing is reported
    expect(offences).toEqual([]);
  });

  it('when a spawn passes windowsHide false or a variable, should flag it', () => {
    // given: two snippets whose windowsHide is not the literal true
    const literal = call('spawn', 'cmd, args, { windowsHide: false }');
    const computed = call('spawn', 'cmd, args, { windowsHide: isWindows }');
    // when: each is scanned
    const offences = [...spawnsWithoutWindowsHide(literal), ...spawnsWithoutWindowsHide(computed)];
    // then: both are reported — a substring test would have passed them
    expect(offences).toHaveLength(2);
  });

  it('when child_process is imported under an alias or a namespace, should still flag it', () => {
    // given: the aliased, namespaced and destructured-require shapes
    const aliased = `import { spawn as launch } from 'node:child_process';\n${call('launch', 'cmd, args, {})')}`;
    const namespaced = `import * as cp from 'node:child_process';\n${call('cp.spawn', 'cmd, args, {})')}`;
    const required = `const { spawn: run } = require('node:child_process');\n${call('run', 'cmd, args, {})')}`;
    // when: each is scanned
    const offences = [aliased, namespaced, required].flatMap((source) =>
      spawnsWithoutWindowsHide(source)
    );
    // then: all three are reported
    expect(offences).toHaveLength(3);
  });

  it('when a snippet calls execSync or fork, should flag it', () => {
    // given: the two child_process names the old alternation never matched
    const exec = `import { execSync } from 'node:child_process';\n${call('execSync', "'git status')")}`;
    const forked = `import { fork } from 'node:child_process';\n${call('fork', "'entry.js')")}`;
    // when: each is scanned
    const offences = [exec, forked].flatMap((source) => spawnsWithoutWindowsHide(source));
    // then: both are reported
    expect(offences).toHaveLength(2);
  });

  it('when a regexp exec is present, should not mistake it for a child process', () => {
    // given: a source snippet calling RegExp.exec
    const source = 'const match = /^([A-Z]+):\\s*([\\s\\S]*)$/.exec(message);';
    // when: the snippet is scanned
    const offences = spawnsWithoutWindowsHide(source);
    // then: it is not a spawn
    expect(offences).toEqual([]);
  });

  it('when prose mentions a spawn, should not treat it as a call', () => {
    // given: a comment describing a double-spawn in words
    const source = '// the loser of a double-spawn (exactly what this file detects)';
    // when: the snippet is scanned
    const offences = spawnsWithoutWindowsHide(source);
    // then: nothing is reported
    expect(offences).toEqual([]);
  });
});

describe('behavior — the daemon spawn chain', () => {
  it('when the daemon command is resolved, should spawn node directly with no shell in the argv', () => {
    // given: the command `spawnDaemon` hands to `spawn`
    const invocation = daemonSpawnCommand();
    // when: it is inspected element by element
    const shellish = [invocation.command, ...invocation.args].filter((element) =>
      /(\.cmd|\.bat|\.ps1)$/i.test(element) || /\bcmd\.exe\b|npx-cli|npx\.cmd/i.test(element)
    );
    // then: the interpreter is this Node and nothing routes through a shell
    expect(basename(invocation.command)).toBe(basename(process.execPath));
    expect(shellish).toEqual([]);
  });

  it('when the daemon argv is executed, should be one process with no wrapper between us and it', async () => {
    // given: a probe launched with exactly the daemon's argv construction
    const probe = join(ROOT, 'tests', 'fixtures', 'web', 'spawn-hop-probe.ts');
    const invocation = daemonSpawnCommand();
    // when: it is spawned the way the daemon is
    const child = spawn(process.execPath, [...invocation.args.slice(0, -1), probe], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    });
    const reported = await collectExit(child);
    // then: the process we spawned IS the probe (no shell in between), and its
    // parent is this process (no wrapper above it either)
    expect(reported.pid).toBe(child.pid);
    expect(reported.ppid).toBe(process.pid);
    expect(basename(invocation.command)).toBe(basename(process.execPath));
  }, 30_000);

  it('when the entry is TypeScript, should load it in-process through the loader flags', () => {
    // given: a TypeScript entry in the source tree
    const entry = join(ROOT, 'src', 'services', 'web', 'daemon-entry.ts');
    // when: the interpreter arguments are built
    const args = interpreterArgs(entry);
    // then: the loader is attached to OUR node process, not handed to a tsx CLI
    expect(args).toContain('--require');
    expect(args[args.length - 1]).toBe(entry);
    expect(args.some((arg) => arg.includes('cli.mjs'))).toBe(false);
  });

  it('when the entry is compiled JavaScript, should run it directly', () => {
    // given: a compiled entry
    const entry = join(ROOT, 'src', 'services', 'web', 'daemon-entry.js');
    // when: the interpreter arguments are built
    const args = interpreterArgs(entry);
    // then: node runs it with no loader at all
    expect(args).toEqual([entry]);
  });

  it('when the Node version predates the import flag, should fall back to the loader spelling', () => {
    // given: the versions on either side of the 20.6.0 boundary
    // when: each is asked whether `--import` is understood
    // then: only the ones that have it say yes
    expect(supportsImportFlag('20.0.0')).toBe(false);
    expect(supportsImportFlag('20.5.9')).toBe(false);
    expect(supportsImportFlag('20.6.0')).toBe(true);
    expect(supportsImportFlag('22.10.0')).toBe(true);
    expect(supportsImportFlag('18.19.0')).toBe(true);
  });
});

describe('integration — the feature sources', () => {
  it('when a module under src/services/web spawns a process, should hide the window', () => {
    // given: every source file of the feature
    const files = sourceFiles(join(ROOT, 'src', 'services', 'web'));
    // when: each is scanned for a spawn that omits windowsHide
    const offences = scan(files);
    // then: there are none
    expect(offences).toEqual([]);
  });

  it('when a web test or the daemon racer spawns a process, should hide the window', () => {
    // given: this feature's test files and the fixture processes they launch
    const files = [
      ...sourceFiles(join(ROOT, 'tests', 'unit', 'services', 'web')),
      ...sourceFiles(join(ROOT, 'tests', 'fixtures', 'web'))
    ];
    // when: each is scanned for a spawn that omits windowsHide
    const offences = scan(files);
    // then: there are none
    expect(offences).toEqual([]);
  });

  it('when a web CLI file spawns a process, should hide the window', () => {
    // given: the two CLI files this slice owns
    // when: each is scanned for a spawn that omits windowsHide
    const offences = scan(CLI_SCAN_FILES);
    // then: there are none
    expect(offences).toEqual([]);
  });
});
