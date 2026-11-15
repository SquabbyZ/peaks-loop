/**
 * Keeping the body tables of `.peaks/project-scan/project-scan.md` in step with
 * the frontmatter a refresh just rewrote.
 *
 * WHY THIS EXISTS — a measured defect, not a guess. `peaks-rd`'s own reference
 * (`references/library-version-awareness.md`) tells RD to read the `## Library
 * versions` TABLE, while `readProjectScan` reads the FRONTMATTER. A refresh that
 * only touched the frontmatter left the two disagreeing: measured 2026-11-16 on
 * this repository's own scan — 32 names in the frontmatter, 21 rows in the
 * table, 11 names (including `typescript`) present in only one of them. RD would
 * then cross-check a breaking-change table against rows that never moved.
 *
 * WHAT MAY BE REWRITTEN. Only the version CELL of a row whose package is in the
 * refreshed map, plus whole rows appended for packages the table lacks. The
 * Notes column, the header, the row order and every other prose table are
 * untouched — those are sediment.
 */

/** One body table a refresher may touch, and the column that holds its version. */
const VERSION_CELL_INDEX = 1;

/** A markdown table row, split into its raw cells (`null` when it is not a row). */
function cellsOf(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|');
}

/** Re-join cells into a row, preserving the padding style of the original. */
function joinCells(cells: readonly string[]): string {
  return `|${cells.join('|')}|`;
}

/** The package name a row names, or `null` when the row is not a package row. */
function packageNameOf(cells: readonly string[]): string | null {
  const first = (cells[0] ?? '').trim();
  const backticked = /^`([^`]+)`$/.exec(first);
  if (backticked !== null) return backticked[1] ?? null;
  // The create path writes rows without backticks; accept a bare name too.
  return first === '' || first.includes(' ') ? null : first;
}

/** True for the `|---|---|` separator row. */
function isSeparator(cells: readonly string[]): boolean {
  return cells.every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell));
}

/** The table's first and last line index under the heading, or `null`. */
function tableBounds(
  lines: readonly string[],
  headingAt: number
): { readonly first: number; readonly last: number } | null {
  let first = -1;
  for (let i = headingAt + 1; i < lines.length; i += 1) {
    if (cellsOf(lines[i] ?? '') !== null) {
      first = i;
      break;
    }
    // A later heading before any table row means there is no table here.
    if (/^#{1,6}\s/.test((lines[i] ?? '').trim())) return null;
  }
  if (first < 0) return null;
  let last = first;
  while (last + 1 < lines.length && cellsOf(lines[last + 1] ?? '') !== null) last += 1;
  return { first, last };
}

/** Rewrite one row's version cell, preserving its backtick style. */
function rewriteVersionCell(cells: readonly string[], spec: string): string {
  const next = [...cells];
  const previous = (next[VERSION_CELL_INDEX] ?? '').trim();
  const backticked = /^`.*`$/.test(previous);
  next[VERSION_CELL_INDEX] = backticked ? ` \`${spec}\` ` : ` ${spec} `;
  return joinCells(next);
}

/**
 * Rewrite the `## Library versions` table's version cells from `versions`, and
 * append a row for every package the table does not carry yet.
 *
 * The row's own backtick style is preserved so a hand-authored table keeps its
 * shape; an appended row copies the style of the first existing package row, and
 * falls back to backticked cells when the table is empty.
 */
/** One table row's outcome: the line to emit, and the package it named (if any). */
type RowRewrite = {
  readonly line: string;
  readonly name: string | null;
  readonly width: number;
};

/** Rewrite a single body line against `versions`, or leave it alone. */
function rewriteRow(line: string, versions: Readonly<Record<string, string>>): RowRewrite | null {
  const cells = cellsOf(line);
  if (cells === null) return null;
  if (isSeparator(cells)) return { line, name: null, width: cells.length };
  const name = packageNameOf(cells);
  if (name === null) return { line, name: null, width: cells.length };
  const spec = versions[name];
  return {
    line: spec === undefined ? line : rewriteVersionCell(cells, spec),
    name,
    width: cells.length
  };
}

/** A row for a package the table does not carry, shaped like its neighbours. */
function appendRow(name: string, spec: string, width: number): string {
  const row = Array.from({ length: width }, () => ' ');
  row[0] = ` \`${name}\` `;
  row[VERSION_CELL_INDEX] = ` \`${spec}\` `;
  return joinCells(row);
}

export function refreshLibraryVersionsTable(
  body: string,
  versions: Readonly<Record<string, string>>
): string {
  const lines = body.split('\n');
  const headingAt = lines.findIndex((line) => /^##\s+Library versions\s*$/.test(line.trim()));
  if (headingAt < 0) return body;
  const bounds = tableBounds(lines, headingAt);
  if (bounds === null) return body;
  const { first, last } = bounds;

  const seen = new Set<string>();
  const rewritten: string[] = [];
  let width = VERSION_CELL_INDEX + 1;
  for (let i = first; i <= last; i += 1) {
    const result = rewriteRow(lines[i] ?? '', versions);
    if (result === null) continue;
    width = Math.max(width, result.width);
    if (result.name !== null) seen.add(result.name);
    rewritten.push(result.line);
  }
  for (const name of Object.keys(versions).sort()) {
    if (!seen.has(name)) rewritten.push(appendRow(name, versions[name] ?? '', width));
  }

  return [...lines.slice(0, first), ...rewritten, ...lines.slice(last + 1)].join('\n');
}

/**
 * Rewrite the `## Tech stack` table's value cells from `techStack`, matched by
 * the row's own label. A label with no derived value keeps whatever the author
 * wrote — the table labels are prose ("Node runtime", "Build"), not machine keys,
 * so this matches on a small label→key map rather than guessing.
 */
const TECH_STACK_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^language$/i, 'language'],
  [/^package manager$/i, 'packageManager'],
  [/^node runtime$/i, 'runtime'],
  [/^build$/i, 'buildTool']
];

/** Cell text that carries no information — safe to fill. */
function isPlaceholderCell(text: string): boolean {
  const stripped = text.replace(/[`*_]/g, '').trim();
  return stripped === '' || /^\(?(empty|unknown|n\/a|—|-)\)?$/i.test(stripped);
}

/**
 * Fill the `## Tech stack` table's EMPTY value cells from `techStack`.
 *
 * WHY IT ONLY FILLS, NEVER OVERWRITES. These cells are prose, not a machine
 * record: this repository's own scan reads
 * `| Build | \`tsc -p tsconfig.build.json\` (root, via \`pnpm build\`) + per-package ... |`.
 * An earlier version of this function replaced that with the bare derived
 * `tsc -p tsconfig.build.json`, and did the same to the Language, Package manager
 * and Node runtime rows — measured 2026-11-16, on the very file this slice
 * exists to protect. The derived value is strictly less informative than what an
 * author writes here, so it may only take a cell that is empty or a placeholder.
 * The machine-readable copy is the FRONTMATTER, which is refreshed in full; this
 * table is for humans and stays theirs.
 */
export function refreshTechStackTable(
  body: string,
  techStack: Readonly<Record<string, string>>
): string {
  const lines = body.split('\n');
  const headingAt = lines.findIndex((line) => /^##\s+Tech stack\s*$/.test(line.trim()));
  if (headingAt < 0) return body;

  let last = headingAt;
  while (last + 1 < lines.length) {
    const next = lines[last + 1] ?? '';
    if (/^#{1,6}\s/.test(next.trim()) && last > headingAt) break;
    if (next.trim() === '' && last > headingAt + 1) break;
    last += 1;
  }

  const rewritten = lines.slice(headingAt, last + 1).map((line) => {
    const cells = cellsOf(line);
    if (cells === null || isSeparator(cells)) return line;
    const label = (cells[0] ?? '').trim();
    const match = TECH_STACK_LABELS.find(([pattern]) => pattern.test(label));
    if (match === undefined) return line;
    const value = techStack[match[1]];
    if (value === undefined) return line;
    if (!isPlaceholderCell(cells[1] ?? '')) return line;
    const next = [...cells];
    next[1] = ` ${value} `;
    return joinCells(next);
  });

  return [...lines.slice(0, headingAt), ...rewritten, ...lines.slice(last + 1)].join('\n');
}
