/**
 * v2.15.0 follow-up — G4: user touchpoint classifier.
 *
 * 12 Gaps positioning memory: "user 介入 = 业务/产品审阅,不是技术决策".
 * This service classifies every Solo gate by the kind of decision it
 * represents, so the CLI / status line can show user which gates
 * actually need their attention vs which are technical defaults
 * (AI auto-decides in full-auto).
 *
 *   - `business`         — user MUST be present (business / product decisions)
 *   - `tech`             — AI auto-decides in full-auto (tech choices)
 *   - `mode-selection`   — the gate IS the mode / context selection
 *                          itself (always prompts the user, even in
 *                          full-auto)
 *   - `commit-boundary`  — hard-floor: push / tag / publish / global
 *                          install (always prompts, even in full-auto)
 *   - `commit-floor`     — other hard-floor categories
 *                          (irreversible-external / auth / multi-day
 *                          investment)
 *
 * Pure functions. No I/O.
 */

export type GateKind = 'business' | 'tech' | 'mode-selection' | 'commit-boundary' | 'commit-floor';

export interface GateClassification {
  readonly step: string;
  readonly kind: GateKind;
  /** Short description of what the user / AI is deciding. */
  readonly description: string;
  /** Whether full-auto can auto-proceed this gate. */
  readonly fullAutoCanProceed: boolean;
  /** When user should pay attention (always / business-only / never). */
  readonly userShouldReview: 'always' | 'business-only' | 'never';
}

/** Classification table — one row per Solo gate. */
interface RawGate {
  step: string;
  kind: GateKind;
  description: string;
  fullAutoCanProceed: boolean;
  userShouldReview: 'always' | 'business-only' | 'never';
}

const RAW_CLASSIFICATION: readonly RawGate[] = [
  {
    step: 'step-0.5-openspec-opt-in',
    kind: 'mode-selection',
    description: 'OpenSpec 一次性 opt-in(使用 OpenSpec spec-first 流程)。这是 context 选择门,user 必答。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'step-0.6-audit-goal',
    kind: 'business',
    description: 'Audit + Goal 确认。goal 必须明确区分业务/产品(user 写)与技术(AI 拍板)。user 必审。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'step-0.7-resume-detection',
    kind: 'mode-selection',
    description: '未完工作续做 vs 重开。context 选择门,user 必答。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'step-0.55-1x-upgrade',
    kind: 'commit-floor',
    description: '1.x → 2.0 升级检测。不可逆外部副作用(改写 config + cache schema),所有 mode 都必须 AskUserQuestion。full-auto 也暂停。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'step-0.75-checkpoint-resume',
    kind: 'tech',
    description: '同 session 当日重入 + checkpoint 续做。技术恢复逻辑,user 不参与。',
    fullAutoCanProceed: true,
    userShouldReview: 'never'
  },
  {
    step: 'step-1-mode-select',
    kind: 'mode-selection',
    description: 'Mode 选择(全自动化 / 半自动 / 蜂群 / 严格)。context 选择门,user 必答。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'step-2.5-session-title',
    kind: 'tech',
    description: 'Session 标题生成(从用户首次请求抽取)。技术性 metadata,AI 自决。',
    fullAutoCanProceed: true,
    userShouldReview: 'never'
  },
  {
    step: 'phase-2-prd-confirm',
    kind: 'business',
    description: 'PRD 确认。user 必审业务/产品意图(4 必填块见 prd check-blocks)。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'phase-3-swarm-gate-b',
    kind: 'tech',
    description: '蜂群 gate B(并行 fan-out 决策)。技术调度,AI 在 full-auto 自决。',
    fullAutoCanProceed: true,
    userShouldReview: 'never'
  },
  {
    step: 'phase-6-qa-gate-d',
    kind: 'business',
    description: 'QA gate D(业务验收)。user 必审业务/产品视角 6 项清单(不是技术指标)。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'phase-10-txt-memory-extract',
    kind: 'business',
    description: 'TXT handoff + memory 提取。user 必审(决定哪些 peaks-memory 块落 .peaks/memory/)。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'step-n+1-final-review',
    kind: 'business',
    description: '4 维终审。user 必审业务交付完整性。',
    fullAutoCanProceed: false,
    userShouldReview: 'always'
  },
  {
    step: 'frontend-only-mismatch',
    kind: 'tech',
    description: '前端-only 模式不匹配检测。技术模式判断,AI 在 full-auto 自决。',
    fullAutoCanProceed: true,
    userShouldReview: 'never'
  },
  {
    step: 'standards-preflight',
    kind: 'tech',
    description: '项目标准预检(standards init/update dry-run)。技术 preflight,AI 自决 apply。',
    fullAutoCanProceed: true,
    userShouldReview: 'never'
  }
];

export function classifyAllGates(): readonly GateClassification[] {
  return RAW_CLASSIFICATION.slice() as readonly GateClassification[];
}

/** Look up a single gate's classification. Returns null when the step is not in the table. */
export function classifyGate(step: string): GateClassification | null {
  const raw = RAW_CLASSIFICATION.find((g) => g.step === step);
  return raw === undefined ? null : (raw as GateClassification);
}

/** List all gates the user must review (per the 12 Gaps positioning). */
export function userMustReviewGates(): readonly GateClassification[] {
  return RAW_CLASSIFICATION.filter((g) => g.userShouldReview !== 'never') as readonly GateClassification[];
}

/** List all gates AI auto-decides in full-auto. */
export function aiAutoDecidesGates(): readonly GateClassification[] {
  return RAW_CLASSIFICATION.filter((g) => g.fullAutoCanProceed) as readonly GateClassification[];
}

export const COMMIT_BOUNDARY_ACTIONS_LIST: readonly { id: string; description: string }[] = [
  { id: 'git-push', description: 'git push / git push origin / git push --tags' },
  { id: 'git-tag', description: 'git tag v2.15.0 / git tag -a ...' },
  { id: 'npm-publish', description: 'npm publish / npm pub' },
  { id: 'npm-install-global', description: 'npm install -g / npm i -g / npm add -g' },
  { id: 'peaks-global-install', description: 'peaks-cli 全局安装 / npm install -g peaks-cli' }
];
