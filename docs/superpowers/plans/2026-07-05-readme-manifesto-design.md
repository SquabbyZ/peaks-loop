# peaks-loop README + README-en rewrite — Design

**Status:** Draft (post-brainstorming, pre-writing-plans)
**Date:** 2026-07-05
**Author:** SquabbyZ (via peaks-code brainstorm session 2026-07-05)
**Affects:** `README.md`, `README-en.md`
**Target version:** 4.0.0 (companion to be launched)
**Predecessor docs (for context):** `2026-07-04-peaks-maker-dynamic-skill-sediment-design.md`

---

## 1. Problem statement

### 1.1 Symptom

Three previous README drafts (`30-second install`, `loop-engineering in production hero`, `compares-with-LangChain`) failed the user's "I wouldn't use this if I were a real user" sniff test. Then the user clarified 2026-07-05 what the README is supposed to do:

- The README is a **brand landing zone**, not an onboarding document.
- The reader's first impression must be **"this is a loop-engineering engineering implementation"**, not "this is an AI tool that installs in 30 seconds".
- The reader must see what ships in the box (peaks-code as the first example) **with concrete use cases** (development, bug-fix, long-task requirement).
- The reader must see that **other loop-engineering roles are coming**.
- The reader must see that **they can sediment their own loop-engineering** — not "skill" — into the box while using it.

### 1.2 Root cause (the gap)

The previous drafts conflated three different reading jobs:

| Job | Reader question | Reader moment |
|---|---|---|
| Install walk-through | "How do I start?" | Already decided to install |
| Feature catalog | "What can I do with it?" | Wants a feature list |
| **Brand landing** | **"Who are these people and what's their stance?"** | **First 30 seconds** |

The peaks-loop 4.0 mission serves the third. The first two live elsewhere (`getting-started.md`, skill-level docs). The README must own only the third.

### 1.3 Required narrative

A 4-block ordering emerged from the user's clarifications 2026-07-05:

1. **Hero: engineering implementation of loop-engineering.** Plain assertion. Not an AI tool, not a framework — loop engineering, implemented.
2. **Image overlay: AI tactical squad, 24/7 on call.** Carries the brand image into every other section without re-stating it.
3. **Capabilities in the box.** peaks-code is the first tactician — development, bug-fix, long-task requirement. Other loop-engineering roles = `敬请期待`.
4. **Sediment-your-own-loop-engineering.** The contrast line: "what you sediment is loop-engineering tactical play, not a simple skill spell".

Plus one closing hook naming the rename history (peaks-solo → peaks-code → peaks-loop) as a memory anchor.

---

## 2. Goals & non-goals

### 2.1 Goals (in priority order)

1. **A reader who lands on `peaks-loop/peaks-loop` reads 90 seconds and walks away with one sentence about who peaks-loop is.** "Loop-engineering engineering implementation + AI tactical squad on 24/7 call".
2. **The reader can name the in-box tactician (`peaks-code`) and what it does (development, bug-fix, long-task requirement).**
3. **The reader knows more is coming** ("其他内置 loop engineering 敬请期待").
4. **The reader knows they can sediment their own loop-engineering into the box.** The contrast sentence (loop-engineering vs simple skill) makes sediment-vs-prompt-templating obvious.
5. **The reader retains the rename history in 24 hours**: peaks-solo → peaks-code → peaks-loop.

### 2.2 Non-goals

- Walk-through instructions inside the README. They live in `getting-started.md`.
- Comparison tables against competitors (LangChain, Dify, ...). The contrast lives in the prose, single sentence, no table.
- Build of the actual brand landing zone website (separate future PRD).
- Translation beyond zh + en.
- Section reorganization of `skills/` or `docs/`.

---

## 3. Architecture — the 4-block skeleton

```
┌──────────────────────────────────────────────────────────────┐
│  Header strip: badges only                                    │
│  ─ version / license / stars                                  │
├──────────────────────────────────────────────────────────────┤
│  H1  Hero                                                     │
│     · Loop engineering, engineered. (断言)                    │
│     · peaks-loop is your AI tactical squad, 24/7 on call.    │
│       (image overlay — 战术小队 24 小时待命)                  │
├──────────────────────────────────────────────────────────────┤
│  H2  What's in the box (in-box tactical roles)                │
│     · peaks-code is the lead tactician.                       │
│     · It does: development, bug-fix, long-task requirements.  │
│     · 其他内置 loop engineering 敬请期待。                     │
├──────────────────────────────────────────────────────────────┤
│  H2  Sediment your own loop engineering                        │
│     · Plain-language single line.                             │
│     · Contrast sentence: "what you sediment is                │
│       loop-engineering tactical play, not a simple            │
│       skill spell".                                           │
├──────────────────────────────────────────────────────────────┤
│  H2  Get it running                                           │
│     · `npx peaks-loop install`                                │
│     · One optional link to `examples/video-demo/` for visual. │
├──────────────────────────────────────────────────────────────┤
│  H2  Closing hook                                             │
│     · peaks-solo → peaks-code → peaks-loop, in one breath.    │
├──────────────────────────────────────────────────────────────┤
│  Footer strip: links to skills/, docs/, CHANGELOG, Issues    │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 Section contracts

| Section | Lines | Contains | Does NOT contain |
|---|---|---|---|
| Header strip | 3–5 | npm/license/stars badges | Anything else |
| Hero | 6–9 | Two layers: (a) what it is (assertion), (b) image overlay (squad on call). | Install commands. Version numbers. |
| In-box capabilities | 8–12 | peaks-code named as lead, with 3 example use cases. A closing line that "其他内置 loop engineering 敬请期待". | Other 10 skill names — don't enumerate them in the README; mention peaks-code only. |
| Sediment-your-own | 5–9 | One-line "how you sediment", followed by the contrast sentence. | Step-by-step CLI walk-through. |
| Get it running | 3–4 | The npx line + optional video-demo link. | Walk-through prose. |
| Closing hook | 3–5 | The rename arc. | Dates. Versions. Migration instructions. |

### 3.2 Voice rules

- **Plain words over jargon.** "we're a tactical squad, 24/7" beats "we provide persistent LLM multi-agent orchestration".
- **Sentence fragments OK.** Manifesto style.
- **Metaphor discipline: "squad / 24/7" repeats at most twice per section.** The aim is "threaded" not "wallpapered". Don't smother every line with military flavor.
- **No emoji inside prose.** Squad / 24-7 metaphors are the visual unit; emojis would compete.
- **No CTA phrasing.** Install line is the only CTA.

### 3.3 The peak-code name inside capabilities

peaks-code appears **inside the in-box section only** — not in the hero, not in the closing hook. The hero carries the brand image; the in-box section delivers the first example. The closing hook names it again **only** because peaks-code is in the rename arc (peaks-solo → peaks-code → peaks-loop), and the hook has to name `peaks-code` to make the arc complete.

### 3.4 Sediment contrast sentence

This sentence is the brand anchor for sediment:

> "你沉淀的是 loop engineering(战术套路),不是简单的 skill(动作招式)。"

The English mirror:

> "What you sediment is loop-engineering — a tactical play, not just a skill spell."

The contrast is `playbook` vs `spell`, `套路` vs `招式`. The reader learns in one sentence that "I'll have repeated tactical context on my own machine" — not "I'll have a prompt library".

---

## 4. Failure modes (reading failures)

| Failure | Mitigation |
|---|---|
| Reader can't tell "loop engineering" from "agent framework" | Hero asserts "engineered" + "tactical squad" — neither lands in agent-framework vocabulary |
| Reader doesn't realize more is coming | "敬请期待" line + rename arc hint at growth |
| Reader thinks sediment = prompt library | The contrast sentence explicitly nixes the "spell" framing |
| Reader installs without reading | That's fine — install line is one-liner, no further commitment |
| Reader can't name the in-box examples | "development, bug-fix, long-task requirement" = concrete |
| Reader forgets name after 24h | Rename arc in closing hook |

---

## 5. Testing

This artifact has no automated tests. The verification is human:

| Test | How |
|---|---|
| 90-second first-impression. | 3 cold readers time the "what is this project" reaction. Target < 90s. |
| 24h memory. | 24h later, ask "what does this project do". Target ≥ 2 of 3 hit "loop engineering implementation, with an on-call tactical squad". |
| In-box recall. | Ask "name one tactician and what it does". Target ≥ 2 of 3 say `peaks-code` for "development/bug-fix/requirement". |
| Sediment distinction. | Ask "what does sediment mean in this context?". Target ≥ 2 of 3 distinguish "playbook vs spell". |
| Rename recall. | Ask "what was this project called before?". Target ≥ 2 of 3 say "peaks-solo then peaks-code". |

---

## 6. Out of scope

- Brand landing zone website. Separate PRD.
- Standalone `getting-started.md`. Future slice.
- Comparison tables. Permanently out of scope for the README.
