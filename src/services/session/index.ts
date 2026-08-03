export {
  ensureSession,
  getSessionId,
  getCurrentSessionDir,
  listSessions,
  getSessionMeta,
  setSessionMeta,
  setSessionTitle,
  listSessionMetas,
  getProjectScanPath,
  hasProjectScan,
  setCurrentSessionBinding,
  rotateSessionBinding,
  type SessionInfo,
  type SessionMeta
} from './session-manager.js';

export { getSessionDir } from './getSessionDir.js';

// Slice 020 — caller-keyed session binding. The new canonical path.
export {
  resolveCallerId,
} from './resolve-caller-id.js';

export {
  getCallerBindingFile,
  getActiveSkillFileForCaller,
  synthesiseLegacyCallerId,
  getCallerBinding,
  setCallerBinding,
  listCallerBindings
} from './caller-binding-service.js';

// Slice 4.0.8 (C1): PLATFORM_FALLBACKS is deleted. Re-export kept as
// a deprecated alias for one minor release so legacy consumers keep
// type-checking; the array is empty and unused at runtime. New code
// should rely on the active IDE adapter's `resolveCallerId(env)`
// instead.
export {
  PLATFORM_FALLBACKS,
  type PlatformFallback
} from './platform-fallbacks.js';

export {
  resolveCallerProjection,
  type ResolveCallerIdOptions
} from './resolve-caller-id.js';

export {
  type CallerProjection,
  type CallerProjectionSource,
  type CallerResolveErrorCode
} from './caller-id-types.js';

export {
  CALLER_ID_REGEX,
  CallerIdError,
  type CallerBinding,
  type CallerSkillPresence,
  type CallerIdSource
} from './caller-id-types.js';
