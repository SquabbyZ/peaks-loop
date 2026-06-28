/**
 * v2.14.0 G1 — Fixture services barrel.
 *
 * Re-exports both the sanitize + capture services so consumers (CLI,
 * tests) import from one path.
 */
export {
  sanitizeFixture,
  sanitizeFixtureStrict,
  SANITIZE_RULES,
  SANITIZE_RULE_NAMES,
  SanitizationReportSchema,
  SanitizationIssueSchema,
  type SanitizeRule,
  type SanitizeRuleName,
  type SanitizationReport,
  type SanitizationIssue
} from './fixture-sanitize-service.js';

export {
  captureHistoricalFixture,
  captureDerivedVariant,
  ENVELOPE_KINDS,
  ENVELOPE_ON_DISK_PATH,
  ENVELOPE_FILE_EXTENSION,
  EDGE_CASE_VARIANTS,
  type EnvelopeKind,
  type EdgeCaseVariant,
  type HistoricalCaptureInput,
  type DerivedVariantInput,
  type CaptureInput,
  type CapturedFixture,
  type FixtureMeta
} from './fixture-capture-service.js';
