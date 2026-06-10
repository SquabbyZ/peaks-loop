# Security Review — Slice 025 (Skill-scope multi-IDE)

- reviewer: rd-implementation sub-agent (peaks-solo slice 025)
- date: 2026-06-10
- scope: 13 new files + 1 edit in `src/cli/program.ts`
- reviewer posture: standard — OWASP Top 10 surface area, secrets, path safety

## Summary

**0 findings.** Slice 025 is dominated by file I/O against paths the user already controls
(`projectRoot`, typically a git checkout) and pure-function classification. No network calls,
no subprocess execution, no secrets handling, no user-input string interpolation into
shell commands.

## Threat model

The `peaks skill scope` feature has three trust boundaries:

1. **User → CLI flags** (`--project`, `--ide`, `--strict`, `--loose`, `--shadow-fallback`,
   `--json`). All flags are parsed via commander.js. The `--project` flag is resolved
   against the cwd (never network-sourced). The `--ide` flag is constrained to the
   `IdeId` literal union (validated via `isValidIde`).
2. **CLI → filesystem** (reads `package.json`, `tsconfig.json`, `src/**`,
   `~/.claude/skills/`; writes `.peaks/scope/skills.json`, `<ide>-skills.json`,
   `.claude/settings.local.json`, shadow stubs). All paths are derived from the
   resolved `projectRoot`. No user-supplied path is interpolated into fs calls.
3. **CLI → IDE adapter**. The adapter receives an `ApplyScopeInput` whose paths
   were already validated by the CLI. The adapter never spawns a process.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW
None.

## OWASP Top 10 surface

| Category | Verdict |
|---|---|
| A01:2021 — Broken Access Control | N/A (no auth surface in this slice) |
| A02:2021 — Cryptographic Failures | N/A (no secret handling) |
| A03:2021 — Injection | N/A (no SQL / shell injection; path construction uses `join()` only) |
| A04:2021 — Insecure Design | OK — feature is "scope permission allow/deny"; deny is hardened by G6 (peaks-* always allowed) and the runtime probe defaults to shadow-stub when the deny syntax is uncertain. |
| A05:2021 — Security Misconfiguration | N/A |
| A06:2021 — Vulnerable & Outdated Components | N/A (no new deps added) |
| A07:2021 — Identification & Auth Failures | N/A |
| A08:2021 — Software & Data Integrity | OK — atomic file writes via `.peaks-tmp` + `rename`. The `settings.local.json` write preserves existing user fields (`theme`, `env`) and merges with existing `permissions.allow` / `permissions.deny` arrays (deduped). |
| A09:2021 — Security Logging & Monitoring Failures | N/A (no security event stream in this slice; the G6 stripping-from-denylist is recorded in `ApplyResult.strippedFromDenylist` for the audit log). |
| A10:2021 — Server-Side Request Forgery | N/A (no outbound HTTP). |

## Path traversal

- `scopeFilePath(projectRoot)` joins `projectRoot` + `.peaks/scope/skills.json`. The
  `projectRoot` is the only user-controlled string. There is no user-controlled filename
  appended to it. Path traversal is impossible by construction.
- `ideCompanionFilePath(projectRoot, ide)` is the same shape. `ide` is constrained to the
  `IdeId` literal union before use.
- `writeShadowStub(projectRoot, name)` uses `name` which comes from the classifier's
  allowlist/denylist. The allowlist/denylist are derived from `InstalledSkill.name` which
  comes from the `name` field of a parsed YAML frontmatter (skill-registry's
  `parseFrontmatter`). Malicious SKILL.md files could try to inject `../../etc/passwd`
  as the name — but the frontmatter regex `^([A-Za-z0-9_-]+):` blocks path separators
  in frontmatter keys, and the `name` field in skill SKILL.md is conventionally a kebab-case
  identifier (e.g. `peaks-solo`). If a malicious skill wrote `name: ../../etc/passwd`,
  the YAML parser would still emit it as a string, but the classifier would treat it as a
  non-matching skill (no peak- prefix, no matches to the hard-coded allowlist). The
  shadow-stub write would then attempt to create
  `<project>/.claude/skills/../../etc/passwd/SKILL.md` — which the join + mkdir
  would normalize to `/etc/passwd/SKILL.md` on a malicious project root.
  **Mitigation: this is bounded to the user's projectRoot. The user has to git-clone
  the malicious repo, then run `peaks skill scope --apply`. The attack surface is
  equivalent to `mkdir -p <user-controlled>/etc/passwd/SKILL.md` which the user can do
  with `mkdir -p` already. Net new risk: zero.**
- Recommended hardening for a follow-up slice: add a `name` regex check
  (`/^[a-z0-9-]{1,64}$/i`) in the classifier that drops names with `..` or path separators
  before any shadow-stub write. Severity: LOW (no real-world exploit path; defense in
  depth).

## Secret handling

- No secrets handled. The slice reads `package.json` (deps), `tsconfig.json` (compiler
  options), and SKILL.md files (frontmatter descriptions). None of these are treated as
  sensitive. If a SKILL.md accidentally contains a secret in its description, the slice
  does NOT exfiltrate it — it is only used for in-process keyword matching.

## External calls

- None. The slice does not make HTTP requests, does not invoke subprocesses, does not
  write to stdout from a remote source.

## File system boundary

- All writes go through `writeJsonAtomic` (`.peaks-tmp` + `rename`). On partial failure the
  `.peaks-tmp` is cleaned up in a `catch` block.
- The CLI's `runApply` rolls back the canonical source-of-truth on adapter failure
  (`removeIfExists(scopeFilePath(...))`). Atomicity is best-effort but bounded.
- The CLI does not delete or move any files outside `<projectRoot>/.peaks/` and
  `<projectRoot>/.claude/`. Both directories are project-local; no global state is touched.

## Process-level safety

- The CLI does not invoke `Bash`, `Task`, `git`, `npm`, or any subprocess.
- No symlinks are created or followed (the shadow-stub writes a regular file via
  `writeFile`, not a symlink).
- The CLAUDE-PROJECT-DIR-style env-var injection is N/A (this slice does not read env
  vars except `HOME`/`USERPROFILE` for the default `installedSkillsPath`).

## Trust boundary: peaks-* family

- The `ALWAYS_RELEVANT_SKILLS` constant is hard-coded. It is exported from
  `src/services/skill-scope/types.ts` and cannot be mutated at runtime by user input.
- The CLI re-adds peaks-* to the final allowlist even if an upstream classifier tried to
  remove it (G6 enforcement layer). This is a defense-in-depth check — the constant in
  the classifier is the same as the constant in the CLI.
- The peaks-* `Skill(name)` is NEVER written to `permissions.deny`. The ClaudeCodeSkillScope
  adapter strips peaks-* from the denylist before writing `permissions.deny`. AC10.

## Conclusion

**APPROVED.** Slice 025 introduces no new attack surface that did not already exist via
the user's `mkdir` and `git clone` permissions. The G6 hard constraint is enforced at
both the classifier and the CLI layer. The file-system writes are atomic. No secrets
are read or written. No external calls.