---
name: the-judged-declaration-resolves-its-paths-against-the-repository-root-not-the-session-directory
description: The judged declaration resolves its paths against the repository root, not the session directory
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23. `audit/security-<rid>.md` carries a `## Judged content` JSON block whose
`files[].path` entries are resolved by `src/services/audit-independent/judged-declaration-check.ts`
as `join(projectRoot, ...file.path.split('/'))` — the **REPOSITORY ROOT**.

The artifact contract's own text says the opposite: "Paths are relative to
`.peaks/_runtime/<session-id>/`". A producer that follows it literally writes
`rd/requests/006-<rid>.md`, and the gate answers `declared-path-gone` — even though the file
exists, at `<session>/rd/requests/006-<rid>.md`, and its sha256 matches to the byte.

The two spellings differ only in the prefix. `src/...` and `tests/...` are already repo-root-relative,
which is why four sibling slices passed their transitions and the fifth — the one whose only judged
files lived under the session runtime directory — did not. The fix is a prefix, not a rewrite:
declare `.peaks/_runtime/<session-id>/rd/requests/006-<rid>.md`.

**How to apply.** Every path in a `## Judged content` block is REPO-ROOT-RELATIVE. A file under the
session runtime directory needs the full `.peaks/_runtime/<session-id>/...` prefix.

The refusal vocabulary is worth keeping: `declared-path-gone`, `declared-path-modified` and
`undeclared-path-under-root` are the three codes that COMPLETED their observation and may therefore
say the tree and the declaration disagree. `declared-path-unreadable` is the fourth, and it is the
one where re-running the producer cannot help.
