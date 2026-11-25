/**
 * The one byte cap every design input is read through.
 *
 * The audit and the G1 scan read DECLARATIONS — a token table, a paved road, a
 * tsconfig's `paths` — never a payload. A multi-megabyte `tokens.json` is not a
 * contract anyone declared; it is a file that would be loaded whole and
 * re-scanned, so each reader refuses it and names the cap instead of reading
 * it. `MAX_SOURCE_BYTES` is also the per-source cap the audit's source cache
 * applies (a stylesheet, a page module); one number serves both so a reader
 * cannot drift from the walk.
 *
 * A refusal is a VALUE, never a silent empty contract: `oversize` carries the
 * measured size so the caller can report it, and `missing` stays distinct so
 * "absent" (a legitimate older contract) is never confused with "too large".
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line no-magic-numbers -- one kibibyte, by definition.
const BYTES_PER_KIB = 1024;

/** One design input larger than this is refused, and the refusal is reported. */
export const MAX_SOURCE_BYTES = 2 * BYTES_PER_KIB * BYTES_PER_KIB;

/** What one capped read produced: text, a measured over-cap size, or absence. */
export type CappedText =
  { kind: 'read'; text: string } | { kind: 'oversize'; bytes: number } | { kind: 'missing' };

/** The measured size of a path, or the reason no size could be taken. */
type FileSize = { kind: 'size'; bytes: number } | { kind: 'absent' };

function fileSize(filePath: string): FileSize {
  try {
    return { kind: 'size', bytes: statSync(filePath).size };
  } catch {
    return { kind: 'absent' };
  }
}

/** Read a file unless it exceeds the cap; never return an over-cap body. */
export function readCappedText(filePath: string): CappedText {
  const size = fileSize(filePath);
  if (size.kind === 'absent') return { kind: 'missing' };
  if (size.bytes > MAX_SOURCE_BYTES) return { kind: 'oversize', bytes: size.bytes };
  try {
    return { kind: 'read', text: readFileSync(filePath, 'utf8') };
  } catch {
    return { kind: 'missing' };
  }
}

/** A named contract file refused for its size, with its measured size. */
export type OversizedFile = { path: string; bytes: number };

/**
 * The contract files under `designRoot` that EXIST but exceed the cap. This
 * only stats them, so a refusal costs no read; the path is design-relative
 * (`design/tokens.json`) so a refusal can cite it without re-deriving the name.
 */
export function oversizedContracts(designRoot: string, names: readonly string[]): OversizedFile[] {
  const oversized: OversizedFile[] = [];
  for (const name of names) {
    const size = fileSize(join(designRoot, name));
    if (size.kind === 'size' && size.bytes > MAX_SOURCE_BYTES) {
      oversized.push({ path: `design/${name}`, bytes: size.bytes });
    }
  }
  return oversized;
}
