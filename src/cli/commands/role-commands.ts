/**
 * v2.15.0 follow-up — G9: peaks role * CLI.
 *
 *   - `peaks role list`                  — list all roles
 *   - `peaks role add <name> --description <text>` — register a role
 *   - `peaks role grant <role> <permission>`      — grant a permission
 *   - `peaks role check <role> <permission>`      — check a permission
 *
 * Persistence: `.peaks/role-registry.json`.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_SENIOR_FE_ROLE,
  grantPermission,
  readRoleRegistry,
  roleHasPermission,
  upsertRole,
  writeRoleRegistry,
  type Role
} from '../../services/role/role-registry.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerRoleCommands(program: Command, io: ProgramIO): void {
  const role = program
    .command('role')
    .description('v2.15.0 follow-up G9: lightweight role registry (RBAC for multi-user peaks-loop teams).');

  addJsonOption(
    role
      .command('list')
      .description('List all roles in the registry.')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const registry = readRoleRegistry(projectRoot);
    printResult(io, ok('role.list', { projectRoot, roles: registry.roles, count: registry.roles.length }, [], [
      registry.roles.length === 0 ? 'No roles registered. Run `peaks role add <name>` to start.' : ''
    ].filter(Boolean)), opts.json ?? false);
  });

  addJsonOption(
    role
      .command('add <name>')
      .description(
        'Register a new role. Use `--preset senior-fe` to seed the default ' +
          '12-Gaps senior-FE permission set. Use `--description` for the ' +
          'human-readable label.'
      )
      .option('--description <text>', 'role description')
      .option('--preset <name>', 'apply a preset (currently only: senior-fe)')
      .option('--permission <perm>', 'add an additional permission (repeatable)', (v: string, prev: string[]) => [...prev, v], [] as string[])
      .option('--project <path>', 'project root (default: cwd)')
  ).action((name: string, opts: { description?: string; preset?: string; permission: string[]; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    let newRole: Role;
    if (opts.preset === 'senior-fe') {
      newRole = { ...DEFAULT_SENIOR_FE_ROLE, name, description: opts.description ?? DEFAULT_SENIOR_FE_ROLE.description, permissions: [...DEFAULT_SENIOR_FE_ROLE.permissions, ...opts.permission] };
    } else {
      newRole = { name, description: opts.description ?? '', permissions: opts.permission };
    }
    const registry = readRoleRegistry(projectRoot);
    const next = upsertRole(registry, newRole);
    writeRoleRegistry(projectRoot, next);
    printResult(io, ok('role.add', { projectRoot, role: newRole }, [], [
      `Role "${name}" registered with ${newRole.permissions.length} permission(s).`
    ]), opts.json ?? false);
  });

  addJsonOption(
    role
      .command('grant <role> <permission>')
      .description('Grant a permission to an existing role.')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((roleName: string, permission: string, opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const registry = readRoleRegistry(projectRoot);
    if (!registry.roles.find((r) => r.name === roleName)) {
      printResult(io, fail('role.grant', 'ROLE_NOT_FOUND', `role "${roleName}" not found. Run peaks role add first.`, { projectRoot }, []), opts.json ?? false);
      process.exitCode = 1;
      return;
    }
    const next = grantPermission(registry, roleName, permission);
    writeRoleRegistry(projectRoot, next);
    printResult(io, ok('role.grant', { projectRoot, role: roleName, permission, granted: true }, [], [
      `Granted "${permission}" to role "${roleName}".`
    ]), opts.json ?? false);
  });

  addJsonOption(
    role
      .command('check <role> <permission>')
      .description(
        'Check if a role has a permission. Exits 0 when granted, 1 when not. ' +
          'Useful for piping into peaks hooks PreToolUse (the 12 Gaps memory ' +
          'B layer: peaks-hooks PreToolUse).'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((roleName: string, permission: string, opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const registry = readRoleRegistry(projectRoot);
    const granted = roleHasPermission(registry, roleName, permission);
    printResult(io, ok('role.check', { projectRoot, role: roleName, permission, granted }, [], [
      granted ? `Role "${roleName}" has permission "${permission}".` : `Role "${roleName}" does NOT have permission "${permission}".`
    ]), opts.json ?? false);
    if (!granted) process.exitCode = 1;
  });
}
