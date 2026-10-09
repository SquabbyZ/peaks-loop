/**
 * The layered `peaks config get` reader.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
import { findProjectRoot } from './config-safety.js';
import { getNestedValue } from './config-nested-path.js';
import { isRecord, omitProxy } from './config-primitives.js';
import { toTokenConfig } from './config-coercion.js';
import {
  readProjectJsonFile,
  readUserJsonFile,
  removeProjectSensitiveConfig
} from './config-file-io.js';
import type { ConfigGetOptions } from './config-types.js';

export function getConfig(options: ConfigGetOptions = {}): unknown {
  const projectRoot = findProjectRoot(process.cwd());
  const userConfig = readUserJsonFile() ?? {};
  const projectConfig = removeProjectSensitiveConfig(readProjectJsonFile(projectRoot) ?? {});
  const projectConfigWithoutProxy = omitProxy(projectConfig);
  const source =
    options.layer === 'user'
      ? userConfig
      : options.layer === 'project'
        ? projectConfig
        : {
            ...userConfig,
            ...projectConfigWithoutProxy
          };
  const config = isRecord(source)
    ? {
        ...source,
        ...(source.tokens !== undefined ? { tokens: toTokenConfig(source.tokens) } : {})
      }
    : source;

  if (options.key !== undefined) {
    return getNestedValue(config, options.key);
  }

  return config;
}
