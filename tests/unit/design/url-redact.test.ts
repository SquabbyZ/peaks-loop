import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { normalizedUrl, redactUrl } from '../../../src/services/design/url-redact.js';

declareDimensions('tests/unit/design/url-redact.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

describe('Scenario: behavior — a parseable URL loses its userinfo', () => {
  it('should drop a username and password but keep host, port and path', () => {
    // given: a parseable URL carrying both credentials
    // when: it is redacted for a refusal message
    // then: the address survives and neither credential does
    const redacted = redactUrl('http://alice:s3cret@127.0.0.1:4311/app');

    expect(redacted).toBe('http://127.0.0.1:4311/app');
    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('s3cret');
  });

  it('should drop a username-only and a password-only userinfo', () => {
    // given: one URL with only a username and one with only a password
    // when: each is redacted
    // then: both credentials are gone, because either half alone is a secret
    expect(redactUrl('http://alice@127.0.0.1:4311/')).toBe('http://127.0.0.1:4311/');
    expect(redactUrl('http://:s3cret@127.0.0.1:4311/')).toBe('http://127.0.0.1:4311/');
  });

  it('should return a URL without userinfo unchanged', () => {
    // given: a URL whose path contains an @ but whose authority carries no userinfo
    // when: it is redacted
    // then: no part of the address is rewritten
    const url = 'http://127.0.0.1:4311/a@b?x=1';

    expect(redactUrl(url)).toBe(url);
  });

  it('should keep a credential-free URL exactly as written, not re-serialized', () => {
    // given: a credential-free URL whose spelling differs from its WHATWG form
    // when: it is redacted
    // then: the caller's original text is returned, not a normalized rewrite
    expect(redactUrl('HTTP://127.0.0.1:4311/')).toBe('HTTP://127.0.0.1:4311/');
  });
});

describe('Scenario: integration — an unparseable URL is stripped textually', () => {
  it('should mask userinfo when the port fails WHATWG parsing', () => {
    // given: a credential-bearing URL with an out-of-range port
    // when: it is redacted
    // then: the authority is masked without the credentials
    const redacted = redactUrl('http://alice:s3cret@127.0.0.1:99999/');

    expect(redacted).toBe('http://***@127.0.0.1:99999/');
    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('s3cret');
  });

  it('should mask a username-only userinfo when the URL does not parse', () => {
    // given: a username-only, credential-bearing URL with an out-of-range port
    // when: it is redacted
    // then: the authority is masked even though the port colon follows the @
    const redacted = redactUrl('http://alice@127.0.0.1:99999/');

    expect(redacted).toBe('http://***@127.0.0.1:99999/');
    expect(redacted).not.toContain('alice');
  });

  it('should mask userinfo when the IPv6 authority is malformed', () => {
    // given: a credential-bearing URL whose IPv6 literal never closes
    // when: it is redacted
    // then: the credentials do not survive the parse failure
    const redacted = redactUrl('http://alice:s3cret@[::1/');

    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('s3cret');
  });

  it('should mask an opaque scheme that parses without a userinfo part', () => {
    // given: an opaque URL whose path text spells user:pass@ at the host
    // when: it is redacted
    // then: the textual mask applies even though WHATWG found no userinfo
    const redacted = redactUrl('opaque:alice:s3cret@host');

    expect(redacted).toBe('opaque:***@host');
    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('s3cret');
  });
});

describe('Scenario: render — the canonical form is the WHATWG href', () => {
  it('should add the default path when a URL omits it', () => {
    // given: the same loopback address spelled without a trailing slash
    // when: its canonical form is computed
    // then: WHATWG adds the root path
    expect(normalizedUrl('http://127.0.0.1:4311')).toBe('http://127.0.0.1:4311/');
  });

  it('should return null for a URL that cannot be parsed', () => {
    // given: a URL with an out-of-range port
    // when: its canonical form is computed
    // then: there is none, so no self-compare can be inferred from it
    expect(normalizedUrl('http://127.0.0.1:99999/')).toBeNull();
  });
});

describe('Scenario: a11y — no refusal output ever carries a credential', () => {
  it('should keep the secret out of every redacted shape', () => {
    // given: parseable and unparseable URLs that all carry the same secret
    // when: each is redacted
    // then: the secret appears in none of the outputs
    const inputs = [
      'http://alice:s3cret@127.0.0.1:4311/',
      'http://alice@127.0.0.1:4311/',
      'http://:s3cret@127.0.0.1:4311/',
      'http://alice:s3cret@127.0.0.1:99999/',
      'http://alice@127.0.0.1:99999/',
      'http://alice:s3cret@[::1/',
      'opaque:alice:s3cret@host'
    ];

    for (const input of inputs) {
      expect(redactUrl(input)).not.toContain('s3cret');
      expect(redactUrl(input)).not.toContain('alice');
    }
  });
});
