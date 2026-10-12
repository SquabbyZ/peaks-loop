---
name: compare-through-git-filters-git-filter
description: compare-through-git-filters —— 比「提交内容与磁盘内容是否一致」必须经 git 自己的 filter
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

**实测**（一次性仓库，`core.autocrlf=true`）：

| | |
|---|---|
| `git diff --quiet -- crlf.txt` | **exit 0** —— git 说两侧同步 |
| 暂存 blob | 12 B（LF，已被 clean filter 处理） |
| 工作树文件 | 14 B（CRLF，原始） |
| 裸字节比较 | **判为分歧 ⇒ 拒绝提交** |
| 它打印的补救 `git add` | **可证明的空操作**（重新 add 后 `git diff --quiet` 仍是 0） |

⇒ **这道门会拒绝一个 git 自己认为干净的提交**，而出口只剩「把文件改回 LF」或「用豁免令牌」——
后者正是训练 `--no-verify` 的东西，而 `--no-verify` 会把门整个关掉。**本仓 `core.autocrlf=true` 是开着的。**

**正解**：比 **oid**，不比字节。磁盘侧用 `git hash-object --stdin-paths`（经 filter），
暂存侧用 index 的 oid。同一形状下两者 oid **相同**（`c0d0fb45…`）。

**推广**：任何「磁盘上的字节与 git 记录的是否一致」的判断都必须**经 git 自己的 filter**。
`.gitattributes` 的 `text=auto`、`eol=lf`、`filter=`、`ident=` 都会让磁盘字节 ≠ 记录字节，
**而且这是设计如此、不是故障**。用 `readFileSync` 直接比，得到的差别是**语料库里的常数**，不是缺陷。

**同族教训（本会话第十次「声明强于实现」）**：这个 bug 的根因是它 header 里的一句假前提
（「工作树字节**就是** git 记录的字节」）—— **而那句话正是它当初能上线的理由**。
