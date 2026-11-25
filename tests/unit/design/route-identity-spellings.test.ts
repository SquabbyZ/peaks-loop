import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type * as RouteIdentityTypes from '../../../src/services/design/route-identity.js';

declareDimensions(
  'tests/unit/design/route-identity-spellings.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'the evaluator is a pure function: no fs, network, process or clock boundary'
    }
  ]
);

type RouteIdentityModule = typeof RouteIdentityTypes;
type RouteIdentityVerdict = ReturnType<RouteIdentityModule['evaluateRouteIdentity']>;

/**
 * Imported per test after a module reset so the module-level marker list and
 * the patterns derived from it initialise INSIDE a test. Under Stryker's
 * per-test coverage a module-scope initialiser executes before any test, so a
 * mutant in it is never scheduled and reads as survived although no test ran.
 */
async function loadRouteIdentity(): Promise<RouteIdentityModule> {
  vi.resetModules();
  return import('../../../src/services/design/route-identity.js');
}

/** The block half of a verdict, or a loud failure rather than a silent cast. */
function blocked(verdict: RouteIdentityVerdict): {
  code: string;
  signal: string;
  detail: string;
} {
  if (verdict.ok) throw new Error('expected a block, got an ok verdict');
  return verdict;
}

describe('Scenario: behavior — every spelling of a sign-in or access state blocks', () => {
  it('when each spelling opens the title, should block as negative-marker', async () => {
    // given: one page per spelling of the sign-in and access labels
    // when: each route identity is evaluated on its title
    // then: every spelling blocks, including the zero-separator and British forms
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const titles = [
      'Sign in',
      'Signin',
      'Sign-in',
      'Log in',
      'Login',
      'Unauthorized',
      'Unauthorised'
    ];
    for (const title of titles) {
      const verdict = blocked(
        evaluateRouteIdentity({ route: '/settings', observation: { title } })
      );
      expect(verdict.signal, title).toBe('negative-marker');
    }
  });

  it('when a spelling opens a heading, should block as negative-marker', async () => {
    // given: a zero-separator sign-in spelling and the British access spelling
    // when: each route identity is evaluated on a heading
    // then: the heading surface blocks exactly as the title surface does
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    for (const heading of ['Signin', 'Unauthorised']) {
      const verdict = blocked(
        evaluateRouteIdentity({ route: '/settings', observation: { headings: [heading] } })
      );
      expect(verdict.signal, heading).toBe('negative-marker');
    }
  });
});

describe('Scenario: behavior — the negative list is the seven page-state labels', () => {
  it('when the module is loaded inside the test, should expose the seven labels in order', async () => {
    // given: the route check loaded so its module-level marker list is built here
    // when: the exported list is read
    // then: it is exactly the seven labels in contract order, with no blank entry
    const { NEGATIVE_ROUTE_MARKERS } = await loadRouteIdentity();
    expect(NEGATIVE_ROUTE_MARKERS).toEqual([
      'page not found',
      'not found',
      'sign in',
      'log in',
      'unauthorized',
      'forbidden',
      'access denied'
    ]);
    expect(NEGATIVE_ROUTE_MARKERS).toHaveLength(7);
  });

  it('when each registered label opens a title, should block and name that label', async () => {
    // given: the loaded list of registered page-state labels
    // when: one page per label opens its title with that label
    // then: each blocks as a negative marker and the detail echoes the label
    const { NEGATIVE_ROUTE_MARKERS, evaluateRouteIdentity } = await loadRouteIdentity();
    for (const marker of NEGATIVE_ROUTE_MARKERS) {
      const title = marker.charAt(0).toUpperCase() + marker.slice(1);
      const verdict = blocked(
        evaluateRouteIdentity({ route: '/settings', observation: { title } })
      );
      expect(verdict.signal, marker).toBe('negative-marker');
      expect(verdict.detail, marker).toContain(`"${marker}"`);
    }
  });
});

describe('Scenario: behavior — only unauthorized accepts the British spelling', () => {
  it('when a page is titled Unauthorised, should block as the unauthorized label', async () => {
    // given: the British spelling of the access label as a title
    // when: the route identity is evaluated
    // then: it blocks and the detail names the registered unauthorized label
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const verdict = blocked(
      evaluateRouteIdentity({ route: '/settings', observation: { title: 'Unauthorised' } })
    );
    expect(verdict.signal).toBe('negative-marker');
    expect(verdict.detail).toContain('"unauthorized"');
  });

  it('when a heading is Forbidden, should block as the forbidden label only', async () => {
    // given: the access label that must not borrow the unauthorized spelling class
    // when: the route identity is evaluated
    // then: it blocks as forbidden and is never reported as unauthorized
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const verdict = blocked(
      evaluateRouteIdentity({ route: '/settings', observation: { headings: ['Forbidden'] } })
    );
    expect(verdict.signal).toBe('negative-marker');
    expect(verdict.detail).toContain('"forbidden"');
    expect(verdict.detail).not.toContain('"unauthorized"');
  });

  it('when a heading merely resembles forbidden with an s, should stay inert', async () => {
    // given: a real page whose heading contains "Forbidsen", which is no page state
    // when: the route identity is evaluated with no declared marker
    // then: the [sz] class belongs to unauthorized alone, so nothing blocks
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    expect(
      evaluateRouteIdentity({ route: '/settings', observation: { headings: ['Forbidsen'] } })
    ).toEqual({ ok: true, inert: true });
  });
});

describe('Scenario: behavior — an unusable input count is no input count', () => {
  it('when the observed count is unusable, should report the unobserved marker only', async () => {
    // given: negative, zero, non-finite, string and absent input counts
    // when: each is evaluated against a declared marker the page never rendered
    // then: none is treated as a rendered form, so the unobserved marker decides
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const unusable: readonly unknown[] = [
      -1,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '2',
      undefined
    ];
    for (const value of unusable) {
      const verdict = blocked(
        evaluateRouteIdentity({
          route: '/settings',
          expectedMarker: 'Account settings',
          observation: { title: 'Ledgerly', renderedInputs: value as number }
        })
      );
      expect(verdict.signal, String(value)).toBe('marker-unobserved');
    }
  });

  it('when exactly one input rendered, should block as a rendered form and name one', async () => {
    // given: one rendered input and a declared marker the page never rendered
    // when: the route identity is evaluated
    // then: the positive count is a form wall and the detail carries the count
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const verdict = blocked(
      evaluateRouteIdentity({
        route: '/settings',
        expectedMarker: 'Account settings',
        observation: { title: 'Ledgerly', renderedInputs: 1 }
      })
    );
    expect(verdict.signal).toBe('rendered-form');
    expect(verdict.detail).toContain('1 form input(s)');
  });
});

describe('Scenario: behavior — status codes are a closed page-state list', () => {
  it('when each listed status code opens the title, should block and name HTTP code', async () => {
    // given: one page per code in the closed status-code list
    // when: each route identity is evaluated
    // then: every code blocks and the detail names the code that fired
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    for (const code of ['400', '401', '403', '404', '405', '500', '502', '503']) {
      const verdict = blocked(
        evaluateRouteIdentity({
          route: '/settings',
          observation: { title: `${code} Something went wrong` }
        })
      );
      expect(verdict.signal, code).toBe('negative-marker');
      expect(verdict.detail, code).toContain(`"HTTP ${code}"`);
    }
  });

  it('when a title merely starts with three digits, should stay inert', async () => {
    // given: real page titles beginning with a number that is not a page state
    // when: each route identity is evaluated with no declared marker
    // then: the closed list refuses them all and each page passes
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    for (const title of ['2024 Roadmap', '100 days', '99 Red Balloons']) {
      expect(evaluateRouteIdentity({ route: '/settings', observation: { title } }), title).toEqual({
        ok: true,
        inert: true
      });
    }
  });

  it('when a listed code appears mid-title, should stay inert', async () => {
    // given: real page titles that mention a status code after their first word
    // when: each route identity is evaluated with no declared marker
    // then: the label is anchored to the title start, so these pages pass
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    for (const title of ['Lease 404 renewal', 'Invoice 500 archive', 'Batch 403 summary']) {
      expect(evaluateRouteIdentity({ route: '/settings', observation: { title } }), title).toEqual({
        ok: true,
        inert: true
      });
    }
  });
});

describe('Scenario: render — a block names the surface that carried the text', () => {
  it('when the title carries the negative marker, should locate it in the page title', async () => {
    // given: a title that is the sign-in state
    // when: the route identity is evaluated
    // then: the detail says the text was found in the page title
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const verdict = blocked(
      evaluateRouteIdentity({ route: '/settings', observation: { title: 'Sign in' } })
    );
    expect(verdict.detail).toContain('in the page title');
    expect(verdict.detail).not.toContain('in a heading');
  });

  it('when a heading carries the negative marker, should locate it in a heading', async () => {
    // given: a heading that is the sign-in state and no title
    // when: the route identity is evaluated
    // then: the detail says the text was found in a heading
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const verdict = blocked(
      evaluateRouteIdentity({ route: '/settings', observation: { headings: ['Sign in'] } })
    );
    expect(verdict.detail).toContain('in a heading');
    expect(verdict.detail).not.toContain('in the page title');
  });
});

describe('Scenario: a11y — a block names what a reader needs', () => {
  it('when the British spelling blocks, should name the text, the label and the surface', async () => {
    // given: an Unauthorised title on a route that expected settings
    // when: the negative-marker block is rendered
    // then: a reader sees the exact page text, the registered label and the surface
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    const verdict = blocked(
      evaluateRouteIdentity({ route: '/settings', observation: { title: 'Unauthorised' } })
    );
    expect(verdict.detail).toContain('Unauthorised');
    expect(verdict.detail).toContain('"unauthorized"');
    expect(verdict.detail).toContain('in the page title');
    expect(verdict.detail).toContain('/settings');
    expect(verdict.detail).not.toMatch(/\p{Cc}/u);
  });
});

describe('Scenario: a11y — a control sequence cannot hide the marker', () => {
  it('when a control sequence prefixes page text, should still match the marker', async () => {
    // given: a "Sign in" title and a heading whose declared marker is split by an ANSI sequence
    // when: the route identity is evaluated
    // then: matching reads the sequence-free text, so both checks still fire
    const { evaluateRouteIdentity } = await loadRouteIdentity();
    for (const title of ['\u001b[31mSign in', '\u009b31mSign in', '\u001b]0;evil\u0007Sign in']) {
      const verdict = blocked(
        evaluateRouteIdentity({ route: '/settings', observation: { title } })
      );
      expect(verdict.signal, title).toBe('negative-marker');
    }
    const heading = { headings: ['Account\u001b[0m settings'] };
    expect(
      evaluateRouteIdentity({
        route: '/settings',
        expectedMarker: 'Account settings',
        observation: heading
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });
});
