// tests/unit/standards/_expired-grace-scan.ts
//
// The pure scan machinery behind
// `tests/unit/standards/expired-grace-ratchet.test.ts` — the shrink-only ratchet
// for expired temporary-debt markers of the shape
// `grace: 1 minor release (vX.Y.Z)` (and the `, vX.Y.Z)` spelling).
//
// WHY A RATCHET AND NOT A FIX. 129 silent catches carry a "grace: 1 minor
// release" marker written when the current version was 2.x; the tree is now
// 4.1.6, so every one of those markers has expired and nothing noticed. Fixing
// 129 catch sites at once is separate, riskier work. This module provides the
// measurement half of the alternative: record the population on disk, fail when
// it grows, and fail when it moves at all without the baseline being updated.
//
// This is a scan LIBRARY, not a test file: it has no `.test.ts` suffix, so the
// unit config (`include: tests/unit/**/*.test.ts`) does not collect it. The
// assertion half — including the control arms that prove this detector can
// fail — lives in the ratchet test.
//
// Both functions are pure and take their inputs as parameters so the control
// arms can drive them with synthetic text and synthetic populations instead of
// a private copy of the logic.

/**
 * One `grace: 1 minor release [vX.Y.Z]` marker.
 *
 * `version` is `null` for a marker with no version on its line. Such a marker
 * cannot be dated, so it is treated as expired and must be baselined: the
 * alternative would let an undated marker exist forever.
 */
export interface GraceMarker {
  /** 1-based line number in the scanned text. */
  readonly line: number;
  /** The marker as written, e.g. `grace: 1 minor release (v2.14.0)`. */
  readonly marker: string;
  /** `v<major>.<minor>.<patch>`, or `null` when the marker carries no version. */
  readonly version: string | null;
  /** True when the marker is unversioned, or its minor predates `currentMinor`. */
  readonly expired: boolean;
}

export interface GraceBaselineEntry {
  /** Repo-relative, POSIX separators. */
  readonly path: string;
  readonly occurrences: number;
  /** Sorted, de-duplicated versions; `"unversioned"` for a null version. */
  readonly versions: readonly string[];
}

export interface GraceBaseline {
  readonly version: number;
  readonly currentMinor: string;
  readonly files: readonly GraceBaselineEntry[];
}

/**
 * The two ways a population may disagree with the baseline.
 *
 * `unblessed` — a file has expired markers but no baseline entry.
 * `count-mismatch` — a baselined file's expired-marker count changed.
 * `stale` — a baseline entry's file no longer has any expired marker.
 */
export type BaselineViolation =
  | {
      readonly kind: 'unblessed';
      readonly path: string;
      readonly count: number;
      readonly markers: readonly GraceMarker[];
    }
  | {
      readonly kind: 'count-mismatch';
      readonly path: string;
      readonly count: number;
      readonly expected: number;
    }
  | {
      readonly kind: 'stale';
      readonly path: string;
      readonly count: number;
    };

const MARKER_PATTERN = /grace:\s*1\s+minor\s+release/gi;
const VERSION_PATTERN = /\bv(\d+)\.(\d+)\.(\d+)\b/;

/** Parse `"<major>.<minor>"` (a full `X.Y.Z` version is also accepted). */
export function parseMinor(minor: string): readonly [number, number] {
  const [majorText, minorText] = minor.split('.');
  const major = Number(majorText);
  const minorNumber = Number(minorText);
  if (!Number.isInteger(major) || !Number.isInteger(minorNumber)) {
    throw new Error(`expected <major>.<minor>, got '${minor}'`);
  }
  return [major, minorNumber];
}

interface ParsedVersion {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  /** Offset in the line just past the patch digit. */
  readonly end: number;
}

/** The first `v<major>.<minor>.<patch>` at or after `from` on this line. */
function versionAfter(line: string, from: number): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(line.slice(from));
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return undefined;
  return {
    version: `v${match[1]}.${match[2]}.${match[3]}`,
    major,
    minor,
    end: from + match.index + match[0].length
  };
}

/**
 * Every grace marker in `sourceText`, with its expiry decision.
 *
 * Expiry is the tuple comparison the contract states: `[major, minor]` is older
 * than `currentMinor`'s pair. Markers at the current minor (or newer) are
 * returned with `expired: false` rather than dropped, so the control arm can
 * assert their presence without treating them as debt.
 */
export function scanExpiredGrace(sourceText: string, currentMinor: string): GraceMarker[] {
  const [currentMajor, currentMinorNumber] = parseMinor(currentMinor);
  const markers: GraceMarker[] = [];

  sourceText.split(/\r?\n/).forEach((line, index) => {
    // A local pattern per line: a shared global regex would carry `lastIndex`
    // across lines and silently skip a marker.
    const pattern = new RegExp(MARKER_PATTERN.source, MARKER_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const afterMarker = match.index + match[0].length;
      const parsed = versionAfter(line, afterMarker);
      const expired =
        parsed === undefined ||
        parsed.major < currentMajor ||
        (parsed.major === currentMajor && parsed.minor < currentMinorNumber);
      const end = parsed === undefined ? afterMarker : parsed.end;
      // Include a closing paren when it immediately follows the version, so the
      // reported marker reads the way it was written.
      const closing = line[end] === ')' ? end + 1 : end;
      markers.push({
        line: index + 1,
        marker: line.slice(match.index, closing),
        version: parsed?.version ?? null,
        expired
      });
    }
  });

  return markers;
}

/**
 * Compare a measured population (repo-relative path → EXPIRED markers) with the
 * recorded baseline. Pure, so the ratchet test can prove both directions with a
 * synthetic population instead of editing the real tree.
 */
export function compareBaseline(
  population: ReadonlyMap<string, readonly GraceMarker[]>,
  baseline: GraceBaseline
): BaselineViolation[] {
  const violations: BaselineViolation[] = [];
  const blessed = new Map(baseline.files.map((entry) => [entry.path, entry]));

  for (const [path, markers] of population) {
    const entry = blessed.get(path);
    if (entry === undefined) {
      violations.push({ kind: 'unblessed', path, count: markers.length, markers });
    } else if (entry.occurrences !== markers.length) {
      violations.push({
        kind: 'count-mismatch',
        path,
        count: markers.length,
        expected: entry.occurrences
      });
    }
  }

  for (const entry of baseline.files) {
    if ((population.get(entry.path)?.length ?? 0) === 0) {
      violations.push({ kind: 'stale', path: entry.path, count: 0 });
    }
  }

  return violations;
}
