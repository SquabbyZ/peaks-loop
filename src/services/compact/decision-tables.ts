/**
 * Strategic-compact decision tables (slice 2026-07-01-strategic-compact-cli).
 *
 * Pure data + lookup helpers. No I/O. The byte-for-byte text mirrors the
 * "Compaction Decision Guide" + "What Survives Compaction" tables in
 * ECC's strategic-compact SKILL.md (read-only reference at
 * C:\Users\smallMark\.claude\plugins\cache\ecc\ecc\2.0.0\skills\strategic-compact\SKILL.md).
 *
 * The `peaks compact recommend` + `peaks compact survival` + `peaks
 * compact dry-run` primitives read from these tables; any change to the
 * upstream skill table must be mirrored here and re-asserted by the
 * `tests/unit/cli/compact-command.test.ts` regression suite.
 */

export type Phase = 'research' | 'planning' | 'implementation' | 'testing' | 'debugging';
export const PHASES: readonly Phase[] = [
  'research',
  'planning',
  'implementation',
  'testing',
  'debugging'
] as const;

export function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}

/** Severity for a phase transition: matches the SKILL.md "Compact?" column. */
export type Severity = 'yes' | 'maybe' | 'no';

export interface PhaseTransitionDecision {
  readonly from: Phase;
  readonly to: Phase;
  readonly severity: Severity;
  readonly rationale: string;
}

/**
 * Single source of truth for the strategic-compact "Compaction Decision
 * Guide" table. Each row is a recommended from→to transition. The
 * `rationale` field is the "Why" column verbatim from SKILL.md.
 *
 * The CLI accepts arbitrary from/to phase pairs; if the pair is not in
 * the table (e.g. testing→implementation) the recommend primitive
 * returns `severity: 'no'` with a `notInTable: true` flag and the
 * default rationale "No documented transition; preserve context".
 */
export const PHASE_TRANSITIONS: readonly PhaseTransitionDecision[] = [
  {
    from: 'research',
    to: 'planning',
    severity: 'yes',
    rationale: 'Research context is bulky; plan is the distilled output'
  },
  {
    from: 'planning',
    to: 'implementation',
    severity: 'yes',
    rationale: 'Plan is in TodoWrite or a file; free up context for code'
  },
  {
    from: 'implementation',
    to: 'testing',
    severity: 'maybe',
    rationale: 'Keep if tests reference recent code; compact if switching focus'
  },
  {
    from: 'debugging',
    to: 'implementation',
    severity: 'yes',
    rationale: 'Debug traces pollute context for unrelated work'
  }
] as const;

/** Documented "no compact" rows from the SKILL.md table. */
export const PHASE_NO_TRANSITIONS: readonly { from: Phase; to: Phase; rationale: string }[] = [
  {
    from: 'implementation',
    to: 'implementation',
    rationale: 'Mid-implementation: losing variable names, file paths, and partial state is costly'
  },
  {
    from: 'debugging',
    to: 'debugging',
    rationale: 'After a failed approach: keep context until you commit to a new direction'
  }
] as const;

/**
 * SKILL.md "What Survives Compaction" table — byte-for-byte.
 * The `peaks compact survival` primitive emits these lists verbatim.
 */
export const SURVIVAL_TABLE: Readonly<{ persists: readonly string[]; lost: readonly string[] }> = {
  persists: [
    'CLAUDE.md instructions',
    'TodoWrite task list',
    'Memory files (~/.claude/memory/)',
    'Git state (commits, branches)',
    'Files on disk'
  ],
  lost: [
    'Intermediate reasoning and analysis',
    'File contents you previously read',
    'Multi-step conversation context',
    'Tool call history and counts',
    'Nuanced user preferences stated verbally'
  ]
} as const;

/**
 * Resolve a (from, to) phase pair to a recommend() envelope.
 * Unknown pairs return `severity: 'no'` with `notInTable: true` so the
 * LLM can see "this transition isn't in the table" instead of silently
 * getting a default.
 */
export function lookupPhaseTransition(from: Phase, to: Phase): {
  severity: Severity;
  rationale: string;
  notInTable: boolean;
} {
  const direct = PHASE_TRANSITIONS.find((row) => row.from === from && row.to === to);
  if (direct !== undefined) {
    return { severity: direct.severity, rationale: direct.rationale, notInTable: false };
  }
  const noRow = PHASE_NO_TRANSITIONS.find((row) => row.from === from && row.to === to);
  if (noRow !== undefined) {
    return { severity: 'no', rationale: noRow.rationale, notInTable: false };
  }
  return {
    severity: 'no',
    rationale: 'No documented transition; preserve context',
    notInTable: true
  };
}

/**
 * LLM-ready `/compact Focus on ...` prompt string. The phrasing is
 * deliberately terse — the upstream ECC suggest-compact hook uses a
 * similar short imperative form.
 */
export function buildSuggestedCompactMessage(from: Phase, to: Phase, severity: Severity): string {
  if (severity === 'no') {
    return `/compact Preserve context for ongoing ${from} work; do not abandon in-flight state.`;
  }
  if (severity === 'maybe') {
    return `/compact Focus on completing ${to} for the current thread; preserve recent code references.`;
  }
  return `/compact Focus on ${to}: ${from} context has been distilled into the plan / todo list.`;
}
