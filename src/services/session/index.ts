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
  type ResolveCallerIdOptions
} from './resolve-caller-id.js';

export {
  getCallerBindingFile,
  getActiveSkillFileForCaller,
  synthesiseLegacyCallerId,
  getCallerBinding,
  setCallerBinding,
  listCallerBindings
} from './caller-binding-service.js';

export {
  PLATFORM_FALLBACKS,
  type PlatformFallback
} from './platform-fallbacks.js';

export {
  CALLER_ID_REGEX,
  CallerIdError,
  type CallerBinding,
  type CallerSkillPresence,
  type CallerIdSource
} from './caller-id-types.js';
