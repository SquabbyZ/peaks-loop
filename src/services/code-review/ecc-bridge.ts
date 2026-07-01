/**
 * Everything-Claude-Code (ECC) code-review bridge — adapter that
 * takes the ECC `code-review` agent's structured envelope
 * (`{ passed, violations[], gateAction }`) and renders it into the
 * `rd/code-review.md` markdown format that `peaks request transition`
 * Gate B3 already reads (`mustContain: ['## Findings', 'CRITICAL']`).
 *
 * Companion to `ocr-service.ts`: ECC is the in-skill agent option
 * (uses peaks-loop's own Agent tool surface), ocr is the external
 * subprocess option. Both produce a second-opinion code review that
 * the parent RD loop aggregates alongside its own inline review.
 *
 * === Why a bridge (not a direct swap) ===
 *
 * `peaks-rd/references/parallel-review-fanout.md` sub-agent 1 has a
 * hard contract: write `rd/code-review.md` with sections
 * `Summary / Findings / Required Fixes / Recommended / Verdict`.
 * The CLI gate at `rd:qa-handoff` enforces `mustContain: ['## Findings',
 * 'CRITICAL']` and refuses the transition otherwise. ECC's structured
 * envelope does not match that shape — it returns `{ passed, violations,
 * gateAction }`. Hence the bridge: render the envelope into the
 * canonical markdown shape, so ECC and the legacy inline reviewer
 * share the same downstream contract.
 *
 * === Why no `peaksConfig.ecc.*` block ===
 *
 * ECC is shipped via the `everything-claude-code` plugin, not as a
 * separate npm package. The user installs the plugin (a one-time
 * marketplace step); peaks-loop does not write or read any LLM
 * endpoint config for ECC. If a future ECC release needs user-
 * managed config (URL / token / model), add a `peaksConfig.ecc.*`
 * block then — not speculatively now.
 *
 * === Source: peaks-rd/references/parallel-review-fanout.md ===
 *
 * Sub-agent 1 contract (Tier 7 v2.11.0): the parent RD loop calls
 * `Agent({ subagent_type: 'everything-claude-code:code-review', ... })`
 * with the diff + handoff in scope, receives the structured envelope,
 * then runs `adaptEccEnvelopeToRdCodeReview(env, { rid, generatedAt })`
 * and writes the resulting body to
 * `.peaks/_runtime/<sessionId>/rd/code-review.md`.
 */
export type EccViolationKind =
  | 'correctness'
  | 'type-safety'
  | 'error-handling'
  | 'mutation'
  | 'file-size'
  | 'naming'
  | 'dead-code'
  | 'regression'
  | 'contract-drift'
  | 'other';

export interface EccViolation {
  readonly kind: string;
  readonly line: number;
  readonly snippet: string;
  readonly hint: string;
}

export type EccGateAction = 'pass' | 'warn' | 'block';

export interface EccEnvelope {
  readonly passed: boolean;
  readonly violations: ReadonlyArray<EccViolation>;
  readonly gateAction: EccGateAction;
}

/**
 * 5-state detect result — mirrors `ocr-service.ts` `OcrDetectState`
 * (ready / package-missing / binary-missing / config-missing /
 * detection-failed). ECC's analogue:
 *   - `ready`               — ECC plugin is installed and reachable
 *   - `plugin-missing`      — `everything-claude-code` not in skill list
 *   - `agent-missing`       — plugin present but `code-review` agent absent
 *   - `dispatch-failed`     — Agent tool call threw before returning envelope
 *   - `envelope-malformed`  — returned value failed `isEccEnvelope` validation
 *
 * The caller (peaks-rd's sub-agent 1 contract) inspects `state` and
 * either proceeds with the envelope or records a degradation note in
 * the request artifact body (`code-review-ecc-degraded-to-inline`).
 */
export type EccDetectState =
  | 'ready'
  | 'plugin-missing'
  | 'agent-missing'
  | 'dispatch-failed'
  | 'envelope-malformed';

export interface EccDetectResult {
  readonly state: EccDetectState;
  readonly pluginInstalled: boolean;
  readonly agentAvailable: boolean;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

export type RdCodeReviewVerdict = 'pass' | 'warn' | 'block';

export interface RdCodeReviewDoc {
  /** Full markdown body, ready to write to `rd/code-review.md`. */
  readonly body: string;
  /** Mirror of `gateAction` for the parent RD loop to log/aggregate. */
  readonly verdict: RdCodeReviewVerdict;
  /** Counts per severity bucket — populated only when violations exist. */
  readonly counts: {
    readonly total: number;
    readonly byKind: Readonly<Record<string, number>>;
  };
}

/**
 * Validate a raw value as an EccEnvelope. Accepts the strict shape
 * only — extra fields are tolerated (forward-compat for ECC adding
 * new top-level keys), but missing/typed-wrong fields reject.
 *
 * Defensive on purpose: ECC is external code, and a malformed envelope
 * must not propagate into `rd/code-review.md` (would corrupt Gate B3).
 */
export function isEccEnvelope(value: unknown): value is EccEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.passed !== 'boolean') return false;
  if (!Array.isArray(obj.violations)) return false;
  if (typeof obj.gateAction !== 'string') return false;
  if (obj.gateAction !== 'pass' && obj.gateAction !== 'warn' && obj.gateAction !== 'block') {
    return false;
  }
  for (const v of obj.violations) {
    if (v === null || typeof v !== 'object') return false;
    const vo = v as Record<string, unknown>;
    if (typeof vo.kind !== 'string') return false;
    if (typeof vo.line !== 'number' || !Number.isFinite(vo.line)) return false;
    if (typeof vo.snippet !== 'string') return false;
    if (typeof vo.hint !== 'string') return false;
  }
  return true;
}

function escapeMarkdownCell(value: string): string {
  // Defang characters that would break a markdown bullet or inject a
  // code fence. We render violations as bullet items, so the only
  // ones that matter are:
  //   - newlines (turn into spaces so a violation cannot span rows),
  //   - backtick runs (strip — three or more consecutive backticks
  //     would open a fenced code block),
  //   - the bullet marker `-` if it leads the cell.
  return value
    .replace(/\r?\n/g, ' ')
    .replace(/`{3,}/g, '')
    .replace(/^[-*+]\s+/, '')
    .trim();
}

function severityLabel(gateAction: EccGateAction): string {
  switch (gateAction) {
    case 'pass':
      return 'info';
    case 'warn':
      return 'warn';
    case 'block':
      return 'CRITICAL';
  }
}

function countByKind(violations: ReadonlyArray<EccViolation>): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    counts[v.kind] = (counts[v.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * Render an ECC envelope to the canonical `rd/code-review.md` shape.
 * Verdict → sections:
 *   - `pass`  → Summary + Findings (empty) + Verdict: pass
 *   - `warn`  → Summary + Findings + Required Fixes + Recommended + Verdict: warn
 *   - `block` → Summary + Findings + Required Fixes + Recommended + Verdict: block
 *               + the `CRITICAL: <n>` marker that Gate B3's
 *               `mustContain: ['## Findings', 'CRITICAL']` requires
 */
export function adaptEccEnvelopeToRdCodeReview(
  env: EccEnvelope,
  opts: { rid: string; generatedAt: string }
): RdCodeReviewDoc {
  const counts = countByKind(env.violations);
  const summary = [
    `# Code review — ${opts.rid}`,
    '',
    `## Summary`,
    '',
    `- generatedAt: ${opts.generatedAt}`,
    `- source: everything-claude-code:code-review (Tier 7 bridge)`,
    `- gateAction: ${env.gateAction}`,
    `- passed: ${env.passed}`,
    `- violations: ${env.violations.length}`,
    ''
  ].join('\n');

  const findingsSection = renderFindings(env.violations);

  const requiredFixesSection = env.violations.length === 0
    ? ''
    : [
        '## Required Fixes',
        '',
        ...env.violations.map((v, i) => {
          const safeSnippet = escapeMarkdownCell(v.snippet);
          const safeHint = escapeMarkdownCell(v.hint);
          return `- [${v.kind} @ line ${v.line}] ${safeHint} (snippet: \`${safeSnippet}\`)`;
        }),
        ''
      ].join('\n');

  const recommendedSection = env.gateAction === 'pass'
    ? ''
    : [
        '## Recommended',
        '',
        '- Address each Required Fix before transitioning to `qa-handoff`.',
        '- For non-blocking (`gateAction: warn`) violations, fix or defer with a written rationale in `rd/requests/<rid>.md`.',
        ''
      ].join('\n');

  // Gate B3 contract: the file MUST contain both `## Findings` and `CRITICAL`.
  // `pass` envelope → emit `CRITICAL: 0` so the gate's substring check still
  // hits even when there are no violations.
  const criticalCount = env.gateAction === 'block' ? env.violations.length : 0;
  const verdictBlock = [
    '## Verdict',
    '',
    `verdict: ${env.gateAction}`,
    `CRITICAL: ${criticalCount}`,
    ''
  ].join('\n');

  const body = [
    summary,
    findingsSection,
    requiredFixesSection,
    recommendedSection,
    verdictBlock
  ].filter((s) => s.length > 0).join('\n');

  return {
    body,
    verdict: env.gateAction,
    counts: { total: env.violations.length, byKind: counts }
  };
}

function renderFindings(violations: ReadonlyArray<EccViolation>): string {
  if (violations.length === 0) {
    return ['## Findings', '', '- (none)', ''].join('\n');
  }
  const bullets = violations.map((v) => {
    const safeSnippet = escapeMarkdownCell(v.snippet);
    const safeHint = escapeMarkdownCell(v.hint);
    return `- ${v.kind} @ line ${v.line}: ${safeHint} (snippet: \`${safeSnippet}\`)`;
  });
  return ['## Findings', '', ...bullets, ''].join('\n');
}

/**
 * 5-state detector — mirrors `detectOcr`'s shape (state enum + warnings
 * + nextActions). The caller passes in the result of its own probe:
 *
 * - `pluginInstalled`: did the skill list scan find `everything-claude-code`?
 * - `agentAvailable`: did the Agent tool say `code-review` is registered?
 * - `dispatchError`: optional — the Agent tool threw before returning.
 * - `envelope`: optional — what came back (if anything).
 *
 * The detector never blocks: when state !== `ready`, the parent RD
 * loop records a `code-review-ecc-degraded-to-inline` note and falls
 * back to inline review. This matches `detectOcr`'s soft-fail policy.
 */
export function detectEcc(input: {
  readonly pluginInstalled: boolean;
  readonly agentAvailable: boolean;
  readonly dispatchError?: unknown;
  readonly envelope?: unknown;
}): EccDetectResult {
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (!input.pluginInstalled) {
    return {
      state: 'plugin-missing',
      pluginInstalled: false,
      agentAvailable: false,
      warnings,
      nextActions: [
        'Install the `everything-claude-code` plugin (Claude Code marketplace).',
        'Until installed, peaks-rd falls back to inline code review (degradation note: code-review-ecc-degraded-to-inline).'
      ]
    };
  }

  if (!input.agentAvailable) {
    return {
      state: 'agent-missing',
      pluginInstalled: true,
      agentAvailable: false,
      warnings: [
        '`everything-claude-code` is installed but its `code-review` agent is not registered.'
      ],
      nextActions: [
        'Verify the plugin is enabled in your Claude Code settings (MCP servers / agent registry).',
        'Until resolved, peaks-rd falls back to inline code review.'
      ]
    };
  }

  if (input.dispatchError !== undefined) {
    return {
      state: 'dispatch-failed',
      pluginInstalled: true,
      agentAvailable: true,
      warnings: [
        `Agent dispatch failed: ${input.dispatchError instanceof Error ? input.dispatchError.message : String(input.dispatchError)}`
      ],
      nextActions: [
        'Inspect the agent registry logs for the failure cause.',
        'peaks-rd falls back to inline code review (degradation note: code-review-ecc-degraded-to-inline).'
      ]
    };
  }

  if (input.envelope !== undefined && !isEccEnvelope(input.envelope)) {
    return {
      state: 'envelope-malformed',
      pluginInstalled: true,
      agentAvailable: true,
      warnings: [
        'ECC `code-review` agent returned a value that failed envelope validation (expected { passed, violations, gateAction }).'
      ],
      nextActions: [
        'Verify the ECC plugin version is compatible with peaks-loop 2.11.0+ (this bridge).',
        'If the envelope shape is intentionally different, file a bug at the peaks-loop repo.'
      ]
    };
  }

  return {
    state: 'ready',
    pluginInstalled: true,
    agentAvailable: true,
    warnings,
    nextActions
  };
}

/**
 * Convenience: run `detectEcc` and `adaptEccEnvelopeToRdCodeReview`
 * in one call. The parent RD loop calls this after the Agent tool
 * returns. When `detectEcc` returns state !== 'ready', the caller
 * should NOT call `adaptEccEnvelopeToRdCodeReview` — fall back to
 * inline review instead.
 */
export function runEccCodeReview(input: {
  readonly rid: string;
  readonly generatedAt: string;
  readonly pluginInstalled: boolean;
  readonly agentAvailable: boolean;
  readonly dispatchError?: unknown;
  readonly envelope?: unknown;
}): { detect: EccDetectResult; doc: RdCodeReviewDoc | null } {
  const detect = detectEcc(input);
  if (detect.state !== 'ready' || input.envelope === undefined) {
    return { detect, doc: null };
  }
  // Detect.state === 'ready' implies input.envelope passed isEccEnvelope; the runtime
  // type is therefore EccEnvelope, not `unknown`. Cast is justified by detect's contract.
  const env = input.envelope as EccEnvelope;
  return { detect, doc: adaptEccEnvelopeToRdCodeReview(env, { rid: input.rid, generatedAt: input.generatedAt }) };
}