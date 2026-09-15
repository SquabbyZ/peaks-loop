---
name: a-fixture-that-forces-failure-by-file-mode-is-platform-scoped
description: 用 chmod 0444 + renameSync 强制写入失败，在 Windows 抛 EPERM、在 POSIX 成功（rename 看的是目录权限）；三个 pass 都在这台 Windows 上验过，全部通过，CI 在 Linux 上全红
metadata:
  type: feedback
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-15T12:30:00.000Z
---

**一个用文件模式强制"写入必须失败"的夹具，只在 Windows 上成立。**

## 实测

```
chmod 0444 <record> 之后 renameSync(tmp → record)
  Windows:  EPERM   ← 只读属性挡住替换
  POSIX:    成功    ← rename(2) 是否替换目标，只看**所在目录**的写权限，
                      目标文件自己的 mode 无关
```

于是"强制失败"在 Linux 上根本没发生，写入照常成功，断言去读成功路径 → 全红。

在 `tests/unit/services/code/compact-event-settle.test.ts` 上真实发生过：4 处 `chmodSync(..., 0o444)`，CI 报 3 个断言失败（canary 先挂，连带它后面的断言到不了）。**而那个文件自己的注释写着 `measured on this OS, EPERM`** —— 对scope 是诚实的，然后 CI 把它拿到另一个 OS 上跑了。

## 更难受的地方

**它被三个 pass 验证过，三次都通过** —— R9、R11 和一次 QA —— 因为它们全都跑在这台 Windows 上。**"通过"在这个夹具上不携带任何跨平台信息。**

## 怎么用

- **任何用文件系统副作用制造失败的夹具，都要问一句"这个副作用在另一个 OS 上还发生吗"。** 具体到 Windows/POSIX：只读**文件**能挡 `writeFileSync`，挡不住 `rename`；只读**目录**在 POSIX 能挡创建、在 Windows 上是 no-op。
- **优先用不依赖 OS 的机制**：本仓可用的选择是调用方本来就携带的注入接缝（例如 `failLifecycleWrite`），**再用一条"回读状态、确认失败真的发生了"的金丝雀把它补回来** —— 因为接缝的弱点是"测试的是代码愿不愿意遵守旗标"，而回读能观测到"拒绝确实发生了"。
- **换机制时要把失败的替代方案连测量一起记下来**，否则下一个人会把它们再试一遍：本次否掉的是"把记录路径做成目录"（临时文件是兄弟文件，写入不失败；而读取抛 EISDIR，settle 在写入前就返回）、"只读会话目录"（Windows no-op）、"预测临时文件名"（把测试焊死在 store 的私有命名上）。
- **本地 OOM/负载敏感的失败之外，还有一种失败是"本地绿、CI 红"** —— 成本更高，因为它不报错，只是让证据失效。

相关：[[ci-status-is-readable-without-gh-auth]] · [[2026-08-04-cross-platform-path-utility-rule]] · [[a-probe-that-always-says-caught-is-indistinguishable-from-a-working-guard]]。
