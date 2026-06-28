/**
 * v2.15.0 follow-up — G9: role registry (lightweight RBAC).
 *
 * 12 Gaps memory: 团队多角色协同. This service manages a tiny
 * in-memory / JSON-backed role → permission map. The CLI surfaces
 *   - `peaks role list`              — list all roles
 *   - `peaks role add <name>`        — register a role
 *   - `peaks role grant <role> <perm>` — grant a permission
 *   - `peaks role check <role> <perm>` — check if role has permission
 *
 * Persistence: `.peaks/role-registry.json` in the project root.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface Role {
  /** Unique role name (e.g. "senior-fe", "backend-lead", "admin"). */
  readonly name: string;
  /** Description (human-readable). */
  readonly description: string;
  /** Granted permissions (free-form strings, dot-separated convention). */
  readonly permissions: readonly string[];
}

export interface RoleRegistry {
  readonly version: 1;
  readonly roles: readonly Role[];
}

export const EMPTY_ROLE_REGISTRY: RoleRegistry = { version: 1, roles: [] };

const STATE_FILE = '.peaks/role-registry.json';

export function getRoleRegistryPath(projectRoot: string): string {
  return resolve(projectRoot, STATE_FILE);
}

export function readRoleRegistry(projectRoot: string): RoleRegistry {
  const path = getRoleRegistryPath(projectRoot);
  if (!existsSync(path)) return EMPTY_ROLE_REGISTRY;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RoleRegistry>;
    if (parsed.version !== 1) return EMPTY_ROLE_REGISTRY;
    return { version: 1, roles: Array.isArray(parsed.roles) ? parsed.roles : [] };
  } catch {
    return EMPTY_ROLE_REGISTRY;
  }
}

export function writeRoleRegistry(projectRoot: string, registry: RoleRegistry): void {
  const path = getRoleRegistryPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(registry, null, 2), 'utf8');
}

/** Add or update a role. Returns the new registry. */
export function upsertRole(registry: RoleRegistry, role: Role): RoleRegistry {
  const filtered = registry.roles.filter((r) => r.name !== role.name);
  return { version: 1, roles: [...filtered, role] };
}

/** Grant a permission to a role. Returns the new registry. */
export function grantPermission(registry: RoleRegistry, roleName: string, permission: string): RoleRegistry {
  const found = registry.roles.find((r) => r.name === roleName);
  if (!found) return registry;
  if (found.permissions.includes(permission)) return registry;
  const updated: Role = { ...found, permissions: [...found.permissions, permission] };
  return upsertRole(registry, updated);
}

/** Check if a role has a permission. */
export function roleHasPermission(registry: RoleRegistry, roleName: string, permission: string): boolean {
  const role = registry.roles.find((r) => r.name === roleName);
  if (!role) return false;
  return role.permissions.includes(permission);
}

/** Permission categories that align with the peaks-cli 12 Gaps memory. */
export const DEFAULT_PERMISSIONS: readonly string[] = [
  'prd.write',
  'prd.confirm',
  'rd.implement',
  'rd.review',
  'qa.accept',
  'qa.reject',
  'release.canary',
  'release.promote',
  'release.hotfix',
  'fork.sync',
  'smoke.define',
  'smoke.run',
  'admin.full'
];

/** Default role preset for a Senior FE on a 24h AI programmer team. */
export const DEFAULT_SENIOR_FE_ROLE: Role = {
  name: 'senior-fe',
  description: 'Senior Frontend (业务资深 + 后端半盲 + 24h AI 程序员)',
  permissions: ['prd.write', 'prd.confirm', 'rd.review', 'qa.accept', 'qa.reject', 'smoke.define', 'smoke.run']
};
