/**
 * doctor-service plugin registry (slice rid-004).
 *
 * Holds the fixed-order, code-driven list of `DoctorCheckPlugin`
 * instances that `runDoctor` iterates. The order is the same as the
 * legacy monolithic function body — preserving the on-disk check
 * ordering keeps the existing `report.checks` array unchanged for
 * every consumer (CLI summary, JSON output, schema self-check).
 *
 * Why code-driven (not data-driven):
 *   - Each check has distinct typed inputs (skills, presence, layout
 *     probe, gateguard probe, …) and conditional logic that a config
 *     table cannot express without losing type safety.
 *   - The check ordering is load-bearing — `skill-presence:workspace`
 *     depends on `presence` being probed, `doctor-self:check-id-pattern`
 *     depends on every prior check's IDs, and `L3:l3-orphan-sessions` /
 *     `L3:l3-memory-health` run last so they observe a clean post-F3
 *     layout. A config-driven registry would obscure that ordering
 *     and force callers to read two files to understand execution
 *     flow. Code-driven keeps it auditable in one place.
 *   - Adding a check is a code change in any case (the typed probe
 *     surface has to grow). A code-driven registry makes the diff
 *     self-contained.
 *
 * Adding a new check:
 *   1. Create `checks/<your-check>.ts` exporting
 *      `export const check: DoctorCheckPlugin`.
 *   2. Append `check` to the `PLUGINS` array below IN THE EXACT
 *      POSITION THE LEGACY MONOLITHIC FUNCTION EMITS IT.
 *   3. If you need new context state, extend `DoctorContext` in
 *      `types.ts` and populate it in `index.ts`.
 */

import { check as skillExistence } from './checks/skill-existence.js';
import { check as skillNameMatch } from './checks/skill-name-match.js';
import { check as skillParse } from './checks/skill-parse.js';
import { check as skillRunbook } from './checks/skill-runbook.js';
import { check as skillApplyNote } from './checks/skill-apply-note.js';
import { check as schemaValidity } from './checks/schema-validity.js';
import { check as userConfig } from './checks/user-config.js';
import { check as skillPresence } from './checks/skill-presence.js';
import { check as workspaceInit } from './checks/workspace-init.js';
import { check as statuslineInstall } from './checks/statusline-install.js';
import { check as statuslineRuntime } from './checks/statusline-runtime.js';
import { check as codegraphCapability } from './checks/codegraph-capability.js';
import { check as distSourceVersion } from './checks/dist-source-version.js';
import { check as multiBinaryDrift } from './checks/multi-binary-drift.js';
import { check as workspaceLayout } from './checks/workspace-layout.js';
import { check as gateguardConflict } from './checks/gateguard-conflict.js';
import { check as checkIdSchema } from './checks/check-id-schema.js';
import { check as l3OrphanSessions } from './checks/l3-orphan-sessions.js';
import { check as l3MemoryHealth } from './checks/l3-memory-health.js';
import type { DoctorCheckPlugin } from './types.js';

/**
 * Ordered list of doctor check plugins. The order mirrors the legacy
 * monolithic `runDoctor` function body verbatim — DO NOT REORDER
 * without first re-reading the consumer-side tests in
 * `tests/doctor.test.ts` / `tests/doctor/35-checks-aggregate.test.ts`
 * and updating the expected check-id list.
 */
export const PLUGINS: ReadonlyArray<DoctorCheckPlugin> = [
  skillExistence,       // id prefix "skill:"
  skillNameMatch,       // id prefix "skill-name:"
  skillParse,           // id prefix "skill-parse:"
  skillRunbook,         // id prefix "skill-runbook:"
  skillApplyNote,       // id prefix "skill-apply-note:"
  schemaValidity,       // id prefix "schema:"
  userConfig,           // id "config:user"
  skillPresence,        // ids "skill-presence:current" + "skill-presence:freshness"
  workspaceInit,        // id "skill-presence:workspace"
  statuslineInstall,    // id "statusline:install"
  statuslineRuntime,    // id "statusline:runtime"
  codegraphCapability,  // id "capability:codegraph"
  distSourceVersion,    // id "build:dist-version-matches-source"
  multiBinaryDrift,     // id "build:multi-binary-drift"
  workspaceLayout,      // id "build:workspace-layout-canonical"
  gateguardConflict,    // id "integration:gateguard-peaks-conflict"
  checkIdSchema,        // id "doctor-self:check-id-pattern"
  l3OrphanSessions,     // id "L3:l3-orphan-sessions"
  l3MemoryHealth,       // id "L3:l3-memory-health"
];