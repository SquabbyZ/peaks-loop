#!/usr/bin/env node
/**
 * Standalone entry shim for the peaks-cron-scheduler daemon.
 *
 * `peaks cron-scheduler start` spawns this file as a detached
 * child (with PEAKS_CRON_SCHEDULER_DAEMON=1 in env). The CLI's
 * own module detects the env var and runs runSchedulerLoop
 * directly; this shim is a separate path for users who want
 * a dedicated binary (e.g. systemd unit calling
 * peaks-cron-scheduler.js directly, or the NSSM install recipe
 * in skills/peaks-code/references/cron-scheduler-deployment.md).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
// bin/peaks-cron-scheduler.js → dist/cli/commands/cron-scheduler-commands.js
const cliPath = resolve(here, '..', 'dist/cli/commands/cron-scheduler-commands.js');
process.env.PEAKS_CRON_SCHEDULER_DAEMON = '1';
const r = createRequire(import.meta.url);
r(cliPath);
