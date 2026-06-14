import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../../src/shared/frontmatter.js';

const SKILL_PATH = resolve(__dirname, '../../../skills/peaks-companion/SKILL.md');

interface PeaksCompanionFrontmatter {
  name?: string;
  description?: string;
  internal?: string;
  slice?: string;
  channel?: string;
  surface?: string;
}

function extractBody(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (match === null || match[1] === undefined) throw new Error('SKILL.md is missing YAML frontmatter');
  let body = match[1];
  if (body.startsWith('\n')) body = body.slice(1);
  if (body.endsWith('\n')) body = body.slice(0, -1);
  return body;
}

describe('skills/peaks-companion/SKILL.md', () => {
  const raw = readFileSync(SKILL_PATH, 'utf8');
  const parsed = parseFrontmatter(raw) as PeaksCompanionFrontmatter;
  const body = extractBody(raw);

  it('declares name === "peaks-companion"', () => {
    expect(parsed.name).toBe('peaks-companion');
  });

  it('description contains the four trigger keywords (WeChat, install, status, pair)', () => {
    const desc = parsed.description ?? '';
    expect(desc.toLowerCase()).toContain('wechat');
    expect(desc.toLowerCase()).toContain('install');
    expect(desc.toLowerCase()).toContain('status');
    expect(desc.toLowerCase()).toContain('pair');
  });

  it('description mentions the "NEVER invoke cc-connect directly" red line', () => {
    const desc = parsed.description ?? '';
    expect(desc.toLowerCase()).toMatch(/never invoke cc-connect directly/);
    expect(desc.toLowerCase()).toContain('peaks companion');
  });

  it('description routes the weixin-only channel refusal', () => {
    const desc = parsed.description ?? '';
    expect(desc.toLowerCase()).toContain('migrate to a different channel');
    expect(desc.toLowerCase()).toContain('weixin');
    expect(desc.toLowerCase()).toContain('refused');
  });

  it('metadata pins the slice + channel', () => {
    expect(parsed.slice).toBe('2026-06-14-cc-connect-weixin');
    expect(parsed.channel).toBe('weixin');
    expect(parsed.surface).toBe('cli');
  });

  it('body has a Default runbook section that walks the LLM through install → setup → start', () => {
    expect(body).toContain('## Default runbook');
    expect(body).toMatch(/peaks companion install/);
    expect(body).toMatch(/peaks companion setup/);
    expect(body).toMatch(/peaks companion start/);
  });

  it('body carries the explicit red line: skill MUST NOT call cc-connect directly', () => {
    expect(body).toMatch(/This skill MUST NOT call cc-connect directly/i);
    expect(body).toMatch(/peaks companion \.\.\./);
  });

  it('body references ~/.peaks/config.json as the source of truth', () => {
    expect(body).toContain('~/.peaks/config.json');
    expect(body).toMatch(/source of truth/i);
  });

  it('body hash matches a snapshot (catches accidental description / step drift)', () => {
    const hash = createHash('sha256').update(body).digest('hex');
    // Frozen at slice change-1 (commit f0400c0 + this slice). If you
    // intentionally edit the body, bump this hash.
    expect(hash).toBe('5a0daa4fc42712e51f9495d2c73564a6c366d99f38c8feaa77ee40a5012c43bb');
  });
});