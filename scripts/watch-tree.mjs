#!/usr/bin/env node
// scripts/watch-tree.mjs
//
// The DIRECTORY-TREE half of the dev watcher: walk the inputs, and keep one `fs.watch`
// handle per directory so a file created in a directory that did not exist at startup
// is still seen. Split out of `scripts/watch.mjs` (rid-043) along the seam the file
// already had — everything here touches the filesystem and nothing here knows about
// builds, debouncing or status lines.
//
// `collectDirectories` is injectable (`options.collectDirectories`) and so is the
// `watch` primitive (`options.watch`), which is how the tests drive the tree without
// a real timer; both defaults live in `watch.mjs`'s callers, not here.

import { watch as nodeWatch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

function getErrorCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function isMissingPathError(error) {
  return getErrorCode(error) === 'ENOENT';
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
