import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IdeId } from './ide-types.js';
import { listAdapters } from './ide-registry.js';

/**
 * Detect which IDE a given project root is using, by looking for the IDE's
 * settings directory (`.claude`, `.trae`, etc.). Returns the first match in
 * adapter insertion order, or `null` if no adapter's directory is present.
 *
 * 启发式:基于 cwd 目录存在性。CLI 后续 slice 会扩展为 env 变量检测、settings
 * 文件内容检测、显式 `--ide` flag 覆盖等。
 */
export function detectInstalledIde(projectRoot: string): IdeId | null {
  for (const adapter of listAdapters()) {
    if (existsSync(join(projectRoot, adapter.settings.dirName))) {
      return adapter.id;
    }
  }
  return null;
}
