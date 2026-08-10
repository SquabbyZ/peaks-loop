// tests/unit/services/dispatch/detached-record-fields.test.ts
//
// Phase A Task 8: extend DispatchRecord schema for detached sub-agent mode.
// Verifies the 4 new fields (mode, vendor, autoCompactEvents, tokenUsage)
// are persisted on new records and that readRecord transparently
// upgrades legacy v3.2 records to the v4.1.0 schema with safe defaults.

import { describe, it, expect } from 'vitest';
import { writeInitialDispatchRecord, readRecord } from '../../../../src/services/dispatch/dispatch-record-writer';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('DispatchRecord mode/vendor/autoCompact fields', () => {
  const stubToolCall = {
    name: 'Task',
    args: { subagent_type: 'general-purpose', description: 'test', prompt: 'x' },
    toolCallVersion: '2.0.0' as const,
  };

  it('persists detached mode + claude vendor on new record', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const out = writeInitialDispatchRecord({
        projectRoot: tmp,
        sessionId: 's1',
        requestId: 'r1',
        role: 'rd',
        prompt: 'do X',
        toolCall: stubToolCall,
        batchId: 'b1',
        mode: 'detached',
        vendor: 'claude',
      });
      const rec = JSON.parse(readFileSync(out.path, 'utf8'));
      expect(rec.mode).toBe('detached');
      expect(rec.vendor).toBe('claude');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('defaults mode to in-process when not provided', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const out = writeInitialDispatchRecord({
        projectRoot: tmp,
        sessionId: 's1',
        requestId: 'r1',
        role: 'rd',
        prompt: 'do X',
        toolCall: stubToolCall,
        batchId: 'b1',
      });
      const rec = JSON.parse(readFileSync(out.path, 'utf8'));
      expect(rec.mode).toBe('in-process');
      expect(rec.vendor ?? null).toBe(null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('persists autoCompactEvents + tokenUsage arrays', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const out = writeInitialDispatchRecord({
        projectRoot: tmp,
        sessionId: 's1',
        requestId: 'r1',
        role: 'rd',
        prompt: 'do X',
        toolCall: stubToolCall,
        batchId: 'b1',
        mode: 'detached',
        vendor: 'claude',
        autoCompactEvents: [
          { at: 1, threshold: '0.85' as const, tokensBefore: 100, tokensAfter: 30 },
        ],
        tokenUsage: { promptTokens: 50, completionTokens: 20 },
      });
      const rec = JSON.parse(readFileSync(out.path, 'utf8'));
      expect(rec.autoCompactEvents).toHaveLength(1);
      expect(rec.autoCompactEvents[0]).toMatchObject({ threshold: '0.85' });
      expect(rec.tokenUsage).toMatchObject({ promptTokens: 50, completionTokens: 20 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('readRecord upgrades legacy record missing mode field (default in-process)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dr-'));
    try {
      const sub = join(tmp, '.peaks', '_sub_agents', 's1');
      mkdirSync(sub, { recursive: true });
      const file = join(sub, 'rec.json');
      // Minimal v3.2 record (no mode / vendor / autoCompact / tokenUsage)
      writeFileSync(
        file,
        JSON.stringify({
          version: '3.2',
          createdAt: '2026-08-10T15:00:00.000Z',
          completedAt: null,
          outcome: 'no-execution',
          artifactPaths: [],
          disposed: false,
          disposedAt: null,
          role: 'rd',
          requestId: 'r-legacy',
          sessionId: 's1',
          prompt: 'legacy',
          toolCall: stubToolCall,
          batchId: 'b-legacy',
          heartbeats: [],
          lastBeatAt: null,
          status: 'done',
          stage: null,
          leaseId: null,
          isolationStartedAt: null,
          serviceKill: [],
          mergeBackAttempts: 0,
          workflowId: null,
          graphNodeId: null,
          graphRef: null,
        }),
      );
      const rec = readRecord(file);
      expect(rec.mode).toBe('in-process');
      expect(rec.vendor ?? null).toBe(null);
      expect(rec.autoCompactEvents ?? []).toEqual([]);
      expect(rec.tokenUsage ?? null).toBe(null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
