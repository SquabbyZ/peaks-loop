/**
 * peaks-loop-doctor public surface.
 *
 * Re-exports the runDoctor check pipeline plus the public type
 * contract (DoctorCheck / DoctorReport / DoctorOptions and the
 * injectable probe types).
 *
 * Main peaks-loop package consumes via `workspace:*` dep:
 *
 *   import { runDoctor } from 'peaks-loop-doctor';
 *
 * The doctor service is probe-driven: cross-domain utilities
 * (loadSkillRegistry, getSkillPresence, planStatusLineInstall,
 * findProjectRoot, isValidSessionId) are injected at the
 * call-site in main `src/cli/commands/core/doctor-command.ts`,
 * so this package stays standalone and does NOT depend on
 * the main peaks-loop package (avoiding circular deps).
 *
 * See .peaks/_runtime/2026-07-17-session-1d5ac0/rd/slice-3b-doctor.md
 * for the slice-3b Option C decision rationale.
 */

export {
  runDoctor,
  isWorkspaceInitializedAt,
  compareDistVersion,
  inspectWorkspaceLayout,
  collectGateguardEntries,
  type DoctorCheck,
  type DoctorReport,
  type DoctorOptions,
  type CodegraphCapabilityProbe,
  type DistVersionComparison,
  type DistVersionProbe,
  type WorkspaceLayoutInspection,
  type WorkspaceLayoutProbe,
  type GateguardHookLocation,
  type GateguardProbeResult,
  type GateguardProbe,
} from './services/doctor/doctor-service.js';