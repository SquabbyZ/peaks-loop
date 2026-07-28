export type MainSessionMonitorBanInput = {
  readonly tool_name?: string;
  readonly tool_input?: {
    readonly file_path?: string;
    readonly content?: string;
    readonly new_string?: string;
  };
};

export type MainSessionMonitorBanDecision = {
  readonly allowed: boolean;
  readonly reason?: string;
};

const FORBIDDEN_IMPORT = /import\s*\{[^}]*\b(?:detectIdeFromEnv|IdeKind|IDE_KINDS|isIdeKind)\b[^}]*\}\s*from\s*['"][^'"]*main-session-monitor(?:\.js)?['"]/;

/** Reject Edit/Write calls that introduce a new import of the legacy monitor. */
export function checkMainSessionMonitorImport(
  input: MainSessionMonitorBanInput
): MainSessionMonitorBanDecision {
  if (input.tool_name !== 'Edit' && input.tool_name !== 'Write') {
    return { allowed: true };
  }
  const filePath = input.tool_input?.file_path;
  if (!filePath || /(?:^|[\\/])main-session-monitor\.ts$/.test(filePath)) {
    return { allowed: true };
  }
  const candidate = input.tool_input?.new_string ?? input.tool_input?.content ?? '';
  if (!FORBIDDEN_IMPORT.test(candidate)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'Import IDE detection from services/context/ide-detect.ts; main-session-monitor.ts is legacy-only.'
  };
}
