import type { Command } from 'commander';
import { listProfiles } from '../../../services/profiles/profile-service.js';
import { ok } from '../../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';

export function registerProfileCommand(program: Command, io: ProgramIO): void {
  const profile = program.command('profile').description('Manage runtime profiles');
  addJsonOption(profile.command('list').description('List available profiles')).action((options: { json?: boolean }) => {
    printResult(io, ok('profile.list', { profiles: listProfiles() }), options.json);
  });
}
