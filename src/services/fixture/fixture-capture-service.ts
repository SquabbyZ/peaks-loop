/**
 * v2.14.0 G1 AC-1.4 — Fixture capture service.
 *
 * Producer-side counterpart of `fixture-sanitize-service`. The CLI
 * (`scripts/fixture-capture.mjs`) is a thin wrapper around this module.
 *
 * Two capture modes:
 *
 *   1. **historical** — copy a real envelope file from
 *      `.peaks/_runtime/<sid>/<role>/<envelope>` to
 *      `tests/fixtures/replay/<name>.md` (or `.json`), sanitize, checksum.
 *
 *   2. **derived-variant** — take an already-captured fixture and apply
 *      a deterministic edge-case transformation. The transformations
 *      are the 5 v2.13.x historical bug shapes that the replay suite
 *      must hit (PRD A1.2):
 *
 *      - `chinese-colon`            — replace ASCII `:` after
 *                                     `verdict` / `passed` with fullwidth
 *                                     `：` in the frontmatter / body
 *      - `yaml-frontmatter-variation` — inject CRLF / BOM / extra spaces
 *                                     into the YAML frontmatter
 *      - `double-format`            — embed a JSON blob inside a markdown
 *                                     body (or vice versa)
 *      - `empty-body`               — strip everything after `## Summary`
 *      - `multi-findings`           — duplicate the `## Findings` block
 *
 * Every captured fixture is paired with a `fixture.meta.json` that
 * validates against `schemas/replay-fixture.schema.json`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
  sanitizeFixtureStrict,
  SANITIZE_RULE_NAMES,
  type SanitizationReport,
  type SanitizeRuleName
} from './fixture-sanitize-service.js';

// ─── Envelope kinds ───────────────────────────────────────────────────

export type EnvelopeKind =
  | 'audit-security'
  | 'audit-perf'
  | 'karpathy-review'
  | 'mut-report'
  | 'qa-report'
  | 'prd-handoff';

export const ENVELOPE_KINDS: ReadonlyArray<EnvelopeKind> = [
  'audit-security',
  'audit-perf',
  'karpathy-review',
  'mut-report',
  'qa-report',
  'prd-handoff'
];

/**
 * Map envelope kind → on-disk path segment under `.peaks/_runtime/<sid>/`.
 * `qa-report` is intentionally absent — the PRD lists 5 envelope types;
 * `qa-report` is a 6th bonus to widen coverage. All 6 are accepted as
 * inputs; the replay test enforces ≥5 distinct kinds.
 */
export const ENVELOPE_ON_DISK_PATH: Record<EnvelopeKind, string> = {
  'audit-security': 'audit/security.md',
  'audit-perf': 'audit/perf.md',
  'karpathy-review': 'rd/karpathy-review.md',
  'mut-report': 'dogfood-v2132/mut/mut-report.json',
  'qa-report': 'qa/test-reports/2026-06-27-verdict-aggregator.md',
  'prd-handoff': 'prd/handoff.md'
};

export const ENVELOPE_FILE_EXTENSION: Record<EnvelopeKind, 'md' | 'json'> = {
  'audit-security': 'md',
  'audit-perf': 'md',
  'karpathy-review': 'md',
  'mut-report': 'json',
  'qa-report': 'md',
  'prd-handoff': 'md'
};

// ─── Capture inputs ───────────────────────────────────────────────────

export interface HistoricalCaptureInput {
  readonly mode: 'historical';
  readonly sessionId: string;
  readonly envelopeKind: EnvelopeKind;
  readonly fixtureId: string;
  readonly outDir: string;
  /**
   * Optional absolute or relative base dir used to resolve the source
   * path `.peaks/_runtime/<sid>/...`. When omitted, defaults to
   * `process.cwd()`. The CLI passes `process.cwd()` explicitly;
   * tests that pre-populate a tmp tree pass the tmp root here.
   */
  readonly projectRoot?: string;
  /**
   * When true (default), the CLI refuses to write if the source file
   * does not exist. Set false only in tests where you want to assert
   * the error path.
   */
  readonly requireSource?: boolean;
}

export interface DerivedVariantInput {
  readonly mode: 'derived-variant';
  /** Path (absolute or relative to cwd) to a previously captured fixture body. */
  readonly parentFixturePath: string;
  readonly variant: EdgeCaseVariant;
  readonly fixtureId: string;
  readonly outDir: string;
}

export type EdgeCaseVariant =
  | 'chinese-colon'
  | 'yaml-frontmatter-variation'
  | 'double-format'
  | 'empty-body'
  | 'multi-findings'
  | 'historical-canonical';

export const EDGE_CASE_VARIANTS: ReadonlyArray<EdgeCaseVariant> = [
  'chinese-colon',
  'yaml-frontmatter-variation',
  'double-format',
  'empty-body',
  'multi-findings',
  'historical-canonical'
];

export type CaptureInput = HistoricalCaptureInput | DerivedVariantInput;

// ─── Capture output ───────────────────────────────────────────────────

export interface CapturedFixture {
  readonly fixtureId: string;
  readonly envelopeKind: EnvelopeKind;
  readonly bodyPath: string;
  readonly metaPath: string;
  readonly meta: FixtureMeta;
}

export interface FixtureMeta {
  readonly schemaVersion: 1;
  readonly fixtureId: string;
  readonly envelopeKind: EnvelopeKind;
  readonly producer: 'peaks-fixture-capture-cli';
  readonly producerVersion: '2.14.0';
  readonly sourceOrigin: {
    readonly kind: 'historical-artifact' | 'derived-variant';
    readonly path: string;
    readonly sessionId: string | null;
    readonly parentFixtureId: string | null;
    readonly variantCommand: string | null;
  };
  readonly capturedAt: string;
  readonly sanitization: SanitizationReport;
  readonly checksum: { readonly algorithm: 'sha256'; readonly value: string };
  readonly edgeCases: ReadonlyArray<EdgeCaseVariant>;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Resolve a historical capture: read the source file from disk, sanitize
 * it, compute the checksum, write the body + `fixture.meta.json` pair.
 *
 * Pure orchestration — no command-line parsing here. The CLI in
 * `scripts/fixture-capture.mjs` validates args and calls this function.
 *
 * @throws if the source file does not exist and `requireSource !== false`.
 */
export function captureHistoricalFixture(input: HistoricalCaptureInput): CapturedFixture {
  const requireSource = input.requireSource !== false;

  const root = input.projectRoot ?? process.cwd();
  const sourcePath = join(root, '.peaks', '_runtime', input.sessionId, ENVELOPE_ON_DISK_PATH[input.envelopeKind]);
  const sourcePathPosix = sourcePath.split(sep).join('/');
  if (!existsSync(sourcePath)) {
    if (requireSource) {
      throw new Error(
        `[peaks fixture capture] source not found: ${sourcePath}. ` +
        `Ensure session ${input.sessionId} contains ${ENVELOPE_ON_DISK_PATH[input.envelopeKind]}.`
      );
    }
    throw new Error('source-not-found');
  }

  const raw = readFileSync(sourcePath, 'utf8');
  return writeCapturedPair({
    fixtureId: input.fixtureId,
    envelopeKind: input.envelopeKind,
    raw,
    sourceOrigin: {
      kind: 'historical-artifact',
      path: sourcePathPosix,
      sessionId: input.sessionId,
      parentFixtureId: null,
      variantCommand: null
    },
    edgeCases: deriveEdgeCasesFromRaw(raw),
    outDir: input.outDir
  });
}

/**
 * Derive a variant fixture from a parent fixture body. The parent must
 * already be a captured fixture (i.e. it has been sanitized). Variants
 * are deterministic — same parent + same variant → identical output.
 */
export function captureDerivedVariant(input: DerivedVariantInput): CapturedFixture {
  const parentPath = input.parentFixturePath;
  if (!existsSync(parentPath)) {
    throw new Error(`[peaks fixture capture] parent fixture not found: ${parentPath}`);
  }
  const parentRaw = readFileSync(parentPath, 'utf8');
  const parentMetaPath = parentPath.replace(/\.(md|json)$/, '.meta.json');
  const parentMeta: FixtureMeta | null = existsSync(parentMetaPath)
    ? (JSON.parse(readFileSync(parentMetaPath, 'utf8')) as FixtureMeta)
    : null;

  const mutated = applyEdgeCaseVariant(parentRaw, input.variant, parentMeta?.envelopeKind ?? null);
  return writeCapturedPair({
    fixtureId: input.fixtureId,
    envelopeKind: parentMeta?.envelopeKind ?? inferEnvelopeFromBody(mutated),
    raw: mutated,
    sourceOrigin: {
      kind: 'derived-variant',
      path: parentPath.split(sep).join('/'),
      sessionId: parentMeta?.sourceOrigin.sessionId ?? null,
      parentFixtureId: parentMeta?.fixtureId ?? null,
      variantCommand: input.variant
    },
    edgeCases: [input.variant],
    outDir: input.outDir
  });
}

// ─── Internals ────────────────────────────────────────────────────────

interface WritePairInput {
  readonly fixtureId: string;
  readonly envelopeKind: EnvelopeKind;
  readonly raw: string;
  readonly sourceOrigin: FixtureMeta['sourceOrigin'];
  readonly edgeCases: ReadonlyArray<EdgeCaseVariant>;
  readonly outDir: string;
}

function writeCapturedPair(input: WritePairInput): CapturedFixture {
  mkdirSync(input.outDir, { recursive: true });

  const { redacted, report } = sanitizeFixtureStrict(input.raw);
  const ext = inferExtension(input.envelopeKind);
  const bodyFilename = `${input.fixtureId}.${ext}`;
  const metaFilename = `${input.fixtureId}.meta.json`;
  const bodyPath = join(input.outDir, bodyFilename);
  const metaPath = join(input.outDir, metaFilename);

  const checksum = createHash('sha256').update(redacted, 'utf8').digest('hex');
  const meta: FixtureMeta = {
    schemaVersion: 1,
    fixtureId: input.fixtureId,
    envelopeKind: input.envelopeKind,
    producer: 'peaks-fixture-capture-cli',
    producerVersion: '2.14.0',
    sourceOrigin: input.sourceOrigin,
    capturedAt: new Date().toISOString(),
    sanitization: report,
    checksum: { algorithm: 'sha256', value: checksum },
    edgeCases: input.edgeCases
  };

  writeFileSync(bodyPath, redacted, 'utf8');
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');

  return {
    fixtureId: input.fixtureId,
    envelopeKind: input.envelopeKind,
    bodyPath,
    metaPath,
    meta
  };
}

function inferExtension(kind: EnvelopeKind): 'md' | 'json' {
  return ENVELOPE_FILE_EXTENSION[kind];
}

function inferEnvelopeFromBody(body: string): EnvelopeKind {
  if (/^---\n[\s\S]*?verdict\s*:/m.test(body) && /security-audit|## Findings/i.test(body)) return 'audit-security';
  if (/^---\n[\s\S]*?verdict\s*:/m.test(body) && /perf|baseline|threshold/i.test(body)) return 'audit-perf';
  if (/^## Karpathy-Gate[\s\S]*?gateAction\s*:/m.test(body) || /gateAction\s*:\s*(pass|warn|block)/m.test(body)) return 'karpathy-review';
  if (/^---$|schemaVersion.*2|sha256\s*:/m.test(body)) return 'prd-handoff';
  if (/^verdict\s*:\s*(pass|return-to-rd|blocked)/m.test(body)) return 'qa-report';
  return 'audit-security';
}

function deriveEdgeCasesFromRaw(raw: string): ReadonlyArray<EdgeCaseVariant> {
  const cases: EdgeCaseVariant[] = [];
  if (/[：]/.test(raw)) cases.push('chinese-colon');
  if (/\r\n|﻿/.test(raw)) cases.push('yaml-frontmatter-variation');
  if (cases.length === 0) cases.push('historical-canonical');
  return cases;
}

function applyEdgeCaseVariant(raw: string, variant: EdgeCaseVariant, envelope: EnvelopeKind | null): string {
  switch (variant) {
    case 'chinese-colon': {
      // The real v2.13.1 dogfood case: some real audit envelopes used
      // Chinese fullwidth punctuation in body content (Summary,
      // Findings descriptions). The parser still extracts the verdict
      // from the frontmatter (ASCII `:`) but the body retains
      // 中文冒号 — that is the exact shape the fixture must preserve.
      // For envelopes without a `## Summary` section (karpathy, qa,
      // prd-handoff) we apply fullwidth colon to body prose lines
      // (those that have a colon followed by text) but never to
      // frontmatter or parser-load-bearing `verdict:` / `passed:`
      // lines — those stay ASCII so the parser can still extract them.
      // Split body from frontmatter, mutate the body only.
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      const mutateBody = (body: string): string =>
        body
          .replace(/^## Summary\n([\s\S]*?)(?=\n## |\s*$)/m, (_full, summary: string) =>
            `## Summary\n${summary.replace(/:/g, '：')}`
          )
          .replace(/^## Findings\n([\s\S]*?)(?=\n## |\s*$)/m, (_full, findings: string) =>
            `## Findings\n${findings.replace(/:/g, '：')}`
          )
          // Body prose lines with a colon: "Authors: ..." → "Authors：..."
          // EXCLUDE parser-load-bearing lines (verdict / passed / gateAction).
          .replace(/^([A-Za-z][A-Za-z0-9 _-]{2,40})\s*:\s*(.+)$/gm, (line, label: string, rest: string) => {
            if (/^(verdict|passed|gateAction)$/i.test(label.trim())) return line;
            return `${label}：${rest}`;
          });
      if (fmMatch !== null) {
        const frontmatter = fmMatch[1]!;
        const body = fmMatch[2]!;
        return `---\n${frontmatter}\n---\n${mutateBody(body)}`;
      }
      return mutateBody(raw);
    }
    case 'yaml-frontmatter-variation': {
      // Convert LF to CRLF in the frontmatter only. This stresses the
      // CRLF tolerance of the parser regex (line-anchored `^...$` with
      // multiline flag must treat `\r` as whitespace, not data).
      // For envelopes with no frontmatter (karpathy, qa-report) we
      // append a BOM (﻿) to the body to exercise the parser's
      // tolerance of leading BOM.
      const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (m !== null) {
        const frontmatter = m[1]!.replace(/\n/g, '\r\n');
        const body = m[2]!;
        return `---\r\n${frontmatter}\r\n---\n${body}`;
      }
      // No frontmatter — prepend a BOM and CRLF-terminate the first
      // body line so the variant is observable.
      return `﻿${raw.replace(/\n/, '\r\n')}`;
    }
    case 'double-format': {
      // Embed a JSON blob inside a markdown `## Embedded JSON` block.
      // The parser must still recover the frontmatter envelope.
      const json = JSON.stringify({
        verdict: 'warn',
        violations: [{ dimension: 'embed', severity: 'HIGH', file: 'embed.ts', line: 1, hint: 'embedded json' }],
        summary: 'embedded json inside markdown'
      }, null, 2);
      return `${raw}\n\n## Embedded JSON\n\n\`\`\`json\n${json}\n\`\`\`\n`;
    }
    case 'empty-body': {
      // For envelopes with `## Summary`/`## Findings` structure, strip
      // everything after `## Summary` — leaves a Summary-only envelope
      // with no Findings block. The parser must return
      // {verdict, violations: [], summary: ...} without crashing.
      // For envelopes without those sections, strip non-load-bearing
      // body lines while preserving parser-load-bearing lines
      // (verdict: / passed: / gateAction:) so the parser still
      // extracts a verdict.
      const idx = raw.indexOf('## Summary');
      if (idx !== -1) {
        const tail = raw.indexOf('\n## ', idx + 1);
        return tail === -1 ? raw.slice(0, idx) + '## Summary\n\n(no body)\n' : raw.slice(0, tail);
      }
      // Karpathy / qa / handoff: keep only load-bearing body lines.
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      const body = fmMatch !== null ? fmMatch[2]! : raw;
      const kept = body
        .split('\n')
        .filter((line) => /^\s*(verdict|passed|gateAction|verdict\s*：)\s*[:：]/i.test(line) || line.trim().length === 0)
        .join('\n');
      return fmMatch !== null
        ? `---\n${fmMatch[1]!}\n---\n${kept}`
        : kept;
    }
    case 'multi-findings': {
      // For envelopes with `## Findings` sections, duplicate the
      // block. For envelopes without that structure, duplicate the
      // first non-frontmatter body line so the variant is observable.
      const m = raw.match(/(## Findings[\s\S]*?)(?=\n## |\s*$)/);
      if (m !== null) {
        return `${raw}\n\n${m[1]}`;
      }
      // No Findings section — duplicate the first body line after
      // frontmatter (or after line 0 if no frontmatter).
      const fmEnd = raw.match(/^---\n[\s\S]*?\n---\n/);
      const bodyStart = fmEnd !== null ? fmEnd[0]!.length : 0;
      const firstNewlineAfter = raw.indexOf('\n', bodyStart);
      if (firstNewlineAfter === -1) return raw;
      const firstBodyLine = raw.slice(bodyStart, firstNewlineAfter + 1);
      return `${raw}\n${firstBodyLine}`;
    }
    case 'historical-canonical': {
      // No transformation — the historical capture is the canonical
      // shape. Returned verbatim. (This branch exists so the
      // `EdgeCaseVariant` exhaustive check is satisfied; the
      // captureHistorical path never invokes it.)
      return raw;
    }
    default: {
      const _exhaustive: never = variant;
      void _exhaustive;
      return raw;
    }
  }
}

// ─── Sanitize rule-name re-export (so the CLI + tests don't need to
//    import from both sanitize-service and capture-service) ───────────

export { SANITIZE_RULE_NAMES, type SanitizeRuleName };
