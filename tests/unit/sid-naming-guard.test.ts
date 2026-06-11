import { describe, expect, test } from 'vitest';
import {
 isValidSessionId,
 isValidChangeId,
 isBareSid,
 assertValidSessionId,
 assertValidChangeId,
 SID_FORMAT_DESCRIPTION,
} from '../../src/services/workspace/sid-naming-guard.js';

describe('isValidSessionId', () => {
 test.each([
 '2026-06-11-session-abc123',
 '2026-06-10-session-f3a9b2',
 '2025-12-31-session-001',
])('accepts %s', (sid) => {
 expect(isValidSessionId(sid)).toBe(true);
 });

 test.each([
 'sid-3',
 'sid-h',
 'sid-r',
 'unknown-sid',
 '2026-06-11',
 '2026-6-11-session-abc',
 'session-abc',
 '2026-06-11-session-',
 '2026-06-11-session-ABCD',
 '2026-13-11-session-abc',
 '2026-06-32-session-abc',
 'foo-bar-baz',
 '',
])('rejects %s', (sid) => {
 expect(isValidSessionId(sid)).toBe(false);
 });
});

describe('isValidChangeId', () => {
 test('accepts canonical kebab-case', () => {
 expect(isValidChangeId('fuzzy-matching')).toBe(true);
 expect(isValidChangeId('r004-migrate-1-4-1')).toBe(true);
 });

 test('rejects empty / non-kebab', () => {
 expect(isValidChangeId('')).toBe(false);
 expect(isValidChangeId('CamelCase')).toBe(false);
 expect(isValidChangeId('snake_case')).toBe(false);
 expect(isValidChangeId('with space')).toBe(false);
 });
});

describe('isBareSid', () => {
 test('matches bare short forms observed in existing data', () => {
 expect(isBareSid('sid-3')).toBe(true);
 expect(isBareSid('sid-h')).toBe(true);
 expect(isBareSid('sid-r')).toBe(true);
 expect(isBareSid('unknown-sid')).toBe(true);
 });

 test('does not match canonical sids', () => {
 expect(isBareSid('2026-06-11-session-abc123')).toBe(false);
 expect(isBareSid('session')).toBe(false);
 });
});

describe('assertValidSessionId', () => {
 test('throws NAMING_INVALID on bad sid with descriptive message', () => {
 expect(() => assertValidSessionId('sid-3')).toThrow(/NAMING_INVALID.*sid-3/);
 });

 test('returns void on valid sid', () => {
 expect(assertValidSessionId('2026-06-11-session-abc123')).toBeUndefined();
 });
});

describe('assertValidChangeId', () => {
 test('throws on invalid change id', () => {
 expect(() => assertValidChangeId('BadName')).toThrow(/NAMING_INVALID/);
 });
});
