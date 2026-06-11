/**
 * Red-line catalog — the 5 P0 red lines shipped in L2.1, plus the marker
 * patterns that the classifier uses to discover them in markdown.
 *
 * The catalog is hand-maintained. New enforcers (L2.2/2.3/2.4) add entries
 * here and the backing-detector picks them up automatically.
 */

import type { RedLineMarker } from './types.js';

export interface RedLineCatalogEntry {
  /** Stable id, e.g. "rl-solo-code-ban-001". */
  readonly id: string;
  readonly rule: string;
  /** Markers that, if found near the rule's text, identify this red line. */
  readonly markers: readonly RedLineMarker[];
  /** Substring(s) that must appear in the surrounding ±2 lines. */
  readonly phrases: readonly string[];
  /** Relative path to the enforcement file (or null when prose-only). */
  readonly enforcerRef: string | null;
}

export const RED_LINE_CATALOG: readonly RedLineCatalogEntry[] = [
  {
    id: 'rl-solo-code-ban-001',
    rule: 'Solo Code-Change Red Line',
    markers: ['BLOCKING', 'MANDATORY'],
    phrases: [
      'peaks-solo',
      'orchestrator, NOT an implementer',
      'solo',
    ],
    enforcerRef: 'src/services/audit/enforcers/solo-code-ban.ts',
  },
  {
    id: 'rl-no-root-pollution-001',
    rule: 'No Root Pollution',
    markers: ['MANDATORY', 'MUST NOT', 'RED LINE'],
    phrases: [
      'root pollution',
      'must not write to the project root',
      'no root',
    ],
    enforcerRef: 'src/services/audit/enforcers/no-root-pollution.ts',
  },
  {
    id: 'rl-sub-agent-sid-001',
    rule: 'Sub-Agent SID Isolation',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: [
      'sub-agent',
      'session id',
      'sub-agent session sharing',
      'one conversation = one sid',
    ],
    enforcerRef: 'src/services/audit/enforcers/sub-agent-sid.ts',
  },
  {
    id: 'rl-tech-doc-presence-001',
    rule: 'Tech-Doc Presence',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: [
      'tech-doc',
      'tech doc',
      'spec-locked',
      'rd/tech-doc.md',
    ],
    enforcerRef: 'src/services/audit/enforcers/tech-doc-presence.ts',
  },
  {
    id: 'rl-mock-placement-001',
    rule: 'Mock Data Placement',
    markers: ['MUST NOT', 'MANDATORY'],
    phrases: [
      'mock data',
      'mock placement',
      'inline mock',
      'fixture placement',
    ],
    enforcerRef: 'src/services/audit/enforcers/mock-placement.ts',
  },
] as const;

/**
 * Catalog entries for enforcers whose source code is shipped in this slice
 * but whose integration (wiring into PreToolUse hooks, request transition,
 * slice check) is deferred to subsequent commits within L2.1.
 *
 * The backing-detector downgrades these to `prose-only` at runtime because
 * the integration seam is missing. Once each enforcer's integration lands
 * (Tasks 4-6), the entry is moved out of this list back into RED_LINE_CATALOG.
 */
export const DEFERRED_ENFORCERS: ReadonlySet<string> = new Set([
  // Task 5: solo-code-ban — needs PreToolUse Bash wiring
  'rl-solo-code-ban-001',
  // Task 6: no-root-pollution — needs PreToolUse Write/Edit wiring
  'rl-no-root-pollution-001',
]);

/**
 * A red line's catalog id is the join key. If a discovered red line in a
 * markdown file matches no catalog entry, it stays as `prose-only`.
 *
 * Match policy: phrase-only for identity. Markers (MANDATORY / BLOCKING /
 * MUST NOT / RED LINE) are too generic to disambiguate — every catalog
 * entry shares the same marker set, so a marker-only match would always
 * return the first catalog entry regardless of the rule.
 *
 * Deferred enforcers (Tasks 4-6 integration pending) are matched by
 * phrase but tagged with enforcerRef=null so the backing-detector
 * downgrades them to prose-only at runtime. They are NOT removed from
 * the catalog so future integration commits can re-tag them with a
 * single source-of-truth change.
 */
export function findCatalogEntry(rule: string, _markers: readonly RedLineMarker[]): RedLineCatalogEntry | null {
  const lower = rule.toLowerCase();
  for (const entry of RED_LINE_CATALOG) {
    const phraseHit = entry.phrases.some((p) => lower.includes(p.toLowerCase()));
    if (phraseHit) {
      if (DEFERRED_ENFORCERS.has(entry.id)) {
        // Return a copy with enforcerRef nulled out, so backing-detector
        // treats it as prose-only until the integration lands.
        return { ...entry, enforcerRef: null };
      }
      return entry;
    }
  }
  return null;
}
