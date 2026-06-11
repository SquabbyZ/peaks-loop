/**
 * 1.x → 2.0 detection service — TypeScript mirror of
 * `scripts/install-skills.mjs:detect1xProjectState`.
 *
 * Slice: 2026-06-12-solo-step-0-55-1x-detection.
 *
 * The canonical implementation lives in the .mjs postinstall
 * (because the postinstall runs before any TS compile step).
 * This TS mirror exists so the peaks-solo skill can call
 * `peaks upgrade --detect-1x --project <root> --json` and
 * read a structured JSON envelope to gate the
 * AskUserQuestion that prompts the 1.x → 2.0 upgrade.
 *
 * The two implementations MUST stay in parity. The
 * `tests/integration/upgrade/1x-detector-parity.test.ts`
 * test exercises both on the same fixture and asserts
 * their outputs match.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface OneXState {
  readonly isOneX: boolean;
  readonly signals: readonly string[];
  readonly projectRoot: string | null;
  readonly configPath: string | null;
}

const MAX_WALK_UP = 8;

export function detect1xProjectState(cwd: string = process.cwd()): OneXState {
  const home = homedir();
  const signals: string[] = [];
  let projectRoot: string | null = null;
  let configPath: string | null = null;

  // Walk up from cwd looking for .peaks/_runtime (signals
  // we're inside a peaks project).
  let dir = cwd;
  for (let i = 0; i < MAX_WALK_UP; i += 1) {
    const peaksRuntime = join(dir, '.peaks', '_runtime');
    if (existsSync(peaksRuntime)) {
      projectRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Signal 1: ~/.peaks/config.json with 1.x version
  const globalConfig = join(home, '.peaks', 'config.json');
  if (existsSync(globalConfig)) {
    try {
      const raw = JSON.parse(readFileSync(globalConfig, 'utf8')) as Record<string, unknown>;
      if (typeof raw['version'] === 'string' && /^1\./.test(raw['version'])) {
        signals.push(`global config at ${globalConfig} is 1.x (${raw['version']})`);
        if (configPath === null) configPath = globalConfig;
      }
    } catch {
      // ignore parse error — the 1.x detection is best-effort
    }
  }

  // Signal 2: .claude/rules/common/dev-preference.md with peaks progress
  if (projectRoot !== null) {
    const devPref = join(projectRoot, '.claude', 'rules', 'common', 'dev-preference.md');
    if (existsSync(devPref)) {
      try {
        const body = readFileSync(devPref, 'utf8');
        if (/peaks progress/i.test(body)) {
          signals.push(`${devPref} references "peaks progress" (1.x CLI surface, removed in slice #014)`);
        }
      } catch {
        // ignore
      }
    }
    // Signal 3: project preferences.json missing or 1.x
    const prefs = join(projectRoot, '.peaks', 'preferences.json');
    if (!existsSync(prefs)) {
      signals.push(`${prefs} does not exist (1.x project never migrated)`);
    } else {
      try {
        const raw = JSON.parse(readFileSync(prefs, 'utf8')) as Record<string, unknown>;
        if (raw['schema_version'] !== '2.0.0') {
          signals.push(`${prefs} has schema_version ${JSON.stringify(raw['schema_version'])}, expected '2.0.0'`);
        }
      } catch {
        signals.push(`${prefs} exists but is not valid JSON`);
      }
    }
  }

  return {
    isOneX: signals.length > 0,
    signals,
    projectRoot,
    configPath,
  };
}
