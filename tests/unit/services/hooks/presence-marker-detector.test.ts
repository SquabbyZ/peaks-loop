import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { detectPresenceMarker, PRESENCE_MARKER_WARNING } from '../../../../src/services/hooks/presence-marker-detector.js';

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-marker-detector-'));
}

function writeCanonicalPresence(projectRoot: string, payload: object): void {
  const dir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'active-skill.json'), JSON.stringify(payload, null, 2), 'utf8');
}

function writeLegacyPresence(projectRoot: string, payload: object): void {
  const dir = join(projectRoot, '.peaks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.active-skill.json'), JSON.stringify(payload, null, 2), 'utf8');
}

describe('presence-marker-detector', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // T-H1
  test('T-H1: returns inactive when no presence file exists', () => {
    const result = detectPresenceMarker({ project: projectRoot, latestAssistantMessage: 'hello world' });
    expect(result.active).toBe(false);
    expect(result.markerFound).toBe(false);
    expect(result.skill).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });

  // T-H2
  test('T-H2: active presence with marker in message → markerFound true, no warning', () => {
    writeCanonicalPresence(projectRoot, { skill: 'peaks-solo', mode: 'assisted' });
    const result = detectPresenceMarker({
      project: projectRoot,
      latestAssistantMessage: 'Peaks-Cli Skill: peaks-solo | Peaks-Cli Gate: rd-discovery | Next: read PRD'
    });
    expect(result.active).toBe(true);
    expect(result.skill).toBe('peaks-solo');
    expect(result.markerFound).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  // T-H3
  test('T-H3: active presence without markers → markerFound false and warning emitted', () => {
    writeCanonicalPresence(projectRoot, { skill: 'peaks-rd', mode: 'assisted' });
    const result = detectPresenceMarker({
      project: projectRoot,
      latestAssistantMessage: 'I am starting the implementation. Let me look at the file first.'
    });
    expect(result.active).toBe(true);
    expect(result.skill).toBe('peaks-rd');
    expect(result.markerFound).toBe(false);
    expect(result.warning).toBe(PRESENCE_MARKER_WARNING[0]);
  });

  // T-H4
  test('T-H4: legacy path is used when canonical file is absent', () => {
    writeLegacyPresence(projectRoot, { skill: 'peaks-qa' });
    const result = detectPresenceMarker({
      project: projectRoot,
      latestAssistantMessage: 'Peaks-Cli Skill: peaks-qa | Peaks-Cli Gate: verify-3way | Next: tsc'
    });
    expect(result.active).toBe(true);
    expect(result.skill).toBe('peaks-qa');
    expect(result.markerFound).toBe(true);
  });

  // T-H5
  test('T-H5: empty latest message → markerFound false and warning present', () => {
    writeCanonicalPresence(projectRoot, { skill: 'peaks-solo' });
    const result = detectPresenceMarker({ project: projectRoot, latestAssistantMessage: '' });
    expect(result.active).toBe(true);
    expect(result.markerFound).toBe(false);
    expect(result.warning).toBe(PRESENCE_MARKER_WARNING[0]);
  });

  // T-H6
  test('T-H6: corrupted presence JSON is treated as inactive', () => {
    const dir = join(projectRoot, '.peaks', '_runtime');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'active-skill.json'), '{ this is not valid json ', 'utf8');
    const result = detectPresenceMarker({ project: projectRoot, latestAssistantMessage: 'Peaks-Cli Skill: peaks-solo' });
    expect(result.active).toBe(false);
    expect(result.markerFound).toBe(false);
    expect(result.warning).toBeUndefined();
  });
});
