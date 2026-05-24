import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRepoRoot(startPath: string): string {
  let currentPath = startPath;

  while (currentPath !== dirname(currentPath)) {
    if (existsSync(resolve(currentPath, 'package.json')) && existsSync(resolve(currentPath, 'skills'))) {
      return currentPath;
    }
    currentPath = dirname(currentPath);
  }

  throw new Error(`Unable to locate Peaks repository root from ${startPath}`);
}

const currentFile = fileURLToPath(import.meta.url);
export const repoRoot = findRepoRoot(dirname(currentFile));
export const skillsDir = resolve(repoRoot, 'skills');
export const schemasDir = resolve(repoRoot, 'schemas');
export const templatesDir = resolve(repoRoot, 'templates');

export const requiredSkillNames = [
  'peaks-solo',
  'peaks-prd',
  'peaks-ui',
  'peaks-rd',
  'peaks-qa',
  'peaks-sc',
  'peaks-txt'
] as const;

export const requiredSchemaFiles = [
  'artifact-manifest.schema.json',
  'context-capsule.schema.json',
  'approval-record.schema.json',
  'change-impact.schema.json',
  'refactor-slice-spec.schema.json',
  'artifact-retention-report.schema.json',
  'capability-source.schema.json',
  'capability-item.schema.json',
  'capability-availability.schema.json',
  'recommendation-plan.schema.json',
  'artifact-workspace.schema.json',
  'mcp-server.schema.json',
  'mcp-install-spec.schema.json',
  'mcp-install-plan.schema.json',
  'mcp-apply-result.schema.json',
  'openspec-change-summary.schema.json',
  'openspec-render-request.schema.json',
  'openspec-validation-result.schema.json',
  'doctor-report.schema.json'
] as const;
