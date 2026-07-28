export type IdeKind = 'claude-code' | 'trae' | 'opencode' | 'unknown';

export const IDE_KINDS: readonly IdeKind[] = [
  'claude-code',
  'trae',
  'opencode',
  'unknown'
] as const;

export function isIdeKind(value: string): value is IdeKind {
  return (IDE_KINDS as readonly string[]).includes(value);
}

export function detectIdeFromEnv(env: NodeJS.ProcessEnv = process.env): IdeKind {
  if (typeof env['CLAUDE_CODE_ENTRYPOINT'] === 'string' && env['CLAUDE_CODE_ENTRYPOINT'].length > 0) {
    return 'claude-code';
  }
  if (typeof env['CLAUDE_SESSION_ID'] === 'string' && env['CLAUDE_SESSION_ID'].length > 0) {
    return 'claude-code';
  }
  if (typeof env['TRAE_CLI'] === 'string' && env['TRAE_CLI'].length > 0) {
    return 'trae';
  }
  if (typeof env['OPENCODE'] === 'string' && env['OPENCODE'].length > 0) {
    return 'opencode';
  }
  return 'unknown';
}
