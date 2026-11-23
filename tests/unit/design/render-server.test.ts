import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/design/render-server.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import { probeRenderUrl } from '../../../src/services/design/render-url.js';
import {
  startRenderServer,
  type RenderServerHandle
} from '../../../src/services/design/render-server.js';

const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-render-server-'));
const serverScript = join(projectRoot, 'server.mjs');
const idleScript = join(projectRoot, 'idle.mjs');
const exitScript = join(projectRoot, 'exit.mjs');

/** Every handle the tests started, so a failing test still reaps its child. */
const handles: RenderServerHandle[] = [];

/** Every child pid the tests learned about from a pid file. */
const pids: number[] = [];

/** A token shape a start command could inline; failure text must never echo it. */
const SECRET_TOKEN = 'sk-live-DO-NOT-PRINT';

beforeAll(() => {
  writeFileSync(
    serverScript,
    [
      "import { createServer } from 'node:http';",
      "import { writeFileSync } from 'node:fs';",
      'const [portArg, pidFile] = process.argv.slice(2);',
      'writeFileSync(pidFile, String(process.pid));',
      'const server = createServer((_request, response) => {',
      "  response.writeHead(200, { 'content-type': 'text/html' });",
      "  response.end('<html><body>ok</body></html>');",
      '});',
      "server.listen(Number(portArg), '127.0.0.1');"
    ].join('\n')
  );
  writeFileSync(
    idleScript,
    [
      "import { writeFileSync } from 'node:fs';",
      'const [pidFile] = process.argv.slice(2);',
      'writeFileSync(pidFile, String(process.pid));',
      'setInterval(() => {}, 1000);'
    ].join('\n')
  );
  writeFileSync(exitScript, 'process.exit(7);\n');
});

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.stop();
  }
  for (const pid of pids.splice(0)) {
    await killPid(pid);
  }
});

// The tmp dir is created once per file and removed when the file's tests finish.
afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/** Build a shell command line the way a project's `startCommand` would look. */
function nodeCommand(script: string, ...args: string[]): string {
  return [process.execPath, script, ...args].map((part) => `"${part}"`).join(' ');
}

/** An OS-chosen port (port 0), released before the child claims it. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((settle, fail) => {
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (typeof address === 'object' && address !== null) {
        settle(address.port);
      } else {
        fail(new Error('probe has no port'));
      }
    });
  });
  await new Promise<void>((settle) => {
    probe.close(() => {
      settle();
    });
  });
  return port;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killPid(pid: number): Promise<void> {
  if (!isAlive(pid)) return;
  if (process.platform === 'win32') {
    await new Promise<void>((settle) => {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => {
        settle();
      });
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // It exited between the probe and the signal.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((settle) => {
    setTimeout(settle, ms);
  });
}

/** Poll a predicate until it holds, or fail with the last observed state. */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error('condition was not met before the timeout');
}

/** Read the pid a fixture script wrote, once the script has started. */
async function readPid(pidFile: string): Promise<number> {
  await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
  return Number(readFileSync(pidFile, 'utf8').trim());
}

describe('Scenario: render — the ready server record', () => {
  it(
    'when the command starts listening, should return the url and a stop function',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a real HTTP server script and an OS-chosen port
      // when: the server starts and is probed ready
      // then: the record names the same URL and exposes stop
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const pidFile = join(projectRoot, 'render-shape.pid');
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: nodeCommand(serverScript, String(port), pidFile),
        url,
        timeoutMs: 10_000
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      handles.push(result.server);
      pids.push(await readPid(pidFile));
      expect(result.server.url).toBe(url);
      expect(typeof result.server.stop).toBe('function');
      await result.server.stop();
    }
  );
});

describe('Scenario: behavior — start failures are classified, not thrown', () => {
  it(
    'when the command never listens, should time out with DESIGN_RENDER_UNREACHABLE',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a command that stays alive without binding the URL
      // when: the start budget elapses
      // then: the failure names unreachability and the child is reaped
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const pidFile = join(projectRoot, 'never-listens.pid');
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: `${nodeCommand(idleScript, pidFile)} --token ${SECRET_TOKEN}`,
        url,
        timeoutMs: 800
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the start to time out');
      expect(result.code).toBe('DESIGN_RENDER_UNREACHABLE');
      expect(result.message).toContain(url);
      expect(result.message).toContain('800ms');
      expect(result.message).toContain(process.execPath);
      expect(result.message).not.toContain(SECRET_TOKEN);
      const pid = await readPid(pidFile);
      pids.push(pid);
      expect(isAlive(pid)).toBe(false);
      expect(await probeRenderUrl(url, 500)).toBe(false);
    }
  );

  it(
    'when the command exits immediately, should report DESIGN_START_COMMAND_EXITED without waiting',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a command that exits nonzero before any listener exists
      // when: the start is attempted
      // then: the exit is classified, not waited out as a timeout
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const started = Date.now();
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: nodeCommand(exitScript),
        url,
        timeoutMs: 10_000
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the command exit to fail the start');
      expect(result.code).toBe('DESIGN_START_COMMAND_EXITED');
      expect(result.message).toContain('exit code 7');
      expect(Date.now() - started).toBeLessThan(5_000);
    }
  );

  it(
    'when a quoted program holds a space, should name the whole program and redact the rest',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: single- and double-quoted program words that contain a space
      // when: each command exits without listening
      // then: the message carries the unquoted program and never the arguments
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      for (const program of ["'my prog'", '"my prog"']) {
        const result = await startRenderServer({
          projectRoot,
          cwd: '.',
          command: `${program} --token ${SECRET_TOKEN}`,
          url,
          timeoutMs: 5_000
        });
        expect(result.ok, program).toBe(false);
        if (result.ok) throw new Error('expected the command to exit');
        expect(result.code).toBe('DESIGN_START_COMMAND_EXITED');
        expect(result.message).toContain('my prog (arguments redacted)');
        expect(result.message).not.toContain(SECRET_TOKEN);
      }
    }
  );

  it(
    'when the command is just spaces, should name it as an empty command',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a whitespace-only start command
      // when: it is started
      // then: the failure text names the empty command instead of a token
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: '   ',
        url,
        timeoutMs: 5_000
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the empty command to fail');
      expect(result.message).toContain('<empty command>');
    }
  );

  it(
    'when the program is a bare word, should name the whole word, not its first letter',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: an unquoted program word and an argument
      // when: the command exits without listening
      // then: the message carries the whole program and never the argument
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: 'nope-no-such-program --flag',
        url,
        timeoutMs: 5_000
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the command to exit');
      expect(result.message).toContain('nope-no-such-program (arguments redacted)');
      expect(result.message).not.toContain('--flag');
    }
  );

  it(
    'when the program word embeds a quote, should strip only the edge quotes',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a program token with an interior double quote and no edge quotes
      // when: the command exits without listening
      // then: the interior quote survives in the redacted program name
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: 'ab"cd --flag',
        url,
        timeoutMs: 5_000
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the command to exit');
      expect(result.message).toContain('ab"cd (arguments redacted)');
    }
  );

  it(
    'when the spawn fails outright, should classify the error without throwing',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a command whose working directory does not exist
      // when: the spawn errors before any process starts
      // then: the error is the exited classification, never a crash
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const result = await startRenderServer({
        projectRoot,
        cwd: 'no-such-dir',
        command: nodeCommand(exitScript),
        url,
        timeoutMs: 5_000
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the spawn to fail');
      expect(result.code).toBe('DESIGN_START_COMMAND_EXITED');
      expect(result.message).toContain('ENOENT');
    }
  );
});

describe('Scenario: integration — stop reaps the process tree', () => {
  it(
    'when stop is called, should close the port and leave no child alive',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a ready server whose child pid is recorded
      // when: stop resolves
      // then: the port is closed and the child process is gone
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const pidFile = join(projectRoot, 'stop-reaps.pid');
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: nodeCommand(serverScript, String(port), pidFile),
        url,
        timeoutMs: 10_000
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      handles.push(result.server);
      const pid = await readPid(pidFile);
      pids.push(pid);
      expect(await probeRenderUrl(url, 2_000)).toBe(true);
      await result.server.stop();
      await result.server.stop();
      await waitUntil(() => !isAlive(pid));
      await waitUntil(async () => !(await probeRenderUrl(url, 250)));
      expect(isAlive(pid)).toBe(false);
    }
  );
});

describe('Scenario: a11y — failure text names the URL and redacts the command', () => {
  it(
    'when the command exits at once, should name the URL and program but not the arguments',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: an exiting command whose arguments inline a secret-like token
      // when: the start fails
      // then: the URL and program are named and the secret never appears
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const result = await startRenderServer({
        projectRoot,
        cwd: '.',
        command: `${nodeCommand(exitScript)} --token ${SECRET_TOKEN}`,
        url,
        timeoutMs: 5_000
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the command exit to fail the start');
      expect(result.message).toContain(url);
      expect(result.message).toContain(process.execPath);
      expect(result.message).not.toContain(SECRET_TOKEN);
      expect(result.message).not.toContain(exitScript);
    }
  );
});
