export type RefactorMode = 'solo' | 'rd';

export type RefactorDryRun = {
  mode: RefactorMode;
  implementationAllowed: false;
  hardGates: string[];
  requiredArtifacts: string[];
  nextActions: string[];
};

export function createRefactorDryRun(mode: RefactorMode): RefactorDryRun {
  return {
    mode,
    implementationAllowed: false,
    hardGates: [
      'Understand the project before changes',
      'Prefer existing project standards over Peaks built-ins',
      'Require UT coverage >= 95%',
      'Treat missing, unknown, or unverifiable coverage as failing',
      'Coverage success only allows analysis and spec generation',
      'Split broad refactors into minimal functional slices',
      'Generate strict verifiable spec before each slice',
      'Require peaks-prd and peaks-qa artifacts even for direct peaks-rd refactor',
      'Require 100% acceptance for each slice',
      'Commit code and intermediate artifacts before the next slice'
    ],
    requiredArtifacts: [
      'project-scan.md',
      'coverage-report.md',
      'feature-slice-map.md',
      'slice-spec.md',
      'acceptance-spec.md',
      'validation-report.md',
      'artifact-retention-report.md',
      'commit-required.md'
    ],
    nextActions: [
      'Run doctor checks',
      'Initialize or link the remote artifact repository',
      'Generate the first refactor slice spec before implementation'
    ]
  };
}
