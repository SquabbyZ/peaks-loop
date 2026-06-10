// TODO(slice-025.2-trae): research Trae's per-project skill scoping config
// format. Likely candidates: `.trae/skills.json` or `.trae/settings.json`.
//
// Until the real format is known, this stub:
// 1. Writes `.peaks/scope/trae-skills.json` (source-of-truth) on every
//    `applyScope` so the user's intent is captured on disk.
// 2. Returns NOT_SUPPORTED with a clear message pointing at this slice.
//
// When implementing, replace the makeStubAdapter call with the real
// TraeSkillScope class.

import type { SkillScopeAdapter } from '../types.js';
import { makeStubAdapter } from './_stub-helper.js';

export const TRAE_SKILL_SCOPE: SkillScopeAdapter =
  makeStubAdapter('trae', 'slice-025.2-trae', 'Trae IDE');