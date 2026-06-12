import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import {
  loadPreferences,
  preferencesPath,
  savePreferences,
} from '../../services/preferences/preferences-service.js';
import type { ProjectPreferences } from '../../services/preferences/preferences-types.js';

const ALLOWED_KEYS: ReadonlySet<keyof ProjectPreferences> = new Set<keyof ProjectPreferences>([
  'economyMode',
  'swarmMode',
  'uaPrompt',
  'agentShieldPrompt',
  'classifyConservatism',
  'classifyRules',
  'headroom',
  'swarmSpeculative',
  'loopAutonomousEnabled',
]);

interface GetOptions {
  key: string;
  project: string;
  json?: boolean;
}

interface SetOptions {
  key: string;
  value: string;
  project: string;
  json?: boolean;
}

interface ResetOptions {
  key: string;
  project: string;
  json?: boolean;
}

export function registerPreferencesCommands(program: Command): void {
  const prefs = program
    .command('preferences')
    .description('Manage project-local preferences (`.peaks/preferences.json`)');

  prefs
    .command('get')
    .description('Get a preference value (from override or default)')
    .requiredOption('--key <key>', 'preference key')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: GetOptions) => {
      try {
        if (!ALLOWED_KEYS.has(opts.key as keyof ProjectPreferences)) {
          throw new Error(`PREFERENCES_KEY_UNKNOWN: ${opts.key}`);
        }
        const all = loadPreferences(opts.project);
        const value = (all as unknown as Record<string, unknown>)[opts.key];
        const filePath = preferencesPath(opts.project);
        // Spec bug fix: use the top-level existsSync import (the spec's
        // `await import('node:fs')` would not compile inside a non-async action).
        // Source is 'override' only when the key is explicitly present in
        // the on-disk file (not merely when the file exists, since reset()
        // may leave the file with other keys still overridden).
        let source: 'override' | 'default' = 'default';
        if (existsSync(filePath)) {
          try {
            const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
            if (Object.prototype.hasOwnProperty.call(raw, opts.key)) {
              source = 'override';
            }
          } catch {
            // Corrupt file: report the merged value but fall back to 'default'
            // source to avoid claiming an override that cannot be parsed.
            source = 'default';
          }
        }
        // Stable ordering: source is computed, value reflects merged state.
        const envelope = {
          ok: true,
          data: { key: opts.key, value, source },
        };
        process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });

  prefs
    .command('set')
    .description('Override a preference value (writes to .peaks/preferences.json)')
    .requiredOption('--key <key>', 'preference key')
    .requiredOption('--value <value>', 'value (parsed as JSON, or string if not JSON)')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: SetOptions) => {
      try {
        if (!ALLOWED_KEYS.has(opts.key as keyof ProjectPreferences)) {
          throw new Error(`PREFERENCES_KEY_UNKNOWN: ${opts.key}`);
        }
        let parsed: unknown = opts.value;
        try {
          parsed = JSON.parse(opts.value);
        } catch {
          // Not valid JSON — keep the raw string.
        }
        const merged = savePreferences(opts.project, {
          [opts.key]: parsed,
        } as Partial<ProjectPreferences>);
        const envelope = {
          ok: true,
          data: {
            key: opts.key,
            value: (merged as unknown as Record<string, unknown>)[opts.key],
          },
        };
        process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });

  prefs
    .command('reset')
    .description('Remove the override for a key (falls back to default)')
    .requiredOption('--key <key>', 'preference key')
    .option('--project <path>', 'project root', process.cwd())
    .option('--json', 'JSON envelope output')
    .action((opts: ResetOptions) => {
      try {
        if (!ALLOWED_KEYS.has(opts.key as keyof ProjectPreferences)) {
          throw new Error(`PREFERENCES_KEY_UNKNOWN: ${opts.key}`);
        }
        const filePath = preferencesPath(opts.project);
        // Read raw on-disk state (not the merged view) so removing a key
        // truly removes the override, instead of savePreferences re-inserting
        // the default value. If no file exists, there is nothing to reset.
        if (!existsSync(filePath)) {
          const envelope = {
            ok: true,
            data: { key: opts.key, removed: false, reason: 'no-override-file' },
          };
          process.stdout.write(JSON.stringify(envelope) + '\n');
          return;
        }
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        } catch (err) {
          throw new Error(
            `PREFERENCES_JSON_INVALID: failed to parse ${filePath}: ${(err as Error).message}`
          );
        }
        const hadKey = Object.prototype.hasOwnProperty.call(raw, opts.key);
        if (hadKey) {
          delete raw[opts.key];
          mkdirSync(dirname(filePath), { recursive: true });
          writeFileSync(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
        }
        const envelope = {
          ok: true,
          data: { key: opts.key, removed: hadKey },
        };
        process.stdout.write(JSON.stringify(envelope) + '\n');
      } catch (err) {
        process.stderr.write((err as Error).message + '\n');
        process.exit(1);
      }
    });
}
