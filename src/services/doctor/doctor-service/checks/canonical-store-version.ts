/**
 * Check: the canonical skill store against the installed package
 * (`skills:store-version:store`).
 *
 * THE HOLE THIS CLOSES. `skill-reference-parity` compares the canonical store
 * against the IDE trees — and on a normal install the IDE entry is a LINK INTO
 * the store, so the two sides are the SAME tree and the comparison is always in
 * parity. A store frozen at an old release is perfectly self-consistent, and
 * therefore invisible to that check. The comparison this one makes is the other
 * axis: STORE against PACKAGE. The store's sidecar records the version that
 * produced each copy; the package's `package.json#version` is the version that
 * SHOULD have produced it. A gap between them is staleness nothing else can see.
 *
 * THE PATTERN. It is the `dist-source-version` shape applied to the store: a
 * missing input is INFORMATIONAL, never a red — a machine with no store at all
 * has nothing stale, and saying so is not a finding. A store that cannot be
 * read is a different case: it looks exactly like "no drift", so it is
 * reported.
 *
 * IT ALWAYS EMITS A ROW. A check that stays silent when it finds nothing
 * cannot be told apart from a check that never ran; this one says "clean" out
 * loud, with the version it compared against.
 *
 * READ-ONLY. It lists the store and reads sidecars. It never writes, repairs
 * or deletes; the remedy it names (`peaks skill sync`) is the repair.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_VERSION } from 'peaks-loop-shared/version';
import { z } from 'zod';

import { isExpectedFsMiss } from '../../../../shared/fs-utils.js';
import { tryParseJson } from '../../../../shared/json-parse.js';
import { compareReleaseVersions } from '../../../artifacts/prerequisite-checks.js';
import { peaksHome } from '../../../sop/sop-paths.js';
import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

/** The sidecar shape the store writes. A marker in any other shape is legacy. */
const markerSchema = z.object({
  format: z.literal('peaks-managed-v2'),
  path: z.string().optional(),
  version: z.string().optional()
});

/** One managed store entry, and the version its sidecar records. */
export type CanonicalStoreEntryVersion = {
  readonly name: string;
  /** null when the sidecar records no version — the legacy shape. */
  readonly version: string | null;
};

/** What the store holds, compared with the installed package. */
export type CanonicalStoreVersionInspection = {
  readonly storeRoot: string;
  readonly storePresent: boolean;
  /** False when the store root exists but cannot be listed. */
  readonly readable: boolean;
  /** How many entries the store owns (they carry a `.peaks-managed` sidecar). */
  readonly managed: number;
  readonly entries: readonly CanonicalStoreEntryVersion[];
  /** The entries whose recorded version is behind the installed one. */
  readonly stale: readonly CanonicalStoreEntryVersion[];
  readonly installedVersion: string;
};

/** The version a sidecar records, or null when it records none. */
export function readMarkerVersion(markerPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(markerPath, 'utf8');
  } catch (err) {
    // A sidecar that raced away is "no version"; anything else is a real fault
    // and is not swallowed here.
    if (!isExpectedFsMiss(err)) throw err;
    return null;
  }
  const parsed = tryParseJson(content, markerSchema);
  if (!parsed.ok) return null;
  const version = parsed.value.version;
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/**
 * Is the recorded version behind the installed one? An UNKNOWN version is
 * behind: a copy that cannot say how old it is cannot be shown to be current,
 * and the installed package is the authority on what should be there.
 */
function isBehind(recorded: string | null, installed: string): boolean {
  return compareReleaseVersions(recorded ?? '0.0.0', installed) < 0;
}

/**
 * The managed entries of one canonical skills store, and the ones behind.
 *
 * `storeRoot` is the canonical SKILLS directory (`<PEAKS_HOME or ~/.peaks>/skills`).
 * An entry the user authored carries no sidecar and is not ours, so it is not
 * counted and never reported.
 */
export function inspectCanonicalStoreVersions(
  storeRoot: string,
  installedVersion: string
): CanonicalStoreVersionInspection {
  if (!existsSync(storeRoot)) {
    return {
      storeRoot,
      storePresent: false,
      readable: true,
      managed: 0,
      entries: [],
      stale: [],
      installedVersion
    };
  }
  let names: string[];
  try {
    names = readdirSync(storeRoot).sort();
  } catch (err) {
    // A store root that exists but cannot be listed is not "no drift" — it is
    // a store nobody can check, and it is reported rather than passed over.
    if (!isExpectedFsMiss(err)) throw err;
    return {
      storeRoot,
      storePresent: true,
      readable: false,
      managed: 0,
      entries: [],
      stale: [],
      installedVersion
    };
  }
  const entries: CanonicalStoreEntryVersion[] = [];
  for (const name of names) {
    if (name.endsWith('.peaks-managed') || name.startsWith('.peaks-tmp-')) continue;
    const markerPath = join(storeRoot, `${name}.peaks-managed`);
    if (!existsSync(markerPath)) continue;
    entries.push({ name, version: readMarkerVersion(markerPath) });
  }
  const stale = entries.filter((entry) => isBehind(entry.version, installedVersion));
  return {
    storeRoot,
    storePresent: true,
    readable: true,
    managed: entries.length,
    entries,
    stale,
    installedVersion
  };
}

/** The canonical skills store, exactly where the store writes it. */
function canonicalSkillsStore(): string {
  return join(peaksHome(), 'skills');
}

/** How an entry's recorded version reads in a message. */
function describeEntry(entry: CanonicalStoreEntryVersion): string {
  return entry.version === null
    ? `${entry.name} (no version recorded)`
    : `${entry.name} (${entry.version})`;
}

function toCheck(inspection: CanonicalStoreVersionInspection): DoctorCheck {
  const id = 'skills:store-version:store';
  if (!inspection.storePresent) {
    return {
      id,
      ok: true,
      message:
        `No canonical skill store at ${inspection.storeRoot}; nothing to compare ` +
        '(run `peaks skill sync` to create one)'
    };
  }
  if (!inspection.readable) {
    return {
      id,
      ok: false,
      severity: 'warning',
      message:
        `The canonical skill store at ${inspection.storeRoot} cannot be read; ` +
        'it was not compared with the installed package'
    };
  }
  if (inspection.managed === 0) {
    return {
      id,
      ok: true,
      message:
        `The canonical skill store at ${inspection.storeRoot} holds no peaks-managed entries; ` +
        'nothing to compare'
    };
  }
  if (inspection.stale.length === 0) {
    return {
      id,
      ok: true,
      message:
        `The canonical skill store at ${inspection.storeRoot} is current for all ` +
        `${inspection.managed} managed entries against peaks-loop ${inspection.installedVersion}`
    };
  }
  return {
    id,
    ok: false,
    message:
      `The canonical skill store at ${inspection.storeRoot} is behind the installed ` +
      `peaks-loop ${inspection.installedVersion}: ${inspection.stale.length} of ` +
      `${inspection.managed} managed entries record an older version ` +
      `(${inspection.stale.map(describeEntry).join(', ')}). ` +
      'Run `peaks skill sync` to refresh the store.'
  };
}

function run({ options }: DoctorContext): readonly DoctorCheck[] {
  const injected = options.canonicalStoreVersion;
  const storeRoot = injected?.storeRoot ?? canonicalSkillsStore();
  const installedVersion = injected?.installedVersion ?? CLI_VERSION;
  return [toCheck(inspectCanonicalStoreVersions(storeRoot, installedVersion))];
}

export const check: DoctorCheckPlugin = {
  name: 'canonical-store-version',
  run
};
