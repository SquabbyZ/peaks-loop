/**
 * Slice 2026-07-29-rid-prose-only-sweep-006 — closes peaks-qa
 * discovered lines md-26 / md-113 / md-165 / md-201.
 */

import { describe, expect, test } from 'vitest';
import {
  lintQaGateguardPreflight,
  lintQaRuntimeContract
} from '../../../../src/services/audit/enforcers/lint-qa-gateguard-and-runtime.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makeQaSkill(body: string): SkillFile {
  return {
    name: 'peaks-qa',
    path: 'skills/bee/peaks-qa/SKILL.md',
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintQaGateguardPreflight', () => {
  test('passes when the gateguard pre-flight heading is present', () => {
    const skill = makeQaSkill([
      '## Pre-flight: gateguard-fact-force conflict (BLOCKING — read before any Edit/Write)',
      '',
      'Some content about the third-party hook.'
    ].join('\n'));
    expect(lintQaGateguardPreflight(skill)).toEqual([]);
  });

  test('emits a hit when the heading is missing', () => {
    const skill = makeQaSkill('## Runbook\n');
    const hits = lintQaGateguardPreflight(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-qa-gateguard-preflight-001');
  });

  test('non-peaks-qa SKILL.md is not enforcer-targeted', () => {
    const skill: SkillFile = {
      name: 'peaks-rd',
      path: 'skills/bee/peaks-rd/SKILL.md',
      body: '## Runbook',
      lines: ['## Runbook']
    };
    expect(lintQaGateguardPreflight(skill)).toEqual([]);
  });
});

describe('lintQaRuntimeContract', () => {
  test('passes when transition gates + playwright + openspec are all present', () => {
    const skill = makeQaSkill([
      '### Transition verification gates (MANDATORY — run the command, see the output)',
      '',
      'if playwright mcp is unavailable, the llm checks ...',
      '',
      'When the target repository has openspec/, qa must ...'
    ].join('\n'));
    expect(lintQaRuntimeContract(skill)).toEqual([]);
  });

  test('emits a hit when playwright MCP handling is missing', () => {
    const skill = makeQaSkill([
      '### Transition verification gates (MANDATORY)',
      '',
      'When the target repository has openspec/, qa must ...'
    ].join('\n'));
    const hits = lintQaRuntimeContract(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/Playwright/);
  });
});
