/**
 * Thin shim — `doctor-service.ts` (legacy 1309-line file)
 * was split in slice rid-004 into a code-driven fixed-registry
 * tree under `./doctor-service/`. This file remains so the legacy
 * import paths (`from '../services/doctor/doctor-service.js'` and
 * `peaks-loop-doctor/services/doctor/doctor-service` package
 * export) keep working without modification.
 *
 * Do NOT add logic here — the public surface lives in
 * `./doctor-service/index.ts` and the check modules under
 * `./doctor-service/checks/`.
 */

export * from './doctor-service/index.js';

// Re-export the helper symbols the legacy monolithic doctor-service.ts
// exposed at the package boundary. These were split into the check
// modules during rid-004; we re-export here so legacy callers
// (`import { compareDistVersion } from '../services/doctor/doctor-service.js'`)
// keep working without modification.
export { compareDistVersion } from './doctor-service/checks/dist-source-version.js';
export { inspectWorkspaceLayout } from './doctor-service/checks/workspace-layout.js';
export { collectGateguardEntries } from './doctor-service/checks/gateguard-conflict.js';

// Re-export the fixed plugin registry so characterization tests and
// future CLI surfaces (e.g. `peaks doctor --list-checks`) can enumerate
// the check pipeline without reaching into a private module path.
export { PLUGINS } from './doctor-service/plugin-registry.js';

// Re-export types so the legacy `import type { DoctorCheck } from
// '../services/doctor/doctor-service.js'` paths keep working. The
// `export * from './doctor-service/index.js'` above re-exports the
// runtime symbols, but TypeScript erases `export type` — we re-export
// them here explicitly so `type` imports resolve correctly.
export type {
  DoctorCheck,
  DoctorReport,
  DoctorOptions,
  DoctorCheckPlugin,
  DoctorContext,
  DoctorSkillEntry,
  DoctorSkillLoadFailure,
  DoctorSkillsResult,
  DoctorSkillPresence,
  CodegraphCapabilityProbe,
  DistVersionComparison,
  DistVersionProbe,
  WorkspaceLayoutInspection,
  WorkspaceLayoutProbe,
  GateguardHookLocation,
  GateguardProbeResult,
  GateguardProbe
} from './doctor-service/types.js';