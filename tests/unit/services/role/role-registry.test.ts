/**
 * v2.15.0 follow-up — G9 tests: role registry.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_SENIOR_FE_ROLE,
  EMPTY_ROLE_REGISTRY,
  grantPermission,
  readRoleRegistry,
  roleHasPermission,
  upsertRole,
  writeRoleRegistry
} from '../../../../src/services/role/role-registry.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-role-test-'));
});
afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('readRoleRegistry / writeRoleRegistry', () => {
  it('returns EMPTY when no file exists', () => {
    expect(readRoleRegistry(tmpDir)).toEqual(EMPTY_ROLE_REGISTRY);
  });
  it('round-trips a registry through disk', () => {
    const r = { version: 1 as const, roles: [DEFAULT_SENIOR_FE_ROLE] };
    writeRoleRegistry(tmpDir, r);
    expect(readRoleRegistry(tmpDir)).toEqual(r);
  });
});

describe('upsertRole', () => {
  it('adds a new role', () => {
    const next = upsertRole(EMPTY_ROLE_REGISTRY, DEFAULT_SENIOR_FE_ROLE);
    expect(next.roles).toHaveLength(1);
  });
  it('replaces an existing role with the same name', () => {
    const v1 = { name: 'r', description: 'v1', permissions: [] };
    const v2 = { name: 'r', description: 'v2', permissions: ['x'] };
    const r1 = upsertRole(EMPTY_ROLE_REGISTRY, v1);
    const r2 = upsertRole(r1, v2);
    expect(r2.roles).toHaveLength(1);
    expect(r2.roles[0]?.description).toBe('v2');
  });
});

describe('grantPermission + roleHasPermission', () => {
  it('grants and checks a permission', () => {
    const r1 = upsertRole(EMPTY_ROLE_REGISTRY, { name: 'r', description: '', permissions: [] });
    const r2 = grantPermission(r1, 'r', 'qa.accept');
    expect(roleHasPermission(r2, 'r', 'qa.accept')).toBe(true);
  });
  it('is idempotent (granting the same perm twice is a no-op)', () => {
    const r1 = upsertRole(EMPTY_ROLE_REGISTRY, { name: 'r', description: '', permissions: [] });
    const r2 = grantPermission(r1, 'r', 'qa.accept');
    const r3 = grantPermission(r2, 'r', 'qa.accept');
    expect(r3.roles[0]?.permissions).toEqual(['qa.accept']);
  });
  it('returns false for a role that does not exist', () => {
    expect(roleHasPermission(EMPTY_ROLE_REGISTRY, 'nope', 'x')).toBe(false);
  });
});

describe('DEFAULT_PERMISSIONS / DEFAULT_SENIOR_FE_ROLE', () => {
  it('exposes a non-empty permission list', () => {
    expect(DEFAULT_PERMISSIONS.length).toBeGreaterThan(5);
  });
  it('senior-fe role has the canonical 12-Gaps permissions', () => {
    expect(DEFAULT_SENIOR_FE_ROLE.permissions).toContain('prd.write');
    expect(DEFAULT_SENIOR_FE_ROLE.permissions).toContain('qa.accept');
  });
});
