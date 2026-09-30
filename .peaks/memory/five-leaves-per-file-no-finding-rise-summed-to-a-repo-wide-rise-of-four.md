---
name: five-leaves-per-file-no-finding-rise-summed-to-a-repo-wide-rise-of-four
description: Five leaves' per-file "no finding rise" summed to a repo-wide rise of four
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/txt/handoff.md
---

A ratchet that only bounds totals is blind to where the total came from, and a leaf verifying
its own two files cannot see a rise it introduced in a file it only imports from. Wave 3B
shipped seven unused-import errors in one afternoon: the split moved type declarations to a
sibling and left the parent IMPORTING them for re-export, so each re-exported name became an
unused import. Every leaf's scoped eslint reported zero findings - on the new files, which were
clean - while the parents gained.

Rule: hoisted types leave via a re-export that creates no local binding, never an import plus a
local re-export. And the whole-repo recount runs once after every wave, by the orchestrator, on
the converged tree - not assembled from per-leaf claims. When it blocked at 2875 against a
ceiling of 2871, the diagnosis cost one comparison against the baseline's per-file table.
