import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';
import { buildEngineContract } from '../../../src/services/design/engine-contract.js';
import { isTrustedDesignUrl } from '../../../src/services/design/url-trust.js';

declareDimensions('tests/unit/design/paved-road-and-engine.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

describe('Scenario: behavior — the paved road defaults', () => {
  it('when no rules are supplied, should hard-fail arbitrary values and raw primitives', () => {
    // given: a default paved road
    // when: the rules are read
    // then: the two symptom rules are fail, coverage stays warn
    const road = buildPavedRoad({
      pageRoots: ['src/routes'],
      componentEntrypoints: ['@/components/ui']
    });
    expect(road.rules.DESIGN_ARBITRARY_VALUE).toBe('fail');
    expect(road.rules.DESIGN_RAW_PRIMITIVE).toBe('fail');
    expect(road.rules.DESIGN_TOKEN_COVERAGE).toBe('warn');
  });
});

describe('Scenario: behavior — the engine contract does not hardcode a URL', () => {
  it('when built with no explicit URL, should leave render.url null', () => {
    // given: a dev command and port
    // when: the engine file is read
    // then: no fixed URL is stored
    const engine = buildEngineContract({
      cwd: 'web',
      startCommand: 'bun run dev',
      port: 3000,
      pages: ['/'],
      archetypes: ['list']
    });
    expect(engine.render.url).toBeNull();
    expect(engine.render.cwd).toBe('web');
    expect(engine.render.startPolicy).toBe('never');
  });
});

describe('Scenario: a11y — URL trust', () => {
  const engine = buildEngineContract({
    cwd: 'web',
    startCommand: null,
    port: 3000,
    pages: ['/'],
    archetypes: ['list']
  });

  it('when the host is loopback, should trust it', () => {
    // given: loopback spellings
    // when: each is checked
    // then: all are trusted
    expect(isTrustedDesignUrl('http://localhost:3000', engine)).toBe(true);
    expect(isTrustedDesignUrl('http://127.0.0.1:3000', engine)).toBe(true);
    expect(isTrustedDesignUrl('http://[::1]:3000', engine)).toBe(true);
  });

  it('when the host is a private IP or a lookalike, should refuse', () => {
    // given: private and lookalike hosts
    // when: each is checked
    // then: none is trusted
    expect(isTrustedDesignUrl('http://192.168.1.5:3000', engine)).toBe(false);
    expect(isTrustedDesignUrl('https://localhost.evil.com', engine)).toBe(false);
    expect(isTrustedDesignUrl('http://user:pass@localhost:3000', engine)).toBe(false);
    expect(isTrustedDesignUrl('file:///tmp/page.html', engine)).toBe(false);
    expect(isTrustedDesignUrl('not-a-url', engine)).toBe(false);
  });

  it('when the engine records an explicit URL, should trust exactly that URL', () => {
    // given: a recorded public URL
    // when: it and a different host are checked
    // then: only the recorded one is trusted
    const recorded = {
      ...engine,
      render: { ...engine.render, url: 'https://design.example.com' }
    };
    expect(isTrustedDesignUrl('https://design.example.com', recorded)).toBe(true);
    expect(isTrustedDesignUrl('https://other.example.com', recorded)).toBe(false);
  });
});
