/**
 * peaks-workflow v3.0.0 — YAML field helpers
 *
 * Private helpers used by the parser in `workflow-spec.ts`. NOT publicly
 * re-exported; not part of the public API surface. Kept in a sibling
 * file so the slimmed `workflow-spec.ts` can stay under the 400-line
 * file-size cap (rid-006 split).
 *
 * File budget: ≤ 400 lines (rid-006 split).
 */

export function leadingSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else break;
  }
  return n;
}

export function parseScalar(raw: string): unknown {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  // Inline array form `[a, b, c]`
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => parseScalar(s.trim()));
  }
  // Strip optional surrounding quotes.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Number?
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  return raw;
}

export function stringField(obj: Record<string, unknown>, key: string, fallback?: string): string {
  const v = obj[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`workflow yaml: missing required string field "${key}"`);
}

export function numberField(obj: Record<string, unknown>, key: string, fallback?: number): number {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`workflow yaml: missing required number field "${key}"`);
}

export function arrayField(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`workflow yaml: field "${key}" must be an array`);
  return v;
}

export function objectField(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = obj[key];
  if (v === undefined) return {};
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`workflow yaml: field "${key}" must be an object`);
  }
  return v as Record<string, unknown>;
}

export function stringArrayField(obj: Record<string, unknown>, key: string): readonly string[] {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`workflow yaml: field "${key}" must be an array of strings`);
  return v.map((s) => String(s));
}