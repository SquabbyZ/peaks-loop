import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/design/page-probe-http.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

import {
  fetchPageHttp,
  MAX_STAGE_A_BODY_BYTES,
  PROBE_TIMEOUT_MS,
  untrustedRedirectTarget,
  visibleChars
} from '../../../src/services/design/page-probe-http.js';

describe('Scenario: behavior — the Stage A budgets are fixed', () => {
  it('when the module constants are read, should publish the documented budgets', () => {
    // given: the exported Stage A bounds
    // when: each is read
    // then: the byte budget and the timeout are the documented values
    expect(MAX_STAGE_A_BODY_BYTES).toBe(262_144);
    expect(PROBE_TIMEOUT_MS).toBe(5_000);
  });
});

const BODY_BYTES = 1024 * 1024;

let origin: Server;
let target: Server;
let originUrl = '';
let targetUrl = '';
let originPort = 0;
/** Every path the origin server was asked for, in order. */
const originPaths: string[] = [];
let targetHits = 0;

beforeAll(async () => {
  origin = createServer((request, response) => {
    const path = request.url ?? '/';
    originPaths.push(path);
    if (path === '/huge') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('a'.repeat(BODY_BYTES));
      return;
    }
    if (path === '/exact-limit') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('b'.repeat(MAX_STAGE_A_BODY_BYTES));
      return;
    }
    if (path === '/nobody') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === '/loop') {
      response.writeHead(302, { Location: '/loop' });
      response.end();
      return;
    }
    if (path === '/no-location') {
      response.writeHead(302);
      response.end();
      return;
    }
    if (path.startsWith('/redirect-')) {
      const status = Number(path.slice('/redirect-'.length));
      response.writeHead(status, { Location: '/landing' });
      response.end();
      return;
    }
    if (path === '/hop') {
      response.writeHead(302, { Location: '/landing' });
      response.end();
      return;
    }
    if (path === '/cross-untrusted') {
      // A non-loopback spelling of this very server: the next request WOULD land
      // here if the probe followed it, so the path log proves it never did.
      response.writeHead(302, {
        Location: `http://[::ffff:127.0.0.1]:${String(originPort)}/followed`
      });
      response.end();
      return;
    }
    if (path === '/cross-host-loopback') {
      response.writeHead(302, { Location: `${targetUrl}ok` });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<h1>Reconciliation</h1>');
  });
  await new Promise<void>((settle) => {
    origin.listen(0, '127.0.0.1', () => settle());
  });
  // Bound under the same name the redirect will use, so DNS resolution is
  // consistent between listen and fetch on every platform.
  target = createServer((_request, response) => {
    targetHits += 1;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<h1>${'Ledgerly '.repeat(40)}</h1>`);
  });
  await new Promise<void>((settle) => {
    target.listen(0, 'localhost', () => settle());
  });
  const originAddress = origin.address() as AddressInfo;
  const targetAddress = target.address() as AddressInfo;
  originPort = originAddress.port;
  originUrl = `http://127.0.0.1:${String(originPort)}`;
  targetUrl = `http://localhost:${String(targetAddress.port)}/`;
});

afterAll(async () => {
  await Promise.all(
    [origin, target].map(
      (server) =>
        new Promise<void>((settle) => {
          server.close(() => settle());
        })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Scenario: integration — Stage A reads a bounded body', () => {
  it('when the page streams a megabyte, should read only the byte budget', async () => {
    // given: a page whose body is 1 MiB of visible text
    // when: the real Stage A fetch reads it
    // then: exactly MAX_STAGE_A_BODY_BYTES characters are counted
    const observation = await fetchPageHttp(`${originUrl}/huge`);
    expect(observation.status).toBe(200);
    expect(observation.textChars).toBe(MAX_STAGE_A_BODY_BYTES);
  });

  it('when a same-host redirect names another path, should follow it manually', async () => {
    // given: a 302 whose Location is a relative path on the same server
    // when: Stage A follows the hop itself
    // then: the landing page is the measured answer
    const observation = await fetchPageHttp(`${originUrl}/hop`);
    expect(observation.status).toBe(200);
    expect(observation.finalUrl).toBe(`${originUrl}/landing`);
    expect(observation.untrustedRedirect).toBeUndefined();
    expect(observation.textChars).toBeGreaterThan(0);
  });

  it('when a redirect crosses to another loopback host, should follow it', async () => {
    // given: 127.0.0.1 answering with a 302 to localhost on another port
    // when: Stage A follows the hop
    // then: the cross-host hop stays trusted because it is loopback
    const observation = await fetchPageHttp(`${originUrl}/cross-host-loopback`);
    expect(observation.status).toBe(200);
    expect(observation.finalUrl).toContain('localhost');
    expect(observation.untrustedRedirect).toBeUndefined();
    expect(observation.textChars).toBeGreaterThan(0);
    expect(targetHits).toBeGreaterThan(0);
  });

  it('when a redirect names a non-loopback host, should refuse before the next request', async () => {
    // given: a 302 to a non-loopback spelling of the same server
    // when: Stage A classifies the hop
    // then: the redirect answer is returned and the target was never requested
    const observation = await fetchPageHttp(`${originUrl}/cross-untrusted`);
    expect(observation.status).toBe(302);
    expect(observation.untrustedRedirect).toContain('::ffff');
    expect(observation.textChars).toBe(0);
    expect(originPaths.filter((path) => path === '/followed')).toHaveLength(0);
  });
});

describe('Scenario: behavior — the redirect host decision', () => {
  it('when a redirect keeps the host, should allow a port change', () => {
    // given: the same host on a different port
    // when: the hop is classified
    // then: it is not a cross-host redirect
    expect(untrustedRedirectTarget('http://127.0.0.1:1/', 'http://127.0.0.1:2/x')).toBeNull();
  });

  it('when a redirect crosses to a non-loopback host, should refuse it', () => {
    // given: loopback answering with a Location for a public host and a LAN address
    // when: each hop is classified
    // then: the final URL is returned as untrusted
    expect(untrustedRedirectTarget('http://127.0.0.1:1/', 'http://evil.test/x')).toBe(
      'http://evil.test/x'
    );
    expect(untrustedRedirectTarget('http://127.0.0.1:1/', 'http://10.0.0.5:9/x')).toBe(
      'http://10.0.0.5:9/x'
    );
  });

  it('when a redirect crosses between loopback names, should allow it', () => {
    // given: 127.0.0.1 answering with a Location for localhost, and the reverse
    // when: each hop is classified
    // then: a developer's own machine never counts as an untrusted host
    expect(untrustedRedirectTarget('http://127.0.0.1:1/', 'http://localhost:2/')).toBeNull();
    expect(untrustedRedirectTarget('http://localhost:1/', 'http://127.0.0.1:2/')).toBeNull();
  });

  it('when the final URL does not parse, should not invent a refusal', () => {
    // given: no final URL at all
    // when: the hop is classified
    // then: the answer is the "no redirect" value
    expect(untrustedRedirectTarget('http://127.0.0.1:1/', null)).toBeNull();
  });

  it('when either side of the hop does not parse, should answer null instead of refusing', () => {
    // given: an unparsable request URL and an unparsable final URL
    // when: each hop is classified
    // then: an address this code cannot read is never invented into a refusal
    expect(untrustedRedirectTarget('not a url', 'http://evil.test/x')).toBeNull();
    expect(untrustedRedirectTarget('http://127.0.0.1:1/', 'not a url')).toBeNull();
    expect(untrustedRedirectTarget('', '')).toBeNull();
  });
});

describe('Scenario: behavior — visible text is measured after markup removal', () => {
  it('when scripts and styles carry attributes, should still remove them whole', () => {
    // given: script and style elements with attributes, in both cases
    // when: the visible characters are counted
    // then: only the real text remains
    const html =
      '<script type="module">var x = 1;</script><STYLE media="screen">.a{color:red}</STYLE>Hi';
    expect(visibleChars(html)).toBe(2);
  });

  it('when the closing script tag carries whitespace, should end the element there', () => {
    // given: a script closed with a trailing space before the angle bracket
    // when: the visible characters are counted
    // then: the script body is not counted
    expect(visibleChars('<script>ignored</script >Hi')).toBe(2);
  });

  it('when named, numeric and hex entities appear, should drop each one', () => {
    // given: an ampersand entity, a numeric entity and a hex entity around text
    // when: the visible characters are counted
    // then: entity spellings are not visible text
    expect(visibleChars('<p>&amp;&#39;&#x27;Hi</p>')).toBe(2);
  });

  it('when text is split by whitespace, should count only non-whitespace characters', () => {
    // given: text split by newlines, tabs and spaces
    // when: the visible characters are counted
    // then: only the letters are counted
    expect(visibleChars('<p>a\n\tb  c</p>')).toBe(3);
  });
});

describe('Scenario: behavior — the password-field signal', () => {
  it('when a password input is spelled with any attribute shape, should detect it', async () => {
    // given: password inputs with single, double and no quotes, and long attribute lists
    // when: Stage A reads each page
    // then: every spelling of the same field is a password field
    const detected = [
      '<input type="password" name="pw">',
      "<input type='password'>",
      '<input type=password>',
      '<INPUT TYPE="PASSWORD">',
      '<input\n  type = "password">',
      '<input id="x" data-x="1" type="password">',
      '<input\ttype=password>'
    ];
    for (const html of detected) {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(html, { status: 200 })));
      const observation = await fetchPageHttp('http://127.0.0.1:1/');
      expect(observation.hasPasswordField, html).toBe(true);
    }
  });

  it('when the page has no password-typed input, should report false', async () => {
    // given: a text input, a name="password" field, and a non-input element
    // when: Stage A reads each page
    // then: none of them is a password field
    const absent = [
      '<input type="text">',
      '<input name="password">',
      '<div type="password">',
      '<inputtype="password">'
    ];
    for (const html of absent) {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(html, { status: 200 })));
      const observation = await fetchPageHttp('http://127.0.0.1:1/');
      expect(observation.hasPasswordField, html).toBe(false);
    }
  });
});

describe('Scenario: integration — redirects are followed manually and bounded', () => {
  it('when the page streams exactly the byte budget, should read all of it', async () => {
    // given: a body of exactly MAX_STAGE_A_BODY_BYTES visible characters
    // when: Stage A reads it
    // then: the whole budget is counted, not one byte short
    const observation = await fetchPageHttp(`${originUrl}/exact-limit`);
    expect(observation.textChars).toBe(MAX_STAGE_A_BODY_BYTES);
  });

  it('when the answer carries no body, should report zero visible characters', async () => {
    // given: a 204 answer with a null body
    // when: Stage A reads it
    // then: the body reader is skipped without a throw
    const observation = await fetchPageHttp(`${originUrl}/nobody`);
    expect(observation).toEqual({
      status: 204,
      finalUrl: `${originUrl}/nobody`,
      textChars: 0,
      hasPasswordField: false
    });
  });

  it('when the Location is missing, should stop and measure the redirect answer', async () => {
    // given: a 302 with no Location header
    // when: Stage A classifies the answer
    // then: it is the final answer and nothing further is requested
    const observation = await fetchPageHttp(`${originUrl}/no-location`);
    expect(observation.status).toBe(302);
    expect(observation.textChars).toBe(0);
  });

  it('when each redirect status names a same-host target, should follow it', async () => {
    // given: 301, 302, 303, 307 and 308 answers naming /landing
    // when: each page is fetched
    // then: every redirect status is followed to the 200 landing page
    for (const status of [301, 302, 303, 307, 308]) {
      const observation = await fetchPageHttp(`${originUrl}/redirect-${String(status)}`);
      expect(observation.status, String(status)).toBe(200);
      expect(observation.finalUrl, String(status)).toBe(`${originUrl}/landing`);
    }
  });

  it('when a 300 or 304 answer names a target, should treat it as final', async () => {
    // given: 300 and 304 answers that carry a Location header
    // when: each page is fetched
    // then: neither status is a redirect this probe follows
    for (const status of [300, 304]) {
      const observation = await fetchPageHttp(`${originUrl}/redirect-${String(status)}`);
      expect(observation.status, String(status)).toBe(status);
      expect(observation.finalUrl, String(status)).toBe(`${originUrl}/redirect-${String(status)}`);
    }
  });

  it('when redirects loop, should stop after the hop budget and return the last answer', async () => {
    // given: a route that redirects to itself forever
    // when: Stage A follows it
    // then: exactly four requests are made and the fourth 302 is returned
    const before = originPaths.filter((path) => path === '/loop').length;
    const observation = await fetchPageHttp(`${originUrl}/loop`);
    expect(observation.status).toBe(302);
    expect(observation.finalUrl).toBe(`${originUrl}/loop`);
    expect(observation.textChars).toBe(0);
    expect(originPaths.filter((path) => path === '/loop').length - before).toBe(4);
  });

  it('when fetch itself throws, should report no answer rather than propagate', async () => {
    // given: a global fetch that rejects as a refused connection would
    // when: Stage A runs
    // then: the failure is a status-null observation
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    await expect(fetchPageHttp('http://127.0.0.1:1/')).resolves.toEqual({
      status: null,
      finalUrl: null,
      textChars: 0,
      hasPasswordField: false
    });
  });
});
