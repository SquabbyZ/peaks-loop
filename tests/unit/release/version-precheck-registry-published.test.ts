// tests/unit/release/version-precheck-registry-published.test.ts
//
// The registryPublished layer must read an existing version as a blocker, a
// missing version as free, and a registry it could not reach as unknown — never
// as ok. The 4.3.6 release failed exactly here: the subpackages kept last
// release's versions, `release-pack` tried to re-publish
// peaks-loop-shared@0.0.128, and npm refused.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runRegistryPublished,
  type RegistryObserved
} from '~/src/services/release/version-precheck-layer-registry';
import { runAllLayers } from '~/src/services/release/version-precheck-service';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

let root: string;
const registries: ChildProcess[] = [];

// A separate process, because the layer probes with spawnSync: an in-process
// server cannot accept while its own event loop is blocked.
const REGISTRY_SCRIPT = [
  'import { createServer } from "node:http";',
  'const map = JSON.parse(process.env.FIXTURE_STATUSES ?? "{}");',
  'const server = createServer((req, res) => {',
  '  res.statusCode = map[req.url] ?? 404;',
  '  res.end();',
  '});',
  'server.listen(0, "127.0.0.1", () => {',
  '  process.stdout.write(`PORT=${server.address().port}`);',
  '});'
].join('\n');

async function startRegistry(statusByPath: Record<string, number>): Promise<string> {
  const child = spawn(process.execPath, ['--input-type=module', '-e', REGISTRY_SCRIPT], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, FIXTURE_STATUSES: JSON.stringify(statusByPath) }
  });
  registries.push(child);
  const port = await new Promise<string>((resolve, reject) => {
    child.on('error', reject);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      const match = /PORT=(\d+)/.exec(String(chunk));
      if (match?.[1] !== undefined) {
        resolve(match[1]);
      }
    });
  });
  return `http://127.0.0.1:${port}`;
}

function writeManifest(path: string, name: string, version: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify({ name, version }));
}

function observedRows(result: {
  observed?: Readonly<Record<string, unknown>>;
}): RegistryObserved[] {
  return (result.observed?.['packages'] ?? []) as RegistryObserved[];
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-precheck-registry-'));
  writeManifest('package.json', 'fixture-root', '1.0.0');
  writeManifest('packages/a/package.json', 'fixture-a', '0.0.1');
});

afterEach(() => {
  for (const child of registries.splice(0)) {
    child.kill();
  }
  rmSync(root, { recursive: true, force: true });
});

describe('registryPublished — a published version is a blocker, an unreachable registry is not ok', () => {
  it('when every version answers 404, should report ok with one observed row per manifest', async () => {
    // given: a root manifest and one subpackage that the registry does not know
    // when: the layer probes both versions against that registry
    // then: the layer is ok and observed carries name/version/manifest/status per package
    const registryUrl = await startRegistry({});
    const result = runRegistryPublished({ projectRoot: root, registryUrl });
    const rows = observedRows(result);

    expect(result.status).toBe('ok');
    expect(rows.map((row) => `${row.name}@${row.version}`)).toEqual([
      'fixture-root@1.0.0',
      'fixture-a@0.0.1'
    ]);
    expect(rows.map((row) => row.status)).toEqual(['absent', 'absent']);
    expect(rows[1]?.manifest).toBe('packages/a/package.json');
  });

  it('when a version answers 200, should block and name both the version and its manifest', async () => {
    // given: the subpackage version is already on the registry
    // when: the layer probes it
    // then: the layer blocks and the message names fixture-a@0.0.1 and packages/a/package.json
    const registryUrl = await startRegistry({ '/fixture-a/0.0.1': 200 });

    const result = runRegistryPublished({ projectRoot: root, registryUrl });

    expect(result.status).toBe('blocker');
    expect(result.message).toContain('fixture-a@0.0.1');
    expect(result.message).toContain('packages/a/package.json');
    expect(observedRows(result).find((row) => row.name === 'fixture-a')?.status).toBe('published');
  });

  it('when the registry answers 500, should report unknown rather than ok', async () => {
    // given: one version answers with a server error and the other is free
    // when: the layer probes them
    // then: the layer is a warning and the 500 row is observed as unknown
    const registryUrl = await startRegistry({ '/fixture-root/1.0.0': 500 });

    const result = runRegistryPublished({ projectRoot: root, registryUrl });

    expect(result.status).toBe('warning');
    expect(result.status).not.toBe('ok');
    expect(observedRows(result).find((row) => row.name === 'fixture-root')?.status).toBe('unknown');
    expect(result.message).toContain('NOT treated as safe');
  });

  it(
    'when the registry is unreachable, should report unknown instead of ok',
    () => {
      // given: a registry base URL that refuses the connection
      // when: the layer probes it
      // then: every row is unknown and the layer is a warning, never ok
      const result = runRegistryPublished({
        projectRoot: root,
        registryUrl: 'http://127.0.0.1:1'
      });

      expect(result.status).toBe('warning');
      expect(observedRows(result).map((row) => row.status)).toEqual(['unknown', 'unknown']);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when strict mode meets an unreachable registry, should promote the unknown to a blocker',
    () => {
      // given: the same unreachable registry, run through the orchestrator with --strict
      // when: runAllLayers probes the registry
      // then: the layer is a blocker, so CI cannot pass on a check it could not run
      const envelope = runAllLayers({
        projectRoot: root,
        registryUrl: 'http://127.0.0.1:1',
        strict: true
      });

      expect(envelope.layers.registryPublished.status).toBe('blocker');
      expect(envelope.ok).toBe(false);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it('when a manifest has no readable version, should report unknown rather than probing it', async () => {
    // given: a subpackage whose version cannot be published as written
    // when: the layer enumerates the manifests
    // then: that row is unknown and never counted as free
    const registryUrl = await startRegistry({});
    writeManifest('packages/b/package.json', 'fixture-b', 'not-a-version');

    const result = runRegistryPublished({ projectRoot: root, registryUrl });

    expect(observedRows(result).find((row) => row.name === 'fixture-b')?.status).toBe('unknown');
    expect(result.status).toBe('warning');
  });
});
