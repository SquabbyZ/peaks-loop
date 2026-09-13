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

import type { HandoffFrontmatter } from './handoff-types.js';

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
 * Serialize `frontmatter` into the fenced block, terminated by the closing
 * `---` and a trailing newline. Callers append the body verbatim, which keeps
 * the sha256 of the body independent of how the frontmatter renders.
 */
export function serializeHandoffFrontmatter(
  frontmatter: HandoffFrontmatter
): string {
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
    '---',
  ];
  return `${lines.join('\n')}\n`;
}
