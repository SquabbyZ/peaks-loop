# peaks-loop video demo

Remotion-based 30-second brand walk-through for peaks-loop 4.0. Mirrors `README.md`.

## Composition

- Two compositions, one per locale:
  - `peaks-loop-demo`     — 30 seconds @ 30fps (900 frames), 1920×1080 — Chinese primary.
  - `peaks-loop-demo-en`  — same frame budget, English primary.
- Scene timeline (frozen in `src/Root.tsx`):
  - 0–90    — **TitleScene** (`peaks-loop`, no ·, no emoji)
  - 90–240  — **PhilosophyScene** — 5 hero philosophy items, bilingual
  - 240–540 — **DemoScene × 3** — `写长任务代码` / `修 bug 当天发` / `接一个长跑的需求`
  - 540–780 — **SedimentScene** — 3-beat `NL → MANIFEST → BEE`
  - 780–900 — **ClosingScene** — `npm i -g peaks-loop` + repo-name vs skill-name arc + 5,439 tests stats

## Visual style

- Background: `#0f172a` (slate-900) via `bg-brand-bg`
- Primary text: `#f8fafc` (slate-50) via `text-brand-fg`
- Accent: `#6366f1` (indigo-500) via `text-brand-accent`
- Stable badge: `#22c55e` (green-500)
- Mono font for kickers / install chip / chat bubbles; sans font for headlines

## Public preview files (tracked)

The READMEs embed `<video>` tags that point at:

- `preview/peaks-loop-demo.mp4`    (zh, 4.9 MB)
- `preview/peaks-loop-demo-en.mp4` (en, 5.0 MB)

These are produced by the render command below and committed to git so a clone (and the GitHub rendering) sees the same path. The shell snippet under **Render** keeps `preview/` in sync after a fresh build.

## Render

```bash
cd examples/video-demo
pnpm install
npx remotion render peaks-loop-demo out/peaks-loop-demo.mp4
npx remotion render peaks-loop-demo-en out/peaks-loop-demo-en.mp4

mkdir -p preview
cp out/peaks-loop-demo.mp4    preview/peaks-loop-demo.mp4
cp out/peaks-loop-demo-en.mp4 preview/peaks-loop-demo-en.mp4
```

Fallback (no Chromium available):

```bash
npx remotion still peaks-loop-demo out/still.png --frame=120
```

## Preview during dev

```bash
npx remotion studio   # http://localhost:3000
```
