// src/services/release/version-precheck-layer-changeset.ts
//
// Wave-5 class-A hoist (rid 2026-10-01-wave5-w5-3-compact-release): Layer C
// (`runChangesetStaged`) moved VERBATIM out of `version-precheck-service.ts`
// (:285-320 at the split) for the 300-raw-line cap. The parent re-exports it
// so './version-precheck-service.js' keeps the public name.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LayerResult, PrecheckOptions } from './version-precheck-support.js';

// ---------------------------------------------------------------------------
// Layer C — changesetStaged (mirrors publish.yml gate-changeset step)
// ---------------------------------------------------------------------------

export function runChangesetStaged(opts: PrecheckOptions): LayerResult {
  const changesetDir = join(opts.projectRoot, '.changeset');
  let files: string[] = [];
  try {
    files = readdirSync(changesetDir);
  } catch {
    return {
      status: 'ok',
      message: '.changeset/ directory is absent — no changeset is staged',
      remediation: '',
      observed: { stagedFiles: [] }
    };
  }
  const staged = files.filter((f) => f.endsWith('.md') && f !== 'README.md');
  if (staged.length === 0) {
    return {
      status: 'ok',
      message: '.changeset/ has no staged *.md files',
      remediation: '',
      observed: { stagedFiles: [] }
    };
  }
  return {
    status: 'warning',
    message: `.changeset/ has ${staged.length} staged change(s): ${staged.join(', ')}`,
    remediation:
      'publish.yml gate-changeset will BLOCK publish with these staged files. ' +
      'Either: (a) run `peaks changeset publish` to drain the staged changesets, ' +
      '(b) move them out of .changeset/, or (c) re-run with --strict to enforce blocker exit here.',
    observed: { stagedFiles: staged }
  };
}
