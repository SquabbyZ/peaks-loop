import { join } from 'node:path';

export function playwrightProfilePaths(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly dispatchId: string;
}): { readonly userDataDir: string; readonly profileName: string } {
  const userDataDir = join(
    input.projectRoot,
    '.peaks', '_runtime', input.sessionId,
    'pw-profiles', input.dispatchId
  );
  return { userDataDir, profileName: `dispatch-${input.dispatchId}` };
}
