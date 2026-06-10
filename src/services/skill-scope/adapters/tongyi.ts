// TODO(slice-025.6-tongyi): research Tongyi Lingma's per-project skill
// scoping config format. Tongyi Lingma is an AI IDE by Alibaba; per-
// project config dir is unconfirmed at slice 025.1.
//
// Until the real format is known, this stub:
// 1. Writes `.peaks/scope/tongyi-lingma-skills.json` (source-of-truth)
//    on every `applyScope` so the user's intent is captured on disk.
// 2. Returns NOT_SUPPORTED with a clear message pointing at this slice.
//
// When implementing, replace the makeStubAdapter call with the real
// TongyiSkillScope class.

import type { SkillScopeAdapter } from '../types.js';
import { makeStubAdapter } from './_stub-helper.js';

export const TONGYI_SKILL_SCOPE: SkillScopeAdapter =
  makeStubAdapter('tongyi-lingma', 'slice-025.6-tongyi', 'Tongyi Lingma');