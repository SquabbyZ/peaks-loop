import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

const watchModulePath = '../../scripts/watch.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('watch script', () => {
  test('exports watched inputs and helpers without starting on import', async () => {
    const module = await import(watchModulePath);

    expect(module.WATCHED_INPUTS).toEqual(['src', 'schemas', 'skills']);
    expect(typeof module.collectDirectories).toBe('function');
    expect(typeof module.createDirectoryTreeWatcher).toBe('function');
    expect(typeof module.rebuildOnce).toBe('function');
    expect(typeof module.createWatchMode).toBe('function');
  });

  test('collectDirectories returns nested directories', async () => {
    const { collectDirectories } = await import(watchModulePath);
    const root = mkdtempSync(join(tmpdir(), 'peaks-watch-tree-'));

    try {
      mkdirSync(join(root, 'src', 'cli'), { recursive: true });
      mkdirSync(join(root, 'skills', 'peaks-rd'), { recursive: true });

      const directories = await collectDirectories(root);

      expect(new Set(directories)).toEqual(new Set([
        root,
        join(root, 'skills'),
        join(root, 'skills', 'peaks-rd'),
        join(root, 'src'),
        join(root, 'src', 'cli')
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rebuildOnce runs the compiler before installing bundled skills', async () => {
    const { rebuildOnce } = await import(watchModulePath);
    const calls: string[] = [];
    const runner = vi.fn(async () => {
      calls.push('runner');
    });
    const installer = vi.fn(() => {
      calls.push('installer');
      return { installed: [], skipped: [] };
    });

    await rebuildOnce({ runner, installer });

    expect(runner).toHaveBeenCalledWith('pnpm', ['run', 'build'], undefined);
    expect(installer).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['runner', 'installer']);
  });

  test('rebuildOnce skips skill installation when the build fails', async () => {
    const { rebuildOnce } = await import(watchModulePath);
    const runner = vi.fn(async () => {
      throw new Error('build failed');
    });
    const installer = vi.fn(() => ({ installed: [], skipped: [] }));

    await expect(rebuildOnce({ runner, installer })).rejects.toThrow('build failed');

    expect(installer).not.toHaveBeenCalled();
  });

  test('createDirectoryTreeWatcher wires every discovered directory and closes cleanly', async () => {
    const { createDirectoryTreeWatcher } = await import(watchModulePath);
    const closes = new Map<string, ReturnType<typeof vi.fn>>();
    const watch = vi.fn((directory: string, listener: () => void) => {
      const close = vi.fn();
      closes.set(directory, close);
      if (directory === 'src') {
        listener();
      }
      return { close };
    });
    const collectDirectories = vi.fn(async () => ['src', 'src/cli', 'skills']);
    const onChange = vi.fn();

    const treeWatcher = createDirectoryTreeWatcher('root', { watch, collectDirectories, onChange });
    await treeWatcher.start();

    expect(watch).toHaveBeenCalledWith('src', expect.any(Function));
    expect(watch).toHaveBeenCalledWith('src/cli', expect.any(Function));
    expect(watch).toHaveBeenCalledWith('skills', expect.any(Function));
    expect(onChange).toHaveBeenCalled();

    await treeWatcher.close();
    expect(closes.get('src')).toHaveBeenCalled();
    expect(closes.get('src/cli')).toHaveBeenCalled();
    expect(closes.get('skills')).toHaveBeenCalled();
  });

  test('createWatchMode keeps watchers alive after startup until explicit close', async () => {
    const { createWatchMode } = await import(watchModulePath);
    const runner = vi.fn(async () => undefined);
    const installer = vi.fn(() => ({ installed: [], skipped: [] }));
    const treeWatchers = [
      { start: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
      { start: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
      { start: vi.fn(async () => undefined), close: vi.fn(async () => undefined) }
    ];
    const createTreeWatcher = vi.fn(() => {
      const treeWatcher = treeWatchers.shift();
      if (!treeWatcher) {
        throw new Error('unexpected watcher');
      }
      return treeWatcher;
    });
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };

    const watchMode = createWatchMode({
      runner,
      installer,
      createTreeWatcher,
      stdout,
      stderr,
      debounceMs: 1
    });

    await watchMode.start();
    const createdWatchers = createTreeWatcher.mock.results.map((result) => result.value);

    expect(createTreeWatcher).toHaveBeenCalledTimes(3);
    for (const treeWatcher of createdWatchers) {
      expect(treeWatcher.start).toHaveBeenCalled();
      expect(treeWatcher.close).not.toHaveBeenCalled();
    }

    await watchMode.close();
    for (const treeWatcher of createdWatchers) {
      expect(treeWatcher.close).toHaveBeenCalled();
    }
  });
});
