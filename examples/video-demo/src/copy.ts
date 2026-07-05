/**
 * Locale registry. Video renders two compositions (one per locale); scenes
 * consume copy via the strings below. Strict rules:
 *   - Each scene reads copy from this file only — no hardcoded CN/EN inline.
 *   - Tagline / footer / footer-of-closing slots use the locked separator
 *     sentence below, NOT ad-hoc CN/EN mixing.
 *   - All non-CJK is English. All CJK is Simplified Chinese. No Traditional.
 */

export type LocaleId = "zh" | "en";

export type SceneCopy = {
  // TitleScene
  title: {
    kicker: string; // kicker above the title
    taglineLineA: string; // first line of locked separator sentence
    taglineSep: string; // the literal separator (e.g. "—")
    taglineLineB: string; // second line of locked separator sentence
  };
  philosophy: {
    footerLineA: string;
    footerSep: string;
    footerLineB: string;
  };
  demos: ReadonlyArray<{
    title: string;
    subtitle: string;
    steps: ReadonlyArray<string>;
  }>;
  sediment: {
    beats: ReadonlyArray<{
      kicker: string;
      headlineLineA: string;
      headlineSep: string;
      headlineLineB: string;
      bubbleLineA: string;
      bubbleSep: string;
      bubbleLineB: string;
    }>;
  };
  closing: {
    chip: string; // install line (already single-lang)
    repoArc: {
      wasLabel: string;
      repoWas: string;
      arrow: string;
      repoNow: string;
      caption: string;
    };
    skillArc: {
      skillWas: string;
      arrow: string;
      skillNow: string;
      legacyCaption: string;
      codeCaption: string;
    };
    footerLineA: string;
    footerSep: string;
    footerLineB: string;
    stats: {
      headline: string; // zh: "门禁不是装饰"
      sepChar: string;
      subline: string; // zh: "5439 tests passed · 19 skipped · 0 failed"
    };
  };
};

export const COPY: Record<LocaleId, SceneCopy> = {
  zh: {
    title: {
      kicker: "★ loop engineering · in production",
      taglineLineA: "peaks-loop,你的 AI 战术小队",
      taglineSep: "—",
      taglineLineB: "24 小时待命,一句话交付一整条工程流水线",
    },
    philosophy: {
      footerLineA: "做这个项目的只有一个人",
      footerSep: "·",
      footerLineB: "工程师口味",
    },
    demos: [
      {
        title: "写长任务代码",
        subtitle: "end-to-end · requirement → PRD → implementation → QA",
        steps: ["peaks-code", "peaks-prd", "peaks-rd", "peaks-qa", "peaks-ui", "peaks-sc", "peaks-txt"],
      },
      {
        title: "修 bug 当天发",
        subtitle: "fix → review → tests → ship, same day",
        steps: ["peaks-code", "peaks-rd", "peaks-qa", "peaks-sc"],
      },
      {
        title: "接一个长跑的需求",
        subtitle: "fuzzy ask → landed code, one tactician's chain",
        steps: ["peaks-code", "peaks-prd", "peaks-rd", "peaks-qa", "peaks-sc"],
      },
    ],
    sediment: {
      beats: [
        {
          kicker: "NL",
          headlineLineA: "跑过一次还想跑",
          headlineSep: "—",
          headlineLineB: "一句话让它永久驻场",
          bubbleLineA: "把'抓 arxiv 每日论文 → 清理 → 入库'沉淀成我的 bee",
          bubbleSep: "",
          bubbleLineB: "",
        },
        {
          kicker: "MANIFEST",
          headlineLineA: "沉淀成战术套路",
          headlineSep: "—",
          headlineLineB: "不是简单的动作招式",
          bubbleLineA: "BeeManifest: name · trigger · steps · gates",
          bubbleSep: "",
          bubbleLineB: "",
        },
        {
          kicker: "BEE",
          headlineLineA: "驻场,下次说跑就跑",
          headlineSep: "—",
          headlineLineB: "一只属于你的 bee,只听你一个人的",
          bubbleLineA: "bee-arxiv-daily",
          bubbleSep: "·",
          bubbleLineB: "STABLE",
        },
      ],
    },
    closing: {
      chip: "npm i -g peaks-loop",
      repoArc: {
        wasLabel: "仓库以前",
        repoWas: "peaks-cli",
        arrow: "→",
        repoNow: "peaks-loop",
        caption: "repo · was, now",
      },
      skillArc: {
        skillWas: "peaks-solo",
        arrow: "→",
        skillNow: "peaks-code",
        legacyCaption: "单角色(老入口)",
        codeCaption: "带门禁(代码域)",
      },
      footerLineA: "你说话,它替你排工程门禁",
      footerSep: "—",
      footerLineB: "坏在哪道停在哪道,你拍板",
      stats: {
        headline: "门禁不是装饰",
        sepChar: "—",
        subline: "5,439 tests passed · 19 skipped · 0 failed",
      },
    },
  },
  en: {
    title: {
      kicker: "★ loop engineering · in production",
      taglineLineA: "peaks-loop, your AI tactical squad",
      taglineSep: "—",
      taglineLineB: "on call 24/7, one sentence runs the whole engineering chain",
    },
    philosophy: {
      footerLineA: "Built by one engineer",
      footerSep: "·",
      footerLineB: "an engineer's taste",
    },
    demos: [
      {
        title: "Ship a long task",
        subtitle: "end-to-end · requirement → PRD → implementation → QA",
        steps: ["peaks-code", "peaks-prd", "peaks-rd", "peaks-qa", "peaks-ui", "peaks-sc", "peaks-txt"],
      },
      {
        title: "Fix a bug, ship it today",
        subtitle: "fix → review → tests → ship, same day",
        steps: ["peaks-code", "peaks-rd", "peaks-qa", "peaks-sc"],
      },
      {
        title: "Take a long-running ask",
        subtitle: "fuzzy ask → landed code, one tactician's chain",
        steps: ["peaks-code", "peaks-prd", "peaks-rd", "peaks-qa", "peaks-sc"],
      },
    ],
    sediment: {
      beats: [
        {
          kicker: "NL",
          headlineLineA: "Run once, want to run again",
          headlineSep: "—",
          headlineLineB: "one sentence grounds it forever",
          bubbleLineA: "Sediment 'fetch arxiv daily → clean → index' into my bee",
          bubbleSep: "",
          bubbleLineB: "",
        },
        {
          kicker: "MANIFEST",
          headlineLineA: "Sediment the playbook",
          headlineSep: "—",
          headlineLineB: "not just a skill spell",
          bubbleLineA: "BeeManifest: name · trigger · steps · gates",
          bubbleSep: "",
          bubbleLineB: "",
        },
        {
          kicker: "BEE",
          headlineLineA: "Grounded — run it next time",
          headlineSep: "—",
          headlineLineB: "a bee of your own, only you call it",
          bubbleLineA: "bee-arxiv-daily",
          bubbleSep: "·",
          bubbleLineB: "STABLE",
        },
      ],
    },
    closing: {
      chip: "npm i -g peaks-loop",
      repoArc: {
        wasLabel: "Repo used to be",
        repoWas: "peaks-cli",
        arrow: "→",
        repoNow: "peaks-loop",
        caption: "repo · was, now",
      },
      skillArc: {
        skillWas: "peaks-solo",
        arrow: "→",
        skillNow: "peaks-code",
        legacyCaption: "single-role (legacy)",
        codeCaption: "gate-bearing, code-domain",
      },
      footerLineA: "You talk, it lays out the engineering gates",
      footerSep: "—",
      footerLineB: "fail where it fails, you decide",
      stats: {
        headline: "Gates aren't decoration",
        sepChar: "—",
        subline: "5,439 tests passed · 19 skipped · 0 failed",
      },
    },
  },
};
