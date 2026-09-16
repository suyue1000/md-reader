# Task 16 实现报告

## 审查后更正（追加，先读这一节）

上一轮报告在「不能弄错的顺序」一节里写过一句话：

> 这个测试能证明「push 确实发生、且内容正确」……但**不能**证明「顺序颠倒会
> 被测出来」……这个测试测不出「顺序颠倒」这一种特定的回归。……坦白说明：
> **顺序本身是靠代码走查钉住的，不是靠这条自动化测试钉住的**。

**这个结论下大了，需要更正。** 审查者亲自动手验证：把 `ConflictBanner.tsx`
`useDisk` 里两行顺序颠倒后跑原有 4 条用例——确实全部通过，这部分观察是对的
（原因也查实了：`applyRefreshedDocument` 只改 Zustand store，不会同步触碰独
立的 `EditorView`，而 `view.state.doc.toString()` 要等 `MarkdownEditor` 的
`value` 同步 `useEffect` 跑过才会读到新内容，那个 effect 不会在同一个同步的
点击处理函数内触发）。但审查者接着写了一个基于 `vi.spyOn` +
`invocationCallOrder` 的用例，直接断言两个函数被调用的先后序号——顺序颠倒时
准确变红，顺序正确时通过。

**准确的说法应该是**：「用内容断言这种测试风格测不出来」≠「测不出来」。
`invocationCallOrder` 记录的是 mock 调用的全局递增序号，跟 React 有没有
flush、EditorView 有没有被重新灌入完全无关，能够精确钉住"谁先谁后"这件事。
我把"我这样测测不出来"写成了"这测不出来"，是把一次具体的观察当成了全称结
论——这正是仓库反复强调的"机制归因必须查证"在测试判断上的同一类教训：验证
过"用这种方法测不出"，不等于验证过"没有任何方法测得出"，后者需要真的试过其
他测法才能下结论，而我没有试。

**已处理**：在 `ConflictBanner.test.tsx` 里补了一条常驻的
`invocationCallOrder` 断言（见下方「补充：顺序红线的常驻断言」一节），并做
了撤销验证。同时评估并新增了 `useAutoRefresh.ts` 的 hook 级测试（见下方
「补充：`useAutoRefresh` hook 级测试」一节），这是审查提出、由我判断后决定
补上的一项。

## 完成概述

实现了外部改动的冲突判定：新建 `src/editor/conflict.ts`（`decideRefresh`，取代
并删除了 `src/utils/auto-refresh.ts` 的 `decideRefreshAction`），接进
`useAutoRefresh`，在 `document.store` 里加了 `conflict` 状态，并新建
`ConflictBanner` 组件让用户在「保留我的改动」与「改用磁盘上的版本」之间决断。
同时正式接管了 `MarkdownEditor` 里 Task 13 留下的临时护栏，并首次给
`isSelfWrite`（Task 15）接上了消费方。

## 交付文件

- `src/editor/conflict.ts` + `src/editor/conflict.test.ts`（新增，10 个用例）
- 删除 `src/utils/auto-refresh.ts` + `src/utils/auto-refresh.test.ts`
  （`missing` / `permission-lost` / `error` 的文案断言已搬进
  `conflict.test.ts`）
- `src/hooks/useAutoRefresh.ts`：改用 `decideRefresh`，新增 `conflict` 分支与
  `hasConflict` 依赖
- `src/stores/document.store.ts`：新增 `conflict: MarkdownDocument | null`、
  `setConflict`、`clearConflict`
- `src/editor/save.ts`：新增 `pushVersionBeforeOverwrite`（不写盘，只把内容
  推进版本缓冲）
- `src/components/layout/ConflictBanner.tsx` + `ConflictBanner.test.tsx`（新增，
  4 个用例）、接入 `src/components/layout/AppShell.tsx`
- `src/editor/MarkdownEditor.tsx` + `MarkdownEditor.test.tsx`：移除
  `readOnlyRef` 护栏，改为信任上游判定；两条护栏回归用例改写为反映新行为的
  用例

## `decideRefresh` 的设计

按简报骨架实现，六种结果的可辨识联合（`continue` / `touch-timestamp` /
`adopt` / `conflict` / `stop` / `deactivate`），与仓库里 `FileProbeResult`、
`SaveTarget` 是同一套风格。核心是 `RefreshContext.isSelfWrite` 以**依赖注入**
的方式传入，而不是在 `conflict.ts` 内部直接 `import` `self-write.ts` 的模块级
登记表——这是简报明确要求的可测性设计：注入之后，「自写回环」（`isSelfWrite`
返回 true）、「外部改动无脏」（`editorText === savedContent`）、「外部改动有
脏」（两者不等）三种情形都能在单测里精确构造，不必依赖那张登记表的真实状态。

判定顺序（`changed` 分支内）：
1. 自写回环 → `touch-timestamp`（不重灌，只同步时间戳）
2. 内容与 `savedContent` 完全相同（有些编辑器保存时只改 mtime）→
   `touch-timestamp`
3. 本地无脏（`editorText === savedContent`）→ `adopt`
4. 本地有脏 → `conflict`

## 「脏」判据的选择与理由

目前 `document.store` 没有 `dirty` 字段（Task 17 才加），本任务需要自己判断。
选择：**直接比较编辑器里的活文本（CodeMirror 的 `view.state.doc.toString()`）
与 `document.store` 的 `document.content`**。理由：

- `document.content` 是「上次从磁盘读到或写回磁盘的内容」这条语义目前唯一的
  载体——`setDocument` 与 `applyRefreshedDocument` 是仅有的两处写入点，含义
  正好对应 `RefreshContext.savedContent` 的 JSDoc。
- 阅读态下二者恒等：`MarkdownEditor` 在只读时会把外部内容变化原样灌入，因此
  `dirty` 只可能在编辑态被判定为真——这与「冲突只应该在编辑态出现」这个不变
  量一致，也是 `useAutoRefresh` 里没有额外用 `mode === 'edit'` 去重复判断的
  原因。
- 已知局限：`performSave` 目前没有任何真实的 UI 触发入口（⌘S 与自动保存都是
  Task 17 才接），也没有在保存成功后回写 `document.store` 的 `document.content`
  / `lastModified`。也就是说，一旦 Task 17 接上保存并让某次保存真正发生，在
  它把 `document.content` 同步更新之前，这里的脏判据会短暂地把「已经保存到磁
  盘、但 store 还没来得及知道」误判为「脏」。这个缺口现在无法触发（没有调用
  入口），如实记录给 Task 17：接保存时需要顺带把这次同步做上，否则每次保存
  后都会立刻被自动刷新误判成冲突。

`useAutoRefresh` 里获取 `editorText` 的方式：通过 `useEditorView()`
（`EditorContext`）拿到当前的 `EditorView`，读 `view.state.doc.toString()`；
拿不到 view（阅读态尚未挂载、或还在管线引导期）时退回 `current.content`
（此时二者理应相等）。为避免 `view` 本身在同一个 `documentId` 内变化（重开
同一篇文档，`openEpoch` 变但 `documentId` 不变）时被闭包捕获成旧引用，改成
在同步的 `useEffect` 里把最新 `view` 写进 `viewRef`，`tick` 读 `viewRef.current`
——这个约束与 `MarkdownEditor` 里 `readOnlyRef` 曾经解决的问题是同一类。

## Task 15 遗留接线：`isSelfWrite` 的消费方

`useAutoRefresh` 现在把 `isSelfWrite`（`self-write.ts`）作为
`RefreshContext.isSelfWrite` 传给 `decideRefresh`。这closes了简报点名的回路：
自动保存写盘 → `lastModified` 变 → 轮询判定「外部改了」→ 现在会先查自写登记
表，认出是自己写的，只同步时间戳，不回灌内容、不打断正在打字的光标。

## Task 13 临时护栏的接管

原护栏（`MarkdownEditor` 的 `readOnlyRef` 分支）逻辑是「编辑态下一律拒绝外部
`value` 变化」，注释明写完整判定留给 Task 16。分析后**选择移除**而不是保留或
改造，理由：

- 移除后 `value` prop 在同一个 `documentId`/`openEpoch` 内发生变化，现在只有
  两条路径能触发——`decideRefresh` 判定为 `adopt`（本地无脏，外部改动可以直
  接采用）、或用户在冲突提示里选择「改用磁盘上的版本」（此时未保存改动已经
  被 `pushVersionBeforeOverwrite` 推进版本缓冲）。真正的冲突场景根本不会走到
  `applyRefreshedDocument`，而是被 `useAutoRefresh` 拦下写进
  `document.store.conflict`，交给 `ConflictBanner`。
- **如果保留旧护栏不动，会直接把 `adopt` 这个新功能做废**：`adopt` 恰恰是
  「编辑态、但本地没有未保存改动」时发生的，旧护栏按 `readOnly` 一刀切，会让
  这次本该安全生效的外部更新在编辑态下被无声吞掉——这是实现过程中发现的一个
  真实设计冲突，不是假设。
- 已更新 `MarkdownEditor.tsx` 里的注释，说明这条判断现在的落脚点在
  `decideRefresh` + `useAutoRefresh` + `ConflictBanner` 三处，不再用「留给未来
  某个任务」这种说法。

对应的两条回归用例做了调整：原「编辑态下外部内容变化不许覆盖」改写成「编辑态
下 value 变化同样会被灌入」（验证新行为，而不是删掉不测）；原「退出编辑态不
许把旧内容灌回来」的用例本身验证的是「`readOnly` 不该进依赖数组」，这一点在
新实现里依然成立（该 effect 依赖数组里从未有 `readOnly`），保留并重命名说明
了新的动机。

## 「不能弄错的顺序」的实现与测试边界

`ConflictBanner.useDisk`：先 `pushVersionBeforeOverwrite(view.state.doc.toString())`
再 `applyRefreshedDocument(conflict)`。`ConflictBanner.test.tsx` 用真实的
`EditorView`（挂到 `document.body`，因为 `useEditorView()` 按 `dom.isConnected`
判活）+ 真实的版本缓冲（不 mock `save.ts`）验证：点击「改用磁盘上的版本」后
`popPreviousVersion()` 返回的是点击前编辑器里的原文，而不是磁盘内容或 `null`。

**如实说明测试边界**：这个测试能证明「push 确实发生、且内容正确」（删掉 push
那一行会让它变红，见下方自检），但**不能**证明「顺序颠倒会被测出来」——
`ConflictBanner` 里读取编辑器文本（`view.state.doc.toString()`）与写入
`document.store`（`applyRefreshedDocument`）是两个独立的副作用，`view` 的
内容只会在 React 完成一次渲染并让 `MarkdownEditor` 的 `value` 同步 effect
跑过之后才会真正改变，而这两行代码在同一个同步的事件处理函数里背靠背执行，
中间没有任何机会讨论 React 去 flush 效果。也就是说，即使把两行顺序颠倒，在
当前架构下、在这一次事件处理的同步窗口内，`view.state.doc.toString()` 读到
的值也不会变——这个测试测不出「顺序颠倒」这一种特定的回归。代码仍然按简报
要求的顺序实现（先推版本缓冲、后覆盖），这是防御性正确性，也是为了不给将来
的重构（例如把内容同步改成同步的 `flushSync`）留一个真会炸的坑；但这里坦白
说明：**顺序本身是靠代码走查钉住的，不是靠这条自动化测试钉住的**。

## 自检：删行验证

依次删除以下三处，逐一确认测试变红，再逐一恢复、跑一次完整 `npm run verify`
确认无残留改动：

1. `conflict.ts` 里 `isSelfWrite` 那道判断（`if (context.isSelfWrite(...)) { ... }`
   整段）→ `conflict.test.ts` 的「是我们自己刚写的，只对时而不回灌」**1 条**
   变红。
2. `conflict.ts` 里的 `dirty` 判断（把 `return dirty ? conflict : adopt`
   直接改成恒返回 `adopt`）→ `conflict.test.ts` 的「外部改动且本地有未保存改
   动，报冲突」+「冲突结果携带磁盘上的文档」共 **2 条**变红。
3. `ConflictBanner.tsx` 的 `useDisk` 分支里
   `if (view) pushVersionBeforeOverwrite(view.state.doc.toString());`
   → `ConflictBanner.test.tsx` 的「改用磁盘上的版本」**1 条**变红。

三处关键正确性增量都有测试覆盖，删除后测试确实会红；恢复后 `npm run verify`
回到 53 文件 / 528 用例全绿，没有残留改动。

## 补充：顺序红线的常驻断言

审查指出后，在 `ConflictBanner.test.tsx` 里新增一条用例，用
`vi.spyOn` 分别挂在 `saveModule.pushVersionBeforeOverwrite`（模块命名空间导
入，`import * as saveModule from '@/editor/save'`）与
`useDocumentStore.getState().applyRefreshedDocument` 上，点击「改用磁盘上的
版本」后断言：

```ts
expect(pushSpy).toHaveBeenCalledTimes(1);
expect(applySpy).toHaveBeenCalledTimes(1);
const pushOrder = pushSpy.mock.invocationCallOrder[0];
const applyOrder = applySpy.mock.invocationCallOrder[0];
expect(pushOrder).toBeDefined();
expect(applyOrder).toBeDefined();
expect(pushOrder).toBeLessThan(applyOrder as number);
```

（`as number` 是因为 `tsconfig.json` 开了 `noUncheckedIndexedAccess`，数组下
标访问的类型是 `number | undefined`；上面两行 `toBeDefined()` 在运行时已经
保证了非空，但 TypeScript 的类型收窄认不出 vitest 的 `expect().toBeDefined()`，
只能显式断言。）

**撤销验证**：把 `ConflictBanner.tsx` `useDisk` 里两行顺序换成先
`applyRefreshedDocument` 再 `pushVersionBeforeOverwrite`，跑这条新用例——
准确变红，报错为 `expected 2 to be less than 1`；改回正确顺序后确认变绿，
`git status` 确认工作区干净、`npm run verify` 全绿。这条用例现在是**常驻**
测试，不是本轮临时验证完就删掉的脚本。

## 补充：`useAutoRefresh` hook 级测试

审查指出 `useAutoRefresh.ts` 本身历史上从未有过 hook 级测试，而本任务给它加
了新逻辑：改接 `decideRefresh`、新增 `conflict` 分支、`hasConflict` 暂停/恢复
轮询、`viewRef` 防陈旧闭包。判断后**决定补上**，理由：

- 现有覆盖（`conflict.test.ts` 证明"给定探测结果和上下文，应该做什么决定是
  对的"；`ConflictBanner.test.tsx` 证明"UI 拿到 conflict 之后怎么编排是对
  的"）两端都绕开了 `useAutoRefresh` 本身——**没有任何测试证明"探测结果真的
  被正确地转发到了 `decideRefresh`，`decideRefresh` 的返回值真的被正确地分
  发到对应的 store 调用"**。这与 `ReaderPage.test.tsx` 文件头注释里点名的
  「接线断了没有任何用例会红」是同一类风险，而这次是本任务自己新增的接线，
  不是别人遗留的。
- 成本可控：`probeCurrentFile` 背后是真实的 File System Access API，jsdom 
  造不出真实句柄，但可以整体 `vi.mock('@/utils/file-open')` 掉，只测「拿到
  探测结果之后 `useAutoRefresh` 做对了什么」，不测探测本身（探测逻辑已经在
  `file-open.test.ts` 覆盖）。轮询的 `setTimeout` 链用 `vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync()` 推进，这是 vitest 测异步定时器链的标准做
  法，仓库里没有先例但也没有特殊障碍。
- 权衡过「只测新逻辑、不做历史遗留部分的补全普查」：新建的
  `src/hooks/useAutoRefresh.test.tsx`（4 个用例）只覆盖本任务新增的四个关键
  行为——`adopt`（本地无脏，直接采用）、`conflict`（本地有脏，写进 store 而
  不覆盖 `document.content`）、冲突挂起期间暂停轮询 + 决断后自动恢复、以及
  一条延用旧行为的对照用例（`missing` 停止监听并给出文案）用来确认 mock 接
  线本身是通的。没有去补标签页可见性、`touch-timestamp`（自写识别）等历史
  上就存在、且已经在别处间接验证过的分支——这部分不是本任务引入的风险，继
  续靠 `decideRefresh` 的单测 + 代码走查兜底，全量补齐超出了本任务的范围。

**自检**：删掉 `if (hasConflict) return;` 这一行 → 「冲突决断之前暂停轮
询」用例准确变红（`expected 2 to be 1`，`received 2`——轮询在冲突挂起期间
仍然继续探测了两次）；恢复后确认变绿，`git status` 干净。

## 质量检查结果

```
Typecheck: PASS
Lint: PASS
Test: PASS (54 files / 533 tests)
```

基线从 52 文件 / 521 用例，到本任务第一轮交付的 53 文件 / 528 用例（新增
`conflict.test.ts` 10、`ConflictBanner.test.tsx` 4，删除 `auto-refresh.test.ts`
7，`MarkdownEditor.test.tsx` 用例数不变），到本轮审查修复后的 54 文件 / 533
用例：新增 `useAutoRefresh.test.tsx`（4 个用例，+1 个文件），
`ConflictBanner.test.tsx` 新增顺序红线用例（+1 个用例，文件数不变）。
528 + 4 + 1 = 533，文件数 53 + 1 = 54，与实测结果一致。

## 遇到的问题

1. **构造真实 `EditorView` 用于测试时，第一次忘了把它挂到 `document.body`**：
   `useEditorView()` 按 `dom.isConnected` 判活（`EditorContext.tsx` 里的既有
   设计），不挂的话恒为 `null`，导致「改用磁盘的」用例误判成「没有 view」分
   支，第一次跑测试直接失败（`popPreviousVersion()` 收到 `null`）。加上
   `parent: document.body` 后解决。
2. **`useAutoRefresh` 里 `view` 的闭包陈旧问题**：最初直接在 `tick` 闭包里用
   `useEditorView()` 的返回值，评审自己发现如果同一篇文档被重新打开
   （`openEpoch` 变但 `documentId` 不变），`view` 会更新但这个 effect 的依赖
   数组里没有它，`tick` 会一直用着重建前那个已销毁的旧实例。改成用
   `viewRef`（在同步的 `useEffect` 里更新，模式与已删除的 `readOnlyRef` 相
   同）避免这个问题；这一步没有对应的自动化测试（复现需要真实的重开同一文
   档场景），是走查发现并修复的，如实记录。
3. **移除 `MarkdownEditor` 护栏前的关键判断**：一开始考虑过「原样保留护栏，
   反正上游已经保证安全」，但推演后发现这会让 `adopt` 分支在编辑态下失效
   （见上文「Task 13 临时护栏的接管」一节）——这是本任务里唯一一处「差点做
   错」的设计决策，记录下来避免以后重复踩。
4. **人工浏览器验收未做**：简报 Step 8 要求「编辑态下改几个字、外部改同一
   文件、看是否出现冲突提示」。这个仓库是 Chrome 扩展，`npm run dev` 只是
   watch 构建，没有可交互的开发服务器；端到端验证需要把未打包扩展载入真实
   Chrome、通过 File System Access API 打开一个真实文件、在编辑器外部改动它、
   观察轮询触发冲突条。本次会话没有执行这一步，覆盖依赖的是
   `conflict.test.ts`（决策逻辑）+ `ConflictBanner.test.tsx`（UI 编排 + 版本
   缓冲顺序）+ `MarkdownEditor.test.tsx`（value 同步行为）三层单测/组件测试，
   没有做真实浏览器里的端到端验证——这是本次交付的一个明确缺口，与 Task 15
   报告里对 File System Access API 部分的说明是同一类型的缺口。

## 审查两条 Minor 的处理

1. **`useAutoRefresh.ts` 缺少 hook 级测试**——已处理，见上文「补充：
   `useAutoRefresh` hook 级测试」一节，判断后决定补上而不是说明理由跳过。
2. **脏判据依赖 `document.content` 在保存成功后被同步更新**——审查判定为
   「已被实现者自己记录，非新问题」，且方向安全（多弹提示而非静默覆盖）。
   本轮不做代码改动，维持第一轮报告里「脏判据的选择与理由」一节记录的说
   明，留给 Task 17 接保存时一并处理（保存成功后需要同步更新
   `document.store` 的 `document.content`/`lastModified`）。

## 提交信息

见对话中的 commit 记录（本文件与代码在同一次提交中一起提交）。
