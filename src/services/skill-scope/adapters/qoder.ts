// TODO(slice-025.5-qoder): research Qoder's per-project skill scoping
// config format. Qoder is an AI IDE by Alibaba; per-project config dir
// is unconfirmed at slice 025.1.
//
// Until the real format is known, this stub:
// 1. Writes `.peaks/scope/qoder-skills.json` (source-of-truth) on every
//    `applyScope` so the user's intent is captured on disk.
// 2. Returns NOT_SUPPORTED with a clear message pointing at this slice.
//
// When implementing, replace the makeStubAdapter call with the real
// QoderSkillScope class.

import type { SkillScopeAdapter } from '../types.js';
import { makeStubAdapter } from './_stub-helper.js';

export const QODER_SKILL_SCOPE: SkillScopeAdapter =
  makeStubAdapter('qoder', 'slice-025.5-qoder', 'Qoder');