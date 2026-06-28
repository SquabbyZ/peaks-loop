/**
 * Red-line catalog — the 5 P0 red lines shipped in L2.1, plus the marker
 * patterns that the classifier uses to discover them in markdown.
 *
 * The catalog is hand-maintained. New enforcers (L2.2/2.3/2.4) add entries
 * here and the backing-detector picks them up automatically.
 */

import type { RedLineMarker } from './types.js';
import { RED_LINE_CATALOG_P2_A } from './red-line-catalog-p2-a.js';
import { RED_LINE_CATALOG_P2_B } from './red-line-catalog-p2-b.js';

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
  // === Slice L2.2 P1 — 10 P1 red lines across 5 categories ===
  // Each catalog entry has a phrase that distinguishes it from P0; the
  // backing-detector + DEFERRED_ENFORCERS mechanism handles the rest.
  {
    id: 'rl-resume-detection-001',
    rule: 'Resume Detection: Session Binding',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: ['resume detection', 'session binding', 'resume session', 'resume from'],
    enforcerRef: 'src/services/audit/enforcers/resume-detection.ts',
  },
  {
    id: 'rl-resume-detection-002',
    rule: 'Resume Detection: Request State',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: ['request state', 'resumable state', 'spec-locked', 'implemented', 'qa-handoff'],
    enforcerRef: 'src/services/audit/enforcers/resume-detection.ts',
  },
  {
    id: 'rl-prototype-fidelity-001',
    rule: 'Prototype Fidelity: No Stub Markers',
    markers: ['MUST NOT', 'MANDATORY'],
    phrases: ['prototype fidelity', 'no stub', 'no TODO', 'no FIXME', 'no placeholder'],
    enforcerRef: 'src/services/audit/enforcers/prototype-fidelity.ts',
  },
  {
    id: 'rl-prototype-fidelity-002',
    rule: 'Prototype Fidelity: Test Coverage',
    markers: ['MANDATORY', 'RED LINE'],
    phrases: ['prototype test', 'must have tests', 'test coverage', 'fidelity test'],
    enforcerRef: 'src/services/audit/enforcers/prototype-fidelity.ts',
  },
  {
    id: 'rl-design-draft-confirm-001',
    rule: 'Design-Draft Confirm: Existence',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: ['design-draft', 'design draft', 'design-draft.md', 'design draft exists'],
    enforcerRef: 'src/services/audit/enforcers/design-draft-confirm.ts',
  },
  {
    id: 'rl-design-draft-confirm-002',
    rule: 'Design-Draft Confirm: Confirmed State',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: ['design confirmed', 'design-draft confirmed', 'confirmed-by-user', 'user confirmed'],
    enforcerRef: 'src/services/audit/enforcers/design-draft-confirm.ts',
  },
  {
    id: 'rl-pre-rd-scan-001',
    rule: 'Pre-RD Scan: Archetype Detected',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: ['pre-rd scan', 'project-scan', 'archetype detected', 'scan archetype'],
    enforcerRef: 'src/services/audit/enforcers/pre-rd-scan.ts',
  },
  {
    id: 'rl-pre-rd-scan-002',
    rule: 'Pre-RD Scan: Standards Preflight',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: ['standards preflight', 'pre-rd standards', 'standards init', 'standards update'],
    enforcerRef: 'src/services/audit/enforcers/pre-rd-scan.ts',
  },
  {
    id: 'rl-login-gate-001',
    rule: 'Login Gate: Destructive Path Confirmation',
    markers: ['MANDATORY', 'BLOCKING', 'RED LINE'],
    phrases: ['login gate', 'destructive path', 'uninstall', 'force-push', 'user confirmation required'],
    enforcerRef: 'src/services/audit/enforcers/login-gate.ts',
  },
  {
    id: 'rl-login-gate-002',
    rule: 'Login Gate: Protected Path Auth',
    markers: ['MANDATORY', 'BLOCKING'],
    phrases: ['protected path', 'auth required', 'auth header', 'login required', 'session check'],
    enforcerRef: 'src/services/audit/enforcers/login-gate.ts',
  },
  // Slice #6 L2.3 P2-a: 24 lint-style red-lines (Theme A: section
  // structure, B: frontmatter shape, C: output style, D: CLI-back
  // gaps, E: reference integrity, F: workflow-bound shape, G: catalog
  // governance). Spread from the P2-a module so future P2-a edits
  // are localized.
  ...RED_LINE_CATALOG_P2_A,
  // Slice #7 L2.4 P2-b: 25 lint-style red-lines for references/*.md
  // (Themes H-P) + 4 audit-regression enforcers (Theme L). Spread
  // from the P2-b module so future P2-b edits are localized.
  ...RED_LINE_CATALOG_P2_B,
] as const;

/**
 * Catalog entries for enforcers whose source code is shipped in this slice
 * but whose integration is deferred to subsequent slices (L2.1.1 or later).
 *
 * The backing-detector downgrades these to `prose-only` at runtime because
 * the integration seam is missing. When the integration lands, the entry
 * is removed from this set in a single-line follow-up commit.
 *
 * L2.1 final state: Tasks 5 (solo-code-ban) + 6 (no-root-pollution) are
 * wired into peaks hook handle (Tasks 1-4: framework + 3 enforcers also
 * integrated). Tasks 3 (tech-doc-presence) and 4 (mock-placement) are
 * deferred — their request-transition / slice-check integrations are
 * tracked separately.
 */
// v2.14.0 Slice C Group G3: prose-only catalog governance reform.
// All 8 previously-deferred enforcers are now integrated into the
// red-lines audit pipeline (see red-lines-service.ts §3-7). The
// backing-detector re-classifies these entries as cli-backed because
// their enforcerRef file exists on disk. Rationale per id lives in
// `.peaks/standards/catalog-governance/v2-14-classifications.md`.
//
// The 80 discovered-prose-only entries (`rl-discovered-...` ids) remain
// in the catalog with `informational: true` and stay outside the
// prose-only ratio (see prose-ratio-calculator.ts).
export const DEFERRED_ENFORCERS: ReadonlySet<string> = new Set([]);

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
