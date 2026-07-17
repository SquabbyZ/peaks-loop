export {
  runSecurityAudit,
  isSecurityAuditEnvelope,
  detectSecurityAudit,
  readSecurityTemplate,
  type SecurityAuditEnvelope,
  type SecurityAuditViolation,
  type SecurityAuditVerdict,
  type SecurityAuditDetectState,
  type SecurityAuditDetectResult,
  type HandoffFrontmatter,
  readAndVerifyHandoff,
} from './services/audit-independent/security-audit-service.js';

export {
  runPerfAudit,
  isPerfAuditEnvelope,
  detectPerfAudit,
  readPerfTemplate,
  type PerfAuditEnvelope,
  type PerfAuditViolation,
  type PerfAuditVerdict,
  type PerfAuditDetectState,
  type PerfAuditDetectResult,
} from './services/audit-independent/perf-audit-service.js';