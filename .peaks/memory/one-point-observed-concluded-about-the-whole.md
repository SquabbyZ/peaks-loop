---
name: one-point-observed-concluded-about-the-whole
description: 一次会话内三次「查一个点就断言整个面」——LOC 量错 3 倍、漏查一个文件就断言安装行为、见两个路径不同就假定其一坏了；三次都没配对照组
metadata:
  type: lesson
  node_type: memory
  originSessionId: 41d14175-50f5-4352-bac1-bc0b4656940d
  modified: 2026-09-15T13:50:00.000Z
---

2026-09-15 的 peaks-loop 诊断会话里，**我在一个小时内犯了三次同一类错，并把三个错误数字报给了用户**：

**① 量错了 3 倍，还据此下了结论**
```bash
git ls-files 'src/**/*.ts' | xargs wc -l | tail -1     # → 54,906
```
文件多时 `xargs` 会**拆成多批**，每批各打印一行 `total`。`tail -1` 只拿到**最后一批**的合计。真值 **156,682**（差 2.9 倍）。我据此报告"测试是源码的 1.5 倍"，真值是 **0.52x** —— 方向反了。
**正确写法**：`git ls-files … | xargs cat | wc -l`，或 `xargs wc -l | awk '/total$/{s+=$1} END{print s}'`。

**② 查了一个文件，断言了整个安装行为**
我在临时项目里只读了 `.claude/settings.local.json`，见不到 `peaks code-gate`，就断言「`hooks install` 报告安装了它没装的 hook」。实际上它**装了** —— 在 `.claude/settings.json` 里。同一个命令写**两个**文件，我只看了一个。

**③ 见两个路径不同，就假定其中一个坏了**
生成的 hook 指向 `.../nvm/v24.14.0/node_modules/peaks-loop/...`，而 `npm root -g` 报 `C:\nvm4w\nodejs\node_modules`。我判定前者是坏路径。实际上 `C:\nvm4w\nodejs` 是**符号链接**，指向同一个目录，两份是同一安装。我从没跑 `ls -ld`。

**Why:** 三次的错法完全一样，而且**与我正在诊断的病灶同源** —— 那批闸门的共同点正是"把局部观测当成整体结论"。这不只是巧合：**这个错法在压力下是默认行为**，不能靠"下次注意点"避免。我在诊断别人"闸门没有对照组"的同时，自己三次都没有对照组。

**How to apply:**
1. **凡是会输出 `total` / 汇总行的命令，先确认它有没有被拆批。** 拿一个已知答案的小样本先验一次。
2. **一个概念有几个可能的写入点，就要把几个都查完再断言。** 尤其是 settings / config / manifest 这类会被多个写入者分片的文件。
3. **两个路径不同 ≠ 有一个是坏的。** 先 `ls -ld` 看链接关系，再下结论。
4. **报告数字时，把"我跑的命令"一起写出来** —— 本次报告因此能在 §7 自我纠正；若不写，三个错都会作为事实留下来。

参见 [[a-measurement-whose-command-failed-silently-is-not-a-pass]]、[[single-observation-is-not-a-property]]、[[a-probe-that-always-says-caught-is-indistinguishable-from-a-working-guard]]。
