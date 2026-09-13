---
name: use-the-repos-existing-ast-guard-not-a-fresh-regex-scan
description: 扫描类作业先找仓库里已有的 AST 守卫并直接扩它的射程，不要另写正则扫描——本会话因此错了三次
metadata:
  type: feedback
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-13T01:30:18.464Z
---

**做"扫全仓找某类调用点"这类作业时，先找仓库里**已有的 AST 守卫**，扩它的射程；不要另写一个正则/文本扫描。**

2026-09-13 实测：为了统计"全仓有多少 `child_process` 调用点没带 `windowsHide`"，我临时写了三版扫描器，**三版都错**：

1. **正则 + 固定窗口** → 两个方向都错（漏掉同文件别名的 `const spawnFn = deps.spawnFn ?? spawn`；又把注释与字符串里的伪代码算进去）。
2. **`if (!IMPORT_RE.test(src)) return;` 写在 `walk` 里** → `return` 退出的是**整个 `walk` 调用**，同目录剩余文件与尚未走到的子目录全被跳过。**漏多少取决于 `readdirSync` 的返回顺序** —— 两次运行因此差了 20 倍（11 vs 233 个点）。
3. **括号配对 + 跳过注释** → 仍有两类假阳性：options 是 **spread**（`{ ...spawnOptions, env }`，源对象里有 `windowsHide`，AST 能内联解析而正则不能）；以及正则**起始匹配**落在注释内（配对逻辑只保护实参表内部）。

而 `tests/unit/spawn-windows-hide-guard.test.ts` **早就**是一个正确的扫描器：真 AST、能跟别名与命名空间 import、能内联 spread、有反静默断言。

**Why:** 我用自制扫描器得出的数字（235）**不能拿去派发** —— 它会变成子代理的工作清单，而清单本身是错的。更糟的是：这些数字**看起来**像事实，没人会去复核。

**How to apply:** 要枚举某类调用点时 ——
1. **先 grep 仓库里有没有现成的守卫/扫描器**（本仓库有 `spawn-windows-hide-guard`、`vendor-neutral-identity-guard` 等，都是 AST 的）。
2. 有 → **扩它的射程**，让**它**吐出清单。权威、零假阳性，且扩围本身就是防复发。
3. 没有 → 才自己写，且**必须用真解析器**，并**用一批已知答案的样本反向校准**（拿守卫已经认定"干净"的文件去跑，任何命中都是假阳性）。
4. **任何"我从扫描器算出来的数"在派发前都要先反向校准过一次。**

参见 [[real-cmdline-regression-test-for-spawn]] 与 [[single-observation-is-not-a-property]]。
