# peaks-code video demo

Remotion-based video demo for `peaks-code` and the 11-skill Peaks-Loop capability wall.

## Composition

- `peaks-code-demo` — 30 seconds @ 30fps (900 frames), 1920×1080
- Scene timeline:
  - 0-90 — **TitleScene** ("peaks-code" headline + tagline)
  - 90-270 — **DemoScene** "添加用户登录" — 7 steps
  - 270-450 — **DemoScene** "修复登录页 bug" — 4 steps
  - 450-630 — **DemoScene** "重构认证模块" — 5 steps
  - 630-810 — **SkillsWallScene** — 11 skill names fade in
  - 810-900 — **ClosingScene** ("npx peaks-loop install" + GitHub link)

## Visual style

- Background: `#0f172a` (slate-900)
- Primary text: `#f8fafc` (slate-50)
- Accent: `#6366f1` (indigo-500)
- Mono font for CLI-like text, sans font for headlines

## Render

```bash
cd examples/video-demo
pnpm install
npx remotion render peaks-code-demo out/peaks-code-demo.mp4
```

If the Chromium/Puppeteer download fails on Windows, fallback to a still frame:

```bash
npx remotion still peaks-code-demo out/still.png --frame=450
```

## Preview

```bash
npx remotion studio   # opens http://localhost:3000
```
