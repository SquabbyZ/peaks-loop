export {
  runSecurityAudit,
  isSecurityAuditEnvelope,
  detectSecurityAudit,
  readSecurityTemplate,
  renderSecurityAuditArtifact,
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
  renderPerfAuditArtifact,
  type PerfAuditEnvelope,
  type PerfAuditViolation,
  type PerfAuditVerdict,
  type PerfAuditDetectState,
  type PerfAuditDetectResult,
} from './services/audit-independent/perf-audit-service.js';