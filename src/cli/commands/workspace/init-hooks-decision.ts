// Split out of `workspace/init-command.ts`:
// the first-time "install peaks hooks" decision. The original function was 127
// code lines with a complexity of 19; the marker / auto / prompt paths are now
// one function each so every branch stays inside the 50-code-line cap.
import {
  applyHookInstall,
  readHookStatus
} from '../../../services/skills/hooks-settings-service.js';
import { getErrorMessage } from '../../cli-helpers.js';
import {
  readDecisionMarker,
  writeDecisionMarker,
  promptYesNo,
  type HooksDecisionMarker
} from './helpers.js';
import type {
  FirstTimeHooksInstallOutcome,
  ResolveFirstTimeHooksInstallOptions
} from './init-options.js';

const PROMPT_TEXT =
  '\nPeaks-Cli: install the PreToolUse hooks for this project now?\n' +
  '  → Bash matcher: `peaks gate enforce` (SOP gate enforcement)\n' +
  'The gate-enforce hook runs on every Claude Code tool call without further prompting. The decision is sticky\n' +
  '(recorded in .peaks/.peaks-init-hooks-decision.json) and re-runs of `workspace init` will\n' +
  'honour it. Re-run with --install-hooks=skip or --install-hooks=auto to override.\n\n' +
  'Install now? [Y/n]: ';

/**
 * readHookStatus can throw (e.g. .claude is a symlink → safety check rejects).
 * Treat any throw as "hooks status unknown → treat as not-installed" so the
 * function still reaches the install path; the install will surface the same
 * error in a more specific reason field.
 */
function readHookStatusOrUnknown(projectRoot: string): { installed: boolean } {
  try {
    return readHookStatus('project', projectRoot);
  } catch (error) {
    // Fall through to the install path; the failure will be captured below.
    void error;
    return { installed: false };
  }
}

function resolveWithExistingMarker(
  projectRoot: string,
  existingMarker: HooksDecisionMarker,
  hookStatus: { installed: boolean }
): FirstTimeHooksInstallOutcome {
  if (existingMarker.decision === 'installed' && !hookStatus.installed) {
    try {
      applyHookInstall('project', projectRoot);
      return {
        decision: 'installed',
        action: 'reinstalled',
        scope: 'project',
        reason: 'marker-said-installed-hooks-missing'
      };
    } catch (error) {
      return {
        decision: existingMarker.decision,
        action: 'marker-honored',
        scope: 'project',
        reason: `reinstall-failed: ${getErrorMessage(error)}`
      };
    }
  }
  return {
    decision: existingMarker.decision,
    action: 'marker-honored',
    scope: existingMarker.scope
  };
}

/**
 * The reason code distinguishes the path the user took to reach auto-install:
 *   - explicit-auto:  user passed --install-hooks=auto
 *   - json-mode:      no --install-hooks flag, but --json was set
 *   - non-tty-default: no flag, no --json, stdin is not a TTY
 */
function autoInstallHooks(
  projectRoot: string,
  explicitMode: ResolveFirstTimeHooksInstallOptions['explicitMode'],
  jsonMode: boolean
): FirstTimeHooksInstallOutcome {
  let autoReason: string;
  if (explicitMode === 'auto') {
    autoReason = 'explicit-auto';
  } else if (jsonMode) {
    autoReason = 'json-mode';
  } else {
    autoReason = 'non-tty-default';
  }
  try {
    applyHookInstall('project', projectRoot);
    writeDecisionMarker(projectRoot, 'installed');
    return {
      decision: 'installed',
      action: 'first-decision',
      scope: 'project',
      reason: autoReason
    };
  } catch (error) {
    // Auto-install failed: still record the decision so we do not keep retrying
    // every workspace init. The user can fix the underlying problem and run
    // `peaks hooks install` manually.
    writeDecisionMarker(projectRoot, 'installed');
    return {
      decision: 'installed',
      action: 'first-decision',
      scope: 'project',
      reason: `install-failed: ${getErrorMessage(error)}`
    };
  }
}

/** `ask` mode in a TTY: prompt once and record the answer sticky. */
async function promptForHooksInstall(projectRoot: string): Promise<FirstTimeHooksInstallOutcome> {
  process.stderr.write(PROMPT_TEXT);
  const answer = await promptYesNo('');
  if (answer === null) {
    // TTY disappeared mid-prompt (rare): treat as skip + write marker.
    writeDecisionMarker(projectRoot, 'skipped');
    return {
      decision: 'skipped',
      action: 'first-decision',
      scope: 'project',
      reason: 'tty-prompt-aborted'
    };
  }
  if (!answer) {
    writeDecisionMarker(projectRoot, 'skipped');
    return {
      decision: 'skipped',
      action: 'first-decision',
      scope: 'project',
      reason: 'user-answered-no'
    };
  }
  try {
    applyHookInstall('project', projectRoot);
    writeDecisionMarker(projectRoot, 'installed');
    return {
      decision: 'installed',
      action: 'first-decision',
      scope: 'project',
      reason: 'user-answered-yes'
    };
  } catch (error) {
    writeDecisionMarker(projectRoot, 'installed');
    return {
      decision: 'installed',
      action: 'first-decision',
      scope: 'project',
      reason: `install-failed: ${getErrorMessage(error)}`
    };
  }
}

/**
 * Resolve the first-time "install peaks hooks" decision for this project.
 * Decision tree:
 *
 *   1. Read the sticky marker.
 *      - Marker present:
 *        - marker.decision === 'installed' AND hooks are present → action: marker-honored, no side effects
 *        - marker.decision === 'installed' AND hooks are MISSING   → re-install, action: reinstalled
 *        - marker.decision === 'skipped'                            → action: marker-honored, no install
 *      - Marker absent:
 *        - hooks already present → write a fresh 'installed' marker, action: already-installed
 *        - otherwise:
 *          - explicit --install-hooks=auto  → install + marker, action: first-decision
 *          - explicit --install-hooks=skip  → marker only, action: first-decision
 *          - explicit --install-hooks=ask OR default in TTY:
 *              - jsonMode → silently auto-install (LLM cannot answer), action: first-decision
 *              - TTY      → prompt; on yes install + marker, on no marker-only
 *          - default in non-TTY → auto-install, action: first-decision
 *
 * Project scope is the only supported scope here; global scope is reserved
 * for explicit `peaks hooks install --global` invocations.
 */
export async function resolveFirstTimeHooksInstall(
  options: ResolveFirstTimeHooksInstallOptions
): Promise<FirstTimeHooksInstallOutcome> {
  const { projectRoot, jsonMode } = options;
  const existingMarker = readDecisionMarker(projectRoot);
  const hookStatus = readHookStatusOrUnknown(projectRoot);

  if (existingMarker !== null) {
    return resolveWithExistingMarker(projectRoot, existingMarker, hookStatus);
  }

  // No marker yet — first decision.
  if (hookStatus.installed) {
    writeDecisionMarker(projectRoot, 'installed');
    return { decision: 'installed', action: 'already-installed', scope: 'project' };
  }

  // Determine effective mode (explicit flag wins; default depends on TTY + jsonMode).
  const explicitMode = options.explicitMode;
  const effectiveMode: 'ask' | 'auto' | 'skip' =
    explicitMode ?? (jsonMode ? 'auto' : process.stdin.isTTY === true ? 'ask' : 'auto');

  if (effectiveMode === 'skip') {
    writeDecisionMarker(projectRoot, 'skipped');
    return {
      decision: 'skipped',
      action: 'first-decision',
      scope: 'project',
      reason: 'explicit-skip'
    };
  }

  if (effectiveMode === 'auto' || jsonMode) {
    return autoInstallHooks(projectRoot, explicitMode, jsonMode);
  }

  return promptForHooksInstall(projectRoot);
}
