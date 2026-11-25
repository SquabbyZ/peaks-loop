import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  EVIDENCE_DETAIL_MAX,
  EVIDENCE_SNIPPET_MAX
} from '../../../src/services/design/evidence-text.js';
import {
  evaluateRouteIdentity,
  NEGATIVE_ROUTE_MARKERS,
  type RouteIdentityInput,
  type RouteIdentityVerdict
} from '../../../src/services/design/route-identity.js';

declareDimensions(
  'tests/unit/design/route-identity.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'the evaluator is a pure function: no fs, network, process or clock boundary'
    }
  ]
);

/** Evaluate with a default route so each case states only what it varies. */
function evaluate(overrides: Partial<RouteIdentityInput> = {}): RouteIdentityVerdict {
  return evaluateRouteIdentity({
    route: '/settings',
    observation: {},
    ...overrides
  });
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

describe('Scenario: render — the verdict names its shape', () => {
  it('when nothing was observed, should return the inert shape and no marker', () => {
    // given: an observation that carries no text and no inputs
    // when: the route identity is evaluated
    // then: the verdict is an inert ok with neither a marker nor a signal
    expect(evaluate()).toEqual({ ok: true, inert: true });
  });

  it('when the declared marker is observed, should return an ok naming the declared marker', () => {
    // given: a declared marker that the rendered heading carries
    // when: the route identity is evaluated
    // then: the ok names the declared marker and is not inert
    expect(
      evaluate({
        expectedMarker: 'Account settings',
        observation: { headings: ['Account settings'] }
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });

  it('when a negative marker is observed, should return the route-mismatch block shape', () => {
    // given: a heading that starts with a negative marker
    // when: the route identity is evaluated
    // then: the block carries the fixed code and the negative-marker signal
    const verdict = blocked(evaluate({ observation: { headings: ['Sign in'] } }));
    expect(verdict.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(verdict.signal).toBe('negative-marker');
    expect(typeof verdict.detail).toBe('string');
  });
});

describe('Scenario: behavior — each signal decides alone and in order', () => {
  it('when a heading starts with a negative marker, should block as negative-marker', () => {
    // given: a page whose only signal is a "Page Not Found" heading
    // when: the route identity is evaluated
    // then: the block names the negative-marker signal
    expect(blocked(evaluate({ observation: { headings: ['Page Not Found'] } })).signal).toBe(
      'negative-marker'
    );
  });

  it('when inputs render but the declared marker is absent, should block as rendered-form', () => {
    // given: a declared marker and an observation that shows only two inputs
    // when: the route identity is evaluated
    // then: the form wall is a rendered-form block
    expect(
      blocked(evaluate({ expectedMarker: 'Account settings', observation: { renderedInputs: 2 } }))
        .signal
    ).toBe('rendered-form');
  });

  it('when a settings page shows inputs and its declared marker, should not block', () => {
    // given: the measured settings shape — two inputs plus "Account settings"
    // when: the route identity is evaluated
    // then: the observed declared marker wins over the input count
    expect(
      evaluate({
        expectedMarker: 'Account settings',
        observation: { headings: ['Account settings', 'Change password'], renderedInputs: 2 }
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });

  it('when the declared marker is absent from a constant title, should block as marker-unobserved', () => {
    // given: the measured SPA shape — one constant title and a declared marker it lacks
    // when: the route identity is evaluated
    // then: the route's own declaration was not answered, so the stage blocks
    expect(
      blocked(
        evaluate({ expectedMarker: 'No About Content Set', observation: { title: 'ModelMatrix' } })
      ).signal
    ).toBe('marker-unobserved');
  });

  it('when the declared marker is observed beside a negative heading, should keep the marker', () => {
    // given: a real page whose own heading carries the marker and leaks a "Sign in" heading
    // when: the route identity is evaluated
    // then: the declared marker outranks the negative heuristic
    expect(
      evaluate({
        expectedMarker: 'About this app',
        observation: {
          headings: ['About this app', 'Sign in'],
          buttonPatterns: ['sign in'],
          renderedInputs: 2
        }
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });

  it('when a negative marker and rendered inputs both appear, should report the negative marker', () => {
    // given: a sign-in wall with two inputs and a sign-in heading
    // when: the route identity is evaluated
    // then: the negative marker is reported before the form wall
    expect(
      blocked(
        evaluate({
          expectedMarker: 'Account settings',
          observation: { headings: ['Sign in'], renderedInputs: 2 }
        })
      ).signal
    ).toBe('negative-marker');
  });

  it('when the marker differs only by case, should still observe it', () => {
    // given: a lowercase declared marker and a title-cased heading
    // when: the route identity is evaluated
    // then: the comparison is case-insensitive
    expect(
      evaluate({
        expectedMarker: 'account settings',
        observation: { headings: ['Account Settings — Profile'] }
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });

  it('when a heading merely mentions a negative phrase mid-sentence, should not block', () => {
    // given: a real docs heading that contains "not found" after its first word
    // when: the route identity is evaluated
    // then: the negative markers are anchored and the page stays inert
    expect(evaluate({ observation: { headings: ['How to handle not found pages'] } })).toEqual({
      ok: true,
      inert: true
    });
  });

  it('when the route declares nothing, should stay inert even with rendered text', () => {
    // given: a rendered page whose route declared no marker
    // when: the route identity is evaluated
    // then: the stage never guesses a wrong route from generic text
    expect(
      evaluate({
        route: '/reports',
        observation: { title: 'ModelMatrix', headings: ['Quarterly reports'] }
      })
    ).toEqual({ ok: true, inert: true });
  });
});

describe('Scenario: behavior — page identity decides, shared chrome never does', () => {
  it('when only a header button says Sign in and nothing is declared, should stay inert', () => {
    // given: the pilot's /about shape — a benign heading and a site-wide Sign in button
    // when: the route identity is evaluated with no declared marker
    // then: shared chrome is not evidence of another route and the page passes
    expect(
      evaluate({
        route: '/about',
        observation: {
          title: 'ModelMatrix',
          headings: ['No About Content Set'],
          buttonPatterns: ['change language', 'toggle theme', 'sign in']
        }
      })
    ).toEqual({ ok: true, inert: true });
  });

  it('when the title starts with Sign In, should block as negative-marker', () => {
    // given: a page whose title — a page-identity surface — is the sign-in state
    // when: the route identity is evaluated
    // then: the negative marker blocks even though it came from the title
    expect(blocked(evaluate({ observation: { title: 'Sign In · ModelMatrix' } })).signal).toBe(
      'negative-marker'
    );
  });

  it('when sample text says Page Not Found and nothing is declared, should stay inert', () => {
    // given: anatomy sample text that names a not-found state, with no declaration
    // when: the route identity is evaluated
    // then: sample text is shared chrome and cannot block on its own
    expect(evaluate({ observation: { sampleText: ['Page Not Found'] } })).toEqual({
      ok: true,
      inert: true
    });
  });

  it('when the declared marker appears only in a button label, should stay unobserved', () => {
    // given: the round-6 critical — the sidebar's "channels" link says a declared "Channels"
    // when: the route identity is evaluated for a two-input sign-in wall
    // then: chrome cannot satisfy the declaration, so the form wall blocks
    expect(
      blocked(
        evaluate({
          route: '/channels',
          expectedMarker: 'Channels',
          observation: {
            title: 'ModelMatrix',
            headings: [],
            buttonPatterns: ['channels', 'sign in'],
            renderedInputs: 2
          }
        })
      ).signal
    ).toBe('rendered-form');
  });

  it('when the declared marker appears only in anatomy sample text, should stay unobserved', () => {
    // given: a declared marker carried only by the component anatomy sample text
    // when: the route identity is evaluated
    // then: sample text is chrome, so the unobserved declaration blocks
    expect(
      blocked(
        evaluate({
          expectedMarker: 'Quarterly reports',
          observation: { title: 'ModelMatrix', sampleText: ['Quarterly reports Q1'] }
        })
      ).signal
    ).toBe('marker-unobserved');
  });

  it('when the pilot /about page declares About and renders it in a heading, should pass', () => {
    // given: the measured /about row — declared "About", heading "No About Content Set", header button
    // when: the route identity is evaluated
    // then: the declaration is observed in the heading, so a real page is not blocked by chrome
    expect(
      evaluate({
        route: '/about',
        expectedMarker: 'About',
        observation: {
          title: 'ModelMatrix',
          headings: ['No About Content Set'],
          buttonPatterns: ['change language', 'toggle theme', 'sign in']
        }
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });

  it('when a declared heading is present beside a header Sign in button, should keep declared-marker', () => {
    // given: the marker the route declared, next to the global header's button
    // when: the route identity is evaluated
    // then: the observed declaration wins and the chrome is ignored
    expect(
      evaluate({
        expectedMarker: 'About',
        observation: { headings: ['About'], buttonPatterns: ['sign in'] }
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });
});

describe('Scenario: behavior — the negative list is the seven page-state labels', () => {
  it('when every negative marker opens the title, should block for each one', () => {
    // given: one page per registered negative marker, opening its title
    // when: each route identity is evaluated
    // then: every marker blocks as negative-marker and the list is exactly seven
    expect(NEGATIVE_ROUTE_MARKERS).toEqual([
      'page not found',
      'not found',
      'sign in',
      'log in',
      'unauthorized',
      'forbidden',
      'access denied'
    ]);
    for (const marker of NEGATIVE_ROUTE_MARKERS) {
      const title = marker.charAt(0).toUpperCase() + marker.slice(1);
      expect(blocked(evaluate({ observation: { title } })).signal, marker).toBe('negative-marker');
    }
  });

  it('when a real page is titled Error handling, should not block on a bare error', () => {
    // given: the round-6 false block — a real page whose title opens with "Error"
    // when: the route identity is evaluated with no declared marker
    // then: "error" is not a negative marker and the page stays inert
    expect(evaluate({ observation: { title: 'Error handling' } })).toEqual({
      ok: true,
      inert: true
    });
    expect(NEGATIVE_ROUTE_MARKERS).not.toContain('error');
  });
});

describe('Scenario: behavior — status codes and access labels are page states', () => {
  it('when the title is a 404 status label, should block and name HTTP 404', () => {
    // given: the most common SPA 404 shape — a title opening with the status code
    // when: the route identity is evaluated with no declared marker
    // then: the block is negative-marker and its detail names the code that fired
    const verdict = blocked(evaluate({ observation: { title: '404 Not Found' } }));
    expect(verdict.signal).toBe('negative-marker');
    expect(verdict.detail).toContain('"404 Not Found"');
    expect(verdict.detail).toContain('"HTTP 404"');
  });

  it('when every status code opens the title, should block and name that code', () => {
    // given: one page per code in the closed status-code list
    // when: each route identity is evaluated
    // then: every code blocks as negative-marker and names itself in the detail
    for (const code of ['400', '401', '403', '404', '405', '500', '502', '503']) {
      const verdict = blocked(evaluate({ observation: { title: `${code} Something went wrong` } }));
      expect(verdict.signal, code).toBe('negative-marker');
      expect(verdict.detail, code).toContain(`"HTTP ${code}"`);
    }
  });

  it('when a heading is Forbidden, should block as negative-marker', () => {
    // given: an access wall whose heading is the access label
    // when: the route identity is evaluated
    // then: the access label blocks like the not-found and sign-in states
    const verdict = blocked(evaluate({ observation: { headings: ['Forbidden'] } }));
    expect(verdict.signal).toBe('negative-marker');
    expect(verdict.detail).toContain('"forbidden"');
  });

  it('when a heading is Access denied, should block as negative-marker', () => {
    // given: an access wall whose heading is the two-word access label
    // when: the route identity is evaluated
    // then: the anchored, hyphen-tolerant pattern matches the label
    expect(blocked(evaluate({ observation: { headings: ['Access denied'] } })).signal).toBe(
      'negative-marker'
    );
  });

  it('when a real page is titled 2024 Roadmap, should not block', () => {
    // given: a title opening with four digits that are not a status code
    // when: the route identity is evaluated with no declared marker
    // then: the code list is closed, so the page stays inert
    expect(evaluate({ observation: { title: '2024 Roadmap' } })).toEqual({
      ok: true,
      inert: true
    });
  });

  it('when a status-code title carries the declared marker, should keep declared-marker', () => {
    // given: "404 channels indexed" — the accepted false block — declared as a real route
    // when: the route identity is evaluated
    // then: the observed declared marker wins over the negative status-code label
    expect(
      evaluate({
        route: '/channels',
        expectedMarker: 'channels indexed',
        observation: { title: '404 channels indexed' }
      })
    ).toEqual({ ok: true, marker: 'declared-marker' });
  });
});

describe('Scenario: a11y — every block names the measured text', () => {
  it('when a negative marker blocks, should name the text, its marker and its surface', () => {
    // given: a sign-in heading on a route that expected settings
    // when: the negative-marker block is rendered
    // then: a reader can see the exact text and the marker it matched
    const verdict = blocked(evaluate({ observation: { headings: ['Sign in'] } }));
    expect(verdict.detail).toContain('"Sign in"');
    expect(verdict.detail).toContain('"sign in"');
    expect(verdict.detail).toContain('a heading');
    expect(verdict.detail).toContain('/settings');
  });

  it('when the form wall blocks, should name the input count and the missing marker', () => {
    // given: two inputs and an unobserved declared marker
    // when: the rendered-form block is rendered
    // then: the detail carries the count, the marker and the route
    const verdict = blocked(
      evaluate({ expectedMarker: 'Account settings', observation: { renderedInputs: 2 } })
    );
    expect(verdict.detail).toContain('2 form input(s)');
    expect(verdict.detail).toContain('"Account settings"');
    expect(verdict.detail).toContain('/settings');
  });

  it('when the marker is unobserved, should name the marker and the identity surfaces', () => {
    // given: a declared marker the page never rendered
    // when: the marker-unobserved block is rendered
    // then: the detail names the marker and the route, and claims no chrome surface
    const verdict = blocked(
      evaluate({ expectedMarker: 'Quarterly reports', observation: { title: 'ModelMatrix' } })
    );
    expect(verdict.detail).toContain('"Quarterly reports"');
    expect(verdict.detail).toContain('/settings');
    expect(verdict.detail).toContain('the page title or a heading');
    expect(verdict.detail).not.toContain('button label');
    expect(verdict.detail).not.toContain('sample text');
  });

  it('when any signal blocks, should never mention a score', () => {
    // given: one observation per remaining block signal
    // when: each block is rendered
    // then: the verdict is a block with a named signal, never a score
    const verdicts = [
      evaluate({ observation: { headings: ['Unauthorized access'] } }),
      evaluate({ expectedMarker: 'Account settings', observation: { renderedInputs: 2 } }),
      evaluate({ expectedMarker: 'Quarterly reports', observation: { title: 'ModelMatrix' } })
    ];
    for (const verdict of verdicts) {
      expect(blocked(verdict).detail.toLowerCase()).not.toContain('score');
    }
  });
});

describe('Scenario: a11y — echoed page text loses control bytes and is bounded', () => {
  it('when a heading carries ANSI control bytes, should strip them from the detail', () => {
    // given: a sign-in heading with an ESC colour sequence and a C1 byte
    // when: the negative-marker detail is rendered
    // then: no control byte survives and the readable text does
    const verdict = blocked(
      evaluate({ observation: { headings: ['Sign in\u001b[31m now\u009b2K'] } })
    );
    expect(verdict.detail).not.toMatch(/\p{Cc}/u);
    expect(verdict.detail).toContain('Sign in');
  });

  it('when a heading carries a CSI clear-screen sequence, should drop its tail too', () => {
    // given: a sign-in heading followed by an ESC[2J clear-screen sequence
    // when: the negative-marker detail is rendered
    // then: neither the ESC byte nor the printable parameter tail survives
    const verdict = blocked(evaluate({ observation: { headings: ['Sign in\u001b[2J'] } }));
    expect(verdict.detail).not.toMatch(/\p{Cc}/u);
    expect(verdict.detail).not.toContain('[2J');
    expect(verdict.detail).toContain('Sign in');
  });

  it('when a heading is longer than the echo bound, should cap it with an ellipsis', () => {
    // given: a sign-in heading followed by 200 characters of page text
    // when: the negative-marker detail is rendered
    // then: the echoed surface is at most 120 characters, ending in an ellipsis
    const heading = `Sign in ${'x'.repeat(200)}`;
    const verdict = blocked(evaluate({ observation: { headings: [heading] } }));
    expect(verdict.detail).toContain(`"${heading.slice(0, EVIDENCE_SNIPPET_MAX - 1)}…"`);
    expect(verdict.detail).not.toContain('x'.repeat(EVIDENCE_SNIPPET_MAX));
  });

  it('when every echoed surface is maximal, should cap the whole detail', () => {
    // given: a maximal heading and a maximal route label, each 120 characters
    // when: the negative-marker detail is rendered
    // then: the whole detail is capped at 300 characters and says it was cut
    const verdict = blocked(
      evaluate({
        route: `/${'r'.repeat(400)}`,
        observation: { headings: [`Sign in ${'x'.repeat(400)}`] }
      })
    );
    expect(verdict.detail).toHaveLength(EVIDENCE_DETAIL_MAX);
    expect(verdict.detail.endsWith('…')).toBe(true);
  });
});

describe('Scenario: behavior — an empty declaration is no declaration', () => {
  it('when the declared marker sanitises to nothing, should stay inert and never pass', () => {
    // given: markers of only control bytes and only whitespace
    // when: each is evaluated against a benign page and a sign-in page
    // then: none declares anything, so one page is inert and the other blocks
    for (const expectedMarker of ['\u0007', '\u0000\u0001', '   ']) {
      const benign = { expectedMarker, observation: { title: 'Ledgerly' } };
      expect(evaluate(benign)).toEqual({ ok: true, inert: true });
      const signIn = { expectedMarker, observation: { title: 'Sign in' } };
      expect(blocked(evaluate(signIn)).signal).toBe('negative-marker');
    }
  });
});
