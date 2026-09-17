---
name: a-claim-stronger-than-the-code-is-a-defect-even-when-the-content-claim-underneath-it-holds
description: A claim stronger than the code is a defect even when the content claim underneath it holds
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/txt/handoff.md
---

"The inspection path is read-only" was written, tested, and believed — but opening a WAL SQLite database read-only still CREATES `-shm`/`-wal` sidecar files, so the test asserting "no sidecars" could only pass because its fixture used `journal_mode = delete` while production uses WAL. The database CONTENT was genuinely untouched (sha256/mtime/rows identical across three runs), so the substantive claim survived; the overstated sentence did not. **How to apply:** state the precise scope ("no database content is modified; opening a WAL database still materialises sidecar files") and make the test fixture match the production configuration, or the assertion is structurally unable to fail. Three independent reviewers confirmed this, and a QA control written to the strong claim would have false-failed on a legitimate run.
