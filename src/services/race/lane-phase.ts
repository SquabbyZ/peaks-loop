// src/services/race/lane-phase.ts
//
// THE ONLY READER of the race lane's phase. `.peaks/race/lane-phase.json` holds one
// object with one key, `phase`, whose value is one of two tokens.
//
// WHY THE PHASE IS A FILE WITH A GRAMMAR. Written as a sentence in a markdown file it
// had no grammar, so a guard could only recognise the declaration by a spelling
// pattern, and every spelling a reader would accept while the pattern missed it was
// invisible to the guard. The reader cannot miss one: a value outside the enum, a second
// key, a duplicate key (plain or spelled with an escape), or a missing file is a refusal
// rather than something silently carried.
//
// A MISSING FILE IS A REFUSAL, NOT A DEFAULT. "Exactly one legal value" is a parser
// guarantee, so absence must not resolve to one.

import { type Stats, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const LANE_PHASE_VALUES = ['name-only', 'offered-by-default'] as const;

export type LanePhase = (typeof LANE_PHASE_VALUES)[number];

/**
 * The enum makes a value outside the two legal tokens unrepresentable, and `strict()`
 * refuses an unknown key. `strict()` alone still lets `__proto__` through — it is an own,
 * enumerable key that zod does not treat as unknown — so `readLanePhase` also requires the
 * parsed object's own keys to be exactly `['phase']`. Together, an unknown key is a
 * rejection rather than a key silently carried.
 */
const lanePhaseFileSchema = z.object({ phase: z.enum(LANE_PHASE_VALUES) }).strict();

export type LanePhaseFile = {
  readonly phase: LanePhase;
};

export type ReadLanePhaseResult =
  | { readonly kind: 'ok'; readonly path: string; readonly file: LanePhaseFile }
  | { readonly kind: 'missing'; readonly path: string }
  | { readonly kind: 'invalid'; readonly path: string; readonly message: string };

export function lanePhasePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'race', 'lane-phase.json');
}

/** What inspecting the carrier path produced: absent, unreadable/unparsable, or its text. */
type CarrierRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ok'; readonly text: string; readonly raw: unknown };

/**
 * Inspect the path and read the file. `lstat` (not `stat`) so a symlink is seen as the link
 * rather than followed; `throwIfNoEntry: false` makes absence a value rather than a throw; and the
 * `catch` keeps the reader's contract — a tagged result, never an exception — for a path it cannot
 * inspect at all (a NUL byte, say, where a bare `existsSync` returned `false`). `JSON.parse`'s own
 * message quotes the bytes it choked on, so a parse failure is reported without the file's content.
 */
function readCarrier(path: string): CarrierRead {
  let stat: Stats | undefined;
  try {
    stat = lstatSync(path, { throwIfNoEntry: false });
  } catch {
    return { kind: 'invalid', message: 'the carrier path could not be inspected' };
  }
  if (stat === undefined) return { kind: 'missing' };
  if (!stat.isFile()) return { kind: 'invalid', message: 'the carrier path is not a regular file' };
  let text: string;
  let raw: unknown;
  try {
    text = readFileSync(path, 'utf8');
    raw = JSON.parse(text);
  } catch {
    return { kind: 'invalid', message: 'the file is not valid JSON' };
  }
  return { kind: 'ok', text, raw };
}

/**
 * The raw-text refusal, or `null` when the text declares `"phase"` exactly once. No file this
 * project writes needs a backslash: the only key is `phase` and the only values are `name-only`
 * and `offered-by-default`, none of which needs an escape. Refusing one outright is broader than
 * JSON's grammar — it also refuses a file that escapes a letter of the key, which decodes to a
 * legal value — but the wider refusal errs in the safe direction, and it means the key cannot be
 * written as an escape that `JSON.parse` reads as the property `phase` while a count of the
 * literal text misses it. With no escape, the count sees every declaration, so a repeated key that
 * `JSON.parse` would resolve by keeping the LAST is refused instead.
 */
function duplicateDeclarationMessage(text: string): string | null {
  if (text.includes('\\')) {
    return 'the file contains a backslash; write the key plainly as "phase" — an escaped key would hide a second declaration';
  }
  if ((text.match(/"phase"\s*:/g) ?? []).length > 1) {
    return 'the file declares "phase" more than once; exactly one declaration is legal';
  }
  return null;
}

/**
 * The own-key refusal, or `null` when the parsed object carries only `phase`. `strict()` refuses an
 * unknown key except `__proto__`; this check closes that hole, so nothing is carried beside it.
 */
function carriedKeyMessage(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const keys = Object.keys(raw);
  if (keys.length === 1 && keys[0] === 'phase') return null;
  return 'the file must hold exactly one key, "phase"';
}

export function readLanePhase(projectRoot: string): ReadLanePhaseResult {
  const path = lanePhasePath(projectRoot);
  const carrier = readCarrier(path);
  if (carrier.kind === 'missing') return { kind: 'missing', path };
  if (carrier.kind === 'invalid') return { kind: 'invalid', path, message: carrier.message };
  const duplicate = duplicateDeclarationMessage(carrier.text);
  if (duplicate !== null) return { kind: 'invalid', path, message: duplicate };
  const carried = carriedKeyMessage(carrier.raw);
  if (carried !== null) return { kind: 'invalid', path, message: carried };
  const parsed = lanePhaseFileSchema.safeParse(carrier.raw);
  if (!parsed.success) return { kind: 'invalid', path, message: describeIssues(parsed.error) };
  return { kind: 'ok', path, file: parsed.data };
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}
