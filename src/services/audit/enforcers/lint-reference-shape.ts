/**
 * P2-b Themes H-K + M-P — references/*.md shape enforcers.
 *
 * Slice #7 L2.4. Each enforcer is a pure function that walks
 * `references/*.md` and returns `readonly LintHit[]`. The audit
 * service (`red-lines-service.ts`) is responsible for the
 * walk; this file is pattern-only.
 *
 * Themes covered here:
 *   H — reference structural shape (3 enforcers)
 *   I — reference cross-references (3 enforcers)
 *   J — reference size + structure (3 enforcers)
 *   K — loadStrategy behavior (2 enforcers)
 *   M — inline shell patterns (3 enforcers)
 *   N — code blocks (3 enforcers)
 *   O — permissions + numbers (2 enforcers)
 *   P — dogfooding (2 enforcers)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LintHit, SkillFile } from './lint-style.js';

const H1_TITLE_PATTERN = /^#\s+\S/m;
const TASK_LEVELS_PATTERN = /(applicableTaskLevels|task levels:|applies to (L1a|L1b|L2|L3|L4))/i;
const SEE_ALSO_HEADING = /^##\s+(See also|Related|References)\b/im;
const H2_HEADING = /^##\s+\S/gm;
const OVERVIEW_HEADING = /^##\s+Overview\b/im;
const FALLBACK_PATTERN = /(> Fallback:|^\*\*Fallback\*\*:)/m;
const TOP_LEVEL_SUDO = /^\s*sudo\s+/m;
const CURL_PIPE_BASH = /curl[^\n]*\|\s*bash/;
const HEREDOC_PATTERN = /<<-?\s*\w+/;
const CHMOD_777 = /chmod\s+777/;
const FENCED_BLOCK = /```(\w*)\n([\s\S]*?)\n```/g;
const FENCED_BLOCK_LANG_REQUIRED = /```\w+\n/;
const FAKE_PROMPT = /^[\s]*(?:#|\$)\s*fake\b/im;
const ABSOLUTE_PATH_WINDOWS = /[A-Z]:\\[\w\\]/;
const ABSOLUTE_PATH_UNIX = /\/usr\/(?:local|bin|opt)\b/;
const MAGIC_NUMBER = /\b(\d{3,})\b/;
const LOAD_STRATEGY_PATTERN = /loadStrategy:\s*(always|on-demand)/i;

export interface ReferenceFile {
  readonly skill: string;
  readonly name: string;
  readonly path: string;
  readonly body: string;
  readonly lines: readonly string[];
}

function findLine(lines: readonly string[], pattern: RegExp): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i] ?? '')) return i + 1;
  }
  return -1;
}

function hit(
  catalogId: string,
  rule: string,
  file: string,
  line: number,
  matchedText: string
): LintHit {
  return { catalogId, rule, file, line, matchedText };
}

// ==================== Theme H — structural shape ====================

export function lintH1TitleRequired(ref: ReferenceFile): readonly LintHit[] {
  if (H1_TITLE_PATTERN.test(ref.body)) return [];
  return [hit(
    'rl-ref-h1-title-required-001',
    'every references/*.md starts with `# <title>`',
    ref.path,
    1,
    '(missing `# <title>` first-line heading)',
  )];
}

export function lintApplicableTaskLevels(ref: ReferenceFile): readonly LintHit[] {
  if (TASK_LEVELS_PATTERN.test(ref.body)) return [];
  return [hit(
    'rl-ref-applicable-task-levels-declared-001',
    'every references/*.md declares applicableTaskLevels',
    ref.path,
    1,
    '(missing applicableTaskLevels declaration)',
  )];
}

export function lintSeeAlsoSection(ref: ReferenceFile): readonly LintHit[] {
  if (SEE_ALSO_HEADING.test(ref.body)) return [];
  return [hit(
    'rl-ref-see-also-section-001',
    'every references/*.md has a `## See also` section',
    ref.path,
    1,
    '(missing `## See also` (or `## Related` / `## References`) section)',
  )];
}

// ==================== Theme I — cross-references ====================

export function lintCrossRefResolves(
  ref: ReferenceFile,
  refsDir: string,
  siblings: readonly string[]
): readonly LintHit[] {
  const hits: LintHit[] = [];
  // Match `../<file>.md` or `references/<file>.md` or `<file>.md` style.
  const linkPattern = /\[([^\]]+)\]\((?:\.\/|\.\.\/)?(?:references\/)?([\w./-]+\.md)(?:#[\w-]+)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(ref.body)) !== null) {
    const target = m[2] ?? '';
    if (!target) continue;
    const candidates = [
      join(refsDir, target),
      join(refsDir, '..', target),
      join(refsDir, '..', '..', target),
    ];
    const exists = candidates.some((c) => existsSync(c)) || siblings.includes(target);
    if (!exists) {
      const line = ref.body.slice(0, m.index ?? 0).split('\n').length;
      hits.push(hit(
        'rl-ref-cross-ref-resolves-001',
        'every `../<file>.md` link from a reference resolves',
        ref.path,
        line,
        target,
      ));
    }
  }
  return hits;
}

export function lintNoSelfReference(ref: ReferenceFile): readonly LintHit[] {
  const basename = ref.name;
  // Match `[text](<basename>)` (exact or with section fragment).
  const re = new RegExp(`\\]\\(${basename}(?:#[\\w-]+)?\\)`);
  if (!re.test(ref.body)) return [];
  const line = findLine(ref.lines, re);
  return [hit(
    'rl-ref-no-self-reference-001',
    'no reference file links to itself',
    ref.path,
    line === -1 ? 1 : line,
    `(self-link to ${basename})`,
  )];
}

export function lintNoOrphanLink(ref: ReferenceFile): readonly LintHit[] {
  // Heuristic: a markdown link to a non-.md URL with no protocol
  // and no recognized image extension is an orphan. We do a soft
  // pass here — the strict version is `lintCrossRefResolves`
  // above; this one is a defensive backstop for paths the strict
  // version doesn't catch.
  const hits: LintHit[] = [];
  const linkPattern = /\[([^\]]+)\]\(([\w./-]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(ref.body)) !== null) {
    const target = m[2] ?? '';
    if (!target || target.startsWith('http') || target.startsWith('mailto:')) continue;
    if (target.endsWith('.md') || target.endsWith('.json') || target.endsWith('.ts')) continue;
    // Bare word: probably an anchor link; skip.
    if (!target.includes('/') && !target.includes('.')) continue;
    const line = ref.body.slice(0, m.index ?? 0).split('\n').length;
    hits.push(hit(
      'rl-ref-no-orphan-link-001',
      'no link to a non-existent file or section',
      ref.path,
      line,
      target,
    ));
  }
  return hits;
}

// ==================== Theme J — size + structure ====================

export function lintLineCountLe800(ref: ReferenceFile): readonly LintHit[] {
  if (ref.lines.length <= 800) return [];
  return [hit(
    'rl-ref-line-count-le-800-001',
    'each reference ≤ 800 lines (Karpathy 4 原则 §2.3)',
    ref.path,
    1,
    `(line count ${ref.lines.length} > 800)`,
  )];
}

export function lintH2CountLe12(ref: ReferenceFile): readonly LintHit[] {
  const matches = ref.body.match(H2_HEADING) ?? [];
  if (matches.length <= 12) return [];
  return [hit(
    'rl-ref-h2-count-le-12-001',
    'at most 12 `## <heading>` per reference',
    ref.path,
    1,
    `(h2 count ${matches.length} > 12)`,
  )];
}

export function lintOverviewNearTop(ref: ReferenceFile): readonly LintHit[] {
  if (ref.lines.length <= 200) return [];
  if (findLine(ref.lines.slice(0, 30), OVERVIEW_HEADING) !== -1) return [];
  return [hit(
    'rl-ref-overview-section-near-top-001',
    'long references (>200 lines) must have `## Overview` within the first 30 lines',
    ref.path,
    1,
    '(missing `## Overview` near top of long reference)',
  )];
}

// ==================== Theme K — loadStrategy behavior ====================

export function lintLoadStrategyOnDemandFallback(ref: ReferenceFile): readonly LintHit[] {
  if (!/loadStrategy:\s*on-demand/i.test(ref.body)) return [];
  if (FALLBACK_PATTERN.test(ref.body)) return [];
  return [hit(
    'rl-ref-loadstrategy-on-demand-fallback-001',
    'loadStrategy: on-demand references must declare a fallback path',
    ref.path,
    1,
    '(missing `> Fallback:` or `**Fallback**:` declaration)',
  )];
}

export function lintLoadStrategyAlwaysCacheable(ref: ReferenceFile): readonly LintHit[] {
  if (!/loadStrategy:\s*always/i.test(ref.body)) return [];
  // Heuristic: a loadStrategy: always reference must not have a
  // top-level shell command. This is a soft check — we look at
  // the first 10 non-frontmatter lines for I/O patterns.
  const lines = ref.lines.slice(0, 20);
  for (const line of lines) {
    if (/^\s*(npm|pnpm|yarn|npx|git|curl|wget|docker)\s+/.test(line)) {
      return [hit(
        'rl-ref-loadstrategy-always-cacheable-001',
        'loadStrategy: always references must not run I/O at top of file',
        ref.path,
        1,
        `(I/O pattern at top of file: ${line.trim()})`,
      )];
    }
  }
  return [];
}

// ==================== Theme M — inline shell patterns ====================

export function lintNoBashHeredoc(ref: ReferenceFile): readonly LintHit[] {
  if (!HEREDOC_PATTERN.test(ref.body)) return [];
  const line = findLine(ref.lines, HEREDOC_PATTERN);
  return [hit(
    'rl-ref-no-bash-heredoc-001',
    'no `cat <<EOF` in inline shell snippets',
    ref.path,
    line === -1 ? 1 : line,
    '(bash heredoc pattern found)',
  )];
}

export function lintNoSudo(ref: ReferenceFile): readonly LintHit[] {
  if (!TOP_LEVEL_SUDO.test(ref.body)) return [];
  const line = findLine(ref.lines, TOP_LEVEL_SUDO);
  return [hit(
    'rl-ref-no-sudo-001',
    'no `sudo` in inline shell snippets',
    ref.path,
    line === -1 ? 1 : line,
    '(sudo command found)',
  )];
}

export function lintNoCurlPipeBash(ref: ReferenceFile): readonly LintHit[] {
  if (!CURL_PIPE_BASH.test(ref.body)) return [];
  const line = findLine(ref.lines, CURL_PIPE_BASH);
  return [hit(
    'rl-ref-no-curl-pipe-bash-001',
    'no `curl ... | bash` in inline shell snippets',
    ref.path,
    line === -1 ? 1 : line,
    '(curl-pipe-bash pattern found)',
  )];
}

// ==================== Theme N — code blocks ====================

export function lintCodeBlockLanguage(ref: ReferenceFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  // Reset regex state.
  FENCED_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCED_BLOCK.exec(ref.body)) !== null) {
    const lang = m[1] ?? '';
    if (lang === '') {
      const line = ref.body.slice(0, m.index ?? 0).split('\n').length;
      hits.push(hit(
        'rl-ref-code-block-language-declared-001',
        'every fenced block has a language tag',
        ref.path,
        line,
        '(untyped fenced code block — ` ``` ` without language tag)',
      ));
    }
  }
  return hits;
}

export function lintNoFakePrompt(ref: ReferenceFile): readonly LintHit[] {
  if (!FAKE_PROMPT.test(ref.body)) return [];
  const line = findLine(ref.lines, FAKE_PROMPT);
  return [hit(
    'rl-ref-no-fake-prompt-001',
    'no `# fake prompt` / `$ fake` markers in code blocks',
    ref.path,
    line === -1 ? 1 : line,
    '(fake-prompt marker found)',
  )];
}

export function lintNoAbsolutePaths(ref: ReferenceFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  if (ABSOLUTE_PATH_WINDOWS.test(ref.body)) {
    const line = findLine(ref.lines, ABSOLUTE_PATH_WINDOWS);
    hits.push(hit(
      'rl-ref-no-absolute-paths-001',
      'no `C:\\` or `/usr/local` in code blocks',
      ref.path,
      line === -1 ? 1 : line,
      '(Windows absolute path found)',
    ));
  }
  if (ABSOLUTE_PATH_UNIX.test(ref.body)) {
    const line = findLine(ref.lines, ABSOLUTE_PATH_UNIX);
    hits.push(hit(
      'rl-ref-no-absolute-paths-001',
      'no `C:\\` or `/usr/local` in code blocks',
      ref.path,
      line === -1 ? 1 : line,
      '(Unix absolute path found)',
    ));
  }
  return hits;
}

// ==================== Theme O — permissions + numbers ====================

export function lintNoChmod777(ref: ReferenceFile): readonly LintHit[] {
  if (!CHMOD_777.test(ref.body)) return [];
  const line = findLine(ref.lines, CHMOD_777);
  return [hit(
    'rl-ref-no-chmod-777-001',
    'no `chmod 777` in inline shell',
    ref.path,
    line === -1 ? 1 : line,
    '(chmod 777 found — security red flag)',
  )];
}

export function lintNoMagicNumbers(ref: ReferenceFile): readonly LintHit[] {
  // Look at code blocks for unsigned integers ≥ 100. We don't
  // try to be smart about hex / decimal distinction; the
  // enforcer is pattern-only.
  const hits: LintHit[] = [];
  FENCED_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCED_BLOCK.exec(ref.body)) !== null) {
    const block = m[2] ?? '';
    const numMatch = block.match(MAGIC_NUMBER);
    if (!numMatch) continue;
    const offset = (m.index ?? 0) + (m[0].indexOf(numMatch[0] ?? ''));
    const line = ref.body.slice(0, offset).split('\n').length;
    hits.push(hit(
      'rl-ref-no-magic-numbers-001',
      'no unsigned integer ≥ 100 that is not a named constant',
      ref.path,
      line,
      `(magic number ${numMatch[0]} in code block)`,
    ));
  }
  return hits;
}

// ==================== Theme P — dogfooding ====================

export function lintSkillCitesEveryReference(
  ref: ReferenceFile,
  skill: SkillFile
): readonly LintHit[] {
  // A reference IS cited if its name appears anywhere in the
  // parent SKILL.md body, OR if its content includes a forward
  // link to the SKILL.md.
  const refName = ref.name;
  const skillName = skill.name;
  const citedInSkill = skill.body.includes(refName) || skill.body.includes(`./references/${refName}`);
  const citedInRef = ref.body.includes(`../SKILL.md`) || ref.body.includes(`SKILL.md#`);
  if (citedInSkill || citedInRef) return [];
  return [hit(
    'rl-ref-skill-cites-every-existing-reference-001',
    'every reference IS cited in its parent SKILL.md (or links to it)',
    ref.path,
    1,
    `(uncited reference ${refName} in skill ${skillName})`,
  )];
}

export function lintLoadStrategyMatchesSize(
  ref: ReferenceFile
): readonly LintHit[] {
  const sizeBytes = Buffer.byteLength(ref.body, 'utf8');
  if (sizeBytes <= 5 * 1024) return [];
  // >5KB file should declare loadStrategy: on-demand (always
  // is a context-budget bug).
  const strategy = LOAD_STRATEGY_PATTERN.exec(ref.body);
  if (strategy && strategy[1]?.toLowerCase() === 'on-demand') return [];
  return [hit(
    'rl-ref-loadstrategy-matches-size-001',
    'loadStrategy: on-demand is required for files > 5KB',
    ref.path,
    1,
    `(size ${sizeBytes} bytes; loadStrategy must be \`on-demand\`)`,
  )];
}

export function readReferenceFiles(
  skillsRoot: string,
  skillName: string,
  refNames: readonly string[]
): readonly ReferenceFile[] {
  const refsDir = join(skillsRoot, skillName, 'references');
  const out: ReferenceFile[] = [];
  for (const name of refNames) {
    const path = join(refsDir, name);
    if (!existsSync(path)) continue;
    const body = readFileSync(path, 'utf8');
    out.push({ skill: skillName, name, path, body, lines: body.split(/\r?\n/) });
  }
  return out;
}
