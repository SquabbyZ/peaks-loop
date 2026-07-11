/**
 * Locale registry. Video renders two compositions (one per locale); scenes
 * consume copy via the strings below. Strict rules:
 *   - Each scene reads copy from this file only — no hardcoded CN/EN inline.
 *   - Tagline / footer / footer-of-closing slots use the locked separator
 *     sentence below, NOT ad-hoc CN/EN mixing.
 *   - All non-CJK is English. All CJK is Simplified Chinese. No Traditional.
 *
 * Narrative (v5.1 — multi-domain + slash-command + loop engineering):
 *   1. Intro                 — peaks-loop, hero tagline (talk / run / sediment)
 *   2. RecordingScene × 5    — install / first-slash / domains /
 *                              loop-engineering / sediment
 *   3. CreditScene           — Tribute + recommended stack
 *   4. Closing               — install chip + stats
 */

export type LocaleId = "zh" | "en";
export type CaptionStyle = "subtitle" | "callout" | "annotation";

export type CaptionLine = {
  text: string;
  style: CaptionStyle;
  /** When the caption appears (frame). When undefined, the scene's default
   *  "appears on enter" behaviour is used. */
  enterAt?: number;
  /** How long the caption stays after enterAt. */
  holdFor?: number;
};

export type CursorTick = {
  /** Frame to start moving the cursor to (x, y) in scene-normalized coords (0..1). */
  at: number;
  /** Target normalized x. */
  x: number;
  /** Target normalized y. */
  y: number;
  /** Optional click ripple at the end of the move. */
  click?: boolean;
  /** Frames to spend moving. */
  durationFrames?: number;
};

export type SceneCopy = {
  // IntroScene
  intro: {
    kicker: string;
    title: string;       // brand name, fixed "peaks-loop"
    taglineLineA: string;
    taglineSep: string;
    taglineLineB: string;
  };
  // RecordingScene × 4 — slugs used by the scene renderer
  recordings: ReadonlyArray<{
    slug: string;
    /** Captions stack from bottom; first entry appears at frame 0. */
    captions: ReadonlyArray<CaptionLine>;
    /** Cursor choreography (empty = no cursor overlay). */
    cursor: ReadonlyArray<CursorTick>;
    /** Optional inline HUD overlay (e.g. terminal output window). */
    hud?: {
      kind: "terminal" | "ide";
      lines: ReadonlyArray<string>;
      /** Lines to highlight (cyan accent) one by one as cursor passes. */
      highlightIndexes?: ReadonlyArray<number>;
    };
  }>;
  credit: {
    kicker: string;
    headlineLineA: string;
    headlineSep: string;
    headlineLineB: string;
    tributeLabel: string;
    tributeItems: ReadonlyArray<{ name: string; handle: string; role: string }>;
    stackLabel: string;
    stackItems: ReadonlyArray<{ name: string; tagline: string }>;
    footerLineA: string;
    footerSep: string;
    footerLineB: string;
  };
  closing: {
    chip: string;
    stats: { headline: string; sepChar: string; subline: string };
  };
};

export const COPY: Record<LocaleId, SceneCopy> = {
  zh: {
    intro: {
      kicker: "★ loop engineering · multi-domain · 4.x",
      title: "peaks-loop",
      taglineLineA: "你说话,它替你跑完一整条工程流水线",
      taglineSep: "—",
      taglineLineB: "不止写代码 · 跑两次就沉淀成本地战术",
    },
    recordings: [
      {
        slug: "install",
        hud: {
          kind: "terminal",
          lines: [
            "$ npm i -g peaks-loop",
            "+ peaks-loop@4.0.0-beta.7",
            "added 1 package in 3s",
          ],
        },
        captions: [
          { text: "第一步 · 一行命令装好", style: "callout" },
          { text: "npm i -g peaks-loop", style: "subtitle" },
        ],
        cursor: [],
      },
      {
        slug: "first-slash",
        hud: {
          kind: "ide",
          lines: [
            "› /peaks-code 帮我熟悉下当前的项目",
            "  ↳ 识别到 code 域 · 启动长任务编排器",
            "  ↳ PRD · RD · 实现 · QA · UI · 切片",
            "  ✓ 4 道闸门通过,1 道待你拍板",
          ],
          highlightIndexes: [0, 1, 3],
        },
        captions: [
          { text: "第二步 · 一条斜杠命令,显式触发", style: "callout" },
          { text: "/peaks-code 帮我熟悉下当前的项目", style: "subtitle" },
          { text: "★ 关键:必须以 /peaks-* 开头才稳,自然语言会被 IDE 吞掉", style: "annotation" },
        ],
        cursor: [
          { at: 4, x: 0.10, y: 0.62, click: true, durationFrames: 8 },
          { at: 14, x: 0.42, y: 0.62, durationFrames: 14 },
          { at: 30, x: 0.60, y: 0.62, click: true, durationFrames: 12 },
        ],
      },
      {
        slug: "domains",
        hud: {
          kind: "ide",
          lines: [
            "💻 /peaks-code                写代码、修 bug",
            "📝 /peaks-content             内容生产 / 出版",
            "🩺 /peaks-doctor              项目健康 · 红线审计",
            "🐛 /peaks-issue-fix-...       批量修 upstream issue",
            "📋 /peaks-sop                 自定义工作流 SOP",
            "? /peaks-solo                我不知道该用哪个",
          ],
        },
        captions: [
          { text: "第三步 · 五条域编排链,任意切换", style: "callout" },
          { text: "/peaks-* · 一个前缀,五条域", style: "subtitle" },
        ],
        cursor: [
          { at: 6, x: 0.10, y: 0.32, durationFrames: 10 },
          { at: 18, x: 0.10, y: 0.46, durationFrames: 10 },
          { at: 30, x: 0.10, y: 0.60, durationFrames: 10 },
          { at: 42, x: 0.10, y: 0.74, durationFrames: 10 },
          { at: 54, x: 0.10, y: 0.88, durationFrames: 10 },
        ],
      },
      {
        slug: "loop-engineering",
        hud: {
          kind: "ide",
          lines: [
            "› 抓 arxiv 每日论文 → 清理 → 入库",
            "  ↳ 第一次跑:跑通 ✓",
            "  ↳ 第二次跑:跑通 ✓ · 自动晋升",
            "  ↳ 沉淀成 bee-arxiv-daily",
            "    name · trigger · steps · gates · ★ STABLE",
          ],
        },
        captions: [
          { text: "第四步 · 跑两次稳定,自动沉淀成 bee", style: "callout" },
          { text: "loop engineering · 结晶成你本地的战术", style: "subtitle" },
          { text: "★ 这才是 peaks-loop 跟其它 AI 编排器的根本区别", style: "annotation" },
        ],
        cursor: [
          { at: 4, x: 0.10, y: 0.40, click: true, durationFrames: 10 },
          { at: 18, x: 0.10, y: 0.55, click: true, durationFrames: 8 },
          { at: 30, x: 0.10, y: 0.70, click: true, durationFrames: 8 },
          { at: 44, x: 0.20, y: 0.85, durationFrames: 14 },
        ],
      },
      {
        slug: "sediment",
        hud: {
          kind: "ide",
          lines: [
            "› 跑那只",
            "  ↳ 调出 bee-arxiv-daily,自动复跑",
            "  ✓ 你那几只 bee 跟着口味长",
          ],
        },
        captions: [
          { text: "第五步 · 下次说「跑那只」,整套自动就位", style: "callout" },
          { text: "跑过的套路 → 沉淀 → 复跑", style: "subtitle" },
        ],
        cursor: [
          { at: 4, x: 0.10, y: 0.40, click: true, durationFrames: 8 },
          { at: 18, x: 0.55, y: 0.40, durationFrames: 12 },
        ],
      },
    ],
    credit: {
      kicker: "★ standing on shoulders",
      headlineLineA: "我们向这些项目致敬",
      headlineSep: "—",
      headlineLineB: "它们定义了 peaks-loop 的两条工程脊柱",
      tributeLabel: "inspired by",
      tributeItems: [
        { name: "andrej-karpathy-skills", handle: "@multica-ai", role: "工程纪律" },
        { name: "darwin-skill", handle: "@alchaincyf", role: "演化校验" },
      ],
      stackLabel: "recommended combo · 0 learning cost",
      stackItems: [
        { name: "peaks-loop", tagline: "loop engineering · 多域编排" },
        { name: "ECC", tagline: "everything-claude-code · 战术" },
        { name: "Understand-Anything", tagline: "@Egonex-AI · 代码理解" },
        { name: "superpowers", tagline: "@obra · 流程纪律" },
      ],
      footerLineA: "peaks-loop + ECC + Understand-Anything + superpowers",
      footerSep: "—",
      footerLineB: "一句话组合上手,效果俱佳,0 学习成本",
    },
    closing: {
      chip: "npm i -g peaks-loop",
      stats: {
        headline: "门禁不是装饰",
        sepChar: "—",
        subline: "5,439 tests passed · 19 skipped · 0 failed",
      },
    },
  },
  en: {
    intro: {
      kicker: "★ loop engineering · multi-domain · 4.x",
      title: "peaks-loop",
      taglineLineA: "You talk. It runs the whole engineering chain for you",
      taglineSep: "—",
      taglineLineB: "beyond just code · twice-run flows sediment into local tactics",
    },
    recordings: [
      {
        slug: "install",
        hud: {
          kind: "terminal",
          lines: [
            "$ npm i -g peaks-loop",
            "+ peaks-loop@4.0.0-beta.7",
            "added 1 package in 3s",
          ],
        },
        captions: [
          { text: "Step 1 · One line to install", style: "callout" },
          { text: "npm i -g peaks-loop", style: "subtitle" },
        ],
        cursor: [],
      },
      {
        slug: "first-slash",
        hud: {
          kind: "ide",
          lines: [
            "› /peaks-code walk me through this codebase",
            "  ↳ code domain detected · long-task orchestrator on",
            "  ↳ PRD · RD · code · QA · UI · slice",
            "  ✓ 4 gates passed · 1 gate waiting on you",
          ],
          highlightIndexes: [0, 1, 3],
        },
        captions: [
          { text: "Step 2 · One explicit slash command", style: "callout" },
          { text: "/peaks-code walk me through this codebase", style: "subtitle" },
          { text: "★ Heads up — natural language may be intercepted; slash is the safe trigger", style: "annotation" },
        ],
        cursor: [
          { at: 4, x: 0.10, y: 0.62, click: true, durationFrames: 8 },
          { at: 14, x: 0.42, y: 0.62, durationFrames: 14 },
          { at: 30, x: 0.60, y: 0.62, click: true, durationFrames: 12 },
        ],
      },
      {
        slug: "domains",
        hud: {
          kind: "ide",
          lines: [
            "💻 /peaks-code                write code, fix bugs",
            "📝 /peaks-content             content production / publish",
            "🩺 /peaks-doctor              project health · red-line audit",
            "🐛 /peaks-issue-fix-...       batch-fix upstream issues",
            "📋 /peaks-sop                 author custom workflow SOPs",
            "? /peaks-solo                I don't know which one — you decide",
          ],
        },
        captions: [
          { text: "Step 3 · Five domains, one prefix", style: "callout" },
          { text: "/peaks-* · one prefix, five orchestrators", style: "subtitle" },
        ],
        cursor: [
          { at: 6, x: 0.10, y: 0.32, durationFrames: 10 },
          { at: 18, x: 0.10, y: 0.46, durationFrames: 10 },
          { at: 30, x: 0.10, y: 0.60, durationFrames: 10 },
          { at: 42, x: 0.10, y: 0.74, durationFrames: 10 },
          { at: 54, x: 0.10, y: 0.88, durationFrames: 10 },
        ],
      },
      {
        slug: "loop-engineering",
        hud: {
          kind: "ide",
          lines: [
            "› fetch arxiv daily → clean → index",
            "  ↳ 1st run: pass ✓",
            "  ↳ 2nd run: pass ✓ · auto-promote",
            "  ↳ sediment as bee-arxiv-daily",
            "    name · trigger · steps · gates · ★ STABLE",
          ],
        },
        captions: [
          { text: "Step 4 · Twice-clean runs sediment into a bee", style: "callout" },
          { text: "loop engineering · your local tactic", style: "subtitle" },
          { text: "★ This is what separates peaks-loop from every other orchestrator", style: "annotation" },
        ],
        cursor: [
          { at: 4, x: 0.10, y: 0.40, click: true, durationFrames: 10 },
          { at: 18, x: 0.10, y: 0.55, click: true, durationFrames: 8 },
          { at: 30, x: 0.10, y: 0.70, click: true, durationFrames: 8 },
          { at: 44, x: 0.20, y: 0.85, durationFrames: 14 },
        ],
      },
      {
        slug: "sediment",
        hud: {
          kind: "ide",
          lines: [
            "› run that one",
            "  ↳ pull bee-arxiv-daily, auto replay",
            "  ✓ your few bees grow with your taste",
          ],
        },
        captions: [
          { text: "Step 5 · Say \u201crun that one\u201d — the whole playbook slots back in", style: "callout" },
          { text: "run → sediment → replay", style: "subtitle" },
        ],
        cursor: [
          { at: 4, x: 0.10, y: 0.40, click: true, durationFrames: 8 },
          { at: 18, x: 0.55, y: 0.40, durationFrames: 12 },
        ],
      },
    ],
    credit: {
      kicker: "★ standing on shoulders",
      headlineLineA: "Tribute to the projects that shaped us",
      headlineSep: "—",
      headlineLineB: "they defined peaks-loop's two engineering spines",
      tributeLabel: "inspired by",
      tributeItems: [
        { name: "andrej-karpathy-skills", handle: "@multica-ai", role: "engineering discipline" },
        { name: "darwin-skill", handle: "@alchaincyf", role: "evolution verification" },
      ],
      stackLabel: "recommended combo · 0 learning cost",
      stackItems: [
        { name: "peaks-loop", tagline: "loop engineering · multi-domain" },
        { name: "ECC", tagline: "everything-claude-code · tactics" },
        { name: "Understand-Anything", tagline: "@Egonex-AI · code understanding" },
        { name: "superpowers", tagline: "@obra · process discipline" },
      ],
      footerLineA: "peaks-loop + ECC + Understand-Anything + superpowers",
      footerSep: "—",
      footerLineB: "compose them in one sentence — best effect, zero learning cost",
    },
    closing: {
      chip: "npm i -g peaks-loop",
      stats: {
        headline: "Gates aren't decoration",
        sepChar: "—",
        subline: "5,439 tests passed · 19 skipped · 0 failed",
      },
    },
  },
};