---
name: 2026-07-30-publish-yml-if-quoting
title: publish.yml step-level 'if:' expressions must be wrapped in double quotes
description: GitHub Actions parser rejects step-level if: expressions containing '||' mixed with string comparisons when they are not quoted. Symptom: workflow file fails validation with "Unexpected value 'permissions'" at the next sibling key. Locked 2026-07-30.
kind: feedback
---

# publish.yml step-level `if:` quoting requirement (locked 2026-07-30)

## Symptom

GitHub Actions workflow file fails validation immediately on push:

> Invalid workflow file: .github/workflows/publish.yml#L1
> (Line: 421, Col: 9): Unexpected value 'permissions'

The col-9 is the first letter of the sibling field (`permissions:`)
that comes after the step's `if:` predicate.

## Root cause

The parser sees an unquoted `if:` expression containing `||` mixed
with string-literal comparison (e.g.
`github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')`).
GitHub Actions requires step-level `if:` expressions that contain
`||` or `&&` to be wrapped in double quotes for unambiguous
delimitation. Without the quotes, the parser collapses the
subsequent sibling keys (`permissions:`, `env:`, `run:`) into the
same logical block, then flags the FIRST non-recognized sibling
as 'unexpected'.

## Why this stayed unfixed for 8 days

The original `peaks-loop` publish.yml (committed as `d41828b2`
on 2026-07-28 in the `feat(publish): add GitHub Release step`
slice) shipped with this bug. The reason it was not caught
earlier:

- The 'Create GitHub Release' step only fires on
  `workflow_dispatch` or a `v*.*.*` tag push.
- The local precheck (`peaks release precheck --project .`)
  runs only the in-tree gates; it does NOT validate
  publish.yml via the GitHub Actions API.
- Tag pushes for 4.0.0-beta.N (runs #75, #76) succeeded
  because the publish step (which comes BEFORE the
  'Create GitHub Release' step in the job graph) ran
  fully. The 4.0.0 GA push (run #94) was the FIRST
  time the publish step's failure was visible because
  we were watching the run interactively.

## Fix (corrected 2026-07-30 after run #95)

Two-part fix; quoting alone is not enough:

1. **Quote the `if:` expression** (handles `||` / `&&`
   operator parsing):
   ```yaml
   if: "github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')"
   ```
2. **Put `permissions:` BEFORE `if:` in the step block.**
   The GitHub Actions parser refuses the order
   `if: ... / permissions: ...` (it treats the `if:` value
   as spanning the next sibling key and then flags that
   sibling as 'Unexpected value'). The reverse order
   `permissions: / if: ...` parses cleanly.

   Final shape:
   ```yaml
   - name: Create GitHub Release
     permissions:
       contents: write
       id-token: write
     if: "github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')"
     env: ...
   ```

The quoting alone (commit b7ac90ca) was NOT sufficient —
run #95 still failed with the same 'Line: 421, Col: 9'
error. The field-order fix (commit pending) is what
unblocks the workflow. Both commits are needed.

This is a no-op semantically — the expression's truth
value and the permission scopes are identical.

## How to apply (future iterations)

1. **Local precheck needs a GitHub Actions schema validator.**
   Today `peaks release precheck` only mirrors the 4-layer
   local gates. It does NOT call `gh api repos/{owner}/{repo}/actions/workflows/{file}/runs` to
   pre-validate the YAML. A future slice (post-4.0.0) should
   add a 5th layer: `peaks release precheck --strict` should
   also call the GitHub API's workflow lint endpoint and
   refuse to print `ok` if the workflow file fails
   server-side validation.
2. **Always quote step-level `if:` expressions that contain
   `||` or `&&`.** Single-token `if: always()` or
   `if: failure()` does not need quoting, but anything
   compound does.
3. **Test the publish path on the FIRST GA push, not the
   first GA *commit*.** The 4.0.0 GA itself was the first
   real GA push in this repo. Beta-N pushes had different
   failure modes (gate-changeset, version-skip) that masked
   the YAML parser issue.
4. **Watch the GitHub Actions UI, not just `peaks release
   precheck`.** Precheck is the local mirror; the GitHub
   server is the source of truth. The 4-layer gate cannot
   see GitHub's own parser.

## Cross-references

- `peaks-loop-publishing-critical-hard-rules.md` — the
  chicken-egg / version-skip / OIDC critical rules
- `2026-07-30-4-0-0-ga-release-flow.md` — the 6-step
  release flow this YAML bug broke on step 6 (push)
- `2026-07-30-test-rebuild-epic-sediment.md` — sibling
  epic; the 219 cases 4 packages full-suite
