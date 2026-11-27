/**
 * The refresh plan: which entries a moved token reaches, which pages were named
 * for re-measurement, and which dependent routes a base URL can still address.
 * Nothing here captures a page; the command owns that step.
 */
import {
  affectedEntries,
  type AffectedEntries,
  type RefreshTarget
} from '../../services/design/layout/layout-graph-incremental.js';
import { keyText } from '../../services/design/layout/layout-graph-paths.js';
import type { Viewport } from '../../services/design/layout/layout-geometry.js';
import type { SpacingToken } from '../../services/design/layout/layout-tokens.js';
import {
  DEFAULT_STATE,
  EXIT_REFUSED,
  trustedUrl,
  type DesignLayoutRefreshOptions,
  type Failure
} from './design-layout-shared.js';

type PageTarget = { route: string; url: string };

export type NotAddressed = { key: string; reason: string };

export type RefreshPlan = {
  affected: AffectedEntries;
  explicit: RefreshTarget[];
  derived: RefreshTarget[];
  notAddressed: NotAddressed[];
};

export function parsePage(raw: string): PageTarget | null {
  const at = raw.indexOf('=');
  if (at <= 0) return null;
  const route = raw.slice(0, at).trim();
  const url = raw.slice(at + 1).trim();
  return route === '' || url === '' ? null : { route, url };
}

function trusted(options: DesignLayoutRefreshOptions, url: string): boolean {
  return trustedUrl({
    project: options.project,
    ...(options.app === undefined ? {} : { app: options.app }),
    url
  });
}

/** Why the named pages cannot be used, or null when every one of them is usable. */
export function pageRefusal(options: DesignLayoutRefreshOptions): Failure | null {
  if (options.page.length === 0) {
    return {
      code: 'DESIGN_LAYOUT_PAGE_REQUIRED',
      message: 'name at least one page as route=url',
      exit: EXIT_REFUSED
    };
  }
  for (const raw of options.page) {
    const page = parsePage(raw);
    if (page === null) {
      return {
        code: 'DESIGN_LAYOUT_PAGE_INVALID',
        message: 'a page must be route=url with both parts non-empty',
        exit: EXIT_REFUSED
      };
    }
    if (!trusted(options, page.url)) {
      return {
        code: 'DESIGN_LAYOUT_URL_UNTRUSTED',
        message: 'a page URL is outside the trust boundary',
        data: { route: page.route },
        exit: EXIT_REFUSED
      };
    }
  }
  return null;
}

function pageTargets(
  options: DesignLayoutRefreshOptions,
  viewports: readonly Viewport[]
): RefreshTarget[] {
  const state = options.state ?? DEFAULT_STATE;
  const targets: RefreshTarget[] = [];
  for (const raw of options.page) {
    const page = parsePage(raw);
    if (page === null) continue;
    for (const viewport of viewports) {
      targets.push({ route: page.route, url: page.url, state, viewport });
    }
  }
  return targets;
}

function coveredKeys(targets: readonly RefreshTarget[]): Set<string> {
  return new Set(
    targets.map((target) =>
      keyText({ route: target.route, state: target.state, viewport: target.viewport })
    )
  );
}

/** The addressed URL, or an empty string when the base cannot form the route. */
function derivedUrl(route: string, baseUrl: string): string {
  try {
    return new URL(route, baseUrl).toString();
  } catch {
    return '';
  }
}

/** Address one affected entry without guessing: default state and a base URL only. */
function deriveOne(
  key: { route: string; state: string; viewport: Viewport },
  options: DesignLayoutRefreshOptions
): RefreshTarget | NotAddressed {
  const text = keyText(key);
  if (key.state !== DEFAULT_STATE) {
    return { key: text, reason: `state "${key.state}" has no recorded entry address` };
  }
  if (options.baseUrl === undefined) return { key: text, reason: 'no base URL was supplied' };
  const url = derivedUrl(key.route, options.baseUrl);
  if (url === '') return { key: text, reason: 'the base URL cannot form this route' };
  if (!trusted(options, url)) {
    return { key: text, reason: 'the derived URL is outside the trust boundary' };
  }
  return { route: key.route, url, state: key.state, viewport: key.viewport };
}

function isTarget(value: RefreshTarget | NotAddressed): value is RefreshTarget {
  return 'url' in value;
}

/** The explicit pages plus every affected entry that a base URL can address. */
export function planRefresh(
  options: DesignLayoutRefreshOptions,
  projectRoot: string,
  viewports: readonly Viewport[],
  tokens: readonly SpacingToken[]
): RefreshPlan {
  const affected = affectedEntries(projectRoot, tokens);
  const explicit = pageTargets(options, viewports);
  const covered = coveredKeys(explicit);
  const derived: RefreshTarget[] = [];
  const notAddressed: NotAddressed[] = [];
  for (const key of affected.affected) {
    if (covered.has(keyText(key))) continue;
    const addressed = deriveOne(key, options);
    if (isTarget(addressed)) derived.push(addressed);
    else notAddressed.push(addressed);
  }
  return { affected, explicit, derived, notAddressed };
}

/** The entries this run treats as moved; a full recompute treats the named pages so. */
export function movedKeysOf(plan: RefreshPlan): Set<string> {
  if (plan.affected.mode === 'full') return coveredKeys(plan.explicit);
  return new Set(plan.affected.affected.map(keyText));
}
