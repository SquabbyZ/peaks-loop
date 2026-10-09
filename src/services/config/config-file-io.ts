/**
 * Safe config-file reads/writes and the project-layer write target.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
import { existsSync, mkdirSync } from 'node:fs';
import {
  findProjectRoot,
  getProjectConfigPath,
  getUserConfigPath,
  readConfigFileSafely,
  validateProjectBootstrapConfigPathForWrite,
  validateUserConfigPathForWrite
} from './config-safety.js';
import { containsSensitiveConfigValue, isSecretKey } from './config-validation.js';
import type { PeaksConfig } from './config-types.js';

export function readJsonFile(
  path: string | null,
  validateBeforeRead?: () => void,
  errorMessage = 'Config path must stay inside the config root'
): Partial<PeaksConfig> | null {
  if (!path || !existsSync(path)) return null;
  validateBeforeRead?.();
  const content = readConfigFileSafely(path, errorMessage);
  try {
    return JSON.parse(content) as Partial<PeaksConfig>;
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

export function readExistingJsonFile(
  path: string,
  errorMessage: string,
  validateBeforeRead?: () => void
): Partial<PeaksConfig> | null {
  if (!existsSync(path)) return null;
  validateBeforeRead?.();
  try {
    return JSON.parse(readConfigFileSafely(path, errorMessage)) as Partial<PeaksConfig>;
  } catch {
    throw new Error(errorMessage);
  }
}

export function readUserJsonFile(): Partial<PeaksConfig> | null {
  const userPath = getUserConfigPath();
  return readJsonFile(
    userPath,
    () => validateUserConfigPathForWrite(userPath),
    'User config path must stay inside the user root'
  );
}

export function readProjectJsonFile(projectRoot: string | null): Partial<PeaksConfig> | null {
  const projectPath = getProjectConfigPath(projectRoot);
  return readJsonFile(
    projectPath,
    projectRoot && projectPath
      ? () => validateProjectBootstrapConfigPathForWrite(projectRoot, projectPath)
      : undefined,
    'Project config path must stay inside the project root'
  );
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
export function getProjectWriteTarget(): { projectRoot: string; configPath: string } {
  const projectRoot = findProjectRoot(process.cwd());
  const configPath = getProjectConfigPath(projectRoot);
  if (!projectRoot || !configPath) {
    throw new Error('Project config not found');
  }
  return { projectRoot, configPath };
}
export function removeProjectSensitiveConfig(config: Partial<PeaksConfig>): Partial<PeaksConfig> {
  const OMITTED_KEYS = new Set(['providers', 'proxy', 'tokens']);
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) =>
        !OMITTED_KEYS.has(key) && !isSecretKey(key) && !containsSensitiveConfigValue(value)
    )
  );
}
