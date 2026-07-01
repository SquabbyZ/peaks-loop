---
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived
name: v2-11-0-window-orphan-path-stripping-bug
description: Investigated UserssmallMarkDesktoppeaks-cli orphan directory; root cause not pinpointed but candidate sources narrowed + no regression since 2026-06-26 12:55
metadata:
  type: investigation
---

# Path-Stripping Orphan — Investigation

**Date:** 2026-06-26
**Trigger:** User noticed `UserssmallMarkDesktoppeaks-cli/` directory in project root after v2.11.0 ship.

## Symptom

Untracked directory at project root:
```
C:\Users\smallMark\Desktop\peaks-loop\UserssmallMarkDesktoppeaks-cli\.peaks\
├── memory\
│   └── index.json
└── _runtime\
    └── active-skill.json
```

Created at `2026-06-26T12:55:39+08:00` — exactly 2 min 39 sec after Group A commit `2be2842` (12:53:00). Never modified after creation. Total size 2 KB.

## Path analysis

| Step | Value |
|---|---|
| Original absolute path | `C:\Users\smallMark\Desktop\peaks-loop` |
| Orphan directory name | `UserssmallMarkDesktoppeaks-cli` |
| Pattern | drive letter `C:` + backslash + colon + all `\` stripped → concatenated with `/` separator |

This looks like code that did:
```ts
const stripped = projectRoot.replace(/[C:\\]/g, '');
// 'C:\\Users\\smallMark\\Desktop\\peaks-loop' → 'UserssmallMarkDesktoppeaks-cli'
const target = path.join(cwd, stripped, '.peaks', 'memory', 'index.json');
// → cwd/UserssmallMarkDesktoppeaks-cli/.peaks/memory/index.json
```

## Investigation results

| Source file checked | Path-construction pattern | Verdict |
|---|---|---|
| `src/shared/path-utils.ts` | `normalizePath` does `replace(/\\/g, '/')` — converts backslash to forward slash, NOT strip-to-empty | Safe |
| `src/shared/path-utils.ts:resolveInputPath` | Returns normalized Windows path with forward slashes (not stripped) | Safe |
| `src/services/audit/red-lines-service.ts:231` | Template literal `${input.projectRoot}/.peaks/_runtime/session.json` | Safe (just join) |
| `src/services/memory/memory-search-service.ts:72` | `join(projectRoot, '.peaks', 'memory', 'index.json')` | Safe |
| `src/services/memory/project-memory-service.ts:552` | `assertSafeProjectMemoryDir(normalizedRoot)` then `join(memoryDir, 'index.json')` | Safe (resolves through realpath) |
| `src/services/skills/skill-presence-service.ts:263` | `writeFileSync(presencePath, ...)` where presencePath is joined from cwd | Safe |
| `src/services/memory/project-context-service.ts:24` | `projectRoot.split(/[\\/]/).pop()` — returns last segment `peaks-loop` (not full strip) | Safe |

**No source code currently does the `[C:\\]` strip pattern.**

## Most likely cause

Group A refactor (commit `2be2842`, 2026-06-26 12:53) introduced a session-bound path change. Within the 2-min 39-sec window before Group B started, an interactive test run or CLI invocation passed a `projectRoot` value that, when joined with `.peaks/memory/index.json`, produced the malformed path. The bug appears to have been **fixed in subsequent commits** (no orphan re-creation since 12:55:39).

## Resolution

- Deleted orphan directory (rm -rf, 2026-06-26)
- No .gitignore rule added — orphan was a one-time artifact from v2.11.0 work window; future occurrences would indicate an active regression and should be debugged differently
- If this orphan pattern recurs, grep for `replace(/[C:\\]` and `String(root).replace(...)` patterns in newly-touched source files

## Why this matters

If the v2.11.1 (slice-topology-observability) work introduces new path writers, the same bug pattern could recur. **Mitigation:** every new path-construction in `src/services/observability/*` MUST route through `getSessionDir(root, sid)` (per `session-dir-canonical-resolver-must-route-all-writes` memory) and use `path.join` / `path.resolve` — never `String.replace` on absolute paths.

## How to apply

When writing observability hooks for v2.11.1:
- ✅ `const path = getSessionDir(projectRoot, sessionId)` (canonical resolver)
- ✅ `const file = join(getSessionDir(...), 'metrics', 'slices.jsonl')` (path.join)
- ❌ `const file = projectRoot.replace(...) + '/.peaks/...'` (manual string manipulation)
- ❌ `const file = \`${projectRoot}/.peaks/...\`` (template literal — works for valid paths but fragile on Windows mixed-separator edge cases)