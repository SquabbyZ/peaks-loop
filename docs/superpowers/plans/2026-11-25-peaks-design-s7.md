# peaks design — S7 Implementation Plan (computable diagnosis layer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "功能都对，但看着不舒服" into dimension scores with element-level locations, computed from the repository's own source and the declared token scale — no VLM, no DOM geometry, every detector proven on a fixture that is known to be bad.

**Architecture:** A new `design/audit` analyser reads the same source set the G1 scan reads plus the contract's `tokenScale`, and emits findings `{ file, line, dimension, severity, value, expected, humanText, techText }`. Dimensions are scored 0–100 from their findings; a report aggregates them into `design/audit-<rid>.md` + `.json`. Severity is split: **hard** (usability / accessibility — a raw hard-coded colour where tokens exist, text-background contrast below WCAG) and **soft** (aesthetic — off-ladder spacing, crowded type scale, more than five chromatic families, inconsistent radius/elevation). A golden fixture set calibrates every detector: each bad fixture must produce its expected finding, and each clean fixture must produce none.

**Tech Stack:** TypeScript ESM, the existing `src/services/design/source-scan/*` scanner, Vitest; no new dependency, no network, no browser.

**Spec / references:** the user's own design notes (2026-11-25 conversation) and the article *色彩、算法与美学* (Visualizeit) — read as references only. Two formulas from it are adopted here and nowhere else: adjacent palette steps are only visible at `ΔE ≈ 0.12` in OKLab (`ΔE = √(ΔL²+Δa²+Δb²)`), and colour used as decoration is measurable as area share. The UICrit / UI-Lens / DesignRepair material in the same notes is background for later slices, not for this one.

## Global Constraints

- **No VLM, no image model, no DOM.** S7 reads source text and the contract's `tokens.json` / `paved-road.json` only. A signal that needs pixels is S8; a signal that needs a model is S9.
- **The oracle is the project's declared `tokenScale`**, not a hard-coded ladder. A value is off-ladder only against the contract it lives in; a contract that declares no scale records "unmeasured", never a violation.
- **Every detector is calibrated by a fixture pair.** A detector test must show: the bad fixture produces the expected finding (with its line), the clean fixture produces none, and the assertion fails if the detector is inverted. A detector that cannot fail is not a detector.
- Hard findings are usability/accessibility and are named as such; soft findings are aesthetic. The audit never returns a single "beautiful" score.
- Each finding carries a **bilingual line** the user and the LLM can both act on: a plain sentence ("第 3 个卡片的间距是 20px，其他是 16px") and a technical one (`src/.../Card.tsx:42 padding:20px not in tokenScale.space`).
- No new dependency; `.js` specifiers; prettier; eslint 0; `src/**` ≤ 300 raw lines per file, `tests/**` ≤ 500 — split by responsibility, never trim comments; BDD triple first.

## Spike findings (Task 1, measured — `.peaks/_runtime/<sid>/rd/s7-spike.md`)

Six numbers redefine the tasks below; none of them is a preference.

1. **The oracle does not exist yet.** `readPavedRoad()` parses the declared `tokenScale` and then **discards it**, returning the built-in default. AC2 ("the oracle is the project's own scale") is false until that is fixed — a prerequisite, not part of a detector.
2. **The values are runtime-density-dependent.** In the pilot, 83 % of spacing, 91 % of font-size and 72 % of radius values resolve only against a runtime state (`--spacing ∈ {4, 4.8, 3.6, 4.48} px`, `--radius` overridden per density block). Comparing a literal's px against one preset would produce hundreds of false findings. The detectors compare **ladder steps** (is this value a step in the declared scale?) and pin one density state for px display; a value that only resolves through a state-dependent variable is `unmeasured`.
3. **The page-root cut loses a quarter of the evidence.** 405 scannable files outside the G1 set hold 23.7 % of all literals, 62.6 % of elevation and 37.7 % of colour, and 1886 imports point at 101 component modules the scan never opens. The audit walks the page roots **plus their import closure** (bounded, reported), and state detection follows imports rather than the single file.
4. **A non-UI repository must say so.** On peaks-loop's own `src/**` every dimension resolves to "not a UI project" — not 0 and not a pass. The audit distinguishes "not applicable" from "clean".
5. **Colour has notation and coverage gaps.** The existing `RAW_COLOR` rule's `\b` cannot fire after `_` (5 `rgba()` in arbitrary shadows invisible), `oklch(… )` with underscores is unreadable, `tokens.json` declares 10 colour keys against 51 semantic variables (20 %), and **no fg/bg pair table exists anywhere** — so contrast is `unmeasured` unless the contract declares pairs.
6. **Elevation has no declared scale** (37 hits, all unmeasured): reported as unmeasured with the recommendation to declare a shadow scale, never invented.

## Review Focus

- **A false positive on a healthy page**: a page that follows its contract must score full. Task 2 and Task 3 each ship a clean fixture that fails the test when the detector over-fires.
- **A value the parser cannot read**: arbitrary CSS (`calc()`, `clamp()`, CSS variables, dynamic class strings) must be reported as *unmeasured*, never counted as off-ladder and never silently dropped.
- **Severity inversion**: a hard finding downgraded to soft (a raw hex where tokens exist) or a soft one escalated (five spacing tiers) is the failure that makes the audit ignorable. Task 4 pins the mapping in one table.
- **Score drift with input volume**: adding pages must not lower a page's score. Task 4 scores per page and aggregates by the worst page, not by counting all findings.
- **The delivery checklist is the dimension set, not an afterthought**: the six questions a person checks before shipping (does the first screen show the point; are title, body and secondary text distinguishable; are spacing, radius and buttons consistent; does anything overflow on a phone; are loading, empty and error states present; do keyboard use and contrast pass) map one-to-one onto these dimensions. The responsive one has no source-level signal and must be reported as `unmeasured`, never guessed.

---

### Task 1: Spike — what the scanner already gives, measured

- [ ] Instrument the existing scan on `D:\projects\ModelMatrix-pilot\web` (and on this repo's own `src/**`): for every source file, dump (a) every spacing-like literal found — Tailwind spacing classes, `padding/margin/gap` in CSS and inline styles, `rem`/`px` — (b) every font-size and font-weight, (c) every colour literal, (d) every radius and shadow.
- [ ] Against each project's declared `tokenScale`, report how many values sit on the ladder, off it, and unreadable (`calc`, `var()`, dynamic templates). Record the counts and the top offenders with file:line.
- [ ] Record what the scanner **cannot** see (dynamic class strings, CSS-in-JS at runtime, SVG fills) so the report can say "unmeasured" by name.
- [ ] Write the numbers to `rd/s7-spike.md`. No code change in this task beyond a throwaway script under `.peaks/_runtime/`.

### Task 2: Honour the declared token scale, then the spacing and type detectors

**Files:** modify `src/services/design/paved-road.ts` (the discarded scale); create `src/services/design/audit/audit-spacing.ts`, `audit-type.ts`; tests `tests/unit/design/audit-spacing.test.ts`, `audit-type.test.ts`, plus a case in `tests/unit/design/paved-road-and-engine.test.ts`; fixtures under `tests/fixtures/design/audit/`.

- [ ] **Step 0, the prerequisite:** `readPavedRoad()` must return the `tokenScale` the file declares, and fall back to the built-in default only when the field is absent. A test pins both: a file with a custom scale round-trips it, an absent field yields the default, and a malformed value yields the default **and a named warning** — a silent substitution is the bug this step exists to remove.

- [ ] `auditSpacing(input): AuditFinding[]` — compare a value's **ladder step**, not its px: Tailwind `p-4`/`gap-2` map to steps, and a raw `padding: 20px` is off-ladder only when no step of the declared scale carries that value. A value that resolves only through a state-dependent CSS variable is `severity: 'unmeasured'` with the variable named, never a violation. An off-ladder value yields `{ dimension: 'spacing', severity: 'soft', value, expected: <nearest step>, line }`.
- [ ] `auditType(input)` — distinct font-size **steps** against `tokenScale.font` (more than four levels, or two adjacent levels less than one step apart → soft); a weight set missing any of 400/500/600/700 is reported once per page naming the missing weights (unmeasured when the contract declares no weight scale).
- [ ] Fixtures: a page with `16/16/16/20` on-ladder (clean), a page with `13/15/17/20` off-ladder, `calc()` / `var(--spacing)` cases that must read as unmeasured, and a fixture project whose `paved-road.json` declares a non-default scale (proving the audit uses it, not the built-in default).
- [ ] Tests prove both directions and the inversion guard (a test that fails if the detector is flipped to "everything is off-ladder").

### Task 3: Colour and contrast detectors

**Files:** create `src/services/design/audit/audit-color.ts`, `audit-contrast.ts`; tests + fixtures.

- [ ] `auditColor(input)` — classify each colour literal by chroma in OKLCH (reuse `css-color.ts`): chromatic families are hue buckets at 30°, **dark-theme duplicates of the same family are subtracted**; more than five families across a page is `severity: 'soft'` with the family list; a raw hex/rgba literal where `tokens.json` declares a colour token is `severity: 'hard'` (the contract says use the token). The reader must handle the notations the spike measured as invisible or unreadable: `rgba()` appearing after an identifier character, and `oklch()` written with underscores.
- [ ] `auditContrast(tokens)` — only pairs the contract **declares**: compute the WCAG ratio for each; body text below 4.5:1 and large text below 3:1 is `severity: 'hard'` with both token names and the measured ratio. With no declared pair table (the pilot has none) the dimension is `unmeasured`, and the report recommends declaring pairs — it never guesses a pairing from token names.
- [ ] Fixtures: a five-family page (clean), a seven-family page (soft), a raw-hex page (hard), a tokens file with one failing pair (hard) and one passing file (clean).
- [ ] Contrast maths is tested against known pairs: `#000` on `#fff` = 21:1, `#767676` on `#fff` ≈ 4.54:1, `#777` on `#fff` ≈ 4.48:1 (the boundary that must fall on different sides).

### Task 3b: CSS-aware scan — read the stylesheet, not only the class names

**Why this task exists:** the spike's top recommendation, and the reason a legacy project (plain CSS, few utilities) would otherwise score almost entirely `unmeasured`. `.css` is not a scannable extension today, so the audit cannot see the variables that define the very ladder it judges.

**Files:** extend `src/services/design/source-scan/` (extension list + a rules reader); tests.

- [ ] Add `css` (and `scss` when the project has it) to the scannable set, parsed only for declarations the audit needs: `padding*`, `margin*`, `gap*`, `font-size`, `font-weight`, `color`, `background-color`, `border-radius`, `box-shadow`, and custom-property definitions (`--spacing`, `--text-*`, `--radius*`).
- [ ] Build a variable table (`--name → value or state-dependent set`) so a value written `var(--spacing)` resolves when exactly one definition exists, and reads `unmeasured` naming the variable when it resolves differently per state (the spike measured `--spacing ∈ {4, 4.8, 3.6, 4.48} px`).
- [ ] The audit declares which state it scored: when the project defines more than one state, the report names the one used and the ones skipped — never an average.
- [ ] Fixtures: a plain-CSS page on the declared ladder (clean), the same page with `13px` gaps (soft), and a project whose `--radius` is overridden per density block (the audit names the state).
- [ ] Tests: a `.css` file contributes findings; a `var()` with one definition resolves; a `var()` with three definitions is `unmeasured` with all three values listed; the extension list change does not make the G1 source gate judge `.css` rules it did not judge before (pin that boundary explicitly).


### Task 4: Report aggregation, severity table, and the CLI

**Files:** create `src/services/design/audit/audit-report.ts`, `audit-scoring.ts`; modify the design command surface; tests.

- [ ] One severity table, tested: every dimension maps to `hard` | `soft` | `unmeasured`, and a test asserts the table is exhaustive over the dimension union (a new dimension without a row fails).
- [ ] Per-page scoring: each dimension starts at 100 and loses points per finding with a documented per-finding cost; the page score is the **worst** page's score, never an average across pages (adding a page cannot raise the number).
- [ ] `audit-report.ts` renders `design/audit-<rid>.md` (bilingual finding lines, a dimension table, the unmeasured list) and the `.json` sibling with a `schemaVersion`.
- [ ] `peaks design audit --project <app root> [--rid <rid>] [--json]` runs the audit and writes the pair; it never exits non-zero for findings (it is advisory in this slice) and exits 2 when the contract is missing.
- [ ] Tests: a fixture tree with three pages renders a report whose worst-page score and dimension table match an expected snapshot; a missing contract exits 2 with a named reason.

### Task 5: Consistency, hierarchy, accessibility and the responsive gap

**Files:** create `src/services/design/audit/audit-surface.ts`, `audit-states.ts`, `audit-hierarchy.ts`, `audit-a11y.ts`; tests + fixtures.

- [ ] `auditSurface(input)` — distinct radius values against `tokenScale.radius` (more than three tiers → soft); shadow declarations with blur > 12 px on a B-end surface (soft, message quotes the measured blur).
- [ ] `auditStates(input)` — a page that renders a data list or table but has no empty-state and no error-state branch (no `empty`, `loading`, `error` component reference or conditional in the same file) → `severity: 'hard'` (the half-finished feel is a usability defect); only when the page is detected as data-bearing, and the detector says which evidence made it fire.
- [ ] Fixtures: a data page with empty+error branches (clean), one without (hard), a static marketing page (never fires).
- [ ] Tests prove the false-positive guard: a page whose empty state lives in a child component is measured through the **import closure** (the spike measured 101 component modules the single-file scan never opens), never through the single file alone.
- [ ] `auditHierarchy(input)` — the “第一眼知道重点吗” question, as far as source can carry it: a page with no `h1` is soft; more than one element styled as the primary action in one page module is soft and names them; fewer than three distinguishable type levels (size + weight + colour) is soft. It never scores beauty.
- [ ] `auditA11y(input)` — hard findings: an `onClick` on a non-interactive element (a `div` / `span` / `li`) with no `role` / `tabIndex`; a custom interactive component with no `focus-visible` style anywhere in the file set. Both name the `file:line` and the missing attribute.
- [ ] `auditSurface` additionally reports the number of distinct button class strings that carry the primary style — more than one is the “主按钮被复制成几套” tell.
- [ ] The responsive overflow question (phones) is recorded as `unmeasured` with the reason “needs the rendered page” — it is S8’s, and a source heuristic must not pretend to answer it.

### Task 6: Pilot run and calibration report

- [ ] Run `peaks design audit` on `D:\projects\ModelMatrix-pilot\web` and on this repo; record the dimension table, the hard findings, and the unmeasured list in `design/audit-report-s7.md`. For a repository with no UI (this one: 1443 `.ts`, no `.tsx`, no `design/` contract) the verdict is **"not a UI project"** — never a score, never a pass, and five prose false positives must not appear as findings.
- [ ] For each dimension, state whether the pilot produced a finding, whether that finding is a true positive on inspection, and what the fixture set says about the detector's reliability. A dimension that fires nothing on a page the user calls "看着不舒服" is recorded as a gap, not as a pass.
- [ ] **Page scoping check.** The first pilot run scored 773 "pages" — every `.tsx` under the app root, including dialogs and drawers, which are components, not routes. When `paved-road.json` declares `pageRoots`, those are the scored pages; everything else is context for the import closure and is reported as such. A test pins that a component outside the page roots is not a scored page.
- [ ] **Value dimensions read the page's closure.** Fixing the page scope exposed the opposite error: measuring only a route entry dropped `spacing` from 4,500 values to 24 and `color` to 0, because the values live in the components the page renders. Page-scope rules (`h1`, states, primary-action count) judge the page; value rules (`spacing`, `type`, `color`, `surface` radius/shadow) judge the page **plus its import closure**, deduped per page, and the scope line says so. The five confirmed colour findings the calibration checked must reappear.
- [ ] **Input hygiene the first pilot run exposed.** Two false-positive sources must be removed before any number is trusted: (a) **test files are not audited** (`*.test.*`, `*.spec.*`, `__tests__/**`, `__mocks__/**` are excluded everywhere, and a test pins it); (b) **a component is not a page** — within `pageRoots`, a scored page is a route entry (a file under `routes/`, `pages/`, or `app/` matching its conventions, or a root's own `index.*`), and everything else is context. The pilot's `pageRoots` include `src/features`, so "no `h1`" fired on 957 components and tests; after this fix the finding only applies to route pages, and the report names the page-derivation rule it used.
- [ ] **Score shape check, and fix it if it fails.** Per-finding cost alone collapses a real page to 0 as soon as a few findings land (the first pilot run put most of 773 pages at 0 while 76 % of spacing values were on-ladder). For value-based dimensions (spacing, type, colour) the score must be the **share of measured values that are on-contract** — `100 × onLadder / measured`, `unmeasured` excluded from both sides and reported separately — and a test pins that a page with 20 off-ladder of 100 scores 80, not 0. Boolean dimensions (states, a11y) stay cost-based, because one hit is the whole signal.
- [ ] Record the S8 hand-off: which signals still need the rendered page (palette area share, ΔE ladder between scale steps), and which need a calibrated model.

## Out of scope (later slices)

- Rendering-based palette extraction (Okmain-style area/share/chroma scoring) and ΔE ladder checks — S8, because they need the captured screenshot.
- Style seeds, screenshot-to-spec, and the `theme-overrides.css` progressive migration — S9.
- Any VLM critique layer — S9 at the earliest, and only after a golden set exists to calibrate it.

## Release note

S7 adds a new advisory command surface (`peaks design audit`) and writes `design/audit-<rid>.md`; no prerequisite and no `backCompatUntil` change.
