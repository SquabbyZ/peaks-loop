/**
 * P2-a Theme C — output style enforcers.
 *
 * The peaks-cli dogfood rule: every skill response carries a status
 * header (`Peaks-Cli Skill: <name> | Peaks-Cli Gate: <gate> | Next:
 * <action>`), the SKILL.md body has no greeting/closing-prompt
 * flattery, and the status header is detectable in the recent
 * session transcript (test-only fixture).
 *
 * The status-header detection is a real check on the fixture's
 * most-recent session file; the no-fluff and no-closing-prompt
 * checks are static pattern scans of the skill's SKILL.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LintHit, SkillFile } from './lint-style.js';

const FLUFF_GREETINGS = [
  /\b你好[！!。，,.]?\s*$/m,
  /^\s*你好[！!。，,.]?\s*$/m,
  /\bHello[,，]?\s*I am\b/i,
  /\bI am (an? )?(helpful )?assistant\b/i,
  /\b作为一个 AI\b/,
  /\b我是 (一个 )?AI\b/,
  /\b作为一个\b/,
  /\b我是(助手|模型|AI)/i
];

const CLOSING_PROMPTS = [
  /\bLet me know if you need\b/i,
  /\b如有(任何)?需要\b/,
  /\b如有需要\b/,
  /\bfeel free to ask\b/i,
  /\bdo not hesitate to\b/i,
  /\b随时(欢迎)?(联系|提问)/i,
  /\b随时 (欢迎 )?(联系|提问)/i
];

const STATUS_HEADER_PATTERN = /Peaks-Cli Skill:\s*peaks-[a-z0-9-]+\s*\|\s*Peaks-Cli Gate:\s*[A-Za-z0-9_.-]+\s*\|\s*Next:\s*\S/;

export function lintNoFluff(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (const pattern of FLUFF_GREETINGS) {
    const lineIdx = skill.lines.findIndex((l) => pattern.test(l));
    if (lineIdx !== -1) {
      hits.push({
        catalogId: 'rl-output-style-no-fluff-001',
        rule: 'no greeting / persona fluff in SKILL.md',
        file: skill.path,
        line: lineIdx + 1,
        matchedText: (skill.lines[lineIdx] ?? '').trim()
      });
    }
  }
  return hits;
}

export function lintNoClosingPrompt(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (const pattern of CLOSING_PROMPTS) {
    const lineIdx = skill.lines.findIndex((l) => pattern.test(l));
    if (lineIdx !== -1) {
      hits.push({
        catalogId: 'rl-output-style-no-closing-prompt-001',
        rule: 'no closing-prompt flattery',
        file: skill.path,
        line: lineIdx + 1,
        matchedText: (skill.lines[lineIdx] ?? '').trim()
      });
    }
  }
  return hits;
}

/**
 * Status header detection: scan the most-recent session log for the
 * canonical header line. The session log is read from the project's
 * `.peaks/_runtime/<sid>/session.log` (or the audit's per-test
 * fixture). For static analysis (no session), the lint returns an
 * empty array (the runtime check is elsewhere).
 */
export function lintStatusHeader(projectRoot: string, sessionId: string): readonly LintHit[] {
  const logPath = join(projectRoot, '.peaks', '_runtime', sessionId, 'session.log');
  let body: string;
  try {
    body = readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  if (!STATUS_HEADER_PATTERN.test(body)) {
    return [{
      catalogId: 'rl-output-style-status-header-001',
      rule: 'Peaks-Cli status header on every response',
      file: logPath,
      line: 1,
      matchedText: '(no Peaks-Cli Skill / Gate / Next header found in session.log)'
    }];
  }
  return [];
}
