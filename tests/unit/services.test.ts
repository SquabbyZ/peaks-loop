import { describe, expect, test } from 'vitest';
import { createArtifactInitPlan, getArtifactStatus } from '../../src/services/artifacts/artifact-service.js';
import { listProfiles } from '../../src/services/profiles/profile-service.js';
import { planProxyTest } from '../../src/services/proxy/proxy-service.js';
import { createRefactorDryRun } from '../../src/services/refactor/refactor-service.js';

describe('service skeletons', () => {
  test('lists built-in runtime profiles', () => {
    expect(listProfiles().map((profile) => profile.name)).toContain('strict-refactor');
  });

  test('creates provider-agnostic artifact init plans for GitLab', () => {
    const plan = createArtifactInitPlan({ provider: 'gitlab', name: 'project-artifacts' });

    expect(plan.provider).toBe('gitlab');
    expect(plan.remoteFirst).toBe(true);
    expect(plan.tokenPolicy).toContain('never write tokens');
  });

  test('reports remote-first artifact status', () => {
    expect(getArtifactStatus().supportedProviders).toEqual(['github', 'gitlab']);
  });

  test('plans explicit proxy tests', () => {
    const plan = planProxyTest('http://127.0.0.1:58309');

    expect(plan.commandPreview).toBe("curl -x 'http://127.0.0.1:58309' -I 'https://www.google.com'");
  });

  test('escapes proxy command preview arguments', () => {
    const plan = planProxyTest('http://127.0.0.1:58309/?q=$(whoami)', "https://example.com/a'b");

    expect(plan.commandPreview).toBe("curl -x 'http://127.0.0.1:58309/?q=$(whoami)' -I 'https://example.com/a'\\''b'");
  });

  test('rejects invalid proxy URLs', () => {
    expect(() => planProxyTest('127.0.0.1:58309')).toThrow('Proxy URL must start');
  });

  test('rejects proxy URLs with credentials', () => {
    expect(() => planProxyTest('http://user:secret@127.0.0.1:58309')).toThrow('Proxy URL must not include credentials');
  });

  test('refactor dry run encodes hard gates', () => {
    const dryRun = createRefactorDryRun('code');

    expect(dryRun.implementationAllowed).toBe(false);
    expect(dryRun.hardGates).toContain('Require UT coverage >= 95%');
    expect(dryRun.requiredArtifacts).toContain('retention-boundary.md');
    expect(dryRun.hardGates).toContain('Commit or sync artifacts only after explicit authorization');
  });

  test('refactor dry run supports rd mode', () => {
    expect(createRefactorDryRun('rd').mode).toBe('rd');
  });

  test('planProxyTest rejects URLs that fail to parse', () => {
    // A URL that is valid per startsWith check but fails URL constructor
    expect(() => planProxyTest('http://[invalid')).toThrow('Proxy URL must be a valid URL');
  });
});
