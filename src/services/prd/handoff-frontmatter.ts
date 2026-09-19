/**
 * The ONE canonical serialization of `prd/handoff.md` frontmatter.
 *
 * Why this module exists (slice `2026-09-14-handoff-writer-gate-divergence`):
 * the handoff capsule is written by two producers and read by four
 * consumers, and they did not agree on the bytes:
 *
 *   | consumer / producer | requirement |
 *   |---|---|
 *   | `AUDIT_REQUIRES_HANDOFF` (`artifact-prerequisites.ts`) | SUBSTRING `schemaVersion: 2` (unquoted) + `sha256:` |
 *   | `audit-independent/{security,perf}-audit-service.ts` | anchored `^schemaVersion:\s*(\d+)\s*$` and `^sha256:\s*([a-f0-9]{64})\s*$` |
 *   | `handoff-service.readHandoff` | YAML string `handoffHash` |
 *   | `handoff-service.verifyHandoff` | `handoffHash` === sha256(body), bare hex |
 *
 * `handoff-service.serializeHandoff` fed the frontmatter through
 * `yaml.stringify`, which emits `schemaVersion: "2"` and a bare
 * `handoffHash:` — failing the gate AND both loaders. `handoff-auto-regen.ts`
 * hand-rolled a second serialization that happened to satisfy all four. Two
 * producers, two facts about the same contract, one of them wrong: that is
 * the defect, and copying the right shape into a third place would keep it.
 *
 * So both producers call THIS function. `sha256` is emitted only here, and
 * it is emitted plain, because the two audit loaders anchor a regex on it.
 *
 * Scalar-quoting rule — one rule, one documented exception set:
 *   - every ordinary string is emitted through `yamlScalar` (a JSON
 *     double-quoted scalar, which is valid YAML 1.2 and round-trips
 *     backslashes correctly on Windows paths);
 *   - `schemaVersion` and `sha256` are the exception: emitted PLAIN, because
 *     they are the two scalars the gate and the loaders match textually and a
 *     quoted scalar is invisible to all three. Both values are structurally
 *     constrained (a version digit and 64 hex chars), so plain is unambiguous.
 *
 * `handoffHash` is quoted even though it is also a 64-hex value: the reader
 * parses the block through YAML and requires a STRING, and a bare all-digit
 * sha256 would parse as a YAML number and be refused by the shape check.
 */

import {
  GATE_EVIDENCE_KEYS,
  isGateEvidenceKey,
  type GateEvidence,
  type HandoffFrontmatter
} from './handoff-types.js';

/** Render a string as a YAML double-quoted scalar. JSON string escapes are a
 *  subset of YAML 1.2's double-quoted escapes, so this is valid YAML and
 *  handles `\` (Windows paths), quotes, colons and newlines in one step. */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/** Render `key: []` or a YAML block sequence of quoted scalars. */
function blockSequence(key: string, values: readonly string[]): string[] {
  if (values.length === 0) return [`${key}: []`];
  return [`${key}:`, ...values.map((value) => `  - ${yamlScalar(value)}`)];
}

/**
 * Render `gateEvidence` as a YAML map of quoted path scalars, or as NOTHING.
 *
 * Two shape decisions, both load-bearing:
 *
 *   - **Omitted when absent or empty.** An absent map and an empty map both
 *     render zero lines, so a handoff that declares no evidence is
 *     byte-identical to a pre-B1 capsule. `gateEvidence: {}` would add a line
 *     to every handoff in the repo to say nothing — and the `each key exactly
 *     once` assertions in `handoff-auto-regen.test.ts` /
 *     `handoff-writer-gate-convergence.test.ts` pin the emitted key SET.
 *   - **Canonical key order** (`GATE_EVIDENCE_KEYS`), NOT insertion order of
 *     the caller's object. The frontmatter is sha256-adjacent and read by
 *     substring/regex consumers; a caller that built its map `{perfBaseline,
 *     projectScan}` must not produce different bytes from one that built it
 *     the other way round.
 *
 * Values go through `yamlScalar` because these are PATHS: on Windows they
 * contain backslashes, which a plain YAML scalar would escape.
 */
function gateEvidenceBlock(evidence: GateEvidence | undefined): string[] {
  if (evidence === undefined) return [];
  // F3 of `rid-b1-qa`: this function used to iterate only the five known keys,
  // so anything else was dropped WITHOUT A TRACE — `initHandoff({gateEvidence:
  // {projectScans: 'typo.md'}})` wrote no block at all and the capsule then
  // read back as `field-absent`, i.e. as if nothing had ever been declared.
  // The type system blocks literal typos, but not a value that arrived through
  // `JSON.parse`, an `as` assertion, or a JS caller — and the derivation added
  // in B2 is exactly such an adapter. So the check is runtime, and it is HERE
  // because this serializer is the single funnel every producer passes
  // through: one check covers all three writers and any future one.
  const provided = Object.entries(evidence);
  const unknownKeys = provided
    .map(([key]) => key)
    .filter((key) => !isGateEvidenceKey(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new Error(
      `handoff: unknown gateEvidence key(s) [${unknownKeys.join(', ')}]; expected one of ` +
        `${GATE_EVIDENCE_KEYS.join(', ')} — refusing to write a declaration that would be ` +
        'dropped silently'
    );
  }
  const nonStringKeys = provided
    .filter(([, value]) => typeof value !== 'string')
    .map(([key]) => key)
    .sort();
  if (nonStringKeys.length > 0) {
    throw new Error(
      `handoff: gateEvidence value(s) for [${nonStringKeys.join(', ')}] must be strings (evidence paths)`
    );
  }
  const entries = GATE_EVIDENCE_KEYS.flatMap((key) => {
    const value = evidence[key];
    return value === undefined ? [] : [`  ${key}: ${yamlScalar(value)}`];
  });
  return entries.length === 0 ? [] : ['gateEvidence:', ...entries];
}

/**
 * Serialize `frontmatter` into the fenced block, terminated by the closing
 * `---` and a trailing newline. Callers append the body verbatim, which keeps
 * the sha256 of the body independent of how the frontmatter renders.
 */
export function serializeHandoffFrontmatter(frontmatter: HandoffFrontmatter): string {
  const lines = [
    '---',
    `requestId: ${yamlScalar(frontmatter.requestId)}`,
    `sessionId: ${yamlScalar(frontmatter.sessionId)}`,
    // PLAIN by construction (`HandoffSchemaVersion` is the literal '2').
    `schemaVersion: ${frontmatter.schemaVersion}`,
    // PLAIN: this is the field both audit loaders read, via an anchored
    // regex that a quoted scalar would not match.
    `sha256: ${frontmatter.handoffHash}`,
    // Quoted: `readHandoff` requires a YAML string here.
    `handoffHash: ${yamlScalar(frontmatter.handoffHash)}`,
    `writtenAt: ${yamlScalar(frontmatter.writtenAt)}`,
    ...blockSequence('goals', frontmatter.goals),
    ...blockSequence('acceptanceCriteria', frontmatter.acceptanceCriteria),
    ...blockSequence('preservedBehavior', frontmatter.preservedBehavior),
    `handoffPath: ${yamlScalar(frontmatter.handoffPath)}`,
    // LAST, after every anchored field: `schemaVersion` / `sha256` are
    // matched as `^`-anchored lines by the gate and both audit loaders, so
    // nothing new may be inserted before them. A nested map also renders
    // indented lines only, leaving the top-level key set exactly as it was
    // for every capsule that declares no evidence.
    ...gateEvidenceBlock(frontmatter.gateEvidence),
    '---'
  ];
  return `${lines.join('\n')}\n`;
}
