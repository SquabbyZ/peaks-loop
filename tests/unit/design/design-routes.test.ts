import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { deriveChangedRoutes, routeForFile } from '../../../src/services/design/design-routes.js';

declareDimensions('tests/unit/design/design-routes.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const ROOTS = ['src/pages'];

describe('Scenario: behavior — one page file maps to one route', () => {
  it('should strip the page root and a trailing extension', () => {
    // given: a page file below src/pages with and without an extension
    // when: each is mapped to a route
    // then: the remainder is the route in both spellings
    expect(routeForFile('src/pages/about.tsx', ROOTS)).toBe('/about');
    expect(routeForFile('src/pages/about', ROOTS)).toBe('/about');
  });

  it('should collapse a trailing index to its directory', () => {
    // given: the root index and a nested index page
    // when: each is mapped to a route
    // then: the index segment disappears and the root maps to /
    expect(routeForFile('src/pages/index.tsx', ROOTS)).toBe('/');
    expect(routeForFile('src/pages/users/index.tsx', ROOTS)).toBe('/users');
  });

  it('should keep nested directories and strip only the final extension', () => {
    // given: a nested page and a dotted page name
    // when: each is mapped to a route
    // then: inner dots survive and the directory path is kept
    expect(routeForFile('src/pages/settings/profile.tsx', ROOTS)).toBe('/settings/profile');
    expect(routeForFile('src/pages/page.test.tsx', ROOTS)).toBe('/page.test');
  });

  it('should not treat a name starting with index as an index page', () => {
    // given: a page whose name merely begins with the word index
    // when: it is mapped to a route
    // then: the whole name is kept
    expect(routeForFile('src/pages/index2.tsx', ROOTS)).toBe('/index2');
  });

  it('should normalise an edge-dotted or trailing-slash page root', () => {
    // given: page roots spelled with a leading ./ and doubled trailing slashes
    // when: a page is mapped with each
    // then: only the edges are normalised and the route is unchanged
    expect(routeForFile('src/pages/about.tsx', ['./src/pages/'])).toBe('/about');
    expect(routeForFile('src/pages/about.tsx', ['src/pages//'])).toBe('/about');
  });

  it('should prefer the longest matching page root', () => {
    // given: two roots where one contains the other, and a page under the longer one
    // when: the page is mapped to a route
    // then: the longer root is stripped rather than the shorter one
    expect(routeForFile('src/pages/about.tsx', ['src', 'src/pages'])).toBe('/about');
  });

  it('should not match a sibling directory sharing the root prefix', () => {
    // given: a directory whose name starts with a page root but is not under it
    // when: the file is mapped to a route
    // then: the prefix alone is not a match
    expect(routeForFile('src/pagesX/about.tsx', ROOTS)).toBeNull();
  });

  it('should strip only a leading dot-slash from a page root', () => {
    // given: a page root that itself contains a dot segment after the leading one
    // when: a page under it is mapped
    // then: only the leading ./ is removed
    expect(routeForFile('src/./pages/a.tsx', ['src/./pages'])).toBe('/a');
  });

  it('should return null for the root itself and for a file outside every root', () => {
    // given: the page root path and a file in a different tree
    // when: each is mapped to a route
    // then: neither names a page
    expect(routeForFile('src/pages', ROOTS)).toBeNull();
    expect(routeForFile('src/lib/a.tsx', ROOTS)).toBeNull();
  });
});

describe('Scenario: integration — the changed-route set', () => {
  it('should list distinct routes in first-seen order', () => {
    // given: three changed pages where one route repeats
    // when: the change set is derived
    // then: the repeat is dropped and the order is preserved
    const derived = deriveChangedRoutes(['src/pages/b.tsx', 'src/pages/a.tsx', 'src/pages/b.tsx'], {
      pageRoots: ROOTS
    });

    expect(derived.routes).toEqual(['/b', '/a']);
    expect(derived.unknown).toEqual([]);
  });

  it('should record a UI file with no derivable route as unknown', () => {
    // given: a changed component file outside every page root
    // when: the change set is derived
    // then: it is reported as unknown rather than dropped or mapped
    const derived = deriveChangedRoutes(['src/components/Button.tsx'], { pageRoots: ROOTS });

    expect(derived.routes).toEqual([]);
    expect(derived.unknown).toEqual(['src/components/Button.tsx']);
  });

  it('should ignore a changed non-UI file outside the page roots', () => {
    // given: a changed data file in a non-page tree
    // when: the change set is derived
    // then: it is neither a route nor a route-unknown UI file
    const derived = deriveChangedRoutes(['src/lib/data.json'], { pageRoots: ROOTS });

    expect(derived.routes).toEqual([]);
    expect(derived.unknown).toEqual([]);
  });

  it('should ignore a changed path that is exactly the page root', () => {
    // given: a changed path naming the page root directory itself
    // when: the change set is derived
    // then: it names no page and is not reported as unknown
    const derived = deriveChangedRoutes(['src/pages'], { pageRoots: ROOTS });

    expect(derived.routes).toEqual([]);
    expect(derived.unknown).toEqual([]);
  });
});

describe('Scenario: render — a derived route is an absolute, extension-free path', () => {
  it('should start with a slash and never end with one', () => {
    // given: a root index and a nested page
    // when: each route is derived
    // then: both are absolute and neither has a trailing slash
    const routes = deriveChangedRoutes(
      ['src/pages/index.tsx', 'src/pages/users/index.tsx', 'src/pages/settings/profile.tsx'],
      { pageRoots: ROOTS }
    ).routes;

    expect(routes).toEqual(['/', '/users', '/settings/profile']);
    for (const route of routes) {
      expect(route.startsWith('/')).toBe(true);
      expect(route === '/' || !route.endsWith('/')).toBe(true);
    }
  });
});

describe('Scenario: a11y — an unknown route names the file a reader must move', () => {
  it('should report the app-relative path verbatim', () => {
    // given: a changed UI file outside the page roots
    // when: the unknown list is derived
    // then: it carries the exact path, so the evidence can tell its author where to move it
    const derived = deriveChangedRoutes(['src/widgets/Chart.tsx'], { pageRoots: ROOTS });

    expect(derived.unknown).toEqual(['src/widgets/Chart.tsx']);
  });
});
