/**
 * pre-rd-scan enforcer (L2.2 P1) — verifies the project has been scanned
 * before the rd implementation phase begins.
 *
 * Two red lines:
 *   - rl-pre-rd-scan-001: peaks scan archetype must have been run
 *   - rl-pre-rd-scan-002: peaks standards preflight must have been run
 *
 * Detected by checking for the project-scan.md and standards reports in
 * the session dir. Both are produced by the pre-RD workflow.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PreRdScanInput {
  readonly projectRoot: string;
  readonly sessionId: string;
}

export interface PreRdScanResult {
  readonly archetypeScanned: boolean;
  readonly archetypeReportPath: string;
  readonly standardsPreflightDone: boolean;
  readonly standardsReportPath: string;
}

export function checkPreRdScan(input: PreRdScanInput): PreRdScanResult {
  const archetypeReportPath = join(input.projectRoot, '.peaks/_runtime', input.sessionId, 'rd/project-scan.md');
  const standardsReportPath = join(input.projectRoot, '.peaks/_runtime', input.sessionId, 'standards-preflight.json');

  return {
    archetypeScanned: existsSync(archetypeReportPath),
    archetypeReportPath,
    standardsPreflightDone: existsSync(standardsReportPath),
    standardsReportPath,
  };
}
