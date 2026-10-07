# 资产真源（canonical store）

> 一句话：**三类资产（skills / agents / output-styles）的实体统一放在 `~/.peaks/<kind>/`；每个 IDE 目录里的条目都是指向真源的链接；归属由条目旁边的 `.peaks-managed` 边车判定，删除只认这一条判据。**
>
> 落地于 job `agents-canonical-store`（slice s1–s4），代码在 `scripts/canonical-store*.mjs` 与 `scripts/install-skills.mjs`。
> 本文每条关于行为的陈述都在文末「代码出处」表里标了 `文件:行`。

---

## 一、给下一任安装器维护者

### 1. 真源根是 `~/.peaks`，不是 `~/.agents`

三类资产平行放在真源根下：`~/.peaks/skills/`、`~/.peaks/agents/`、`~/.peaks/output-styles/`。

- 代码：`scripts/canonical-store.mjs:35`（`CANONICAL_ASSET_KINDS`）、`:132-139`（`resolveKindRoot`）。
- 根解析顺序：`options.root` → `$PEAKS_HOME` → `~/.peaks`（`scripts/canonical-store.mjs:119-125`）。

**为什么从 `~/.agents` 改到 `~/.peaks`。** `~/.agents/` 是**共享命名空间**——生态里 `npx skills` / agentrecall / agentlink
等都在往它写；`~/.peaks/` 是 peaks-loop 自己的家目录，而且**已经在用**（实测 `~/.peaks/agents/` 已存在，内含 `ecc`）。
唯一支持 `~/.agents` 的理由是「通用型 agent 原生直读该目录、可省掉链接」，但本仓**没有任何机制能验证**某个具体工具的具体版本
是否真的读它——用一个未验证的好处去换一个确定的命名空间污染，不划算。完整历史与代价见
`.peaks/_runtime/<session>/rd/evidence-root-switch.md`（真源根切换那一片的证据）。

**环境变量是 `PEAKS_HOME`。** 这是本仓**既有**的名字，专指 `~/.peaks`（`src/services/sop/sop-paths.ts:28-30`
的 `peaksHome()`），不是为真源新造的：为一个目录定义两个默认值相同的旋钮，就是让两个旋钮有机会互相矛盾。
真源侧读它的是 `scripts/canonical-store.mjs:39`；类型声明 `scripts/canonical-store.d.mts:45`。

### 2. IDE 侧一律指向真源——目录用 junction，单文件用符号链接

同一个「指向真源」的动作，两族用两种链接，因为 Windows 只对**目录**免权限：

| 资产族 | IDE 条目的形状 | 链接类型 | 出处 |
|---|---|---|---|
| skills | **目录** | win32 → `junction`（免管理员）；POSIX → `dir` | `scripts/canonical-store.mjs:290-295` |
| agents / output-styles | **单个 `.md` 文件** | `file` 符号链接——Windows 上需要**开发者模式或管理员** | `scripts/canonical-store-link.mjs:233`（模块头注 `:5-7`） |

`skills` 走 `reconcileCanonicalEntry`（`scripts/canonical-store.mjs:268-298`）；单文件族走
`reconcileCanonicalFileEntry`（`scripts/canonical-store-link.mjs:272-296`）。两者都先调
`ensureCanonicalCopy`（`scripts/canonical-store.mjs:220-248`）把实体副本写进真源，再决定 IDE 条目怎么指。

**已实测、且写进代码注释的边界**：符号链接只在 **Claude Code 2.1.292** 上实测跟随（探针见
`rd/evidence-symlink-probe-s4.md`）；trae / codex / cursor 等**未测**。若某个 IDE 不跟随文件符号链接，症状是
「agent 静默不出现」，因此 `scripts/canonical-store-link.mjs` 的头注完整保留了这条限制。

### 3. 归属由 `.peaks-managed` 边车判定；删除只认这一条判据

- 判据：`scripts/canonical-store.mjs:94-99`（`isManagedEntry`）——条目旁边有 `.peaks-managed` 才算「我们的」；
  **无标记一律视为用户自建，永不替换、永不删除**。
- 两条删除路径都过这同一个谓词：真源侧 `scripts/canonical-store-prune.mjs:78`，IDE 侧 `:104`。
  这很重要——prune 的**全部**风险都在「只」这个字上：宽一点的 prune 从外面看和正确的 prune 一模一样。
- 负面对照（用户自建的、与包内同名的目录必须逐字节存活）钉在 `tests/unit/ide/install-skills-prune.test.ts`，
  并经变异测试证明有区分力（把谓词短接成恒真 → 变红；见 `rd/evidence-s3-prune.md` §5）。

**三族的边车格式曾经不同，读代码时要知道**：

| 族 | 旧（4.1.1 及以前）边车内容 | 新代码写的边车 |
|---|---|---|
| skills | 一行路径 | 一行**真源路径** |
| agents | **JSON**：`{"version":1,"kind":"agent","agentName":…,"sourcePath":…,"contentSha256":…}` | 一行**真源路径** |
| output-styles | **JSON**：同构，`kind:"output-style"` + `outputStyleName` | 一行**真源路径** |

旧 JSON 边车由 `parseLegacyMarker`（`scripts/canonical-store-link.mjs:99-110`）解析——**解析失败即视为「不是我们的」**
（fail closed），且 `kind` 与资产名都必须对得上（`:142-149`）。

### 4. 回退语义：宿主拒绝建链接 → 写实体副本，并在 stderr 明说

```
scripts/canonical-store-link.mjs:236-253
  捕获 LINK_REFUSED_CODES (:51 = EPERM/EACCES/UNKNOWN/ENOTSUP/EINVAL)
  → writeRealCopy()           写实体副本
  → writeManagedMarker()      边车仍记【真源路径】(不是包路径)
  → 返回 fallback: { mode:'copy', code, reason }
```

- postinstall 上报：`scripts/install-skills.mjs:1047-1054`（`reportCopyFallbacks`），文案
  `… installed as REAL COPIES because this host refused a symlink (<code>)`。
- **已知边界（有意保留）**：一旦某台机器拒绝建链接，该条目此后**不会**再重试建链接（重试要删掉再重建文件，
  会破坏安装器的 mtime 幂等），但它的**内容**仍每次跟着升级走（回退副本不冻结）。
- 回退分支**不是**靠推断：`reconcileCanonicalFileEntry` 接受显式注入点 `options.createFileLink`
  （默认 `fs.symlinkSync`，`scripts/canonical-store-link.mjs:272-295`），测试用它注入 Windows 真实的 `EPERM`
  来走到这条路（`rd/evidence-s4-agents-output-styles.md` §7）。

**两条可见性上报**（修的是一类「结果没人看得见」的形状，不是一个 case）：

| 上报 | 触发 | 出处 | 文案 |
|---|---|---|---|
| `reportCopyFallbacks` | 回退成实体副本 | `scripts/install-skills.mjs:1047-1054` | `… installed as REAL COPIES because this host refused a symlink` |
| `reportLeftAlone` | 条目被跳过（用户自建 / 指向另一份活安装） | `scripts/install-skills.mjs:1063-1068` | `… left alone, not peaks-loop's to replace: <names>` |

调用点：agents 扇出 `scripts/install-skills.mjs:1111-1112`；output-styles 在 `:1259`。

### 5. 本片**没有**改的东西（读代码时别以为漏了）

- **skills 的 `skipped` 仍不上报**：`installBundledSkillsForAllPlatforms`（`scripts/install-skills.mjs:1156-1200`）
  没有 `reportLeftAlone`。这是 s2 已完成的通路，本片边界明令不动。
- `IDE_SKILL_INSTALL_PROFILES` 的 10 平台表、`IDE_DETECTION_DIRS`、`isPlatformPresent` 未动。
- output-styles 仍是**单目标**（只写被探测到的那一个 IDE，否则 `~/.claude`），其理由写在
  `scripts/install-skills.mjs:678-710` 的 DISPATCH STRATEGY 注释里；本片只改它的**落点**，不改扇出策略。

### 6. 新增模块必须进 `package.json#files`

`files` 是 npm 发布白名单。任何被 `install-skills.mjs` import 的兄弟模块若漏加，**每个用户**的全局安装都会
`ERR_MODULE_NOT_FOUND`，而测试全绿（本 session 栽过两次）。现在有一条**通则**守卫：
`tests/unit/ide/install-skills-published-modules.test.ts` 解析安装器里的相对 `import`，逐个断言它在白名单里，
文件里**没有任何模块名清单**。

---

## 二、给普通用户：两件直接影响你的事

### A. 受管入口会在升级时被覆盖；想要自己的版本，删掉旁边的边车

`~/.claude/agents/karpathy-reviewer.md`、`~/.claude/output-styles/peaks-skill-swarm.md` 这类**由 peaks-loop 装进去的**
入口，由它旁边的 `.peaks-managed` 边车标记归属。包升级时它的内容会被更新成新版本。

**如果你想去掉某条受管入口、换成自己的版本**：删掉它旁边的 `.peaks-managed` 边车即可。**没有标记的入口一律视为
用户自建，永不被替换、也永不被删除**——这是代码里唯一的归属判据（`scripts/canonical-store.mjs:94-99`），
也是负面对照所守的规则。

### B. 有些机器上会退化成实体副本，安装器会在 stderr 明说

在**没有开发者模式、也不是管理员**的 Windows 上建不出**文件**符号链接（目录用的 junction 不受此限）。
此时安装器不静默降级：它写**实体副本**，并在 stderr 打印

```
Peaks agents in <dir>: <names> installed as REAL COPIES because this host refused a symlink (EPERM)
```

**内容照样跟着升级走**，只是不再与真源共享同一份（`scripts/canonical-store-link.mjs:236-253`，上报
`scripts/install-skills.mjs:1047-1054`）。想消掉这条提示，去 Windows 设置里打开「开发者模式」，或让安装器以管理员运行。

同样地，若某条入口被**跳过**（它是你自己建的，或它的边车指向**另一份活着的安装**），stderr 会打印
`… left alone, not peaks-loop's to replace: <names>`（`scripts/install-skills.mjs:1063-1068`）。

---

## 三、从 4.1.1 升级：会发生什么 / 怎么验证 / 怎么回退

> ⚠️ 本节所有命令中，**不带 HOME 参数的**会读写**你真实的 home**（`~/.peaks`、`~/.claude` …）。
> 带 `<FAKE_HOME>` 参数的是隔离排练，可以放心跑——但**不要**把真实目录当成 `<FAKE_HOME>` 去跑「排练」。

### 3.1 升级那一刻实际会发生什么

4.1.1 留下的状态是：IDE 里是**实体文件** + 一份**旧 JSON 边车**，边车里记着**带 node 版本号的包路径**
（实测真机：`C:\Users\small\AppData\Local\nvm\v24.21.0\node_modules\peaks-loop\agents\karpathy-reviewer.md`）。
真源里还没有这个资产的副本。

新安装器跑起来时，旧 JSON 边车被采纳为「我们的」有**两条臂**（`scripts/canonical-store-link.mjs:142-149`）：

| 臂 | 边车记录的路径 | 判据 | 结果 |
|---|---|---|---|
| **A** 更早的安装 | **已经解析不到** | `resolveIdentity(recorded) === null` → `return true` | 采纳，重指到真源 |
| **B** 原地升级 | **就是本次安装的那份包** | `resolveIdentity(recorded) === resolvedIdentity(sourcePath)` | 采纳，重指到真源 |
| （第三） | 解析得到、但**是另一份活着的安装**（开发仓 / 另一个 node 版本的全局包） | 记录路径 ≠ 本次安装的包 | **不采纳**，保留 + 经 `reportLeftAlone` 上报 |

旧代码只有「与**当前**版本的包路径做字符串相等」这一条，包路径一变就恒假，于是条目**永久冻结且不报错**——
这正是本 job 修掉的缺陷。

**隔离排练（真跑过，可自证）**：在抛荒 HOME 里放四种条目，跑真实 `installBundledAgents` 两次。原始输出：

```
--- BEFORE ---
  file a-vanished.md          ← 臂 A：边车指向一个已消失的包
  file b-inplace.md           ← 臂 B：边车指向本次安装的包
  file c-other-live.md        ← 第三条：边车指向 D:\peaks-loop（另一份活安装）
  file d-user-mine.md         ← 用户自建，无边车
  store: (absent)
run 1 -> {"installed":["a-vanished.md","b-inplace.md","karpathy-reviewer.md"],
          "skipped":["c-other-live.md"],"pruned":[],"fallbacks":[]}
--- AFTER run 1 ---
  LINK a-vanished.md   -> …\home\.peaks\agents\a-vanished.md      ← 臂 A 被采纳
  LINK b-inplace.md    -> …\home\.peaks\agents\b-inplace.md       ← 臂 B 被采纳
  file c-other-live.md                                            ← 被跳过，保留
  file d-user-mine.md                                             ← 用户文件原样
  LINK karpathy-reviewer.md -> …\home\.peaks\agents\karpathy-reviewer.md
  store: a-vanished.md | b-inplace.md | c-other-live.md | karpathy-reviewer.md
run 2 -> {同上}
idempotent (mtime equal): true
canonical a-vanished is a real file: true
canonical a-vanished bytes == package: true
user file d survives: "# mine\n"
user file d is a link: false
```

读法：**臂 A、臂 B、干净安装都被重指到真源**；**指向另一份活安装的条目被跳过并保留**（`c-other-live.md`
的真源副本仍会写，但 IDE 侧不动 —— 即 `reportLeftAlone` 要报的那种「半迁移」）；**无标记的用户文件逐字节原样**；
第二次运行 **mtime 全等**（幂等）。

### 3.2 升级后要验证什么

`peaks-loop` 没有一条 CLI 命令报告「装上了没装」或「链接断没断」，所以只能看文件系统。
下面这段是**只读**校验脚本（不写任何东西），把 §3.2 的四条判据一次跑完：

```js
// verify-peaks-store.mjs — 只读校验
//   node verify-peaks-store.mjs [要检查的 HOME 目录]     省略参数 = 检查你真实的 home（只读，不写）
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const home = process.argv[2] ?? os.homedir();
const store = path.join(home, '.peaks');
const KINDS = ['skills', 'agents', 'output-styles'];
const IDE_DIRS = ['.claude', '.trae', '.trae-cn', '.codex', '.cursor', '.qoder', '.tongyi-lingma', '.hermes', '.openclaw', '.zcode'];
let failures = 0;
const fail = (m) => { failures += 1; console.log(`  FAIL  ${m}`); };
const ok = (m) => console.log(`  ok    ${m}`);
const rp = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
console.log(`home  = ${home}\nstore = ${store}\n`);
// 1. 真源副本是实体文件，不是链接
for (const kind of KINDS) {
  const dir = path.join(store, kind);
  if (!fs.existsSync(dir)) { console.log(`[${kind}] store absent`); continue; }
  const names = fs.readdirSync(dir).filter((n) => !n.endsWith('.peaks-managed'));
  const links = names.filter((n) => fs.lstatSync(path.join(dir, n)).isSymbolicLink());
  console.log(`[${kind}] ${names.length} canonical entries, ${links.length} of them LINKS`);
  if (links.length) fail(`${kind}: canonical copies must be real files, found links: ${links.join(', ')}`);
  else ok(`${kind}: every canonical copy is a real file`);
}
// 2. 每个 IDE 链接都解析进真源，且断链 0
const storeReal = rp(store) ?? store;
let dangling = 0, checked = 0;
for (const ide of IDE_DIRS) for (const kind of KINDS) {
  const dir = path.join(home, ide, kind);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.peaks-managed')) continue;
    const p = path.join(dir, name);
    if (!fs.lstatSync(p).isSymbolicLink()) continue;   // 用户文件，或 Windows 回退副本
    checked += 1;
    const target = rp(p);
    if (target === null) { dangling += 1; fail(`DANGLING: ${p}`); continue; }
    if (!(target === storeReal || target.startsWith(`${storeReal}${path.sep}`))) fail(`outside the store: ${p} -> ${target}`);
  }
}
console.log(`\n[IDE] ${checked} links inspected; dangling = ${dangling}`);
if (!dangling && checked) ok('0 dangling links');
// 3. 真源里既有的用户目录（~/.peaks/agents/ecc）没被碰
const ecc = path.join(store, 'agents', 'ecc');
if (fs.existsSync(ecc)) {
  if (fs.lstatSync(ecc).isDirectory() && !fs.existsSync(`${ecc}.peaks-managed`)) ok('~/.peaks/agents/ecc is still an unmarked user directory');
  else fail('~/.peaks/agents/ecc was adopted or replaced');
}
console.log(`\nVERDICT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exitCode = failures === 0 ? 0 : 1;
```

**怎么知道它成了**——四条判据（脚本逐条检查）：

1. 真源副本是**实体文件**（`lstat().isSymbolicLink() === false`），不是链接；
2. 每个 IDE 链接的 `realpath` **落在真源根内**；
3. **断链 0**（`realpath` 解析得到）；
4. `~/.peaks/agents/ecc`（本机既有的用户自建树）**仍是无边车的普通目录**。

在隔离排练 HOME 上跑，它 **PASS**；把排练 HOME 弄坏（一条断链 + 一个真源副本被换成链接），它 **FAIL(3)**、
退出码 1 —— 即这段校验**有区分力，不是永远绿**：

```
# 未弄坏时
[agents] 4 canonical entries, 0 of them LINKS
  ok    agents: every canonical copy is a real file
[IDE] 3 links inspected; dangling = 0
  ok    0 dangling links
VERDICT: PASS                                    EXIT=0

# 弄坏之后（注入 1 条断链 + 1 个链接型真源副本）
[agents] 4 canonical entries, 1 of them LINKS
  FAIL  agents: canonical copies must be real files, found links: karpathy-reviewer.md
  FAIL  DANGLING: …\.claude\agents\karpathy-reviewer.md
  FAIL  DANGLING: …\.claude\agents\zzz-dangling.md
[IDE] 4 links inspected; dangling = 2
VERDICT: FAIL (3)                                EXIT=1
```

### 3.3 验证失败的退路：迁移前快照

迁移前的 6 个目录已快照在
`.peaks/_runtime/2026-10-06-session-d0d50d/backup-pre-s4-migration/`
（claude / trae / codex / cursor 的 `agents`，加 claude / trae 的 `output-styles`，各含文件 + `.peaks-managed` 边车）。

回退就是把快照里的文件拷回对应的真实目录（**这一步会写你的真实 home**）：

```powershell
# 仅当你确认迁移出了问题、要把这些条目恢复成迁移前的样子时才跑
$snap = ".peaks/_runtime/2026-10-06-session-d0d50d/backup-pre-s4-migration"
foreach ($d in @('.claude', '.trae', '.codex', '.cursor')) {
  Copy-Item -Recurse -Force "$snap/$d/*" "$HOME/$d/"
}
```

### 3.4 本片**不执行**真实迁移

理由（如实记录）：本 session 已**两次**因安装器遍历「用户实际在用的全部平台」而真实改写用户的 8 个 IDE 目录，
且用户不在场；迁移会在用户下次 `npm i -g peaks-loop@latest` 时**自然发生**。而 agents / output-styles 的 IDE 侧条目
现在仍是**可用**状态（实体文件在，只是 provenance 冻结），不迁移**不会更坏**。

### 3.5 一条你会碰到的边界（nvm 用户）

如果你用 nvm 并**保留多个 node 版本**：某个条目的边车记的是**旧 node 版本**的包路径，那个目录**还在**，
于是它既不是「臂 A」（能解析）也不是「臂 B」（不是本次安装的包），落入**第三条**——**被跳过 + 报到 stderr**，
不再自动更新（`scripts/canonical-store-link.mjs:142-149`，代码注释明说是为了不接管「另一份活着的安装」）。
要看它是否发生：升级后看 stderr 有没有 `left alone, not peaks-loop's to replace`。要让它迁移，删掉那条条目旁边的
`.peaks-managed` 边车，或移除旧 node 版本里的 peaks-loop 包，再跑一次安装器。

---

## 代码出处（每条行为陈述对应的出处）

| # | 陈述 | 出处 |
|---|---|---|
| 1 | 三类资产平行在真源根下 | `scripts/canonical-store.mjs:35` |
| 2 | 真源根 = `options.root` → `$PEAKS_HOME` → `~/.peaks` | `scripts/canonical-store.mjs:119-125` |
| 3 | 环境变量名 `PEAKS_HOME`（复用既有的） | `scripts/canonical-store.mjs:39`；`scripts/canonical-store.d.mts:45`；`src/services/sop/sop-paths.ts:28-30` |
| 4 | 目录资产 win32 用 junction | `scripts/canonical-store.mjs:290-295` |
| 5 | 单文件资产用 file 符号链接（Win 需权限） | `scripts/canonical-store-link.mjs:233`、`:5-7` |
| 6 | 归属 = `.peaks-managed` 边车 | `scripts/canonical-store.mjs:94-99` |
| 7 | 删除只认真源侧 :78 / IDE 侧 :104 | `scripts/canonical-store-prune.mjs:78`、`:104` |
| 8 | 旧 JSON 边车解析（fail closed） | `scripts/canonical-store-link.mjs:99-110` |
| 9 | 采纳两条臂（A 消失 / B 本次包） | `scripts/canonical-store-link.mjs:142-149` |
| 10 | 回退：拒绝建链接 → 实体副本 + 记真源路径 | `scripts/canonical-store-link.mjs:236-253`、`:51` |
| 11 | 回退可注入测量 | `scripts/canonical-store-link.mjs:272-295` |
| 12 | `reportCopyFallbacks` stderr | `scripts/install-skills.mjs:1047-1054` |
| 13 | `reportLeftAlone` stderr + 调用点 | `scripts/install-skills.mjs:1063-1068`、`1111-1112`、`1259` |
| 14 | skills 的 skipped 仍不上报（未改） | `scripts/install-skills.mjs:1156-1200` |
| 15 | output-styles 单目标 + 其理由 | `scripts/install-skills.mjs:678-710` |
| 16 | 新增模块必须进 `files`（通则守卫） | `tests/unit/ide/install-skills-published-modules.test.ts`；`package.json#files` |
| 17 | 幂等按内容；prune 无待删项时 no-op | `scripts/canonical-store.mjs:229-234`；`scripts/canonical-store-prune.mjs:26`（头注） |

---

*本文所引用的「隔离排练」与「校验脚本」原始输出，取自 `rd/evidence-s5-migration.md` §4；两者都在抛荒 HOME 下运行，
未触碰开发者的真实 `~/.peaks`、`~/.claude` 等目录。*
