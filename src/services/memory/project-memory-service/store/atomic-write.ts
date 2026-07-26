// ---------------------------------------------------------------------------
// Sensitive-content + write helpers for the project memory store.
//
//   - `hasSensitiveMemoryContent` — pattern check for api keys, tokens,
//     PEM private keys, JWTs, GitHub / GitLab tokens, AWS access keys. Used
//     both by the extract path (`assertSafeMemory`) and the backup path
//     (`assertSafeMemoryFileContent`).
//   - `assertSafeMemory` — full safety gate applied during extraction.
//     Combines title/body content scan + config-service secret check +
//     sensitive-path check on the title.
//   - `assertSafeMemoryFileContent` — lighter version for backup: just
//     the content pattern scan, since the file already lives in
//     `.peaks/memory/` and was authored through the normal pipeline.
//   - `writeNewFile` — `O_EXCL` create-and-write via `openSync`. Atomic
//     with respect to other writers (no overwrite), used both for fresh
//     memory writes and (with the O_TRUNC variant inside `ranking.ts`)
//     for index.json regeneration.
// ---------------------------------------------------------------------------

import { closeSync, constants, openSync, writeFileSync } from 'node:fs';

import { containsSensitiveConfigValue, isSensitiveConfigPath } from '../../../config/config-service.js';
import type { ExtractedProjectMemory } from '../types.js';

export function hasSensitiveMemoryContent(content: string): boolean {
  return /(?:api[_-]?key|token|secret|password|credential|bearer)\s*[:=]/i.test(content)
    || /\bauthorization\s*:\s*bearer\s+\S+/i.test(content)
    || /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i.test(content)
    || /\bsk-[A-Za-z0-9_-]{6,}\b/.test(content)
    || /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/.test(content)
    || /\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(content)
    || /\bglpat-[A-Za-z0-9_-]{20,}\b/.test(content)
    || /\bAKIA[0-9A-Z]{16}\b/.test(content)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
    || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(content);
}

export function assertSafeMemory(memory: ExtractedProjectMemory): void {
  const content = `${memory.title}\n${memory.kind}\n${memory.body}`;
  const metadata = { title: memory.title, kind: memory.kind, body: memory.body };
  if (containsSensitiveConfigValue(metadata) || hasSensitiveMemoryContent(content)) {
    throw new Error('Refusing to store sensitive memory content');
  }
  if (isSensitiveConfigPath(memory.title)) {
    throw new Error('Refusing to store sensitive memory content');
  }
}

export function assertSafeMemoryFileContent(content: string): void {
  if (hasSensitiveMemoryContent(content)) {
    throw new Error('Refusing to back up sensitive memory content');
  }
}

export function writeNewFile(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}