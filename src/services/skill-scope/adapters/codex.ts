// TODO(slice-025.4-codex): research Codex's per-project skill scoping
// config format. Codex uses `.codex/` for project-local config.
//
// Until the real format is known, this stub:
// 1. Writes `.peaks/scope/codex-skills.json` (source-of-truth) on every
//    `applyScope` so the user's intent is captured on disk.
// 2. Returns NOT_SUPPORTED with a clear message pointing at this slice.
//
// When implementing, replace the makeStubAdapter call with the real
// CodexSkillScope class.

import type { SkillScopeAdapter } from '../types.js';
import { makeStubAdapter } from './_stub-helper.js';

export const CODEX_SKILL_SCOPE: SkillScopeAdapter =
  makeStubAdapter('codex', 'slice-025.4-codex', 'Codex');