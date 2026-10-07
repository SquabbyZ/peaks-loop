---
name: a-guard-named-for-a-rule-but-written-as-a-list-cannot-see-the-next-case
description: 一条名为"安装器导入的兄弟模块都会被发布"的守卫，身体里写死了两个模块名——于是它防的那个坑（新增模块漏进 package.json#files）第三次出现时，它照样会绿
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-06-session-d0d50d/report-material.md
---

`package.json#files` 是 npm 的发布白名单，而**仓库里没有任何东西读它**。漏加一个
`scripts/install-skills.mjs` 导入的模块，后果是**每个用户**在 `npm i -g` 后 `ERR_MODULE_NOT_FOUND`，
而**全仓 4238 条测试全绿**。本 session 在同一个地方栽了两次（`canonical-store.mjs`、`canonical-store-link.mjs`）。

第三次时，一条守卫被加上了：

```js
it('when the installer imports a sibling module, should ship that module in the tarball', () => {
  expect(manifest.files).toContain('scripts/canonical-store.mjs');
  expect(manifest.files).toContain('scripts/canonical-store-link.mjs');
});
```

**它的名字许诺的是一条通则，它的身体枚举的是一份清单。** 第四次新增模块时它不会红 ——
而那正是它被写出来要防的事。一个守卫的价值全在"它没检查的地方"，而**名字把它没检查的地方描述成了已覆盖**。

修法不是再加一个 `toContain`，是**把通则从被守的对象身上读出来**：
解析 `scripts/install-skills.mjs` 的相对 `import`，逐个断言在 `files` 里、且在磁盘上存在（`87d2b86b`）。
清单消失了，因为不再需要人来维护它。

**判据（问得出来就能当场抓住）：**

> 把这条守卫的名字读一遍，再把它身体里**能被改动的常量**数一遍。
> 名字描述的量，和身体实际枚举的量，是同一个吗？

**两个必须配套的防线**（否则修完会掉进反向的坑）：

1. **非空先行**：解析器瞎掉会返回零条，而"对零条循环"永远通过。所以先断言 `specifiers.length > 0`，
   让**"什么都没找到"是失败而不是通过**。退化成一个 no-op 的守卫，必须被它自己的读数抓住。
2. **给解析器喂 fixture**：正例（两条相对导入）与反例（一条 `@scope/pkg` 裸导入，**不得**被算作兄弟模块）
   同时喂给同一个解析器。守卫的可信度来自**它读得准**，不是来自**它读的那个文件碰巧是对的**。

相关：[[a-guard-that-reads-the-thing-it-guards-is-not-a-guard]] ·
[[a-gate-that-verifies-the-label-instead-of-the-thing]] ·
[[refactoring-a-guard-into-pieces-needs-an-arm-that-can-see-the-difference]] ·
[[a-census-guard-cannot-see-an-untracked-file-so-a-pre-commit-green-is-not-a-green]]。
