// ---------------------------------------------------------------------------
// Thin back-compat shim.
//
// The original 1032-line project-memory-service.ts was split on 2026-07-26
// (rid-003) into the `./project-memory-service/` submodule:
//
//   - parsers/frontmatter.ts          — YAML frontmatter parse + render
//   - parsers/markdown-pure.ts        — extract / summarize (pure)
//   - store/paths.ts                  — project-root + memory-dir safety
//   - store/atomic-write.ts           — sensitive content + write helpers
//   - index/search.ts                 — read-side enumeration + bootstrap
//   - index/ranking.ts                — index.json generation + mtime guard
//   - index/kind-dispatch.ts          — extract / backup / session dispatch
//   - index.ts                        — public facade
//
// This file re-exports the entire facade so every existing import path
// (`from '../memory/project-memory-service.js'`) keeps compiling and
// behaving identically. New code should import from the submodule directly.
// ---------------------------------------------------------------------------

export * from './project-memory-service/index.js';