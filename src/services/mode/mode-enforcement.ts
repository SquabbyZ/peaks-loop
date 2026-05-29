import * as readline from 'node:readline';
import { getSkillPresence, type SkillPresenceMode } from '../skills/skill-presence-service.js';

type TransitionKey = `${string}:${string}`;

const ASSISTED_CONFIRM_TRANSITIONS: ReadonlySet<TransitionKey> = new Set([
  'prd:confirmed-by-user',
  'rd:qa-handoff',
  'qa:verdict-issued'
]);

export function requiresConfirmation(mode: SkillPresenceMode, transitionKey: TransitionKey): boolean {
  if (mode === 'full-auto' || mode === 'swarm') {
    return false;
  }
  if (mode === 'strict') {
    return true;
  }
  // assisted: only specific transitions
  return ASSISTED_CONFIRM_TRANSITIONS.has(transitionKey);
}

function describeTransition(transitionKey: TransitionKey): string {
  const parts = transitionKey.split(':');
  const role = parts[0] ?? 'unknown';
  const state = parts[1] ?? 'unknown';
  return `Transition ${role.toUpperCase()} → ${state}`;
}

export type ConfirmationOptions = {
  projectRoot: string;
  transitionKey: TransitionKey;
  confirmed?: boolean | undefined;
  forceConfirm?: boolean | undefined;
};

export class ConfirmationRequiredError extends Error {
  constructor(transitionKey: TransitionKey) {
    const description = describeTransition(transitionKey);
    super(
      `Confirmation required for: ${description}\n` +
      'Add --confirm to proceed non-interactively, or run in an interactive terminal.\n' +
      'In assisted/strict mode, major workflow boundaries require explicit user approval.'
    );
    this.name = 'ConfirmationRequiredError';
  }
}

export async function requireUserConfirmation(options: ConfirmationOptions): Promise<void> {
  // Resolve presence from the project being operated on, not the process cwd.
  const presence = getSkillPresence(options.projectRoot);
  if (!presence?.mode) {
    return;
  }

  const mode = presence.mode;

  if (!requiresConfirmation(mode, options.transitionKey)) {
    return;
  }

  // --confirm flag bypasses interactive prompt
  if (options.confirmed) {
    return;
  }

  // PEAKS_AUTO_CONFIRM=1 only works for full-auto/swarm (already returned above)
  // For assisted/strict, env var is ignored unless --force-confirm is also set
  if (process.env.PEAKS_AUTO_CONFIRM === '1') {
    if (options.forceConfirm) {
      console.error(
        `[WARNING] --force-confirm used in ${mode} mode. ` +
        'This bypasses user confirmation. Use with caution.'
      );
      return;
    }
    throw new ConfirmationRequiredError(options.transitionKey);
  }

  // --force-confirm without env var
  if (options.forceConfirm) {
    console.error(
      `[WARNING] --force-confirm used in ${mode} mode. ` +
      'This bypasses user confirmation. Use with caution.'
    );
    return;
  }

  // Interactive prompt
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr
  });

  return new Promise((resolve, reject) => {
    const description = describeTransition(options.transitionKey);
    const prompt = `\n[CONFIRM] ${description}\nProceed? (y/N) `;
    rl.question(prompt, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === 'y' || normalized === 'yes') {
        resolve();
      } else {
        reject(new ConfirmationRequiredError(options.transitionKey));
      }
    });
  });
}
