---
name: a-gate-that-verifies-the-label-instead-of-the-thing
description: Gate H 只检查"记忆是否带 layer 标记"，而标记由它让你跑的那条命令自己写——自我认证；该命令还打印了一个从未生成的 Generated files 路径；实测 promote 不产生任何强制产物
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-14T12:10:00.000Z
---

**`peaks workflow verify-pipeline` 的 Gate H 检查的是"记忆带没带 `layer=` 标记"，而那个标记由它让你跑的那条命令自己写。它读的一切，都来自它让你跑的东西 —— 自我认证。**

## 实测（2026-09-14）

在临时项目跑真 CLI：`peaks feedback promote <mem> --layer A` 只改变了三样东西 ——

1. 记忆 `.md` 里加一行 HTML 注释；
2. 一个 `<name>.promotion.json` 边车；
3. `.peaks/_runtime/<sid>/rd/` 下一个信封。

**没有任何强制产物。** 四条独立佐证：

- **命令打印 `Generated files: sops/<mem>.md` —— 那个文件不存在，`sops/` 目录也不存在。** 信封把同一个假声明也持久化了。**工具报告了一个它从未生成的文件。**
- `generatedFiles` 全仓**零读者**。
- `selectFeedbackLayerA`（唯一会响应 layer 标记的代码）**零调用方**。
- Layer A 的桩指向 `sops/<name>.md`，而真正的 SOP 引擎读 `.peaks/sops/<id>/sop.json` —— **桩的目标根本不在强制路径上**。

历史足迹吻合：**16** 条记忆带 `layer=A`，而 `sops/` 里只有那份 SOP 说明；一个更早的边车声称的目标文件同样不存在。**`tests/` 里对 promote 服务、CLI、Gate H 的引用：零。**

**对照组比要求的更强**：只提升一条后，扫描 2 → 1、剩下那条正是对照组、**exit 仍是 1**。**门是选择性的（没被关掉），而同一次运行恰好证明"只贴标签也能满足它"。**

## 反方也要给位置（这是它没做成冤案的原因）

**`commit-boundary-side-effect` 确实是真的**（`src/services/code/mode-gate.ts:34-53`）—— 所以**层级本身是可满足的**，缺陷在**这个工具既不做事、也不检查它自己命名的东西**。区分"机制不存在"与"机制存在但这个入口没接上"很重要：前者要删门，后者只需接线。

## 怎么用

- **一个门禁读的输入，如果由"它叫你跑的那条命令"产出，那就是自我认证。** 判据很简单：**把那条命令跳过、手工造出它声称的产物，门会不会照样绿？**
- **对"报告里出现的路径"逐个 `ls`。** 这里 `Generated files:` 后面那行是假的，而它读起来像证据。同族：[[a-surface-declared-clean-by-a-scan-that-never-ran-it]]。
- **提升/注册/标记类操作，问它"产出了什么可被独立检查的东西"**；若答案是"一个标签"，那它就是账目，不该拦门。
- **修的时候注意那个陷阱**：门开始要求产物，而工具从不产出 → 门从"空"变成"不可能"。**两半必须一起动。**

相关：[[a-surface-declared-clean-by-a-scan-that-never-ran-it]] · [[a-right-conclusion-resting-on-evidence-nobody-can-reproduce]] · [[gated-artifacts-have-shape-contracts-nobody-tells-the-producers]]。
