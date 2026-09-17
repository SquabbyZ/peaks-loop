---
name: a-package-at-a-wrong-absolute-path-silences-its-own-gate
description: A package at a wrong absolute path silences its own gate
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/sc/release-3-sidecars.md
---

`peaks codegraph status` was permanently green because `.codegraph/codegraph.db` was a SQLite WAL db, and opening it read-only still creates `.codegraph/{-shm,-wal}` sidecar files. AC4's `no-sidecars` assertion in tests used a `journal_mode = delete` fixture, so the assertion was structurally unable to fail. The no-sidecar claim survives on the content side (sha256/mtime unchanged) but the prose was stronger than the code; correct it to: "no database content is modified; opening a WAL database still materialises sidecar files."
