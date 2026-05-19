#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { watch as nodeWatch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBundledSkills } from './install-skills.mjs';

export const WATCHED_INPUTS = ['src', 'schemas', 'skills'];
export const DEFAULT_BUILD_COMMAND = ['pnpm', ['run', 'build']];

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}

function isMissingPathError(error) {
  return getErrorCode(error) === 'ENOENT';
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;

    try {
      child = spawn(command, args, { stdio: 'inherit', ...options });
    } catch (error) {
      rejectPromise(error);
      return;
    }

    let settled = false;
    const settle = (handler, value) => {
      if (settled) {
        return;
      }

      settled = true;
      handler(value);
    };

    child.once('error', (error) => {
      if (options.signal?.aborted || isAbortError(error)) {
        const abortError = new Error(`${command} ${args.join(' ')} was aborted`);
        abortError.name = 'AbortError';
        settle(rejectPromise, abortError);
        return;
      }

      settle(rejectPromise, error);
    });

    child.once('close', (code, signal) => {
      if (code === 0) {
        settle(resolvePromise);
        return;
      }

      if (options.signal?.aborted || signal) {
        const abortError = new Error(`${command} ${args.join(' ')} was aborted`);
        abortError.name = 'AbortError';
        settle(rejectPromise, abortError);
        return;
      }

      settle(rejectPromise, new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

export async function collectDirectories(root) {
  const directories = [];
  const visited = new Set();

  async function visit(directory) {
    if (visited.has(directory)) {
      return;
    }

    visited.add(directory);

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }

    directories.push(directory);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      await visit(join(directory, entry.name));
    }
  }

  await visit(root);
  return directories;
}

export function createDirectoryTreeWatcher(root, options = {}) {
  const watch = options.watch ?? nodeWatch;
  const collect = options.collectDirectories ?? collectDirectories;
  const onChange = options.onChange ?? (() => {});
  const watchers = new Map();
  let refreshPromise = null;
  let refreshRequested = false;
  let isClosed = false;

  const syncWatchers = async () => {
    const directories = await collect(root);
    const nextDirectories = new Set(directories);

    for (const [directory, watcher] of watchers) {
      if (nextDirectories.has(directory)) {
        continue;
      }

      watcher.close();
      watchers.delete(directory);
    }

    for (const directory of directories) {
      if (watchers.has(directory)) {
        continue;
      }

      const watcher = watch(directory, () => {
        onChange();
        void requestRefresh();
      });
      watchers.set(directory, watcher);
    }
  };

  const requestRefresh = async () => {
    if (isClosed) {
      return;
    }

    refreshRequested = true;
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      do {
        refreshRequested = false;
        await syncWatchers();
      } while (refreshRequested && !isClosed);
    })();

    try {
      await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  };

  return {
    async start() {
      await requestRefresh();
    },
    async close() {
      isClosed = true;

      if (refreshPromise) {
        await refreshPromise.catch(() => undefined);
      }

      for (const watcher of watchers.values()) {
        watcher.close();
      }

      watchers.clear();
    }
  };
}

export async function rebuildOnce(options = {}) {
  const runner = options.runner ?? runCommand;
  const installer = options.installer ?? installBundledSkills;
  const [command, args] = options.command ?? DEFAULT_BUILD_COMMAND;

  await runner(command, args, options.runOptions);
  return installer(options.installOptions);
}

export function createWatchMode(options = {}) {
  const inputs = options.inputs ?? WATCHED_INPUTS;
  const createTreeWatcher = options.createTreeWatcher ?? createDirectoryTreeWatcher;
  const runner = options.runner ?? runCommand;
  const installer = options.installer ?? installBundledSkills;
  const collectDirectoriesFn = options.collectDirectories ?? collectDirectories;
  const watch = options.watch ?? nodeWatch;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const debounceMs = options.debounceMs ?? 150;
  const treeWatchers = [];
  let debounceTimer;
  let isBuilding = false;
  let hasQueuedRebuild = false;
  let isClosed = false;
  let currentAbortController = null;
  let currentBuildPromise = null;

  const writeStatus = (message) => stdout.write(`[peaks watch] ${message}\n`);
  const writeError = (message) => stderr.write(`[peaks watch] ${message}\n`);

  const rebuild = async (reason) => {
    if (isClosed) {
      return;
    }

    if (isBuilding) {
      hasQueuedRebuild = true;
      return currentBuildPromise ?? undefined;
    }

    isBuilding = true;
    currentAbortController = new AbortController();
    writeStatus(`${reason}: rebuilding dist and relinking skills`);

    const buildPromise = (async () => {
      try {
        const result = await rebuildOnce({
          runner,
          installer,
          runOptions: { signal: currentAbortController.signal }
        });
        const installed = result?.installed?.length ?? 0;
        const skipped = result?.skipped?.length ?? 0;
        writeStatus(`ready (${installed} skills linked, ${skipped} skipped)`);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        writeError(`rebuild failed: ${getErrorMessage(error)}`);
      } finally {
        isBuilding = false;
        currentAbortController = null;
      }
    })();

    currentBuildPromise = buildPromise;

    try {
      await buildPromise;
    } finally {
      currentBuildPromise = null;
      if (!isClosed && hasQueuedRebuild) {
        hasQueuedRebuild = false;
        await rebuild('queued change');
      }
    }
  };

  const scheduleRebuild = () => {
    if (isClosed) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void rebuild('change detected');
    }, debounceMs);
  };

  const closeTreeWatchers = async () => {
    for (const treeWatcher of [...treeWatchers].reverse()) {
      await treeWatcher.close();
    }

    treeWatchers.length = 0;
  };

  return {
    async start() {
      await rebuild('initial');

      if (isClosed) {
        return;
      }

      let startupFailed = false;
      try {
        for (const input of inputs) {
          if (isClosed) {
            break;
          }

          const treeWatcher = createTreeWatcher(input, {
            watch,
            collectDirectories: collectDirectoriesFn,
            onChange: scheduleRebuild
          });
          treeWatchers.push(treeWatcher);
          await treeWatcher.start();

          if (isClosed) {
            break;
          }
        }
      } catch (error) {
        startupFailed = true;
        throw error;
      } finally {
        if (startupFailed || isClosed) {
          await closeTreeWatchers();
        }
      }

      if (!isClosed) {
        writeStatus(`watching ${inputs.join(', ')}`);
      }
    },
    async close() {
      isClosed = true;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }

      if (currentAbortController) {
        currentAbortController.abort();
      }

      await closeTreeWatchers();

      if (currentBuildPromise) {
        await currentBuildPromise.catch(() => undefined);
      }
    }
  };
}

async function main() {
  const watchMode = createWatchMode();
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      await watchMode.close();
      process.stdout.write('[peaks watch] stopped\n');
      process.exit(0);
    } catch (error) {
      process.stderr.write(`[peaks watch] ${getErrorMessage(error)}\n`);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await watchMode.start();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`[peaks watch] ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
