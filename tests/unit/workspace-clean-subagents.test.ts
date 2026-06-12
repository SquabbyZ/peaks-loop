import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  listInvalidSubAgentSids,
  executeSubAgentClean,
} from '../../src/services/workspace/workspace-clean-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-clean-subagents-'));
}

describe('listInvalidSubAgentSids', () => {
  test('returns bare sids (sid-3 / sid-h / sid-r / unknown-sid)', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks/_sub_agents');
      mkdirSync(dir, { recursive: true });
      for (const name of ['sid-3', 'sid-h', 'sid-r', 'unknown-sid', '2026-06-11-session-aaa111']) {
        mkdirSync(join(dir, name));
      }
      const invalid = listInvalidSubAgentSids(project);
      expect(invalid.sort()).toEqual(['sid-3', 'sid-h', 'sid-r', 'unknown-sid']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns empty when _sub_agents/ does not exist', () => {
    const project = makeProject();
    try {
      expect(listInvalidSubAgentSids(project)).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('executeSubAgentClean', () => {
  test('dry-run: does not move files, only reports', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks/_sub_agents');
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, 'sid-3'));
      const result = executeSubAgentClean(project, { apply: false });
      expect(result.moved).toEqual(['sid-3']);
      expect(existsSync(join(dir, 'sid-3'))).toBe(true);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-3'))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: moves invalid sids to _archive/invalid-sids/ (does not delete)', () => {
    const project = makeProject();
    try {
      const dir = join(project, '.peaks/_sub_agents');
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(dir, 'sid-3'));
      mkdirSync(join(dir, 'sid-h'));
      const result = executeSubAgentClean(project, { apply: true });
      expect(result.moved.sort()).toEqual(['sid-3', 'sid-h']);
      expect(existsSync(join(dir, 'sid-3'))).toBe(false);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-3'))).toBe(true);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-h'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});