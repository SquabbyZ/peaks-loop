# peaks-solo — Sediment Prompt Template (沉淀提议 AskUserQuestion)

> 自规划兜底跑完(转交 leaf 跑完则由 leaf 内部 Step 11 处理,**不重复问**)→ peaks-solo 用本模板提议沉淀。
> **核心约束(HC-9 Human-NL-Choice-Only 锁死):** 必须用 AskUserQuestion 4-option,**不**允许自由文本输入;**默认推荐 = (a)**,**不**是 (d)。

## 4-option AskUserQuestion 模板

```yaml
question: "本次结果是否沉淀?"
options:
  - label: "(a) 沉淀为普通 lesson / convention"
    description: "通过 peaks memory extract --apply 写到 .peaks/memory/<user>/,作为可复用 lessons/conventions。"
  - label: "(b) 沉淀为 Loop Engineering 资产"
    description: "通过 peaks asset crystallize 提升为 Loop Engineering Asset(标准 / skill / SOP / framework)。"
  - label: "(c) 改 scope 再沉淀"
    description: "本次 scope 不对,LLM 继续追问(例如想问清楚是什么 lesson),然后再走 (a) 或 (b)。"
  - label: "(d) 不沉淀"
    description: "单次性结果,丢弃,不写入任何 .peaks/ 路径。"
multiSelect: false
```

## 默认推荐

**默认推荐 = (a)**(普通 lesson / convention),**不**是 (d)。

**为什么推荐 (a) 而不是 (b):** (b) 沉淀为 Loop Engineering Asset 是**重操作**——会进入 `.peaks/standards/` 或 `.peaks/memory/<asset>/`,影响所有 peaks-* skill 的语义。普通 lesson / convention 风险低、可回滚、不会污染项目 invariants,适合作为大多数一次性结果的首选归宿。(b) 仅在 LLM 识别 ≥ 2 个 reuse signals 时推荐。

## LLM 必须给一段 NL rationale

在调 AskUserQuestion 前,LLM **必须**先(在最终回复里,AskUserQuestion 之前)给一段 1-3 句的 NL 解释,说明为什么推荐 (a) 或 (b)。模板:

> "我推荐 (a) 沉淀为普通 lesson / convention,理由:<1 句:本次结果的可复用程度 / 适用范围 / 为什么不是 (b) / 为什么不是 (d)>。如果你认为这是 Loop Engineering 级别的资产,选 (b);如果本次是单次性 / scope 不对,选 (c) 或 (d)。"

**禁止:** 直接弹 AskUserQuestion 不解释;**禁止:** 默认推荐 (d)。

## 触发条件矩阵

| peaks-solo 跑完类型 | 是否问沉淀 | trigger 标记 |
|---|---|---|
| 转交 leaf 跑完 | **不问**(leaf 内部 Step 11 处理) | `leaf_handled` |
| 自规划兜底跑完(成功) | **默认问** | `success_default_prompt` |
| 自规划兜底跑完(部分失败) | **附带"是否继续"二选一 + 沉淀四选一**两个 AskUserQuestion | `partial_failure` |
| 用户主动说"沉淀这个" / "把这个记下来" | **立即问**(跳过自规划完成检测) | `user_explicit` |
| LLM 识别 ≥ 2 个 reuse signals(同一结果可在 ≥ 2 个未来场景复用) | **附带 4-section brief 问**(在 question 前先输出 brief:reuse contexts / scope / drift risks / crystallize recommendation) | `llm_suggested` |
| 沉淀提议被用户选 (d) 后 | **不重复问**,直接关闭 peaks-solo session | `user_declined` |
| 沉淀提议被用户选 (c) 后(scope 改) | **继续追问 → 再问一次 4-option** | `scope_change` |

## 沉淀后的执行

| 用户选 | LLM 执行 |
|---|---|
| (a) | `peaks memory extract --apply --session-id <sid> --project <repo>` —— 走现成 CLI,不重写 |
| (b) | `peaks asset crystallize --asset <name> --project <repo>` —— 走现成 CLI;**仅**在用户明确选 (b) 后执行 |
| (c) | 继续 AskUserQuestion 追问(例如"具体是什么场景的 lesson?" / "适用哪个子项目?") |
| (d) | 不写任何文件;peaks-solo 直接结束 |

## 反 pattern 警告

- **不推荐 (b) 默认推荐** —— 大多数一次性结果进不了 Loop Engineering Asset 层;盲目 crystallize 会污染 `.peaks/standards/`。
- **不静默丢弃** —— 用户没明示"不要沉淀",就必须问;选 (d) 必须是用户**主动选**,不是 LLM 默认。
- **不重复问** —— 转交 leaf 跑完由 leaf 处理 sediment;peaks-solo 只对**自规划兜底跑完**问。
- **不让用户自由文本** —— HC-9 锁死;不在 AskUserQuestion 选项之外加 free-form input。