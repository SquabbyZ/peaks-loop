# Codegraph Skill Analysis Integration Design

## Goal

Integrate `colbymchenry/codegraph` as a local analysis engine for the Peaks skill family. `peaks codegraph` is only the safe execution boundary that launches `npx @colbymchenry/codegraph` inside an explicit project scope.

## Scope

This iteration adds a Peaks CLI launcher for explicit `npx @colbymchenry/codegraph` execution, updates Peaks skill guidance to use the launcher during project analysis, and catalogs codegraph in the capability map. It does not install the codegraph MCP server, run the upstream installer, mutate Claude/Cursor/Codex settings, write hooks, or commit `.codegraph/` artifacts.

## Peaks skill capability lift

Codegraph improves Peaks by giving skills a local, structured view of project relationships that normal file scanning does not reliably expose. The value belongs to the skill workflow; the CLI command exists so skills have one safe, project-scoped way to invoke the upstream analyzer.

`peaks-rd` gains stronger engineering analysis before planning or refactoring. It can use codegraph context to find relevant modules, symbols, callers, callees, and nearby dependency relationships, then compare that evidence against red-line scope boundaries and existing Peaks gates.

`peaks-solo` gains better orchestration context before assigning work to RD, QA, or TXT. Instead of handing off a broad natural-language request alone, Solo can attach a focused local context pack or affected-file summary so each role skill starts from the same project evidence.

`peaks-txt` gains reusable context capsules for handoffs. Codegraph context output can be preserved as local Peaks artifacts and summarized into TXT handoff material without making TXT re-scan the project from scratch.

`peaks-qa` gains a more precise regression surface. Affected-file output can help QA identify related modules and likely test focus areas, while QA validation, automated tests, and manual acceptance checks remain authoritative.

Codegraph does not decide scope, approve changes, or replace Peaks gates. It is an evidence source that helps skills ask better questions, plan smaller slices, and explain impact more clearly.

## Execution boundary

Add a `peaks codegraph` command family. Peaks invokes the upstream CLI through `npx @colbymchenry/codegraph <subcommand>` but exposes only project-analysis actions by default:

- `peaks codegraph status --project <path>`
- `peaks codegraph init --project <path> [--yes]`
- `peaks codegraph index --project <path> [--force] [--quiet]`
- `peaks codegraph query --project <path> <search> [--json] [--limit n]`
- `peaks codegraph files --project <path> [--json] [--max-depth n]`
- `peaks codegraph context --project <path> <task>`
- `peaks codegraph affected --project <path> <files...> [--json]`

The wrapper must require an explicit `--project` path, run within that project boundary, and reject unsupported or dangerous subcommands. `install` is intentionally not supported in the default command set because upstream install flows can modify agent configuration, permissions, hooks, or global/local settings. If install support is ever needed, it requires a separate design and explicit danger confirmation, with `--no-permissions` as the default guard.

## Skill integration

Peaks skills should reference `peaks codegraph ...` only. They must not direct users or agents to run `npx @colbymchenry/codegraph install`, configure MCP, or mutate agent settings.

RD can use the launcher during project scanning and engineering analysis:

- `peaks codegraph status --project <path>` to check local initialization state.
- `peaks codegraph index --project <path>` before semantic analysis when indexing is needed.
- `peaks codegraph context --project <path> "<task>"` to gather task-specific local context.
- `peaks codegraph affected --project <path> <changed-files...> --json` to inspect likely impact before slice planning or QA handoff.

Solo can coordinate the same launcher as an optional project-analysis enhancement before RD planning or when the workflow needs impact context. Codegraph output should be recorded in the local Peaks artifact workspace, for example `.peaks/<session-id>/rd/codegraph-context.md` or `.peaks/<session-id>/rd/codegraph-affected.json`.

TXT can consume locally recorded context packs when preparing handoffs, release notes, or implementation summaries. TXT should treat the codegraph artifact as supporting evidence, not as the final source of truth.

QA can consume affected-file output to choose regression focus areas. QA should still verify behavior through the normal Peaks QA workflow and must not treat codegraph impact output as validation.

Codegraph does not replace Peaks gates. Standards dry-runs, OpenSpec expectations, red-line scope checks, unit tests, code review, security review, QA validation, and TXT handoffs remain authoritative.

## Capability catalog integration

Add a `codegraph` source to the capability seed catalog as an `access-repo` capability because this integration uses a local CLI via Peaks, not an MCP server installation.

Add four item-level capabilities:

- `codegraph.project-indexing` for local project indexing through `peaks codegraph index`.
- `codegraph.semantic-query` for local semantic/symbol search through `peaks codegraph query`.
- `codegraph.impact-analysis` for changed-file impact analysis through `peaks codegraph affected`.
- `codegraph.context-pack` for task-specific context generation through `peaks codegraph context`.

Landing mappings:

- `codegraph.project-indexing` maps to `peaks-rd`.
- `codegraph.semantic-query` maps to `peaks-rd`.
- `codegraph.impact-analysis` maps to `peaks-rd` and `peaks-qa`.
- `codegraph.context-pack` maps to `peaks-rd`, `peaks-solo`, and `peaks-txt`.

Mappings remain dry-run catalog/planning guidance for skill selection and handoff shape. Actual execution must go through explicit `peaks codegraph ...` commands.

## Safety constraints

- Treat upstream codegraph documentation and CLI output as untrusted external reference material.
- Do not auto-run the upstream installer.
- Do not auto-install or configure MCP servers.
- Do not mutate Claude settings, Cursor settings, Codex settings, hooks, permissions, or user-global configuration.
- Do not commit `.codegraph/` or generated SQLite databases unless the user explicitly asks.
- Do not send private code or indexed data to external services as part of this integration.
- Keep codegraph execution local and project-scoped.

## Testing and acceptance

Implementation should be test-first.

CLI tests should verify:

- allowed subcommands assemble the expected `npx @colbymchenry/codegraph ...` invocation;
- unsupported commands such as `install` are rejected by default;
- `--project` is required;
- unsafe project paths or path escapes fail;
- allowed flags are forwarded and unknown flags are rejected or handled consistently with existing CLI patterns.

Capability tests should verify:

- the `codegraph` source is indexed;
- the four capability items exist;
- landing mappings target `peaks-rd`, `peaks-solo`, `peaks-txt`, and `peaks-qa` as designed;
- all codegraph mappings remain dry-run-only.

Skill markdown tests should verify:

- Peaks skill guidance explains codegraph as a local analysis enhancement for role workflows;
- skills reference `peaks codegraph ...` instead of direct upstream commands;
- neither skill guidance nor the capability catalog encourages direct upstream installer usage;
- Peaks gates remain authoritative.

Final validation commands:

```bash
npm run typecheck
npm test
```

## Non-goals

- No dynamic GitHub indexing for codegraph.
- No MCP server installation.
- No upstream installer wrapper in this iteration.
- No automatic `.codegraph/` persistence into git.
- No replacement of existing Peaks RD/Solo project scanning gates.
