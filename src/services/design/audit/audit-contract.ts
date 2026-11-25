/**
 * Reading the audit's contract file (`design/tokens.json`).
 *
 * Split from `audit-project.ts` when S8 added `visibleDeltaE` and the project
 * reader crossed the file-size ceiling. The reader keeps one responsibility:
 * decide which app units exist. This module only shapes the token file into the
 * `AuditContract` every detector reads. A malformed file becomes an empty
 * contract, never a throw: the audit then reports `unmeasured` gaps, and an
 * over-cap file is refused by the caller before this reader is reached.
 */

import { join } from 'node:path';

import { readCappedText } from '../file-cap.js';
import type { ColorTokenGroup } from './audit-color.js';
import type { DeclaredColorPair } from './audit-contrast.js';
import type { AuditContract } from './audit-unit.js';

function readJson(filePath: string): Record<string, unknown> {
  const read = readCappedText(filePath);
  if (read.kind !== 'read') return {};
  try {
    const parsed: unknown = JSON.parse(read.text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function colorGroup(value: unknown): ColorTokenGroup | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const group: ColorTokenGroup = {};
  for (const [key, token] of Object.entries(value as Record<string, unknown>)) {
    if (token === null || typeof token !== 'object') continue;
    const parsed = token as { $value?: unknown };
    if (typeof parsed.$value === 'string') group[key] = { $value: parsed.$value };
  }
  return group;
}

/** The declared pairs are validated again by `auditContrast`; this only shapes. */
function declaredPairs(value: unknown): DeclaredColorPair[] {
  return Array.isArray(value) ? (value as DeclaredColorPair[]) : [];
}

/** The contract's own visible ΔE step, when it declares a positive number. */
function visibleDeltaE(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** The audit's contract as `design/tokens.json` declares it. */
export function readAuditContract(designRoot: string): AuditContract {
  const raw = readJson(join(designRoot, 'tokens.json'));
  const delta = visibleDeltaE(raw.visibleDeltaE);
  return {
    color: colorGroup(raw.color),
    pairs: declaredPairs(raw.pairs),
    ...(delta === undefined ? {} : { visibleDeltaE: delta })
  };
}
