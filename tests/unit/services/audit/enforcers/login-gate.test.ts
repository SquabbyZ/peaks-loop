import { describe, it, expect } from 'vitest';
import { checkLoginGate } from '../../../../../src/services/audit/enforcers/login-gate.js';

describe('login-gate.checkLoginGate', () => {
  it('flags uninstall as destructive', () => {
    const result = checkLoginGate({ command: 'peaks hooks uninstall' });
    expect(result.destructive).toBe(true);
    expect(result.matchedPattern).toContain('uninstall');
  });

  it('flags rm -rf as destructive', () => {
    const result = checkLoginGate({ command: 'rm -rf node_modules' });
    expect(result.destructive).toBe(true);
  });

  it('flags --force and --hard flags as destructive', () => {
    expect(checkLoginGate({ command: 'git push --force' }).destructive).toBe(true);
    expect(checkLoginGate({ command: 'git reset --hard' }).destructive).toBe(true);
  });

  it('flags auth / login as protected', () => {
    expect(checkLoginGate({ command: 'curl -H "Authorization: Bearer ..."' }).protected).toBe(true);
    expect(checkLoginGate({ command: 'login --user x' }).protected).toBe(true);
  });

  it('returns destructive=false / protected=false for benign commands', () => {
    const result = checkLoginGate({ command: 'pnpm typecheck' });
    expect(result.destructive).toBe(false);
    expect(result.protected).toBe(false);
  });
});
