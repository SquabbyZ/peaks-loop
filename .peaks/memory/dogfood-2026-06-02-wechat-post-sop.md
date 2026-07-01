---
name: dogfood-2026-06-02-wechat-post-sop
description: Real-world dogfood of the 公众号发文 SOP (PRD 005 v2) on 2026-06-02. Confirms G4/G5/G6/G7 work end-to-end; surfaces a small but real "literal-word trap" finding worth flagging in SKILL.md.
metadata:
  type: feedback
---
<!-- peaks-feedback-promoted: layer=A -->
On 2026-06-02 I dogfooded a real wechat-style publishing SOP (`wechat-post-publish`, phases `draft → review → publish`, gates `no-todo` + `no-tktk` using `grep absent:true`) end-to-end against the peaks-loop repo's own `posts/2026-06-02-prd005-v2-dogfood.md` artifact. The four PRD 005 v2 UX fixes all worked as advertised:

- G4 grep absent: a draft with the literal word "T-O-D-O" gets blocked at `review → publish` with the reason `pattern "TODO" must be absent but was found in "..."`. Clean.
- G5 phase skip: trying to advance `null → publish` directly returns `SOP_PHASE_SKIP` with `next allowed: draft` and a `--allow-incomplete --reason` bypass hint.
- G6 init nextActions: `peaks sop init --apply` returns edit + lint next-actions without making the user grep the SKILL.md.
- G7 --project default cwd: `peaks sop registry` (no `--project`) from a repo root sees the project-layer SOP without any extra flag.

**One real bug-class surfaced (small but worth noting).** The first two times I tried to clear the draft and re-advance to `publish`, the `no-todo` gate still failed — because the *discussion* of the gate's behavior inside the same draft ("we use a `grep absent` gate for T-O-D-O", "reason string contains T-O-D-O") counted as a T-O-D-O occurrence. The author gets caught by their own explanation.

**Why:** This is a content-authoring UX corner of a tool that was originally framed around code-review gates. A code reviewer writing "fix the T-O-D-O in handler.ts" rarely triggers the same kind of self-reference; a content author writing a publish-checklist *about* the checklist will.

**How to apply:**
- For a content-publishing SOP, either (a) gate the file with a different name from the gate's pattern (rename the post so the discussion can't collide), or (b) gate on a specific stable token (e.g. an HTML comment `<!-- publish-blocker: TODO -->`) that the editor renders invisibly.
- This is a real finding but **not a code bug** — it's an authoring pattern. Worth a one-paragraph note in `skills/peaks-sop/SKILL.md` under "Where SOPs apply" or a new "Content-publishing dogfood learnings" subsection, not a code change in this iteration.
- The PRD 005 v2 slice stays closed; this feedback is for the next iteration if/when the user wants to harden content-domain SOPs further.

**Cross-references:**
- `[[custom-sop-and-gate-metering]]` — the "Next = dogfood custom SOP for usability gaps" pointer is now partially satisfied (PRD 005 v2 修复 dogfooded), but the literal-word trap is a residual gap to log.
- `[[coverage-red-line]]` — applies to any future code that touches the gate evaluator: do not add a "fix" that suppresses the literal-word match; the behavior is correct, the authoring pattern needs the workaround.
- `[[main-branch-iteration]]` — `posts/`, `.peaks/sops/`, and `.peaks/sop-state/` are working-tree additions in this dogfood run; the SOP manifest may be worth committing once it stabilizes.
