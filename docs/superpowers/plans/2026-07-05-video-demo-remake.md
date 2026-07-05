# peaks-loop video demo Re-Make — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-make `examples/video-demo/` so the 30-second Remotion walk-through mirrors the README manifesto brand (lock-in contrast sentence, 5 hero philosophy lines, NL → Manifest → Bee sediment 3-beat, install line `npm i -g peaks-loop`, repo-name vs skill-name rename arc).

**Architecture:** Re-purpose existing 5 scenes (Title/Demo/Sediment/SkillsWall/Closing) + 1 new `PhilosophyScene` slot. Six scenes, 900 frames @ 30fps, 1920×1080. Frame budget is fixed by `Root.tsx` which is committed and stable. Each scene file is ≤ 220 lines. No new dependencies. No new components. All copy bilingual (zh + en subtitle) where README has both.

**Tech Stack:** Remotion 4.0.290 + React 18.3.1 + Tailwind 3.4.14. TypeScript 5.4.5. No bundler config changes. No package.json dependency changes.

---

## Global Constraints (binding on every task)

- **Frame budget is frozen** (matches `Root.tsx`):
  - `TitleScene       : 0   - 90    (90)`
  - `PhilosophyScene  : 90  - 240   (150)`  ← NEW file
  - `DemoScene × 3    : 240 - 540   (300)` — 100 frames each, titled by `DEMO_SCENES`
  - `SedimentScene    : 540 - 780   (240)` — 3-beat NL → manifest → bee
  - `ClosingScene     : 780 - 900   (120)`
- **No scene may re-define `TOTAL_FRAMES`** or re-import from a different `Root`.
- **Style tokens** (read by Tailwind classes):
  - `bg-brand-bg` = `#0f172a`
  - `text-brand-fg` = `#f8fafc`
  - `text-brand-accent` = `#6366f1` (indigo)
- **Bilingual copy**: the same screen must show zh headline + en micro-line where README pairs them (5 philosophy items, 3 beat labels, rename arc).
- **No emoji inside prose** (matches README rule).
- **No commit message contains** `Co-Authored-By: Claude`, `Co-Authored-By: Anthropic`, or any equivalent AI attribution trailer (CLAUDE.md red rule).
- **SkillsWallScene** is **orphaned** by this re-make — no longer referenced from `Root.tsx`. Either delete the file or leave it as dead-weight with a clear "ORPHANED" comment at top. Prefer **delete**.
- **No CLI commands added.** Pure visual changes. `examples/video-demo/package.json` scripts unchanged.

---

## File Structure (pre-task map)

| File | Action | Lines target | Frame range |
|---|---|---|---|
| `src/scenes/PhilosophyScene.tsx` | **Create** | 80–140 | 90–240 |
| `src/scenes/TitleScene.tsx` | Modify | 70–110 | 0–90 |
| `src/scenes/SedimentScene.tsx` | Modify | 140–200 | 540–780 |
| `src/scenes/ClosingScene.tsx` | Modify | 100–140 | 780–900 |
| `src/scenes/SkillsWallScene.tsx` | **Delete** | — | — |
| `examples/video-demo/README.md` | Modify | 50–70 | n/a (doc) |

No changes to: `Root.tsx` (frozen), `package.json` (frozen), `tailwind.config.js`, `tsconfig.json`, `remotion.config.ts`, or any other source file.

---

### Task 1: Rewrite `TitleScene` + simplify `DemoScene` (drop SkillsWall)

**Files:**
- Modify: `examples/video-demo/src/scenes/TitleScene.tsx`
- Modify: `examples/video-demo/src/scenes/DemoScene.tsx` (only if `subtitle` rendering needs tweaks; otherwise no change)
- Delete: `examples/video-demo/src/scenes/SkillsWallScene.tsx`

**Interfaces:**
- Consumes:
  - `Root.tsx` already passes `from=0, to=90` for `TitleScene` (frozen — do not change)
  - `Root.tsx` already passes `from=240+idx*100, to=240+(idx+1)*100` for `DemoScene` (frozen)
- Produces: scenes that visually match the README brand

**Hard rules:**
- `TitleScene` MUST drop `peaks·loop` middle-dot and middle accent — render as `peaks-loop` (no separators).
- `TitleScene` MUST NOT use any mountain emoji, any ⛰️, or any ⛰ variant.
- `TitleScene` MUST show the same H3-level brand anchors as `README.md`:
  - Top kicker: `★ loop engineering · in production` is fine (existing copy).
  - Hero title: `peaks-loop` (single word, no dot, no separator).
  - Tagline: `your AI 战术小队, 24 hours on call` — keep EN micro-line from existing `taglineOpacity` slot, replace prose to mirror README hero second line.
- `TitleScene` MUST keep the same motion math (`kickerOpacity` at 4–20, `titleOpacity` 0–15 → out at 90–6, `taglineOpacity` 10–30 → out at 90–6) so 90-frame window still feels the same.

- `DemoScene` is already 3-scene capable (the `sceneIndex` prop is unused but accepted; no change needed unless subtitles overflow). If sub-150-char subtitles still fit horizontally at fontSize 34, leave `DemoScene` **unchanged**.

- `SkillsWallScene.tsx` MUST be removed (`git rm`). Root.tsx does not import it. Removing it keeps the tree clean.

- [ ] **Step 1.1: Edit `TitleScene.tsx` to match the README brand**

  Replace the inner JSX inside the outer `<div className="flex flex-col items-center">` so:
  - Kicker stays: `<div className="font-mono text-brand-accent" style={{ fontSize: 36, letterSpacing: 6, textTransform: "uppercase", opacity: kickerOpacity, marginBottom: 28 }}>★ loop engineering · in production</div>`
  - Hero title becomes: `<div className="font-sans text-brand-fg" style={{ fontSize: 240, fontWeight: 800, letterSpacing: -10, opacity: titleOpacity, transform: \`translateY(${titleY}px)\`, lineHeight: 1 }}>peaks-loop</div>` — no inner `<span>` with `#6366f1` dot.
  - Tagline becomes: `<div className="font-mono text-brand-accent mt-10" style={{ fontSize: 40, opacity: taglineOpacity, transform: \`translateY(${taglineY}px)\`, letterSpacing: 1 }}>your AI 战术小队, 24 hours on call — one sentence, one flow</div>`

  Do NOT change: the interpolate math, the className on the outer AbsoluteFill, the `useCurrentFrame`/`useVideoConfig`/`Easing` import block. Only the three inner `<div>` text bodies and the removed inner `<span>`.

- [ ] **Step 1.2: Optional `DemoScene` subtitle tightening**

  Run: `grep -n "font-size: 34" examples/video-demo/src/scenes/DemoScene.tsx` to confirm the subtitle block exists at line ~67 with fontSize 34.
  
  If subtitles from `Root.tsx` `DEMO_SCENES` are all ≤ 60 chars (they are: `end-to-end — requirement → PRD → implementation → QA` = 51; `fix → review → tests → ship, same day` = 41; `fuzzy ask → landed code, one tactician's chain` = 47), no change needed. **Skip to Step 1.3.**

- [ ] **Step 1.3: Remove `SkillsWallScene.tsx`**

  Run: `git rm examples/video-demo/src/scenes/SkillsWallScene.tsx`. Verify with `ls examples/video-demo/src/scenes/`: expecting 5 files (Title / Philosophy / Demo / Sediment / Closing).

- [ ] **Step 1.4: Type-check the file set**

  Run: `cd examples/video-demo && pnpm exec tsc --noEmit 2>&1 | head -40`.
  Expected: zero errors. (SkillsWallScene import would be the only complaint — and it was already removed in Step 1.3.)

- [ ] **Step 1.5: Commit**

  ```bash
  git add examples/video-demo/src/scenes/TitleScene.tsx \
          examples/video-demo/src/scenes/DemoScene.tsx \
          examples/video-demo/src/scenes/SkillsWallScene.tsx
  git commit -m "chore(video-demo): rewrite TitleScene + remove SkillsWallScene"
  ```

  Verify: `git log -1` shows the commit. No `Co-Authored-By:` trailer.

---

### Task 2: Create `PhilosophyScene` (5 hero philosophy items)

**Files:**
- Create: `examples/video-demo/src/scenes/PhilosophyScene.tsx`

**Interfaces:**
- Consumes: `Root.tsx` already passes `from=90, to=240` for `PhilosophyScene` (frozen — do not change)
- Produces: a 150-frame scene displaying the 5 philosophy lines from `README.md` line 21–28

**Locked copy (verbatim, zh headline + en micro-line):**

| # | zh (verbatim from README) | en micro-line (verbatim from README-en) |
|---|---|---|
| 1 | `极客精神。` | `Geek ethos.` |
| 2 | `你跟 AI 之间只该用自然语言讲话,没有 CLI 表面给你。` | `Natural language only — no CLI surface for the user.` |
| 3 | `单测覆盖率和门禁审计真挡得住事,不是装饰。` | `Tests and gates that actually block, not decorate.` |
| 4 | `严于律己,宽以待人 —— 自己写的代码过自己的门,使用者随便怎么说都能跑通。` | `Strict with self, lenient with users — our own code goes through our own gates; users say whatever they want, the system catches it.` |
| 5 | `AI 使用水平的下限平权:你不需要懂 prompt engineering,就跟说话一样用。` | `AI fluency floor is flat — no prompt-engineering chops, no CLI muscle memory; you talk like a person.` |

**Hard rules:**
- 5 items must fit in 150 frames. Distribute as 30 frames per item × 5 = 150. Animate as one card sliding in, sticking for ~22 frames, sliding out (4-frame cross-fade to next).
- Each card layout (left-aligned, vertical stack inside a `flex-row` slot):
  - Number badge: `#01..05` mono, indigo (`#6366f1`), fontSize 56, square-ish (≈ 80×80).
  - en micro-line: muted slate, fontSize 28, line-height 1.3, maxWidth 1200, color `#94a3b8`.
  - zh headline: bold (`fontWeight: 800`), fontSize 56, line-height 1.25, maxWidth 1200, color `#f8fafc`.
  - order: en micro-line ON TOP, zh headline BELOW (zh is the load-bearing language).
- Card enters from the right (`translateX 80px` → `0` over 6 frames, opacity 0→1 over 6 frames, ease-out cubic).
- Card exits to the left (`translateX 0` → `-40px` over 4 frames, opacity 1→0 over 4 frames).
- 5-frame dwell at center.
- Use the existing `from`/`to` props to gate `if (frame < from || frame >= to) return null;`.
- Local time `localT = frame - from`; `localDuration = to - from = 150`.
- Per-item window: `const itemWindow = localDuration / 5;` (= 30). For item `i` ∈ [0,4]: enter at `i * itemWindow`, full visible by `i * itemWindow + 6`, exit start at `i * itemWindow + itemWindow - 4`.
- Card container top: `Math.round(height * 0.30)`. Card x: `Math.round(width * 0.10)`, `width: Math.round(width * 0.80)` (= 1536 on 1920).
- Bottom of screen: a **static contextual line** locked for the whole 150-frame window: `做这个项目的只有一个人,工程师口味。` (mono, fontSize 32, color `#6366f1`, opacity peaks 1, anchored at `top: Math.round(height * 0.85)`, centered).

- [ ] **Step 2.1: Write `PhilosophyScene.tsx`**

  Use this scaffold (write the file in one shot — do not split across messages):

  ```tsx
  import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

  interface Props {
    from: number;
    to: number;
  }

  const ITEMS: ReadonlyArray<{ num: string; zh: string; en: string }> = [
    {
      num: "#01",
      zh: "极客精神。",
      en: "Geek ethos.",
    },
    {
      num: "#02",
      zh: "你跟 AI 之间只该用自然语言讲话,没有 CLI 表面给你。",
      en: "Natural language only — no CLI surface for the user.",
    },
    {
      num: "#03",
      zh: "单测覆盖率和门禁审计真挡得住事,不是装饰。",
      en: "Tests and gates that actually block, not decorate.",
    },
    {
      num: "#04",
      zh: "严于律己,宽以待人 —— 自己写的代码过自己的门,使用者随便怎么说都能跑通。",
      en: "Strict with self, lenient with users — our own code goes through our own gates; users say whatever they want, the system catches it.",
    },
    {
      num: "#05",
      zh: "AI 使用水平的下限平权:你不需要懂 prompt engineering,就跟说话一样用。",
      en: "AI fluency floor is flat — no prompt-engineering chops, no CLI muscle memory; you talk like a person.",
    },
  ];

  const FOOTER = "做这个项目的只有一个人,工程师口味。";

  export const PhilosophyScene: React.FC<Props> = ({ from, to }) => {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();
    if (frame < from || frame >= to) {
      return null;
    }
    const localT = frame - from;
    const localDuration = to - from;
    const itemWindow = localDuration / ITEMS.length;

    const footerOpacity = interpolate(localT, [0, 18, localDuration - 18, localDuration], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return (
      <AbsoluteFill className="bg-brand-bg">
        <div
          style={{
            position: "absolute",
            top: Math.round(height * 0.85),
            left: 0,
            right: 0,
            textAlign: "center",
            opacity: footerOpacity,
          }}
        >
          <span className="font-mono" style={{ fontSize: 32, color: "#6366f1", letterSpacing: 2 }}>
            {FOOTER}
          </span>
        </div>
        {ITEMS.map((item, i) => {
          const winStart = i * itemWindow;
          const enterEnd = winStart + 6;
          const exitStart = (i + 1) * itemWindow - 4;
          const exitEnd = (i + 1) * itemWindow;
          const enterX = interpolate(localT, [winStart, enterEnd], [80, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
          const exitX = interpolate(localT, [exitStart, exitEnd], [0, -40], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const opacity = interpolate(
            localT,
            [winStart, enterEnd, exitStart, exitEnd],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          );
          const visible = opacity > 0.001;
          if (!visible) {
            return null;
          }
          return (
            <div
              key={item.num}
              style={{
                position: "absolute",
                top: Math.round(height * 0.30),
                left: Math.round(width * 0.10),
                width: Math.round(width * 0.80),
                opacity,
                transform: `translateX(${enterX + exitX}px)`,
              }}
            >
              <div className="font-mono" style={{ fontSize: 56, color: "#6366f1", fontWeight: 700, marginBottom: 28 }}>
                {item.num}
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: 28,
                  color: "#94a3b8",
                  lineHeight: 1.3,
                  maxWidth: 1200,
                  marginBottom: 18,
                }}
              >
                {item.en}
              </div>
              <div
                className="font-sans"
                style={{
                  fontSize: 56,
                  fontWeight: 800,
                  color: "#f8fafc",
                  lineHeight: 1.25,
                  maxWidth: 1200,
                  letterSpacing: -1,
                }}
              >
                {item.zh}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    );
  };
  ```

- [ ] **Step 2.2: Type-check the new file**

  Run: `cd examples/video-demo && pnpm exec tsc --noEmit 2>&1 | head -40`.
  Expected: zero errors.

- [ ] **Step 2.3: Self-check the locked wording**

  Run: `grep -F "极客精神" examples/video-demo/src/scenes/PhilosophyScene.tsx` → 1 match.
  Run: `grep -F "AI 使用水平的下限平权" examples/video-demo/src/scenes/PhilosophyScene.tsx` → 1 match.
  Run: `grep -F "做这个项目的只有一个人" examples/video-demo/src/scenes/PhilosophyScene.tsx` → 1 match.

- [ ] **Step 2.4: Commit**

  ```bash
  git add examples/video-demo/src/scenes/PhilosophyScene.tsx
  git commit -m "feat(video-demo): add PhilosophyScene with 5 hero philosophy lines"
  ```

  Verify: no `Co-Authored-By:` trailer.

---

### Task 3: Rewrite `SedimentScene` (3-beat: NL → Manifest → Bee)

**Files:**
- Modify: `examples/video-demo/src/scenes/SedimentScene.tsx`

**Interfaces:**
- Consumes: `Root.tsx` already passes `from=540, to=780` (240 frames) for `SedimentScene` (frozen)
- Produces: a 240-frame scene with three sequential beats

**Three beats (each 80 frames = ~2.67s):**

| Beat | Frames | Headline | Mid line | Right-side artifact |
|---|---|---|---|---|
| 1 — NL | 0–79 | `NL` (en mono kicker) / `跑过一次还想跑` (zh H3) / `say once to keep it forever` (en) | `user: peaks-loop` chat-bubble with one long sentence: `把'抓 arxiv 每日论文 → 清理 → 入库'沉淀成我的 bee` | (nothing yet) |
| 2 — Manifest | 80–159 | `MANIFEST` (mono kicker) / `沉淀成战术套路` (zh H3) / `sediment the playbook, not the spell` (en) | A bordered card showing the structured BeeManifest (`{ trigger, steps[], gates[], name }`) | left = same chat-bubble but ghosted |
| 3 — Bee | 160–239 | `BEE` (mono kicker) / `驻场,下次说跑就跑` (zh H3) / `the bee is grounded; run it again next time` (en) | One centered bee card with name `bee-arxiv-daily` and a green-lit badge `STABLE` | (manifest ghosted to background) |

**Hard rules:**
- All copy bilingual: every beat has zh H3 + en micro-line under it.
- Contrast sentence **NOT REQUIRED** here (it appears in the README sediment section, but the scene is the demonstration of the flow, not the verbal claim — verb claims live in README).
- Each beat's headline sits at top: `Math.round(height * 0.18)`, `left: Math.round(width * 0.06)`, `right: Math.round(width * 0.06)`.
- Beat crossfade: at the seam between beats (frame 79→80, 159→160), fade the old beat out 6 frames, the new beat in 6 frames. (Total seam = 12 frames, but each beat owns 80 frames and the math clamps.)
- Beat 1 input bubble: y `Math.round(height * 0.55)`, mono, fontSize 24, maxWidth ~1100, `border-radius: 18`, indigo border-left `4px solid #6366f1`.
- Beat 2 manifest card: center horizontally, y `Math.round(height * 0.50)`, width ~720, height ~360, background `#1e293b`, border-radius 22, 2px solid `#6366f1`. Inside: 4 rows of `[ key | value ]` labels, mono, fontSize 22.
- Beat 3 bee card: center, y `Math.round(height * 0.42)`, width 460, height 360, background `#1e293b`, 2px solid `#22c55e` (green), border-radius 22. Inside: `STABLE` badge (top-right corner), bee name `bee-arxiv-daily` (fontSize 32, fontWeight 700), `1 of 1 bee` (fontSize 20, slate).

**Maintain the existing import block:** `import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";`. Keep `interface Props { from: number; to: number; }`. Keep the early-null guard.

- [ ] **Step 3.1: Rewrite `SedimentScene.tsx`**

  Replace the file body with the scaffold below (write in one shot — do not split). The file is ~180 lines.

  ```tsx
  import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

  interface Props {
    from: number;
    to: number;
  }

  const NL_LINE =
    "把'抓 arxiv 每日论文 → 清理 → 入库'沉淀成我的 bee";

  const MANIFEST_ROWS: ReadonlyArray<{ key: string; value: string }> = [
    { key: "name", value: "bee-arxiv-daily" },
    { key: "trigger", value: "user: peaks-loop" },
    { key: "steps[4]", value: "fetch · dedupe · summarize · index" },
    { key: "gates[3]", value: "audit · test · ship" },
  ];

  export const SedimentScene: React.FC<Props> = ({ from, to }) => {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();
    if (frame < from || frame >= to) {
      return null;
    }

    const localT = frame - from;
    const localDuration = to - from;
    const beatW = localDuration / 3; // 80

    // Beats 0 (NL) / 1 (Manifest) / 2 (Bee). Each beat: fade-in 0..6, hold, fade-out at beatW-6..beatW.
    const beatFor = (t: number) => Math.min(2, Math.floor(t / beatW));
    const beatTInBeat = (t: number) => t - beatFor(t) * beatW;
    const beatOpacity = (t: number) => {
      const lt = beatTInBeat(t);
      return interpolate(lt, [0, 6, beatW - 6, beatW], [0, 1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    };
    const beatSlide = (t: number) => {
      const lt = beatTInBeat(t);
      return interpolate(lt, [0, 6, beatW - 6, beatW], [40, 0, 0, -40], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      });
    };

    const renderBeatHeadline = (beat: number, kicker: string, zh: string, en: string) => {
      const opacity = beatOpacity(localT);
      const slide = beatSlide(localT);
      const inThisBeat = beatFor(localT) === beat && opacity > 0.001;
      if (!inThisBeat) {
        return null;
      }
      return (
        <div
          style={{
            position: "absolute",
            top: Math.round(height * 0.18),
            left: Math.round(width * 0.06),
            right: Math.round(width * 0.06),
            opacity,
            transform: `translateY(${slide}px)`,
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 28,
              color: "#6366f1",
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 22,
            }}
          >
            {kicker}
          </div>
          <div
            className="font-sans"
            style={{
              fontSize: 96,
              fontWeight: 800,
              color: "#f8fafc",
              lineHeight: 1.05,
              letterSpacing: -3,
              marginBottom: 16,
            }}
          >
            {zh}
          </div>
          <div
            className="font-mono"
            style={{ fontSize: 26, color: "#94a3b8", letterSpacing: 1 }}
          >
            {en}
          </div>
        </div>
      );
    };

    // Render beats in DOM order — React uses CSS-driven opacity to hide ones not in beatFor(t).
    return (
      <AbsoluteFill className="bg-brand-bg">
        {/* Beat 1: NL */}
        {(() => {
          const opacity = beatOpacity(localT);
          const slide = beatSlide(localT);
          if (beatFor(localT) !== 0 || opacity <= 0.001) {
            return null;
          }
          return (
            <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
              {renderBeatHeadline(0, "NL", "跑过一次还想跑", "say once to keep it forever")}
              <div
                style={{
                  position: "absolute",
                  top: Math.round(height * 0.55),
                  left: Math.round(width * 0.10),
                  width: Math.round(width * 0.80),
                  background: "#1e293b",
                  border: "1.5px solid #475569",
                  borderLeft: "4px solid #6366f1",
                  borderRadius: 18,
                  padding: "22px 28px",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                  fontSize: 28,
                  color: "#cbd5e1",
                }}
              >
                <span style={{ color: "#6366f1", marginRight: 18 }}>›</span>
                {NL_LINE}
              </div>
            </div>
          );
        })()}

        {/* Beat 2: Manifest */}
        {(() => {
          const opacity = beatOpacity(localT);
          const slide = beatSlide(localT);
          if (beatFor(localT) !== 1 || opacity <= 0.001) {
            return null;
          }
          return (
            <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
              {renderBeatHeadline(1, "MANIFEST", "沉淀成战术套路", "sediment the playbook, not the spell")}
              <div
                style={{
                  position: "absolute",
                  top: Math.round(height * 0.50),
                  left: "50%",
                  marginLeft: -360,
                  width: 720,
                  background: "#1e293b",
                  border: "2px solid #6366f1",
                  borderRadius: 22,
                  padding: 26,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  className="font-mono"
                  style={{
                    fontSize: 18,
                    letterSpacing: 4,
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  BeeManifest
                </div>
                {MANIFEST_ROWS.map((row) => (
                  <div
                    key={row.key}
                    style={{
                      display: "flex",
                      gap: 24,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                      fontSize: 22,
                    }}
                  >
                    <span style={{ color: "#94a3b8", width: 140 }}>{row.key}</span>
                    <span style={{ color: "#f8fafc" }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Beat 3: Bee */}
        {(() => {
          const opacity = beatOpacity(localT);
          const slide = beatSlide(localT);
          if (beatFor(localT) !== 2 || opacity <= 0.001) {
            return null;
          }
          return (
            <div style={{ position: "absolute", inset: 0, opacity, transform: `translateY(${slide}px)` }}>
              {renderBeatHeadline(2, "BEE", "驻场,下次说跑就跑", "the bee is grounded; run it again next time")}
              <div
                style={{
                  position: "absolute",
                  top: Math.round(height * 0.42),
                  left: "50%",
                  marginLeft: -230,
                  width: 460,
                  height: 360,
                  background: "#1e293b",
                  border: "2px solid #22c55e",
                  borderRadius: 22,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 0 36px rgba(34,197,94,0.35)",
                }}
              >
                <div
                  className="font-mono"
                  style={{
                    fontSize: 18,
                    letterSpacing: 5,
                    color: "#94a3b8",
                    textTransform: "uppercase",
                  }}
                >
                  bee
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 32,
                    fontWeight: 700,
                    color: "#f8fafc",
                    lineHeight: 1.2,
                  }}
                >
                  bee-arxiv-daily
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 18,
                    color: "#22c55e",
                    letterSpacing: 4,
                    textTransform: "uppercase",
                  }}
                >
                  ● STABLE
                </div>
              </div>
            </div>
          );
        })()}
      </AbsoluteFill>
    );
  };
  ```

- [ ] **Step 3.2: Type-check**

  Run: `cd examples/video-demo && pnpm exec tsc --noEmit 2>&1 | head -40`.
  Expected: zero errors.

- [ ] **Step 3.3: Verify the locked-zh copy**

  Run: `grep -F "跑过一次还想跑" examples/video-demo/src/scenes/SedimentScene.tsx` → 1 match.
  Run: `grep -F "沉淀成战术套路" examples/video-demo/src/scenes/SedimentScene.tsx` → 1 match.
  Run: `grep -F "驻场,下次说跑就跑" examples/video-demo/src/scenes/SedimentScene.tsx` → 1 match.
  Run: `grep -F "bee-arxiv-daily" examples/video-demo/src/scenes/SedimentScene.tsx` → ≥ 2 matches (in headline artifact + bee card).

- [ ] **Step 3.4: Commit**

  ```bash
  git add examples/video-demo/src/scenes/SedimentScene.tsx
  git commit -m "feat(video-demo): rewrite SedimentScene as 3-beat NL→Manifest→Bee flow"
  ```

  Verify: no `Co-Authored-By:` trailer.

---

### Task 4: Rewrite `ClosingScene` (install line + repo-name vs skill-name arc)

**Files:**
- Modify: `examples/video-demo/src/scenes/ClosingScene.tsx`
- Modify: `examples/video-demo/README.md`

**Interfaces:**
- Consumes: `Root.tsx` already passes `from=780, to=900` (120 frames) for `ClosingScene` (frozen)
- Produces: a 120-frame scene + an updated README that references the new scene file

**Hard rules:**
- The install line MUST show literally `npm i -g peaks-loop` (matches README §上号 / §Get it running). Not `npx peaks-loop install`.
- The rename arc MUST distinguish REPO NAME from SKILL NAME (per user 2026-07-05:
  > 仓库以前叫 `peaks-cli`(现在叫 `peaks-loop`),不是改名史;
  > 技能从 `peaks-solo`(单角色)演化到 `peaks-code`(带门禁的代码域).).
- Show both in two stacked rows:
  - Row A (REPO): `[ peaks-cli (was) ]   →   [ peaks-loop (now) ]`
    - The "peaks-cli (was)" half should be a clickable-looking muted link in slate. Visual cue: `#94a3b8` or strikethrough OR both, fontSize 24.
    - The "peaks-loop (now)" half: full-color `#f8fafc`, fontSize 40, bold.
    - Arrow: `→` (Unicode) in `#6366f1`, fontSize 32.
  - Row B (SKILL): `[ peaks-solo ]   →   [ peaks-code ]`
    - Same arrow / same accent.
    - "peaks-solo": fontSize 28, mono, color `#94a3b8`, with a micro-caption underneath: `single-role (legacy)`.
    - "peaks-code": fontSize 36, mono, bold, color `#f8fafc`, with micro-caption `gate-bearing, code-domain`.
- Install line at top-center, fontSize 56, mono, in a bordered chip (`#1e293b` bg, `2px solid #6366f1` border, padding `18 36`, borderRadius 14).
- Bottom: a closing line (zh + en bilingual), fontSize 36, color `#94a3b8`.
- Total scene = 120 frames (4 seconds). Animate:
  - Install chip: fade in `0..14`, hold, fade out at `106..120`.
  - Row A (REPO): enter at `16..30`, leave with the chip.
  - Row B (SKILL): enter at `34..48`, leave with the chip.
  - Closing line: enter at `52..70`, hold, fade out at `106..120`.
- Document `examples/video-demo/README.md` to:
  - Drop any reference to `SkillsWallScene` (now removed).
  - Reference `PhilosophyScene` (new).
  - Reference the 3-beat sediment flow.

- [ ] **Step 4.1: Rewrite `ClosingScene.tsx`**

  Use the scaffold below (write in one shot):

  ```tsx
  import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

  interface Props {
    from: number;
    to: number;
  }

  export const ClosingScene: React.FC<Props> = ({ from, to }) => {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();
    if (frame < from || frame >= to) {
      return null;
    }

    const localT = frame - from;
    const localDuration = to - from;

    const chipOpacity = interpolate(localT, [0, 14, localDuration - 14, localDuration], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const chipY = interpolate(localT, [0, 14], [30, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

    const repoOpacity = interpolate(localT, [16, 30, localDuration - 14, localDuration], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const skillOpacity = interpolate(localT, [34, 48, localDuration - 14, localDuration], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const footerOpacity = interpolate(localT, [52, 70, localDuration - 14, localDuration], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

    return (
      <AbsoluteFill className="bg-brand-bg flex items-center justify-center">
        <div className="flex flex-col items-center" style={{ width: Math.round(width * 0.86) }}>
          {/* Install chip */}
          <div
            className="font-mono"
            style={{
              fontSize: 56,
              color: "#f8fafc",
              background: "#1e293b",
              padding: "18px 36px",
              borderRadius: 14,
              border: "2px solid #6366f1",
              opacity: chipOpacity,
              transform: `translateY(${chipY}px)`,
              marginBottom: 56,
            }}
          >
            npm i -g peaks-loop
          </div>

          {/* Row A — REPO NAME */}
          <div
            className="font-mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              opacity: repoOpacity,
              marginBottom: 28,
            }}
          >
            <span style={{ fontSize: 24, color: "#94a3b8", textDecoration: "line-through" }}>
              peaks-cli (was)
            </span>
            <span style={{ fontSize: 32, color: "#6366f1" }}>→</span>
            <span style={{ fontSize: 40, fontWeight: 800, color: "#f8fafc" }}>
              peaks-loop (now)
            </span>
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 16,
              color: "#94a3b8",
              letterSpacing: 3,
              textTransform: "uppercase",
              opacity: repoOpacity,
              marginBottom: 44,
            }}
          >
            repo · was, now
          </div>

          {/* Row B — SKILL NAME */}
          <div
            className="font-mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              opacity: skillOpacity,
              marginBottom: 28,
            }}
          >
            <span style={{ fontSize: 28, color: "#94a3b8" }}>peaks-solo</span>
            <span style={{ fontSize: 32, color: "#6366f1" }}>→</span>
            <span style={{ fontSize: 36, fontWeight: 800, color: "#f8fafc" }}>
              peaks-code
            </span>
          </div>
          <div
            className="font-mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              fontSize: 16,
              color: "#94a3b8",
              letterSpacing: 2,
              opacity: skillOpacity,
              marginBottom: 60,
            }}
          >
            <span style={{ width: 180, textAlign: "right" }}>
              single-role (legacy)
            </span>
            <span style={{ width: 32 }} />
            <span style={{ width: 220, textAlign: "left" }}>
              gate-bearing, code-domain
            </span>
          </div>

          {/* Footer line — zh + en */}
          <div
            className="font-mono"
            style={{
              fontSize: 32,
              color: "#94a3b8",
              opacity: footerOpacity,
              textAlign: "center",
              letterSpacing: 1,
            }}
          >
            你说话,它替你排工程门禁 — fail where it fails, you decide.
          </div>
        </div>
      </AbsoluteFill>
    );
  };
  ```

- [ ] **Step 4.2: Update `examples/video-demo/README.md`**

  Replace the file body with:

  ```markdown
  # peaks-loop video demo

  Remotion-based 30-second brand walk-through for peaks-loop 4.0. Mirrors `README.md`.

  ## Composition

  - `peaks-loop-demo` — 30 seconds @ 30fps (900 frames), 1920×1080
  - Scene timeline (frozen in `src/Root.tsx`):
    - 0–90    — **TitleScene** (`peaks-loop`, no ·, no emoji)
    - 90–240  — **PhilosophyScene** — 5 hero philosophy items, bilingual
    - 240–540 — **DemoScene × 3** — `写长任务代码` / `修 bug 当天发` / `接一个长跑的需求`
    - 540–780 — **SedimentScene** — 3-beat `NL → MANIFEST → BEE`
    - 780–900 — **ClosingScene** — `npm i -g peaks-loop` + repo-name vs skill-name arc

  ## Visual style

  - Background: `#0f172a` (slate-900) via `bg-brand-bg`
  - Primary text: `#f8fafc` (slate-50) via `text-brand-fg`
  - Accent: `#6366f1` (indigo-500) via `text-brand-accent`
  - Stable badge: `#22c55e` (green-500)
  - Mono font for kickers / install chip / chat bubbles; sans font for headlines

  ## Render

  ```bash
  cd examples/video-demo
  pnpm install
  npx remotion render peaks-loop-demo out/peaks-loop-demo.mp4
  ```

  Fallback (no Chromium available):

  ```bash
  npx remotion still peaks-loop-demo out/still.png --frame=120
  ```

  ## Preview

  ```bash
  npx remotion studio   # http://localhost:3000
  ```
  ```

- [ ] **Step 4.3: Type-check**

  Run: `cd examples/video-demo && pnpm exec tsc --noEmit 2>&1 | head -40`.
  Expected: zero errors.

- [ ] **Step 4.4: Self-check the locked copy**

  Run: `grep -F "npm i -g peaks-loop" examples/video-demo/src/scenes/ClosingScene.tsx` → 1 match.
  Run: `grep -F "peaks-cli" examples/video-demo/src/scenes/ClosingScene.tsx` → 1 match.
  Run: `grep -F "peaks-solo" examples/video-demo/src/scenes/ClosingScene.tsx` → 1 match.
  Run: `grep -F "peaks-code" examples/video-demo/src/scenes/ClosingScene.tsx` → ≥ 1 match.
  Run: `grep -F "npx peaks-loop install" examples/video-demo/src/scenes/ClosingScene.tsx` → 0 matches.

- [ ] **Step 4.5: Commit**

  ```bash
  git add examples/video-demo/src/scenes/ClosingScene.tsx examples/video-demo/README.md
  git commit -m "feat(video-demo): rewrite ClosingScene with install line + rename arc"
  ```

  Verify: no `Co-Authored-By:` trailer.

---

## Self-Review (post-plan, pre-handoff)

| Check | Status |
|---|---|
| Every spec requirement mapped to a task | Yes — Title (T1.1), Philosophy 5 items (T2.1, locked wording), NL → Manifest → Bee (T3.1, 3 beats locked), install line `npm i -g peaks-loop` (T4.1), rename arc repo-name vs skill-name (T4.1) |
| Frame budget frozen | Yes — Global Constraints; Root.tsx untouched |
| Bilingual copy | Yes — every scene has zh headline + en micro-line |
| No commit AI trailer | Yes — all commit steps use no-`-C` templates |
| SkillsWallScene handling | Yes — T1.3 deletes; Root.tsx never imports it |
| TypeScript hygiene | Yes — tsc check after every modify-task |
| Plan files outside source code | Yes — only `examples/video-demo/src/scenes/*` + `examples/video-demo/README.md` |
