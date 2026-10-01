---
name: a-prose-claim-about-what-a-timeout-does-while-holding-evidence-only-of-what-it-is
description: 我把 EXEC_TIMEOUT_MS 从 5 小时改成 5 分钟，并在 commit message 里断言「卡住的任务子进程会在几分钟内被回收」——那是从算式推出来的，没人测过；实测证明 execSync 超时只杀 cmd.exe，孤儿化的 node 孙进程活完自己的 60 秒。同族错误：把没读到输出的命令当成读到了「不存在」
metadata:
  type: lesson
---

# 断言行为之前，先测行为；断言不存在之前，先确认自己读到了输出

## 案例一：算式是真的，回收是假的（2026-10-01，rid `2026-10-01-cron-exec-timeout-01`）

`EXEC_TIMEOUT_MS = 5 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND` 求值成 18,000,000 ms
（5 小时），而命名与注释要的是 300,000 ms。这一半是**测过**的：测试先写、先红，红字面显示
`expected 18000000 to be 300000`。

错的是我在 commit message 与 backlog §2.21 里顺手写下的后半句：改完之后「卡住的任务子进程会在几分钟内
被回收，而不是几小时」。这句话的依据只有那个算式。独立评审用一个 30 秒探针打掉它，我随后自己复测
（`runTask` 的同款选项：`timeout` / `stdio:'ignore'` / `windowsHide`）：

```
{"caught":true,"code":"ETIMEDOUT","signal":"SIGTERM","elapsed_ms":1519}
{"after_ms":0,"survivors_of_the_killed_task":1}
{"after_ms":3000,"survivors_of_the_killed_task":1}
{"after_ms":6000,"survivors_of_the_killed_task":1}
```

任务体是 `node -e "setTimeout(…, 60000)"`、超时给 1500 ms：父调用 1519 ms 就带着 ETIMEDOUT 返回了，
被杀的是 `cmd.exe` 那层壳，**node 孙进程一直活着**。所以「回收」这个属性从来不存在，改动真正买到的只是
「阻塞的调用方从等 5 小时变成等 5 分钟」。

判别法：一句关于**机制**的话（会杀谁、会回收谁、会重试几次）必须由一次运行来支撑；一句关于**取值**的话
（等于多少、大于多少）可以由算式或断言支撑。我把后者当证据写了前者，而且是在自己刚写完红→绿测试的自信上。

## 案例二：输出被吞了，我把它读成「不存在」（同日，同一片刻）

填 QA 出口门时我需要判断仓库根有没有 `openspec/`。命令 `ls -d openspec 2>/dev/null || echo "no openspec/ dir"`
的回显里那两行都没出现（被工具输出裁掉了），我就在产物里写下「verified 2026-10-01 that `openspec/` does
not exist at the repo root (measured by `ls -d openspec`)」。重查：`ls -d openspec` exit 0、目录存在（里面有
`baselines`）。那句话是假的，而且它写着「measured」。

判别法：结论为「不存在 / 没有 / 零」的句子，必须引用一个**我亲眼读到内容**的输出，或一个可复算的计数
（`Measure-Object`、`wc -l`、退出码 + 实际 stdout 片段）。没有回显不等于回显为空。修正要留在原地，
不要悄悄改掉——那条产物里现在写着「Correction kept visible」。

## 同族的第三次（本轮实测，别重演）

- 我用 90 字符截断父链命令行，正好截在参数起点，于是把「谁在调用」看成「自我递归」；
- 我用 `-match 'worktree'` 过滤 node 进程，而会话路径本身含 `.qoder-cn\worktrees\`，于是什么都能匹配上；
- 我用「跑完之后没有残留进程」否证递归，而正确的问法是「这一次运行**派生**了几个子进程」。

三条都是仪器骗人。仪器骗人时，结论会看起来很干净——这是最贵的地方。

## 复发（同日，下一片）：这次在提交前被抓

同一个文件、同一类句子又写了一次。`runTask` 改成 `spawnSync` 之后，文档里出现「reaped the task and
leaves nothing」。独立评审量了才承认：代码里没有任何东西请求过树杀（无 `taskkill /T`、无 job object、
无进程组，POSIX 只对单个 pid 发信号），所以「不留下东西」不成立。评审同时确实测到直接子进程
2 → 0（四种 win32 形态，每个 0 前面都有紧接其前的 2 作为活体证据）——**观测成立 ≠ 机制被理解**。

差别只在时机：上一次是提交之后被评审打掉（补了更正提交 `517c2290`），这一次是提交之前（`3ae44c8f`
落地的文案已改成「只对 TASK PROCESS 成立」）。所以流程性结论是：**关于机制的句子先过一遍带数字的探针，
再进 commit message**；而"计数为 0"必须配"同一时刻计数为 N"的对照，否则 0 也可能是根本没开始。
