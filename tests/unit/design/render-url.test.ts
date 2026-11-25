import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/design/render-url.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import type { EngineContractFile } from '../../../src/services/design/engine-contract.js';
import {
  DESIGN_URL_ENV_KEY,
  probeRenderUrl,
  resolveRenderUrl
} from '../../../src/services/design/render-url.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((settle) => {
      server.close(() => {
        settle();
      });
    });
  }
});

/** A full `render` block with only the field under test varied. */
function renderContract(
  overrides: Partial<EngineContractFile['render']> = {}
): Pick<EngineContractFile, 'render'> {
  return {
    render: {
      startCommand: null,
      cwd: '.',
      port: 4321,
      path: '/',
      pages: ['/'],
      startPolicy: 'never',
      url: null,
      ...overrides
    }
  };
}

/** Listen on an OS-chosen port (port 0) and report the port it got. */
async function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise<number>((settle, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        settle(address.port);
      } else {
        fail(new Error('server has no port'));
      }
    });
  });
}

describe('Scenario: render — the resolved URL record', () => {
  it('when the flag is set, should return its URL and name the flag as the source', () => {
    // given: a flag, an env value, and a recorded engine URL
    // when: the resolver runs
    // then: the flag wins and the record carries the source
    const result = resolveRenderUrl({
      explicitUrl: 'http://127.0.0.1:7777/app',
      env: { [DESIGN_URL_ENV_KEY]: 'http://localhost:8888/' },
      engine: renderContract({ url: 'http://127.0.0.1:9999/' })
    });
    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:7777/app', source: 'flag' });
  });

  it('when all sources are absent but a port exists, should derive a loopback URL', () => {
    // given: no flag, no env, no recorded URL, and an engine port and path
    // when: the resolver runs
    // then: it derives a loopback URL from the port and the source is `derived`
    const result = resolveRenderUrl({ engine: renderContract({ port: 4321, path: '/app' }) });
    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:4321/app', source: 'derived' });
  });

  it('when the derived path has no leading slash, should add exactly one', () => {
    // given: an engine path spelled without its leading slash
    // when: the resolver derives the URL
    // then: the path is normalized to a single leading slash
    const result = resolveRenderUrl({ engine: renderContract({ port: 4321, path: 'app' }) });
    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:4321/app', source: 'derived' });
  });

  it('when the port is at the boundary, should accept 65535 and refuse beyond it', () => {
    // given: the maximum port, one past it, zero, a negative, and a fraction
    // when: each is derived
    // then: only the two in-range integers address a loopback URL
    const atMax = resolveRenderUrl({ engine: renderContract({ port: 65_535 }) });
    expect(atMax).toEqual({ ok: true, url: 'http://127.0.0.1:65535/', source: 'derived' });
    for (const port of [65_536, 0, -1, 1.5]) {
      const result = resolveRenderUrl({ engine: renderContract({ port }) });
      expect(result.ok, String(port)).toBe(false);
      if (result.ok) throw new Error(`expected port ${port} to be refused`);
      expect(result.code).toBe('DESIGN_RENDER_URL_MISSING');
    }
  });

  it('when a candidate has surrounding whitespace, should trim it before judging', () => {
    // given: a flag, an env value, and a recorded URL padded with spaces
    // when: each candidate is resolved alone
    // then: the trimmed URL is returned, not the padded original
    const flag = resolveRenderUrl({
      explicitUrl: '  http://127.0.0.1:7777/app  ',
      engine: renderContract()
    });
    expect(flag).toEqual({ ok: true, url: 'http://127.0.0.1:7777/app', source: 'flag' });
    const env = resolveRenderUrl({
      env: { [DESIGN_URL_ENV_KEY]: '  http://127.0.0.1:8888/  ' },
      engine: renderContract()
    });
    expect(env).toEqual({ ok: true, url: 'http://127.0.0.1:8888/', source: 'env' });
    const engine = resolveRenderUrl({
      engine: renderContract({ url: '  http://127.0.0.1:9999/  ' })
    });
    expect(engine).toEqual({ ok: true, url: 'http://127.0.0.1:9999/', source: 'engine' });
  });

  it('when a candidate is whitespace-only, should treat it as absent', () => {
    // given: a whitespace flag and env value with a usable derived port
    // when: the resolver runs
    // then: both are skipped and the derived URL wins
    const result = resolveRenderUrl({
      explicitUrl: '   ',
      env: { [DESIGN_URL_ENV_KEY]: '   ' },
      engine: renderContract({ port: 4321 })
    });
    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:4321/', source: 'derived' });
  });
});

describe('Scenario: behavior — resolution order and trust', () => {
  it('when the env key is exported, should name PEAKS_DESIGN_URL', () => {
    // given: the module's exported env key
    // when: it is read
    // then: it is the documented variable a project can set
    expect(DESIGN_URL_ENV_KEY).toBe('PEAKS_DESIGN_URL');
  });

  it('when the env is set and the engine records a URL, should prefer the env', () => {
    // given: the env variable and a different recorded engine URL
    // when: the resolver runs
    // then: the env value wins and is named as its source
    const result = resolveRenderUrl({
      env: { [DESIGN_URL_ENV_KEY]: 'http://localhost:8888/' },
      engine: renderContract({ url: 'http://127.0.0.1:9999/' })
    });
    expect(result).toEqual({ ok: true, url: 'http://localhost:8888/', source: 'env' });
  });

  it('when the engine records an exact public URL, should use it as the engine source', () => {
    // given: a recorded public URL with no flag or env override
    // when: the resolver runs
    // then: the exact match is trusted and named as the engine source
    const result = resolveRenderUrl({
      engine: renderContract({ url: 'https://design.example.com/app' })
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://design.example.com/app',
      source: 'engine'
    });
  });

  it('when the flag is an empty string, should fall through to the env', () => {
    // given: an empty flag value and a usable env value
    // when: the resolver runs
    // then: the empty flag is treated as absent
    const result = resolveRenderUrl({
      explicitUrl: '',
      env: { [DESIGN_URL_ENV_KEY]: 'http://127.0.0.1:8888/' },
      engine: renderContract()
    });
    expect(result).toEqual({ ok: true, url: 'http://127.0.0.1:8888/', source: 'env' });
  });

  it('when a private host or a loopback lookalike is given, should refuse it as untrusted', () => {
    // given: a private-network address and a host that only starts with localhost
    // when: each is resolved as an explicit URL
    // then: both are refused rather than silently replaced by a derived URL
    for (const url of ['http://192.168.1.10:3000/', 'http://localhost.evil.com:3000/']) {
      const result = resolveRenderUrl({ explicitUrl: url, engine: renderContract() });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`expected ${url} to be refused`);
      expect(result.code).toBe('DESIGN_URL_UNTRUSTED');
    }
  });

  it('when no URL and no usable port exist, should report DESIGN_RENDER_URL_MISSING', () => {
    // given: no flag, no env, no recorded URL, and a non-addressable port
    // when: the resolver runs
    // then: it reports the missing-URL code instead of inventing a URL
    const result = resolveRenderUrl({ engine: renderContract({ port: 0 }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a missing render URL');
    expect(result.code).toBe('DESIGN_RENDER_URL_MISSING');
  });
});

describe('Scenario: integration — probing a real loopback server', () => {
  it('when the server answers, should report the URL reachable', async () => {
    // given: a real HTTP server on an OS-chosen loopback port
    // when: the probe runs
    // then: any HTTP response counts as reachable
    const server = createServer((_request, response) => {
      response.writeHead(503);
      response.end('not ready');
    });
    servers.push(server);
    const port = await listenOnRandomPort(server);
    expect(await probeRenderUrl(`http://127.0.0.1:${port}/`, 2_000)).toBe(true);
  });

  it('when the server answers with no body, should still report it reachable', async () => {
    // given: a real server that answers 204 with no body
    // when: the probe runs
    // then: the absent body must not be cancelled into an unreachable verdict
    const server = createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    servers.push(server);
    const port = await listenOnRandomPort(server);
    expect(await probeRenderUrl(`http://127.0.0.1:${port}/`, 2_000)).toBe(true);
  });

  it('when the server redirects, should judge the target and not follow it', async () => {
    // given: a server redirecting to a port nothing listens on
    // when: the probe runs
    // then: the redirect answer itself counts as reachable
    const server = createServer((_request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:1/' });
      response.end();
    });
    servers.push(server);
    const port = await listenOnRandomPort(server);
    expect(await probeRenderUrl(`http://127.0.0.1:${port}/`, 2_000)).toBe(true);
  });

  it('when nothing listens on the port, should report it unreachable', async () => {
    // given: a port that was bound once and then released
    // when: the probe runs against it
    // then: the network error is reported as unreachable
    const probe = createServer();
    const port = await listenOnRandomPort(probe);
    await new Promise<void>((settle) => {
      probe.close(() => {
        settle();
      });
    });
    expect(await probeRenderUrl(`http://127.0.0.1:${port}/`, 500)).toBe(false);
  });
});

describe('Scenario: a11y — the refusal text names the fix', () => {
  it('when the URL is untrusted, should name the URL and the engine.json escape hatch', () => {
    // given: a private-network URL
    // when: the resolver refuses it
    // then: the message carries the URL and the recorded-URL remedy
    const result = resolveRenderUrl({
      explicitUrl: 'http://10.0.0.5:3000/',
      engine: renderContract()
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an untrusted refusal');
    expect(result.message).toContain('http://10.0.0.5:3000/');
    expect(result.message).toContain('engine.json');
  });

  it('when a credentialed URL is refused, should not echo its userinfo', () => {
    // given: a private-network URL that also carries a username and password
    // when: the resolver refuses it
    // then: the message names the host without either credential
    const result = resolveRenderUrl({
      explicitUrl: 'http://alice:s3cret@10.0.0.5:3000/',
      engine: renderContract()
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an untrusted refusal');
    expect(result.message).toContain('http://10.0.0.5:3000/');
    expect(result.message).not.toContain('s3cret');
    expect(result.message).not.toContain('alice');
  });

  it('when a refused URL carries an ESC sequence, should keep its byte out of the message', () => {
    // given: an untrusted URL whose path carries a CSI clear-screen sequence
    // when: the resolver refuses it
    // then: the echo names the host and no control byte reaches the persisted text
    const result = resolveRenderUrl({
      explicitUrl: 'http://10.0.0.5:3000/\u001b[2J',
      engine: renderContract()
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an untrusted refusal');
    expect(result.message).not.toMatch(/\p{Cc}/u);
    expect(result.message).toContain('http://10.0.0.5:3000/');
  });

  it('when nothing is configured, should name the env key and the derived-port remedy', () => {
    // given: no flag, no env, no recorded URL, and no usable port
    // when: the resolver reports a missing URL
    // then: the message names every way to supply one
    const result = resolveRenderUrl({ engine: renderContract({ port: 0 }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a missing render URL');
    expect(result.message).toContain('PEAKS_DESIGN_URL');
    expect(result.message).toContain('render.port');
  });
});
