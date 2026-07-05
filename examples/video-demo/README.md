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