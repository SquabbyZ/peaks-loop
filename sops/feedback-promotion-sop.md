# Feedback-Promotion SOP (v2.15.0 slice 002, AC-3)

> A user-given rule is only as durable as the layer that enforces it.
> `.peaks/memory/<feedback>.md` is advisory (LLM-readable). The peaks-loop
> enforcement layers are mandatory (machine-enforced). This SOP closes the
> gap by **requiring** every feedback memory to be promoted to at least one
> enforcement layer within the slice that introduced it.

## 1. Trigger

A feedback memory is any `.peaks/memory/<name>.md` whose frontmatter has:

```yaml
metadata:
  type: feedback
```

or whose frontmatter top-level `type:` field is `feedback` (legacy form).
Both forms are accepted by the scanner.

## 2. Enforcement layers (pick at least one)

| Option | Layer | File / surface | When to pick |
|---|---|---|---|
| **A** | `peaks-sop` gate | append to `sops/*.md` and reference from a new `peaks sop` check | the rule is procedural — "do X then verify Y", or "ask before Z" |
| **B** | `peaks-hooks` PreToolUse hook | append a matcher to `.peaks/.claude-settings-template.json` (and reinstall) | the rule must intercept a tool call (Bash, Edit, Write, etc.) before it lands |
| **C** | `hardFloorCategory` in `mode-gate.ts` | extend `HardFloorCategory` + `shouldPauseAtGate` | the rule ALWAYS pauses regardless of mode (irreversible, credential, commit-boundary, etc.) |

For the v2.14.0 release feedback "full-auto boundary = commit only", the
correct promotion was Option C (a new `'commit-boundary-side-effect'`
hard-floor category — see AC-4).

For the v2.15.0 release feedback "sticky-mode must re-ask", the correct
promotion was a combination of Option A (this SOP), Option B (no hook
needed, but the CLI flow surfaces staleness), and a new presence primitive
(see AC-1 + AC-2). When the rule spans multiple layers, promote to ALL
of them — not "at least one".

## 3. CLI surface

### 3.1 `peaks feedback promote <memory-file>`

Reads `.peaks/memory/<file>.md`, parses the frontmatter, prompts the user
(or the LLM in --json mode) to choose an enforcement layer, generates the
code stub, and writes the promotion envelope to
`.peaks/_runtime/<sid>/rd/feedback-promote-<name>.json`.

```bash
# Interactive:
peaks feedback promote 2026-06-28-full-auto-boundary.md

# Non-interactive (CI / sub-agent):
peaks feedback promote 2026-06-28-full-auto-boundary.md --layer C --json

# Dry run (preview the stub without writing):
peaks feedback promote 2026-06-28-full-auto-boundary.md --layer C --dry-run --json
```

### 3.2 `peaks feedback check-unpromoted --project <path>`

Scans `.peaks/memory/*.md`, finds `metadata.type === 'feedback'` entries
without an enforcement-layer reference, and emits a structured warning
list. Defaults to dry-run (lists the unpromoted feedback but does not
fail). Pass `--strict` to fail with exit code 1 — used by
`peaks workflow verify-pipeline` Gate H.

```bash
# List only:
peaks feedback check-unpromoted --project . --json

# Strict (fail on any unpromoted feedback):
peaks feedback check-unpromoted --project . --strict --json
```

## 4. Promotion envelope shape

The RD envelope written to `.peaks/_runtime/<sid>/rd/feedback-promote-<name>.json`:

```json
{
  "name": "2026-06-28-full-auto-boundary",
  "feedbackPath": ".peaks/memory/2026-06-28-full-auto-boundary.md",
  "layer": "C",
  "layerDetail": "hardFloorCategory:commit-boundary-side-effect",
  "generatedFiles": [
    "src/services/solo/mode-gate.ts",
    "tests/unit/services/solo/commit-boundary-hard-floor.test.ts"
  ],
  "promotedAt": "2026-06-28T12:00:00.000Z",
  "promotedBy": "peaks-rd (slice 002 / v2.15.0)"
}
```

## 5. Gate H in `peaks workflow verify-pipeline`

`verify-pipeline` adds a new gate after the existing evidence gates:

```
Gate H "feedback-promotion"
  - Run: peaks feedback check-unpromoted --project <path> --strict
  - Pass condition: exit code 0
  - Fail condition: exit code 1 (any unpromoted feedback found)
  - Detail field: list of unpromoted feedback file names
```

This makes "leave a feedback memory unpromoted" a hard fail in
RD-handoff verification. LLM-driven workflows cannot ship a slice that
introduces new feedback without promoting it.

## 6. Back-compat / escape hatches

- **`--strict` is opt-in** at the CLI level. By default `feedback
  check-unpromoted` is a soft warning (exit code 0). The strict flag
  is what Gate H uses.
- **Legacy feedback** (memory written before this SOP shipped) is NOT
  retroactively required to be promoted. The SOP only applies to
  feedback memories created in slices >= 2.15.0. The scanner can be
  filtered with `--since-version 2.15.0` (not yet implemented; tracked
  as a follow-up).

## 7. Why this matters (defect B from PRD-002)

User-given rules written only to `.peaks/memory/` are advisory. The LLM
may "hope to read" them next session, but nothing forces it to. By
promoting feedback to a gate / hook / SOP, the rule becomes machine-
enforced — it survives session restarts, sub-agent dispatch, and the
LLM's tendency to forget.

The full-auto-boundary defect (v2.14.0 release) is the canonical
example: the rule "full-auto = commit only" was written to memory, but
the LLM (in this case, an automated slice ship) still pushed + tagged
+ attempted npm publish. The promotion to a `hardFloorCategory`
(Option C, this slice's AC-4) makes the next occurrence impossible
without an AskUserQuestion round-trip.
