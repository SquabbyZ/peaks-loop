---
name: a-single-measurement-of-a-host-sensitive-command-is-not-a-fact-about-the-command
description: A single measurement of a host-sensitive command is not a fact about the command
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-24-session-b714c7/txt/handoff.md
---

Four measurements of one `pnpm build` on this repo spread **8.89 s – 14.2 s** (~60 %): `8.89 s → 11 153 ms →
13 731 / 14 178 ms → 9277 / 8909 / 8946 ms`, from three different agents. No `tsbuildinfo` exists and `clean-dist`
wipes `dist/`, so all four did the same work — this is host variance, not measurement error. Two consequences:

- Quote a **range** (≈9–14 s, load-dependent), never a single figure, in anything permanent.
- The intermediate "≈11–14 s" range was **itself wrong**, because it *excluded* 8.89 s — a value that then
  reproduced 3 times out of 3 on a quiet host. Narrowing a range around the measurements you happen to have is
  still over-claiming.

Recorded in `.peaks/docs/backlog.md` §2.13. The same axis produced a second warning that session: three competent
measurements of one import count (190 / 192 / 195) disagreed, and those numbers were **dropped rather than pinned**
— a permanently-reproducible wrong number is worse than no number.
