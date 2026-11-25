# peaks design — S8 Implementation Plan (render layer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the audit from source-only to the rendered page — a palette measured from the screenshot, a contrast judgment grounded in what actually renders, and an honest answer on overflow — each signal accepted only where the evidence really carries it.

**Architecture:** S7's audit reads source and the contract. S8 adds a render evidence reader built on what S6/S5 already capture (the fixed-path `full-page.png` and the bounded `designlang` extract/stats runs) and feeds three new dimensions: `palette` (dominant colours, area share, chroma, ΔE ladder), `contrast` (upgraded from declared-pairs-only to rendered verification, or declared pairs verified against the rendered palette), and `overflow` (only if the evidence exposes geometry; otherwise a recorded `unmeasured` with the reason). Everything S8 adds is `unmeasured`-safe: a page that cannot be rendered produces no score, not a zero.

**Tech Stack:** TypeScript ESM, the existing `paint-metric.ts` PNG decoder, `designlang` 13.4.1's extract/stats payloads as captured by `page-capture.ts`, Vitest. No new dependency, no model.

**Spec / references:** the user's 2026-11-25 design notes and the article *色彩、算法与美学* — two formulas adopted here: `E = √(ΔL² + Δa² + Δb²)` in OKLab with a visible step around 0.12, and the palette ranking `0.3 × weighted area share + 0.7 × normalized chroma` with edge pixels down-weighted. Read as references; nothing installed or executed from them.

## Spike findings (Task 1, measured — `.peaks/_runtime/<sid>/rd/s8-spike.md`)

1. **Palette: from the PNG, never from the payload's `colors.dominance`.** That field's `areaShare` is not frame area: it ranks the toast body `#4e3938` at 99.9 % while the PNG measures 1.680 %; the real dominant colour `#1e1e1e` covers 93.650 / 92.095 / 95.759 % on the three frames. 5-bit distinct colours: 3,139 / 3,131 / 3,497.
2. **Non-app share is ~3.2 % and must be masked by measurement:** toast body + halo 2.68 %, devtools corners 0.65 %, top device rows 0.25 %. Browser chrome is 0 % (the capture is page-only). S5's paint metric reproduces 5.48 / 7.01 / 3.36 %.
3. **Contrast: declared-pair presence only.** The pilot declares no `pairs[]`, so contrast stays "not judged" (S7's rule). Every pair the payload emits is absent from the frame (0.000 % each) — a declared pair that never renders is `unmeasured`, never a pass. The one pair that really renders (toast `#ff6568` on `#4e3938` = 3.72:1) is an eye-check observation, not a scored pair. Per-element contrast needs a browser-side script S8 does not build.
4. **Overflow: not measurable today.** The payload carries only 2–5 top-level `regions[].bounds` and no scroll/client/overflow; `--width` is ignored by the screenshot path (390 → 2560×1600) and `--responsive-shots` is a dead flag in designlang 13.4.1. A real two-viewport capture exists only as a new Playwright path (measured 7 s/page) — a new capture mode, out of this slice.

## Global Constraints

- **Spike before rule.** Task 1 enumerates what the render payload and the captured PNG actually expose (colours, geometry, overflow, computed styles). A signal the evidence does not carry is `unmeasured` with the reason — never estimated from a proxy.
- **No model.** No VLM, no classifier. Contrast and palette are arithmetic on the rendered bytes and the declared contract.
- **The oracle stays the contract** (S7's rule): a palette family the contract does not declare is a finding only against a declared scale; an absent scale renders `unmeasured`.
- **A rendered page that cannot be captured** blocks that page's render dimensions only; the source dimensions keep their S7 behaviour.
- Every new detector ships the S7 calibration triple: a bad fixture, a clean fixture, and an inversion control that fails when the rule is flipped.
- Determinism: palette extraction over the same PNG must produce byte-identical output twice (fixture-pinned), so a report can be compared across runs.
- `.js` specifiers, prettier, eslint 0, `src/**` ≤ 300 raw lines, `tests/**` ≤ 500, BDD triple first; no new dependency.

## Review Focus

- **Overflow without geometry**: the most likely place to fake a signal. If the capture carries no element boxes, the only honest checks are the contract's own declared widths and a two-viewport comparison; the plan must name which of those S8 implements and which it records as `unmeasured`.
- **A palette that describes the app, not the screenshot**: browser chrome, devtools overlays and toast hosts (measured in S5 at ~6.7 % non-modal) must not become "families"; the spike records what is in the frame before any threshold is chosen.
- **Contrast over a gradient or an image background**: a pair that passes on the declared tokens can fail where it lands, and vice versa. The rule must say which background it measured.
- **Regression of S7's honesty rules**: no dimension may render 100 when it judged nothing.

---

### Task 1: Spike — what the rendered page exposes

- [ ] On the pilot, capture `/about`, `/channels` and the component URL through the existing probe and dump: the full `designlang extract --json` shape (every key, including any colour/geometry/overflow field), `stats --as-json`, and the `full-page.png` metadata (dimensions, byte size).
- [ ] From the PNG: decode it with `paint-metric.ts` and record (a) the distinct colour count and the top 10 by area share, (b) how much of the frame is browser chrome / toast host / devtools (measured in S5 at ~6.7 %), (c) whether text rows can be segmented at all (row-luminance profile) — the evidence a screenshot-based contrast would need.
- [ ] Answer three questions with numbers: **does the payload carry element geometry?** **does it carry computed colours?** **can text be separated from its background from the pixels alone?** Write `rd/s8-spike.md` with the answers and, for each of palette / contrast / overflow, one of: measurable from the PNG, measurable from the payload, measurable only with a browser-side script, or not measurable.

### Task 2: Palette from the captured PNG

**Files:** create `src/services/design/audit/render/palette.ts` (+ a PNG-to-colour module if the cap demands); tests + fixtures.

- [ ] Decode the capture (reuse `paint-metric.ts`; do not add a decoder), quantise to a fixed grid in OKLab, and merge neighbours within a ΔE threshold so one family is one entry.
- [ ] Rank by `0.3 × weighted area share + 0.7 × normalised chroma`, with edge pixels down-weighted — the article's Okmain shape, stated in the module header as its source.
- [ ] Drop non-app regions the spike identified (browser chrome, devtools, toast host) **by measurement**, not by guessing a rectangle.
- [ ] Emit `{ families: [{ colour, areaShare, chroma, rank }], neutralShare, distinctChromatic }`; a capture that cannot be decoded is `unmeasured` with the reason.
- [ ] Calibration fixtures: a synthetic PNG with five families and a known share split (exact numbers), the same with a sixth family, a near-monochrome page, and a gradient page whose ΔE ladder is pinned. Determinism test: the same PNG twice → identical output.
- [ ] ΔE ladder: for a declared hue scale, adjacent steps closer than the visible threshold (S7's `0.12` reference, or the contract's own) is a soft finding naming both steps.

### Task 3: Contrast on the rendered page

- [ ] Choose the rule from Task 1's answer, and record the choice in the module header:
  - if the payload exposes computed colours per element: compute text-on-background ratios from them and report failing pairs with their selector/box;
  - else: verify each **declared** pair against the rendered palette (a declared pair that never appears is `unmeasured` for that page, not a pass) and report a ratio only where both colours are found in the frame.
- [ ] The report must state which background the ratio was measured against (solid fill, gradient, or image), and a pair measured over a gradient or image is `unmeasured` with that reason.
- [ ] A page with no declared pairs stays `not judged` (S7's rule); S8 does not invent pairs.
- [ ] Calibration: a fixture where a declared pair fails only after rendering; one where it passes; one measured over a gradient (unmeasured).

### Task 4: Overflow — only what the evidence carries

- [ ] Implement exactly what Task 1 proved available, in this order of preference: (a) element boxes from the payload → compare `scrollWidth`/`clientWidth` per container; (b) two viewport captures (desktop and a 390 px mobile width) → compare the rendered text metric and paint distribution, reporting a page whose mobile frame loses content as `soft` with both captures named; (c) neither available → one fixed `unmeasured` row naming the missing capability, and no heuristic that pretends otherwise.
- [ ] Any rule that fires must name the evidence (the box pair, or both capture sizes) and must be inverted in a test.
- [ ] Fixtures: a page with a fixed-width table that overflows at 390 px (soft, if (b) is implemented), a responsive page that does not, and the `unmeasured` path for a tree without captures.

### Task 5: Pilot run and calibration

- [ ] Run the audit on the pilot with render evidence on the three routes from Task 1, record the three new dimensions in `design/audit-report-s8.md` (pilot copy), and verify each finding against the screenshot by eye: name what the frame shows for each.
- [ ] State the measured limits: what the palette cannot separate (system colours, images), what contrast cannot see (gradients, images, anti-aliased text), and what overflow still cannot see.
- [ ] Hand-off to S9: the seed library (style seeds from mature B-end products), screenshot-to-spec, and any VLM role — each only after a golden set exists.

## Out of scope

- A browser-side script that injects measurement code into the page (that is a new capture mode, and belongs to a slice that can budget for it).
- Style seeds, screenshot-to-spec reverse extraction, and VLM critique — S9.
- Any change to the source dimensions' rules from S7.

## Release note

S8 adds rendered dimensions to `peaks design audit`; the source dimensions and every S7 honesty rule are unchanged.
