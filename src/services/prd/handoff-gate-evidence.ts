// src/services/prd/handoff-gate-evidence.ts
//
// The SOLE reader of the handoff frontmatter's `gateEvidence` field.
//
// WHAT THE FIELD IS (slice B1, rid `rid-b1-gate-evidence-producer`): a map
// from one of five fixed gate keys to the PATH of that gate's evidence file.
// The normative description is
// `skills/bee/peaks-rd/references/writing-handoff-frontmatter.md:35-41`; the
// key set is `GATE_EVIDENCE_KEYS` in `./handoff-types.js`.
//
// WHAT THIS FILE USED TO SAY, AND WHY THAT WAS FALSE: its header claimed the
// field was a `string[]` of "gate names" and that `initHandoff` wrote it.
// Neither held. `grep -rn gateEvidence src/` hit this file and nothing else —
// there was no producer (`HandoffFrontmatter` had no such field,
// `serializeHandoffFrontmatter` never emitted it, `initHandoff` rejected it)
// and no consumer. The field was prose describing data that did not exist,
// and the comment asserting a producer was the reason nobody noticed.
//
// WHAT IS ON DISK NOW, stated precisely because a header that overclaims is
// the defect above. B1 added the producer FUNCTIONS; B2 wired their callers,
// which is what made the difference — until then every producer passed
// nothing, so no capsule carried the field and saying otherwise would have
// described a fact that held only inside tests (F1 of `rid-b1-qa`). At
// HEAD after B2: the three producers DERIVE the map from the request type
// (`services/prd/gate-evidence-derivation.ts`), so a capsule written by
// `peaks prd handoff init`, by the auto-regen on `prd:handed-off`, or by
// `peaks evidence generate` carries this field whenever that slice's PRD
// artifact is readable — and carries no `gateEvidence` block at all when it
// is not. Gate C (`checkPrerequisites` at `rd:qa-handoff`) fails a declared
// path that is not on disk. Every clause above is asserted end-to-end in
// `tests/unit/prd/gate-evidence-derivation.test.ts`.
//
// WHY IT IS STILL STAND-ALONE: keeping the typed-value logic here, rather
// than in `handoff-service.ts`, keeps `HandoffFrontmatter` a pure data shape
// and lets this reader stay PERMISSIVE where `readHandoff` must throw.
//
// PERMISSIVE, RE-ARGUED (the old rationale did not survive contact with its
// own return type): the pre-B1 reader returned `null` for "field absent",
// "field malformed", "YAML broken" and "file missing" alike. Its stated
// justification — "a malformed frontmatter is the caller's signal to surface
// the failure to the operator" — was therefore unimplementable: the caller
// could not distinguish a handoff that DECLARED NOTHING from one whose
// declaration was CORRUPT, so it could not tell whether to proceed or to
// stop. The rationale was a promise the shape could not keep.
//
// It holds now, because the shape changed rather than the policy: this reader
// still never throws (a broken capsule must not crash the gate pipeline, and
// `readHandoff` already owns the throwing contract for capsules that must be
// valid), but every outcome is a DISTINCT `status`. Under the map shape the
// callers that matter are Gate C and the QA role, and both must fail closed on
// `field-not-map` / `value-not-string` while passing `field-absent` — which is
// only expressible if those are different values. So: permissive stays, and it
// is now a decision the return type can actually support.

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { isGateEvidenceKey, type GateEvidence, type GateEvidenceKey } from './handoff-types.js';

/**
 * Why a `gateEvidence` read produced what it produced.
 *
 * `ok` is the only success. `field-absent` is NOT a failure — a capsule with
 * no declaration is a valid capsule (every pre-B1 handoff) — while
 * `field-not-map` and `value-not-string` are declarations that exist and are
 * broken, and `file-missing` / `read-error` / `frontmatter-malformed` mean
 * nothing could be read at all. Collapsing any two of these is the defect
 * this reader was rewritten to remove.
 */
export type HandoffGateEvidenceStatus =
  | 'ok'
  | 'file-missing'
  | 'read-error'
  | 'frontmatter-malformed'
  | 'field-absent'
  | 'field-not-map'
  | 'value-not-string';

/**
 * Discriminated result. `status` alone decides the branch, so a caller that
 * only wants "is there a usable declaration?" checks `result.status === 'ok'`
 * and reads `result.evidence` — and a caller that must refuse corrupt
 * declarations gets `keys` / `actualType` / `reason` to name the problem in
 * its failure message.
 */
export type HandoffGateEvidenceResult =
  | {
      readonly status: 'ok';
      /** Only the five known keys. Absent key = not declared. An EMPTY map
       *  on disk yields an empty `evidence`, not an error: the field was
       *  written and declares nothing, which is a different fact from
       *  `field-absent` and is reported as such. */
      readonly evidence: GateEvidence;
      /** Keys present in the YAML that are not one of the five. Sorted.
       *  Reported rather than dropped: a typo'd key is why a required gate
       *  reads as "not declared", and this is the only place that can say so.
       *  The serializer cannot emit these, so they are hand-authored only. */
      readonly unknownKeys: readonly string[];
    }
  | { readonly status: 'file-missing' }
  | { readonly status: 'read-error'; readonly reason: string }
  | { readonly status: 'frontmatter-malformed'; readonly reason: string }
  | { readonly status: 'field-absent' }
  /** `actualType` is the YAML type found (`array`, `null`, `string`, …) —
   *  `array` is the pre-B1 shape, present in old test fixtures only. */
  | { readonly status: 'field-not-map'; readonly actualType: string }
  /** At least one value was not a string; `keys` names every offender. The
   *  whole declaration is refused rather than filtered down to its good
   *  entries — dropping a malformed value is the collapse this replaced. */
  | { readonly status: 'value-not-string'; readonly keys: readonly string[] };

/** Frontmatter is the `---`-fenced YAML block at the top of the file. */
const FRONTMATTER_FENCE = /^---\r?\n([\s\S]*?)\r?\n---/;

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * THE shape rule for a `gateEvidence` value — one home, two callers.
 *
 * F2 of `rid-b1-qa` found this rule written twice (`handoff-service.ts`'s
 * `isGateEvidenceMap`, added by B1, and this module's own inline checks) with
 * the SAME accept/reject boundary but DIFFERENT results: the same bytes
 * produced a map WITH unknown keys through `readHandoff` and a map WITHOUT
 * them through the reader, and `gateEvidence:` (null) threw on one path and
 * reported a status on the other. That falsified the invariant
 * `handoff-service.ts` stated about itself. Both paths now call this, and
 * only the REFUSAL MECHANISM differs (a status vs a throw) — which is the
 * pre-existing, documented policy split between the throwing `readHandoff`
 * and the permissive reader, not a second opinion about the shape.
 *
 * `absent` is a first-class kind rather than an error: a capsule that
 * declares nothing is valid, and (invariant 1 of B1) every pre-B1 handoff
 * is one.
 */
export type GateEvidenceShape =
  | { readonly kind: 'absent' }
  | { readonly kind: 'not-map'; readonly actualType: string }
  | { readonly kind: 'value-not-string'; readonly keys: readonly string[] }
  | {
      readonly kind: 'ok';
      readonly evidence: GateEvidence;
      readonly unknownKeys: readonly string[];
    };

/** Classify a `gateEvidence` VALUE (already located — see the reader for the
 *  fence/YAML/presence layers, which are file-level concerns, not shape). */
export function classifyGateEvidence(value: unknown): GateEvidenceShape {
  if (value === undefined) return { kind: 'absent' };
  if (!isPlainMap(value)) return { kind: 'not-map', actualType: describeType(value) };
  const nonStringKeys = Object.keys(value).filter((key) => typeof value[key] !== 'string');
  if (nonStringKeys.length > 0) {
    return { kind: 'value-not-string', keys: nonStringKeys.sort() };
  }
  const evidence: Partial<Record<GateEvidenceKey, string>> = {};
  const unknownKeys: string[] = [];
  for (const key of Object.keys(value)) {
    if (isGateEvidenceKey(key)) {
      evidence[key] = value[key] as string;
    } else {
      unknownKeys.push(key);
    }
  }
  return { kind: 'ok', evidence, unknownKeys: unknownKeys.sort() };
}

/**
 * Read + classify the `gateEvidence` map out of `filePath`. Never throws.
 * See the header for the permissive contract and
 * `HandoffGateEvidenceResult` for the outcomes.
 */
export async function readHandoffGateEvidence(
  filePath: string
): Promise<HandoffGateEvidenceResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    // N1 of `handoff-service.verifyHandoff` is the same lesson one layer up:
    // folding every read failure into `file-missing` sends an operator to
    // look for a file that is right there. Only a genuine absence is
    // `file-missing`.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: 'file-missing' };
    return { status: 'read-error', reason: `${code ?? 'unknown'}` };
  }

  const match = FRONTMATTER_FENCE.exec(raw);
  if (!match) {
    return { status: 'frontmatter-malformed', reason: 'no-frontmatter-fence' };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'frontmatter-malformed', reason: `yaml-parse-error: ${message}` };
  }
  if (!isPlainMap(parsed)) {
    return { status: 'frontmatter-malformed', reason: 'frontmatter-not-a-map' };
  }

  // `in`, not `!== undefined`: `gateEvidence:` with an empty value parses to
  // `null`, which IS a (broken) declaration and must not be reported as if
  // the author had written nothing.
  if (!('gateEvidence' in parsed)) return { status: 'field-absent' };
  // The shape rule is shared with `handoff-service.isHandoffFrontmatter` — see
  // `classifyGateEvidence`. This reader only decides how to REPORT it.
  const shape = classifyGateEvidence(parsed['gateEvidence']);
  switch (shape.kind) {
    case 'absent':
      return { status: 'field-absent' };
    case 'not-map':
      return { status: 'field-not-map', actualType: shape.actualType };
    case 'value-not-string':
      return { status: 'value-not-string', keys: shape.keys };
    case 'ok':
      return { status: 'ok', evidence: shape.evidence, unknownKeys: shape.unknownKeys };
  }
}
