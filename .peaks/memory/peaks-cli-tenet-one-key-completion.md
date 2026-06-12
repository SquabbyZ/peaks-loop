---
name: peaks-cli-tenet-one-key-completion-and-minimal-user-operation
description: Two paired tenets for peaks-cli design — (1) one-key completion, no second step required; (2) features can be powerful but the user-facing surface should be minimal, the LLM/CLI figures things out.
metadata:
  type: rule
---

> Source: peaks-cli repo, user-stated principle 2026-06-11 late session (smallMark).
> Scope: applies to every peaks-cli design decision — new CLI commands, new skill surfaces, new auto-detect paths, new umbrella commands, new postinstall hooks.
> Reading: read this before designing any user-facing surface in peaks-cli.

## Tenet 1 — One-key completion

> **能一键完成的不要设计第二步操作；理想目标一键完成。**
> ("Things that can be done in one step should not be designed as
> a two-step operation; the ideal goal is one-key completion.")

Anti-pattern: `npm i -g peaks-cli` → then `peaks upgrade --to 2.0`
(two steps the user has to remember).
Pattern: `npm i -g peaks-cli@2.0` — the postinstall does the
upgrade (1.x → 2.0 detection + auto-migrate) so the user only
runs one command.

## Tenet 2 — Minimal user operation (paired with #1)

> **功能可以很强，但是交给客户实际操作的越少越好。**
> ("Features can be powerful, but the less the customer actually
> has to operate, the better.")

Anti-pattern: a CLI that exposes 12 flags for "the user should
configure this themselves". Pattern: a CLI with 1-2 flags +
sensible defaults + auto-detect. The power is there, but the
user doesn't have to invoke it.

## Why

The product is the **workflow**, not the tool. If the user has
to remember and execute multi-step procedures, they will:
- Skip steps ("I'll just do it manually")
- Make mistakes (out-of-order operations break invariants)
- Avoid the product ("too complicated, I'll use a different tool")
- Get stuck when one step fails (don't know how to recover)

A real Trae user gave product feedback in 2026-06-11: the 1.x
postinstall did not symlink peaks-* skills to Trae's skill
directory (it only symlinked to the auto-detected single IDE).
The user also stated they "just run `npm i -g peaks-cli` and
nothing else". These two pieces of feedback crystallized the
two tenets above.

## Inverse rule (cross-reference)

- **"Skill is primary, CLI is auxiliary"** (per `dev-preference.md`)
  governs the LLM's reasoning about which surface to invoke.
  The two new tenets govern the *user's* surface — both
  must be one-key and minimal.
- **"Default-no on new CLI commands"** (per `dev-preference.md`)
  applies to the LLM's perspective: don't add CLI commands
  unless (1)(2)(3)(4) holds. The two new tenets apply to
  the user's perspective: the commands that DO ship should
  be one-key and minimal.

## How to apply (checklist for new peaks-cli features)

Before merging any new user-facing surface, verify:

1. **One-key**: can the user accomplish this with a single
   command? If not, fold the second step into the first
   (postinstall hook, auto-detect, auto-configure).
2. **Minimal surface**: does the surface have ≤ 2-3 flags?
   If more, the user is operating too much.
3. **Sensible defaults**: are the defaults correct for 99% of
   users? If a user has to read docs to set a flag, the
   default is wrong.
4. **Auto-detect first**: does the CLI/LLM detect the project
   state, IDE, platform, and config before asking the user?
   The user should never have to tell peaks-cli something it
   could discover.
5. **Silent on success**: when the operation succeeds, print
   the minimum (one line). When it fails, print the minimum
   needed to debug. Verbose `--verbose` is opt-in.

## Examples (in this repo)

| Surface | Two-step anti-pattern | One-key pattern (post-2.0) |
|--------|----------------------|---------------------------|
| 1.x → 2.0 upgrade | `npm i -g peaks-cli` → `peaks upgrade --to 2.0` | `npm i -g peaks-cli@2.0` (postinstall auto-detects + auto-upgrades) |
| Trae skill symlink | (1.x bug) postinstall only symlinked to auto-detected IDE | postinstall iterates all 8 platforms (`SYNC_PLATFORMS`) |
| 1.x → 2.0 verbose docs | user reads `UPGRADING-2.0.md` then runs 7 sub-commands | postinstall does the 7 sub-commands; user reads the doc only on failure |
| L2 audit invocation | user runs `peaks audit red-lines` then `peaks audit static` | `peaks slice check` stage 6 invokes both + reports aggregate (one command) |

## Cross-reference

- `dev-preference.md` (`.claude/rules/common/dev-preference.md`) —
  the original "skill is primary, CLI is auxiliary" tenet. The
  two new tenets are paired: the original governs the LLM's
  surface choice, the new ones govern the user's surface
  friction.
- `peaks-cli-1-3-3-will-be-the-first-release-with-the-ide-adapter-layer.md`
  — 1.3.3 first introduced the 8-platform IDE-adapter layer;
  2.0 fixes the postinstall Trae bug that the layer could not
  paper over.

## Status (2026-06-11)

Captured. **Pending action**:
- [ ] Add the two tenets to `.claude/rules/common/dev-preference.md`
      as a new "minimal-user-operation" addendum.
- [ ] Reference in `peaks-solo/SKILL.md` Step 0 (or as a new
      step 0.5 alongside workspace init).
- [ ] Cross-reference from `docs/UPGRADING-2.0.md` (so users
      reading the manual fallback see the design rationale).
- [ ] Add a one-key-completion lint to the L2 audit catalog
      (P2-b extension: a new enforcer that scans new CLI
      commands for "two-step" anti-patterns).
