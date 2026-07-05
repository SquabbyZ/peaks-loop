import { describe, it, expect } from 'vitest';
import { detectMarker, deriveRuleName, classifyFile, classifyFiles } from '../../../../src/services/audit/classifier.js';

describe('classifier.detectMarker', () => {
  it('returns null when no marker is present', () => {
    expect(detectMarker('This is a normal line of prose.')).toBeNull();
    expect(detectMarker('Some intro text without a keyword.')).toBeNull();
  });

  it('detects MANDATORY', () => {
    expect(detectMarker('Reading file content: MANDATORY.')).toBe('MANDATORY');
  });

  it('detects BLOCKING', () => {
    expect(detectMarker('This step is BLOCKING for slice completion.')).toBe('BLOCKING');
  });

  it('detects MUST NOT', () => {
    expect(detectMarker('You MUST NOT write mock data inline.')).toBe('MUST NOT');
  });

  it('detects RED LINE', () => {
    expect(detectMarker('Solo Code-Change RED LINE.')).toBe('RED LINE');
  });

  it('detects markers in lowercase/uppercase mix', () => {
    expect(detectMarker('mandatory check below')).toBe('MANDATORY');
    expect(detectMarker('blocking step')).toBe('BLOCKING');
  });
});

describe('classifier.deriveRuleName', () => {
  it('strips markers and limits to 8 words', () => {
    expect(deriveRuleName('Solo Code-Change Red Line: peaks-code is an orchestrator.')).toBe(
      'solo code-change red line: peaks-code is an orchestrator.'
    );
  });

  it('strips markdown decoration', () => {
    expect(deriveRuleName('**MANDATORY**: do the thing.')).toBe('do the thing.');
  });

  it('returns fallback for empty input', () => {
    expect(deriveRuleName('MANDATORY')).toBe('unspecified red line');
  });
});

describe('classifier.classifyFile', () => {
  it('classifies a file with one MANDATORY marker hit', () => {
    const file = {
      file: 'skills/peaks-code/SKILL.md',
      lines: [
        '# peaks-code',
        '',
        'Peaks-Loop Solo is an orchestrator, NOT an implementer.',
        'You MUST NOT write code directly here.',
        '',
      ],
    };
    const result = classifyFile(file);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.source.marker).toBe('MUST NOT');
    expect(result.entries[0]?.source.line).toBe(4);
    expect(result.entries[0]?.source.file).toBe('skills/peaks-code/SKILL.md');
  });

  it('matches catalog phrases for sub-agent-sid', () => {
    const file = {
      file: 'skills/bee/peaks-rd/SKILL.md',
      lines: [
        '# sub-agent protocol',
        '',
        'One conversation = one sid; sub-agent session sharing is BLOCKING.',
        '',
      ],
    };
    const result = classifyFile(file);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.id).toBe('rl-sub-agent-sid-001');
    expect(result.entries[0]?.backing).toBe('cli-backed');
    expect(result.entries[0]?.enforcerRef).toBe('src/services/audit/enforcers/sub-agent-sid.ts');
  });

  it('returns prose-only entry for marker without catalog match', () => {
    const file = {
      file: 'random.md',
      lines: [
        'Some MANDATORY thing that does not match any catalog entry.',
        'It really is important.',
      ],
    };
    const result = classifyFile(file);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.backing).toBe('prose-only');
    expect(result.entries[0]?.enforcerRef).toBeNull();
  });

  it('v2.12.1 catalog governance: discovered prose-only entries are flagged informational', () => {
    // Discovered entries (no catalog match) should carry
    // `informational: true` so the prose-only ratio excludes them.
    // Pre-v2.12.1 ratio was 60.1% because these were counted; the
    // reform (see `.peaks/memory/2026-06-27-prose-only-catalog-
    // followup.md`) drops the actionable ratio to 6.1%.
    const file = {
      file: 'skills/peaks-code/SKILL.md',
      lines: [
        'Some MANDATORY prose that does not match any catalog entry.',
        'It really is important but advisory-only.',
      ],
    };
    const result = classifyFile(file);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.backing).toBe('prose-only');
    expect(result.entries[0]?.informational).toBe(true);
  });

  it('returns empty entries for a file with no markers', () => {
    const file = {
      file: 'plain.md',
      lines: [
        '# Just a doc',
        'No markers here.',
        'Just normal prose.',
      ],
    };
    const result = classifyFile(file);
    expect(result.entries).toEqual([]);
  });

  it('captures context (±2 lines) around the marker', () => {
    const file = {
      file: 'skills/foo/SKILL.md',
      lines: [
        'line 1',
        'line 2',
        'line 3',
        'BLOCKING: do not do this.',
        'line 5',
        'line 6',
        'line 7',
      ],
    };
    const result = classifyFile(file);
    expect(result.entries).toHaveLength(1);
    const context = result.entries[0]?.source.context ?? '';
    expect(context).toContain('line 2');
    expect(context).toContain('line 3');
    expect(context).toContain('BLOCKING: do not do this.');
    expect(context).toContain('line 5');
    expect(context).toContain('line 6');
  });
});

describe('classifier.classifyFiles', () => {
  it('flattens entries from multiple files', () => {
    const inputs = [
      { file: 'a.md', lines: ['MANDATORY thing.'] },
      { file: 'b.md', lines: ['BLOCKING other.'] },
    ];
    const result = classifyFiles(inputs);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((e) => e.source.file).sort()).toEqual(['a.md', 'b.md']);
  });
});
