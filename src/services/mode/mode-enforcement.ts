import { getSkillPresence, type SkillPresenceMode } from '../skills/skill-presence-service.js';

type TransitionKey = `${string}:${string}`;

const ASSISTED_CONFIRM_TRANSITIONS: ReadonlySet<TransitionKey> = new Set([
  'prd:confirmed-by-user',
  'rd:qa-handoff',
  'qa:verdict-issued'
]);

export function requiresConfirmation(mode: SkillPresenceMode, transitionKey: TransitionKey): boolean {
  // Slice 2026-09-09-mode-consolidation: `swarm` removed as a mode; the
  // two auto-proceed peers are `full-auto` and `24h`.
  if (mode === 'full-auto' || mode === '24h') {
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
  readonly transitionKey: TransitionKey;
  readonly mode: SkillPresenceMode;
  readonly nextActions: readonly string[];

  constructor(transitionKey: TransitionKey, mode: SkillPresenceMode) {
    const description = describeTransition(transitionKey);
    const nextActions = [
      `Ask the user via AskUserQuestion whether to proceed with ${description} in ${mode} mode.`,
      'If the user approves, re-run the same command with --confirm.'
    ];
    super(
      `Confirmation required for: ${description} (mode: ${mode})\n` +
      `${nextActions[0]}\n` +
      `${nextActions[1]}\n` +
      'No terminal prompt is available: this gate never reads stdin.'
    );
    this.name = 'ConfirmationRequiredError';
    this.transitionKey = transitionKey;
    this.mode = mode;
    this.nextActions = nextActions;
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

  // --confirm flag bypasses the gate
  if (options.confirmed) {
    return;
  }

  // PEAKS_AUTO_CONFIRM=1 only works for full-auto/24h (already returned above)
  // For assisted/strict, env var is ignored unless --force-confirm is also set
  if (process.env.PEAKS_AUTO_CONFIRM === '1') {
    if (options.forceConfirm) {
      console.error( // TODO(g2): legacy console.error without envelope — grace: 1 minor release (v2.14.0)
        `[WARNING] --force-confirm used in ${mode} mode. ` +
        'This bypasses user confirmation. Use with caution.'
      );
      return;
    }
    throw new ConfirmationRequiredError(options.transitionKey, mode);
  }

  // --force-confirm without env var
  if (options.forceConfirm) {
    console.error( // TODO(g2): legacy console.error without envelope — grace: 1 minor release (v2.14.0)
      `[WARNING] --force-confirm used in ${mode} mode. ` +
      'This bypasses user confirmation. Use with caution.'
    );
    return;
  }

  // No bypass flag: refuse immediately. Never read stdin — in an LLM-driven
  // session there is no TTY, so a prompt would hang forever, and a `y/N`
  // terminal prompt would also violate the Human-NL-Choice-Only rule (the
  // user answers via AskUserQuestion, never by typing into a shell).
  throw new ConfirmationRequiredError(options.transitionKey, mode);
}
