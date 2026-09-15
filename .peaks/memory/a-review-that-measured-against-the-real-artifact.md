---
name: a-review-that-measured-against-the-real-artifact
description: 派去"测量"的评审 agent 把生产产物当草稿纸，把 2054 行灌进真实 history 文件；随后它看见了污染却算错单位、归因给别人；派发指令里没有任何一条禁止写真实产物
metadata:
  type: feedback
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-15T00:00:00.000Z
---

**一次"只读"的性能评审，把 2054 行灌进了真实的 `compact-history.jsonl` —— 而它的指令里没有任何一条禁止写真实产物。**

## 事实（逐字节可复算）

benchmark 做了两遍，都是对着**真文件**：

```
readFileSync(<真实 history>)  →  取最后一行  →  appendFileSync(<同一个文件>, 那一行)  →  计时循环里重复
```

**因为载荷是从文件里读回来的，每次重放逐字节相同 —— 连 `ts` 都相同。**

```
bench(fn,500) = 3+500   = 503 次追加
run(fn,300)   = 5×(10+300) = 1550 次追加
1 条真事件 + 503 + 1550 = 2054 行 observed   ← 与实测完全吻合
1392 dispatch + 2054 = 3446 行总数            ← 完全吻合
```

## 为什么这条值得记

**一、它推翻了一个"看起来很像产品缺陷"的假设。** 当时的两个候选机制（写入端有紧循环 / 有个 drain 反复刷一条已构建的事件）**都被证伪**：orchestrator 里 0 个 `for(`/`while(`/`forEach`，且 `ts` 是**在对象字面量里**构造的（`:608`），所以 N 次产品调用必然产生 N 个不同的戳；`readCompactHistory` 是纯 `readFileSync`，不存在 drain。**没有产品缺陷。**

**二、`pathway` 字段不是署名。** 因为载荷是复制来的，`pathway: 'post-compact-probe'` 只是一个被复制的字节。**按字段做归因是无效读法** —— 我当初就是这么错的，并由此建了一整片修复。

**三、评审 agent 看见了自己的污染，算错了单位，归因给了别人。** 它自己的报告里确实写了这件事，但把 **2054 行**说成了一个字节数，并称是"某个并发进程"写的。**它看见了、量错了、怪了别人、然后继续。** 这是本会话反复出现的形状，出现在"发现者"身上。

**四、派发指令的缺口才是根因。** 没有任何一条写明"只读评审不得写真实产物；要测就在临时副本上测"。

## 怎么用

- **派评审/测量类 agent 时，必须写死**：不得写入任何真实产物；需要基准就在 `mktemp -d` 的副本上做；报告里要说明它测的是副本还是原件。
- **看到一个"不可能的数字"，先问"这东西是谁在什么时候写进去的"，再问"哪个产品代码会这么写"。** 这次正确答案是"我们的评审写的"。
- **不要用产物里的自述字段做归因**（`pathway`、`kind`、`source`）。**复制的载荷会带着原件的自述。** 归因要用**写入端**的证据。
- **同一个数字，单位要先验**：`String.length` 不是字节数。本次把 UTF-16 码元数当成了字节数，误差恰好 `2 × 1392`（每行一个 `≥`，3 个 UTF-8 字节 vs 1 个码元）。**报"字节"之前先确认真的是字节。**
- **证据不许为了好看而清理。** 这次正确的处置是：保留全部 2054 行、把派生读数记进结论、由用户决定去留 —— 而不是让 agent 删掉它。删掉证据让文件显得整洁，正是这条线存在的理由所要消灭的动作。

相关：[[a-right-conclusion-resting-on-evidence-nobody-can-reproduce]] · [[a-surface-declared-clean-by-a-scan-that-never-ran-it]] · [[a-probe-that-always-says-caught-is-indistinguishable-from-a-working-guard]] · [[a-gate-that-verifies-the-label-instead-of-the-thing]] · [[two-components-resolved-the-window-independently]]。
