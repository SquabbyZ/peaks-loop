/**
 * Reading the frontmatter block out of a `.peaks/project-scan/project-scan.md`.
 *
 * Split out of `project-scan-field-refresh.ts` to stay under the `src/**`
 * 300-line cap, and because the CRLF problem is its own subject: every caller
 * that wants the frontmatter needs the same two facts (the block, and where the
 * body begins), and getting them wrong on a Windows checkout is what re-freezes
 * the scan.
 */

/** The leading frontmatter split apart, with the offsets the writer needs. */
export type FrontmatterSplit = {
  /** The block between the fences, line endings normalised to `\n`. */
  readonly frontmatter: string;
  /** Offset in the ORIGINAL text at which the markdown body starts. */
  readonly bodyStart: number;
  /** True when the file's fences are `---\r\n` (a Windows checkout). */
  readonly crlf: boolean;
};

/**
 * Split the leading `---` block.
 *
 * CRLF-TOLERANT ON PURPOSE. `core.autocrlf=true` is the default on Windows, so a
 * checkout can hand this module a file whose fences are `---\r\n`. A pattern
 * anchored on `\n` alone finds no frontmatter there and the refresh refuses —
 * reviving the exact freeze the refresh exists to end, on the platform most of
 * its users run. The block is returned with `\n` endings so the yaml AST offsets
 * and the span arithmetic agree; `crlf` records what the file actually uses, so
 * the writer can put it back.
 */
export function splitFrontmatter(content: string): FrontmatterSplit | null {
  const match = /^---(\r?\n)([\s\S]*?)\r?\n---/.exec(content);
  if (match === null) return null;
  return {
    frontmatter: (match[2] ?? '').replace(/\r\n/g, '\n'),
    bodyStart: match[0].length,
    crlf: match[1] === '\r\n'
  };
}

/** The frontmatter block alone, or `null`. */
export function frontmatterOf(content: string): string | null {
  return splitFrontmatter(content)?.frontmatter ?? null;
}
