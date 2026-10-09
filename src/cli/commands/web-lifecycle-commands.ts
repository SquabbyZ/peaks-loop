/**
 * `peaks web status|stop|install|login` — the daemon-lifecycle, acquisition and
 *
 * Attaches to the `web` parent handed in by `web-commands.ts` rather than
 * looking it up: the lookup needs a fallback branch for "parent not registered
 * yet" that cannot happen here, and one less branch is one less path to test.
 *
 * None of the four goes through the daemon. `status` must work when the daemon
 * is dead or wedged — that IS its job (AC6) — and `stop` must work when the
 * daemon answers nothing at all. Both therefore read the filesystem and the
 * loopback port directly, and both keep working under S3's
 * `PEAKS_WEB_DISABLED` gate (decision C2). `install` is a local download, so it
 * needs no daemon either, and `login` opens its own headed browser (the daemon's
 * is headless) for a user-level profile that is deliberately cross-project
 * (design §10.2) — which is why it needs no session binding.
 *
 * The verb implementations live beside this file, one module per verb:
 * `web-status-command.ts`, `web-stop-command.ts`, `web-install-command.ts`,
 * `web-login-command.ts`, with the session lookup in `web-command-shared.ts`.
 */
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerWebInstallCommand } from './web-install-command.js';
import { registerWebLoginCommand } from './web-login-command.js';
import { registerWebStatusCommand } from './web-status-command.js';
import { registerWebStopCommand } from './web-stop-command.js';

export function registerWebLifecycleCommands(web: Command, io: ProgramIO): void {
  registerWebStatusCommand(web, io);
  registerWebStopCommand(web, io);
  registerWebInstallCommand(web, io);
  registerWebLoginCommand(web, io);
}

// Re-export for tests / external consumers.
export { runWebStatus } from './web-status-command.js';
export { runWebStop } from './web-stop-command.js';
export { runWebInstall } from './web-install-command.js';
export { runWebLogin } from './web-login-command.js';
