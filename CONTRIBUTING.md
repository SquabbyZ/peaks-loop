# Contributing to peaks-cli

Thanks for your interest. This document covers the contribution
workflow, project conventions, and quality gates. The shorter answer
for "how do I get started" lives in the README.

---

## Architecture: skill-first, CLI-auxiliary

peaks-cli's product is a family of **skills** (SKILL.md files the LLM
consumes), not a fleet of CLI commands. CLI commands earn their place
only when at least one of these is true:

1. The action must be invokable from a hook / script / CI.
2. The action must produce a structured JSON envelope a skill reads
   back to gate a downstream decision.
3. The action is a destructive side effect that needs an explicit
   `--apply` opt-in.
4. The action is a machine-enforced gate that prose cannot enforce.

If none of (1)(2)(3)(4) holds, encode the behaviour in the relevant
skill's SKILL.md instead. See `.claude/rules/common/dev-preference.md`
(project-local) for the operating tenet and decision template.

---

## Branch workflow

Two branches:

- `main` — release branch. Tagged releases live here. **Never commit directly.**
- `develop` — integration. All feature branches merge here first.
- `feature/<topic>` / `fix/<topic>` / `chore/<topic>` — short-lived
  off `develop`, merge back into `develop` with `--no-ff`.

```
feature/foo ──┐
fix/bar ──────┼──> develop ──(release)──> main
chore/baz ────┘
```

---

## Commit messages

Conventional Commits, no AI co-author trailer:

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

**Author and committer must come from your global gitconfig**
(`git config --global user.name` / `user.email`). Do not set per-repo
overrides, env-var identities, or AI co-author trailers. See
`.claude/rules/common/dev-preference.md` for the rationale.

---

## TDD red lines

- Every behaviour change ships with tests written **before** the
  implementation (RED → GREEN → REFACTOR).
- Minimum 80% test coverage on changed code (statements + lines).
  100% branch coverage is the aspirational target; document
  defensible gaps in commit messages.
- The full test suite (`npx vitest run`) must be green before any
  commit. `npx tsc --noEmit` must be clean.

---

## Dogfood gate

Every adjustment, iteration, or fix MUST be dogfood-verified in the
current project before being declared complete. Unit tests verify
the shape of behaviour; dogfood verifies the effect in the system
the user actually uses. See `.claude/rules/common/dev-preference.md`
for the full dogfood protocol.

For changes touching the upgrade umbrella, end-to-end dogfood on at
least one real 1.x consumer project (not just synthetic temp dirs)
is required.

---

## Pull-request checklist

Before requesting review:

- [ ] All tests pass (`npx vitest run`).
- [ ] Typecheck clean (`npx tsc --noEmit`).
- [ ] Build clean (`npm run build`).
- [ ] CHANGELOG entry added if the change is user-visible.
- [ ] No hardcoded secrets, no AI co-author trailers, no per-repo
      git identity overrides.
- [ ] Dogfood evidence in the PR body (or commit message) for any
      behaviour change.

---

## Repository layout

```
src/                  TypeScript source (compiled to dist/)
  cli/commands/         Commander.js CLI surfaces
  services/             Pure-function services (the CLI is a thin wrapper)
  shared/               result envelope, helpers
tests/unit/           Vitest unit tests (mirrors src/ layout)
skills/               SKILL.md family (the primary product surface)
scripts/              postinstall, sync-version, watch, clean-dist
docs/                 UPGRADING-2.0.md, design notes
openspec/changes/     in-flight proposals (archive/ for completed)
.peaks/               peaks-cli's own workspace (dogfood, NOT shipped)
.claude/rules/        project-local rules (extend ~/.claude/rules)
```

---

## Releasing

Releases follow the `develop → main` flow described above. Tag on
`main` after the merge:

```bash
git checkout main
git merge --no-ff develop -m "release: v<N.N.N>"
git tag -a v<N.N.N> -m "<headline>"
git push origin main --tags
npm publish  # only when explicitly authorized
```

`npm publish` is **manual and explicit** — automation must never
publish on behalf of a human.

---

## Questions

Open a GitHub issue or read `CHANGELOG.md` + `docs/UPGRADING-2.0.md`
for the most common questions.
