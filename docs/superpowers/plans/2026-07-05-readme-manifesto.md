# peaks-loop README + README-en Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `README.md` and `README-en.md` to a 5-block Manifesto skeleton — hero (loop engineering + 战术小队 24 小时待命) → in-box (peaks-code 主官 + dev/bug/requirement) → sediment (战术套路 vs 招式) → install (npx 一行) → closing hook (peaks-code → peaks-code → peaks-loop).

**Architecture:** Two parallel files (zh + en), each ~70–95 lines. Same 5-block skeleton, content parallel-translated. Brand-first manifest, NOT an onboarding doc. No new files; no code changes; no spec-derived sub-files.

**Tech Stack:** Plain Markdown. No tooling beyond `git add / commit`.

---

## Global Constraints (copied verbatim from the spec §3.1, §3.2, §3.3)

- **Section line budgets** (per spec §3.1):

  | Section | Lines | Contains | Does NOT contain |
  |---|---|---|---|
  | Hero | 6–9 | Two layers: (a) what it is (assertion), (b) image overlay (squad on call). | Install commands. Version numbers. |
  | In-box capabilities | 8–12 | peaks-code named as lead, with 3 example use cases. A closing line that "其他内置 loop engineering 敬请期待". | Other 10 skill names — don't enumerate them in the README; mention peaks-code only. |
  | Sediment-your-own | 5–9 | One-line "how you sediment", followed by the contrast sentence. | Step-by-step CLI walk-through. |
  | Get it running | 3–4 | The npx line + optional video-demo link. | Walk-through prose. |
  | Closing hook | 3–5 | The rename arc. | Dates. Versions. Migration instructions. |

- **Voice rules** (per spec §3.2):
  - Plain words over jargon.
  - Sentence fragments OK.
  - **Metaphor discipline: "squad / 24/7" repeats at most twice per section.**
  - No emoji inside prose.
  - No CTA phrasing.
- **`peaks-code` placement** (per spec §3.3): only in in-box section, plus once in the closing hook because of the rename arc. **Not** in the hero.
- **Sediment contrast sentence — locked wording** (per spec §3.4):
  - zh: `你沉淀的是 loop engineering(战术套路),不是简单的 skill(动作招式)。`
  - en: `What you sediment is loop-engineering — a tactical play, not just a skill spell.`
- **No commit message contains** `Co-Authored-By: Claude`, `Co-Authored-By: Anthropic`, or any equivalent AI attribution trailer (CLAUDE.md red rule).

---

## File Structure (pre-task map)

| File | Action | Lines target |
|---|---|---|
| `README.md` | full rewrite | 70–95 |
| `README-en.md` | full rewrite | 70–95 |

No other files. No code, no spec diff, no test harness.

---

### Task 1: Write `README.md` (zh)

**Files:**
- Modify: `README.md` (full overwrite)

**Interfaces:**
- Consumes: spec §1.3 (5-block ordering), §3.1 (section contracts), §3.2 (voice rules), §3.3 (peaks-code placement), §3.4 (contrast sentence wording)
- Produces: `README.md` containing the 5 zh sections in order

**Section-by-section target content (zh, plain words, plain sentences, no install commands in the body):**

- [ ] **Step 1.1: Write the Hero section (zh)**

  Insert after the existing badges, replacing everything from "## 它是啥" downward:

  ```markdown
  ## 它是什么

  loop engineering 的工程实现。

  peaks-loop 就是你的 AI 战术小队,24 小时待命。召之即来,事完收队,不跳步,不半截扔给你。
  ```

  Rules:
  - First line is the assertion. Plain. No punctuation piled on.
  - Second block introduces the squad on call (24/7), uses it AT MOST twice across this section.
  - "不跳步,不半截扔给你" is the contrarian refusal — anchors the rest.

- [ ] **Step 1.2: Write the In-box capabilities section (zh)**

  Insert directly after Hero:

  ```markdown
  ## 装了你有什么战术角色

  先给你上的是 `peaks-code`,主官。

  它能做的:
  - 写长任务代码(端到端需求 → PRD → 实现 → QA)
  - 修 bug 当天发
  - 帮你做 / 接 / 拆长跑的需求

  其他内置 loop engineering,敬请期待。
  ```

  Rules:
  - peaks-code appears here ONLY (besides closing hook).
  - 3 bullets: development, bug-fix, long-task requirement — matches spec §1.3.
  - Closing line "其他内置 loop engineering,敬请期待" is the spec-mandated future-expansion hint.
  - **Do NOT list peaks-prd / peaks-rd / peaks-qa / etc.** Spec §3.1 explicitly bans enumerating other 10 skill names.

- [ ] **Step 1.3: Write the Sediment-your-own section (zh)**

  Insert after In-box:

  ```markdown
  ## 你也能沉淀自己的 loop engineering

  跑过一次还想跑,说一句话让它永久驻场。

  你沉淀的是 loop engineering(战术套路),不是简单的 skill(动作招式)。下次说"跑那只",整套流程自动就位。
  ```

  Rules:
  - The contrast sentence MUST be present verbatim: `你沉淀的是 loop engineering(战术套路),不是简单的 skill(动作招式)。`
  - No CLI walk-through.
  - No "type peaks skill sediment ..." examples.

- [ ] **Step 1.4: Write the Get-it-running section (zh)**

  Insert after Sediment:

  ```markdown
  ## 上号

  ```bash
  npx peaks-loop install
  ```
  ```

  (Use real markdown code fence, no extra lines.)

  Also include the optional video link as a one-liner under the code block — keep it ≤ 8 words:

  ```markdown
  顺手看一段 30 秒 walk-through:[`examples/video-demo/`](./examples/video-demo/)
  ```

- [ ] **Step 1.5: Write the Closing hook (zh)**

  Insert after Get-it-running:

  ```markdown
  ## 顺便说一句

  这玩意儿以前叫 `peaks-code`,后来改 `peaks-code`,现在叫 `peaks-loop`——一只小队,要长成你机器上天天替你出力的那群战术角色。
  ```

  Rules:
  - Rename history appears ONLY here.
  - No dates, no version numbers, no CHANGELOG cross-reference.

- [ ] **Step 1.6: Footer (zh)**

  Keep the existing footer (MIT License + SquabbyZ credit + skill/docs/CHANGELOG/Issues links) untouched. Do not rewrite it.

- [ ] **Step 1.7: Verify Readability**

  Run: `wc -l README.md`
  Expected: between 70 and 100 lines.

  Read the file top-to-bottom. Self-check:
  - peaks-code appears in exactly 2 places (in-box + closing hook).
  - "战术小队"/"24 小时" appears ≤ 2 times in Hero.
  - No emoji inside prose.
  - No `npx peaks-loop` in the body before "## 上号".
  - The contrast sentence is verbatim.

- [ ] **Step 1.8: Commit**

  ```bash
  git add README.md
  git commit -m "docs(readme): rewrite zh README to manifesto skeleton"
  ```

  Verify: `git log -1` shows the commit. No `Co-Authored-By:` trailer.

---

### Task 2: Write `README-en.md` (en) — parallel mirror of Task 1

**Files:**
- Modify: `README-en.md` (full overwrite)

**Interfaces:**
- Consumes: spec §3.4 (en contrast sentence) + Task 1's zh section structure
- Produces: `README-en.md` containing the 5 en sections in order

**Section-by-section target content (en, plain words, plain sentences, no install commands in the body):**

- [ ] **Step 2.1: Write the Hero section (en)**

  Insert after the existing badges:

  ```markdown
  ## What it is

  Loop engineering, engineered.

  peaks-loop is your AI tactical squad — on call 24/7. Summon them, they handle the work; stand them down when it's done. No skipped steps. No half-finished hand-offs.
  ```

- [ ] **Step 2.2: Write the In-box capabilities section (en)**

  ```markdown
  ## What's in the box

  First tactician on the roster: `peaks-code`. The lead.

  What it does:
  - Long-task development (end-to-end requirement → PRD → implementation → QA)
  - Fix a bug and ship the same day
  - Take on, break down, or hand off a long-running requirement

  More loop-engineering roles coming.
  ```

- [ ] **Step 2.3: Write the Sediment-your-own section (en)**

  ```markdown
  ## Sediment your own loop engineering

  When a flow has run twice, it can stay. One sentence and it's grounded into your box.

  What you sediment is loop-engineering — a tactical play, not just a skill spell. Next time you say "run that", the whole playbook slots back in.
  ```

  Rules:
  - The contrast sentence MUST be present verbatim: `What you sediment is loop-engineering — a tactical play, not just a skill spell.`

- [ ] **Step 2.4: Write the Get-it-running section (en)**

  ```markdown
  ## Get it running

  ```bash
  npx peaks-loop install
  ```

  Optional 30-second walk-through: [`examples/video-demo/`](./examples/video-demo/)
  ```

- [ ] **Step 2.5: Write the Closing hook (en)**

  ```markdown
  ## One more thing

  This used to be `peaks-code`. Then `peaks-code`. Now `peaks-loop` — a squad you grow into the team that runs your machine day in, day out.
  ```

- [ ] **Step 2.6: Footer (en)**

  Keep the existing footer (MIT License + SquabbyZ credit + skill/docs/CHANGELOG/Issues links) untouched.

- [ ] **Step 2.7: Verify Readability**

  Run: `wc -l README-en.md`
  Expected: between 70 and 100 lines.

  Self-check:
  - peaks-code appears in exactly 2 places.
  - "tactical squad"/"24/7" appears ≤ 2 times in Hero.
  - No emoji inside prose.
  - No `npx peaks-loop` in the body before "## Get it running".
  - The contrast sentence is verbatim.

- [ ] **Step 2.8: Commit**

  ```bash
  git add README-en.md
  git commit -m "docs(readme): rewrite en README to manifesto skeleton"
  ```

  Verify: `git log -1` shows the commit. No `Co-Authored-By:` trailer.

---

### Task 3: Cross-file coherence check

**Files:**
- Read: `README.md`, `README-en.md`

**Interfaces:**
- Consumes: both files from Task 1 + Task 2
- Produces: a green-light signal that the zh + en files are coherent mirrors of the same spec

- [ ] **Step 3.1: Section parity**

  Run: `grep -E '^## ' README.md` and `grep -E '^## ' README-en.md`.
  Expected: the same number of `## ` headings, same order. Allow the en version's section names to differ from the zh version's (e.g., "它是什么" vs "What it is"); the COUNT and ORDER should match (5 headings each after the badges).

- [ ] **Step 3.2: peaks-code placement parity**

  Run: `grep -c 'peaks-code' README.md` and `grep -c 'peaks-code' README-en.md`.
  Expected: each returns `2` (in-box section + closing hook).

- [ ] **Step 3.3: Contrast sentence presence**

  Run: `grep -F '你沉淀的是 loop engineering' README.md` — expect 1 match (the locked zh sentence).
  Run: `grep -F 'What you sediment is loop-engineering — a tactical play' README-en.md` — expect 1 match (the locked en sentence).

- [ ] **Step 3.4: No CTA / no emoji**

  Run: `grep -E 'Try it today|Get started now|👇|🔥|⭐|🚀' README.md README-en.md` (and any other obvious emoji / CTA).
  Expected: zero matches (or only matches in the badges strip at the top).

- [ ] **Step 3.5: Final commit if any drift caught**

  If Step 3.1–3.4 found drift, edit whichever file drifted and amend the latest commit on that file with a follow-up commit (no Co-Authored-By trailer):

  ```bash
  git add <drifted-file>
  git commit --amend --no-edit   # if it's the last commit on that file
  # OR
  git add <drifted-file>
  git commit -m "docs(readme): align <zh|en> with manifesto spec"
  ```

  If no drift, no commit needed.

- [ ] **Step 3.6: Final verification**

  Run: `git log --oneline -5`.
  Expected: at least one commit per Task 1 / Task 2. No AI attribution trailers.

---

## Self-Review (post-plan, pre-handoff)

| Check | Status |
|---|---|
| Every spec section (1.3 / 3.1 / 3.2 / 3.3 / 3.4) mapped to a task step | Yes — Hero (1.1 + 2.1), In-box (1.2 + 2.2), Sediment (1.3 + 2.3 — locked wording in step body), Install (1.4 + 2.4), Closing hook (1.5 + 2.5), Voice rules + peaks-code placement continuously enforced |
| Placeholders / TBD / TODO / "similar to" | None |
| Line budgets respected per task | Yes (per-step content is bounded; Step 1.7 / 2.7 check counts) |
| No commit message has AI trailer | Each commit step has a no-`-C` template; user-set CLAUDE.md trailer ban copied to Global Constraints |
| Type/signature consistency | N/A (documentation only; no code interfaces) |
