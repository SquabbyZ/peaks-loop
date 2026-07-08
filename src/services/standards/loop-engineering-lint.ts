/**
 * Loop Engineering guidelines linter (M0).
 *
 * Pure function: takes the raw markdown text of
 * `.peaks/standards/loop-engineering-guidelines.md` and returns either
 * `{ ok: true, redLines: [...] }` or `{ ok: false, findings: [...] }`.
 *
 * The four required sections per red line (karpathy-style form) are:
 *   - Failure modes
 *   - Rewrite
 *   - Self-check
 *   - Out-of-scope
 *
 * Each red line is identified by a heading like `## RL-0 — ...`.
 *
 * The lint intentionally does NOT touch any application-level code; it
 * only parses the guideline file. The peaks CLI command
 * `peaks standards lint --category loop-engineering` (registered in M0's
 * plan) will read this file from disk and call this function.
 */

export const EXPECTED_RED_LINE_IDS = [
  'RL-0',
  'RL-1',
  'RL-2',
  'RL-3',
  'RL-4',
  'RL-5',
  'RL-6',
  'RL-7',
  'RL-8',
  'RL-9',
] as const;

export type RedLineId = (typeof EXPECTED_RED_LINE_IDS)[number];

export const REQUIRED_SECTIONS = [
  'Failure modes',
  'Rewrite',
  'Self-check',
  'Out-of-scope',
] as const;

export type RedLineSection = (typeof REQUIRED_SECTIONS)[number];

export interface RedLineReport {
  id: RedLineId;
  title: string;
  sections: Partial<Record<RedLineSection, string>>;
}

export type LintResult =
  | { ok: true; redLines: RedLineReport[] }
  | { ok: false; findings: string[]; redLines: RedLineReport[] };

const RED_LINE_HEADING = /^##\s+(RL-\d+)\s+[—-]\s+(.+?)\s*$/gm;
const SECTION_HEADING = /^##\s+(Failure modes|Rewrite|Self-check|Out-of-scope)\s*$/gm;

export function lintLoopEngineeringGuidelines(raw: string): LintResult {
  const findings: string[] = [];
  if (!raw || raw.trim().length === 0) {
    return { ok: false, findings: ['guideline file is empty'], redLines: [] };
  }

  const redLines = parseRedLines(raw);
  if (redLines.length === 0) {
    findings.push('no red line headings (`## RL-N — ...`) found');
  }

  for (const id of EXPECTED_RED_LINE_IDS) {
    const rl = redLines.find((r) => r.id === id);
    if (!rl) {
      findings.push(`missing red line: ${id}`);
      continue;
    }
    for (const section of REQUIRED_SECTIONS) {
      if (!rl.sections[section] || rl.sections[section]!.trim().length === 0) {
        findings.push(`${id} is missing section "${section}"`);
      }
    }
  }

  if (findings.length > 0) {
    return { ok: false, findings, redLines };
  }
  return { ok: true, redLines };
}

function parseRedLines(raw: string): RedLineReport[] {
  const headingRegex = new RegExp(RED_LINE_HEADING.source, RED_LINE_HEADING.flags);
  const sectionRegex = new RegExp(SECTION_HEADING.source, SECTION_HEADING.flags);

  const headings: Array<{ id: string; title: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(raw)) !== null) {
    headings.push({ id: m[1] ?? '', title: m[2] ?? '', start: m.index + m[0].length, end: raw.length });
  }
  for (let i = 0; i < headings.length - 1; i++) {
    headings[i]!.end = headings[i + 1]!.start;
  }
  if (headings.length > 0) {
    headings[headings.length - 1]!.end = raw.length;
  }

  return headings.map((h) => {
    const body = raw.slice(h.start, h.end);
    const sections: Partial<Record<RedLineSection, string>> = {};
    const sectionMatches: Array<{ name: RedLineSection; start: number }> = [];
    let sm: RegExpExecArray | null;
    while ((sm = sectionRegex.exec(body)) !== null) {
      sectionMatches.push({ name: sm[1] as RedLineSection, start: sm.index + sm[0].length });
    }
    for (let i = 0; i < sectionMatches.length; i++) {
      const start = sectionMatches[i]!.start;
      const end = i + 1 < sectionMatches.length ? sectionMatches[i + 1]!.start - sectionMatches[i]!.start : body.length - start;
      const text = body.slice(start, start + end);
      sections[sectionMatches[i]!.name] = text;
    }
    return {
      id: h.id as RedLineId,
      title: h.title,
      sections,
    };
  });
}
