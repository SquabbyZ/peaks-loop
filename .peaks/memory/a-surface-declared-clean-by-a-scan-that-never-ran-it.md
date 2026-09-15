---
name: a-surface-declared-clean-by-a-scan-that-never-ran-it
description: 一个否定结论（"这里没问题"）被写进表里，而它背后没有任何一次执行；实测切片把 playwright stop --terminal 标为"not a guard gap"，而它一个 flag 就能杀掉指名进程并删掉项目根之外的文件
metadata:
  type: feedback
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-14T03:30:00.000Z
---
<!-- peaks-feedback-promoted: layer=A -->

**肯定结论错了要一次执行才能推翻；否定结论错了，连"有没有查过"都看不出来。**

## 实测（2026-09-14）

一个把"调用方 id 拼进路径"整类摸清的切片，产出了一张分类表，把 `playwright-commands.ts` 标为 **"not a guard gap"**。QA 去执行了它：

```
playwright stop --terminal ../../../../X --project <tmp> --json
  → ok:true, exit 0
  → terminated 了它指名的 pid（alive_before=true → alive_after=false）
  → 并 unlinked 了项目根之外的那个文件
```

**任意 SIGTERM 加文件删除，一个 flag 的距离，来自一个被宣布干净的面。**

同一份报告里还有同族的四处：**4 行标着 *measured* 的分类实际靠"exit 0 没写"**（那是同一份文件自己定义的 *inconclusive*）；**"25/40 不确定"是手抄分类的算术余数，却印在工具总数之间**；**§4.1 声称完整枚举，实际 57 个文件里只列了 31**。

## 为什么这类最难发现

- **否定结论不产生输出。** 一次逃逸会写文件、会报错、会留下痕迹；一次"没有问题"什么也不留下。
- **它们从不被复测。** 红的行会被追；绿的行被当成已完成的工作。
- **工具总数会替它背书。** 手抄的桶和工具产出的数字印在一起，读起来就像工具说的。

## 怎么用

- **写"这里没问题"时，必须同时写它是怎么被检查的** —— 执行过（给命令）、读过（标"读"）、还是没查（标"未查"）。**三种标签不许混用，尤其不许把"没查"写成"干净"。**
- **手工分类不要和工具总数并列**：要么让工具产出它，要么分开两个区块，并写出余数是怎么算的。
- **派活时明确要求"否定行也要给依据"** —— 本 session 里一旦这么要求，代理就交出了逐根计数，并主动说出"`docs/` 走了、0 命中 —— **是结果，不是缺口**"。
- 相关的一手教训：**一个永远说"没有"的探针，和一个能用的守卫是分不出来的**（[[a-probe-that-always-says-caught-is-indistinguishable-from-a-working-guard]]）；以及**在一维采样却对整片空间报绿**（[[a-probe-that-samples-one-point-reports-green-for-the-whole-space]]）。

相关：[[a-sweeps-scope-is-the-deliverable-not-its-findings]] · [[a-right-conclusion-resting-on-evidence-nobody-can-reproduce]] · [[a-probe-that-samples-one-point-reports-green-for-the-whole-space]]。
