/**
 * Canonical H8 digest shared by STRAT, TACT and the CLI verifiers.
 *
 * WHY one export: `writeStrategy`, `writeImpl` and the `peaks tact read|write`
 * verifiers must compute the IDENTICAL digest, or an artifact signed by one
 * side is refused by the other. Keeping the omit-`sha256` + sorted-keys rule
 * in one place is what stops that drift.
 *
 * WHY A RECURSIVE SORT AND NOT `JSON.stringify(rest, Object.keys(rest).sort())`:
 * the array-replacer form filters keys at EVERY nesting level, so a nested
 * object whose keys are not top-level names serializes as `{}` — the digest
 * then ignores `astGateResult`, `changedFiles[]` entries and
 * `askUserQuestion` entirely. Measured: forging `impl.json#astGateResult`
 * without touching `sha256` still verified. The sort must be applied by hand,
 * per level, so every nested value is part of the digest.
 */
import { createHash } from 'node:crypto';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = stableValue(source[key]);
  }
  return sorted;
}

export function canonicalSha256(content: object): string {
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  return createHash('sha256')
    .update(JSON.stringify(stableValue(rest)))
    .digest('hex');
}
