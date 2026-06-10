// TODO(slice-025.3-cursor): research Cursor's per-project skill scoping
// config format. Cursor uses `.cursor/` for project-local config; the
// skill-scope hook may live there or in `.cursor/rules/`.
//
// Until the real format is known, this stub:
// 1. Writes `.peaks/scope/cursor-skills.json` (source-of-truth) on every
//    `applyScope` so the user's intent is captured on disk.
// 2. Returns NOT_SUPPORTED with a clear message pointing at this slice.
//
// When implementing, replace the makeStubAdapter call with the real
// CursorSkillScope class.

import type { SkillScopeAdapter } from '../types.js';
import { makeStubAdapter } from './_stub-helper.js';

export const CURSOR_SKILL_SCOPE: SkillScopeAdapter =
  makeStubAdapter('cursor', 'slice-025.3-cursor', 'Cursor');