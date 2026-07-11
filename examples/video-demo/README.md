# peaks-loop video demo (v5)

Remotion-based ~27-second brand walk-through for peaks-loop 4.x. Mirrors the multi-domain + slash-command narrative of the top-level README.

## Composition

- Two compositions, one per locale:
  - `peaks-loop-demo`     — Chinese primary
  - `peaks-loop-demo-en`  — English primary
- Same frame budget for both; dimensions 1920×1080 @ 30fps.
- Scene timeline (frozen in `src/Root.tsx`, v5 narrative):

  | # | Scene | Slug | Frames |
  | --- | --- | --- | --- |
  | 1 | `IntroScene` | intro | 80 |
  | 2 | `RecordingScene` | install | 100 |
  | 3 | `RecordingScene` | first-slash | 100 |
  | 4 | `RecordingScene` | domains | 100 |
  | 5 | `RecordingScene` | sediment | 100 |
  | 6 | `CreditScene` | credit | 130 |
  | 7 | `ClosingScene` | closing | 110 |

  Plus 12-frame overlap transitions between every scene.

## Visual style

- Background: `#0f172a` (slate-900) via `bg-brand-bg` + `BrandBackground` (drifting indigo halo + diagonal sweep line + bottom green glow).
- Accent: `#6366f1` (indigo-500) · Stable: `#22c55e` (green-500) · Warn: `#f59e0b` (amber-500).
- Typography: `font-mono` for kickers, captions, IDE/terminal HUD; `font-sans` for headlines.
- Three caption styles (`CaptionOverlay`):
  - **subtitle** — black semi-transparent bar at the bottom.
  - **callout** — indigo gradient emphasis box, slides in from the left.
  - **annotation** — amber speech-bubble, drops in from the top-right.

## Scene components

```
src/scenes/
├── IntroScene.tsx       — hero title + tagline (kicker / brand / tagline)
├── RecordingScene.tsx   — the workhorse: 4 instances, each plays an HUD + captions + cursor
├── HudWindow.tsx        — stylised terminal/IDE panel that types out lines one at a time
├── CaptionOverlay.tsx   — 3-style caption layer (subtitle / callout / annotation)
├── CursorHighlight.tsx  — macOS-style cursor with smooth waypoint interpolation + click ripple
├── BrandBackground.tsx  — shared brand background (halo + sweep + bottom glow)
├── CreditScene.tsx      — tribute + recommended stack
└── ClosingScene.tsx     — install chip + 5,439 tests stats
```

## Copy registry

All on-screen text lives in `src/copy.ts`. Both locales are strict: no hardcoded
CN/EN inline in scene components. The `recordings[]` array holds 4 scene slugs
(install / first-slash / domains / sediment), each with its own captions,
cursor choreography, and HUD payload.

## v5 recording pipeline (Playwright + Remotion)

The `RecordingScene` slots are designed to host **real recorded footage**
when you have a Chromium-equipped machine. The HUD window is the stand-in
for that footage until the recording pass runs.

### 1. Install the recording side

```bash
cd examples/video-demo
pnpm add -D playwright
pnpm exec playwright install chromium
```

### 2. Author a scenario JSON

Write `recordings/<slug>.json` per scene using the
`web-demo-video_skills` schema (`goto` / `click` / `fill` / `wait` / `screenshot`).
For our 4 slugs, the natural targets are:

| slug | URL / action |
| --- | --- |
| `install` | terminal typing `npm i -g peaks-loop` |
| `first-slash` | Claude Code chat with `/peaks-code ...` |
| `domains` | same chat, scrolling through the 5 `/peaks-*` slash commands |
| `sediment` | same chat, completing a run + asking to sediment |

### 3. Record per scene

```bash
pnpm exec tsx scripts/record-scenes.ts
# outputs recordings/<slug>.webm  +  recordings/<slug>.cursor.json
```

### 4. Swap the HUD for the recorded clip

In `src/scenes/RecordingScene.tsx`, replace the `<HudWindow>` block with a
`<Video src={...}>` from the matching `recordings/<slug>.webm`. Drop the
`HudWindow` import when no scene needs it any more.

### 5. Render

```bash
pnpm install
npx remotion render peaks-loop-demo out/peaks-loop-demo.mp4
npx remotion render peaks-loop-demo-en out/peaks-loop-demo-en.mp4

mkdir -p preview
cp out/peaks-loop-demo.mp4    preview/peaks-loop-demo.mp4
cp out/peaks-loop-demo-en.mp4 preview/peaks-loop-demo-en.mp4
```

Fallback (no Chromium available — renders the HUD stand-in only):

```bash
npx remotion still peaks-loop-demo out/still.png --frame=400
```

## Preview during dev

```bash
npx remotion studio   # http://localhost:3000
```

## Why this layout

The 4 recording slugs follow the **black-box mental model** the README now
uses: install → first slash command → tour the 5 domains → sediment. Each
scene is **self-contained** (own HUD payload, captions, cursor ticks),
so you can rearrange them, drop one, or A/B test a new one without
touching the others. The 12-frame overlap transitions cross-fade between
scenes so the result feels like one continuous take rather than a slide
deck.

## Adding a new scene

1. Add a new entry to `recordings` in `src/copy.ts` (both `zh` and `en`):
   - `slug` (kebab-case, used for the corner chip + recording filename)
   - `captions` (array of `{ text, style }` triples)
   - `cursor` (array of waypoints; empty = no cursor overlay)
   - `hud` (terminal / ide, with the lines you want typed out)
2. Add an extra frame budget to `src/Root.tsx` if you want a longer hold.
3. Typecheck: `pnpm exec tsc --noEmit`.
4. Re-render.

If you have a recording, drop a `<Video>` into `RecordingScene.tsx` and
point it at the new `recordings/<slug>.webm`.