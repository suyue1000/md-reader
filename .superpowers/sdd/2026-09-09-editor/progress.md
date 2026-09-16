# SDD ledger — plan: docs/superpowers/plans/2026-09-09-editor.md

Spec: docs/superpowers/specs/2026-09-09-editor-design.md（可达，裁决以它为准）
分支: feat/editor　merge-base: 16fcce9
计划: 18 个任务 / 134 步骤，阶段 A = Task 1-11，阶段 B = Task 12-18

## 执行前冲突扫描

### 跨任务（共享文件或接口的每一对）

| 任务对 | 共享的东西 | 产出 vs 消费 | 结论 |
| --- | --- | --- | --- |
| T2 → T3 | `BlockSlice` | `sliceTopLevelBlocks` 产出 / `renderBlocks` 消费 | 一致 |
| T3 → T6 | `RenderedBlock`、`renderBlocks` | 字段名与签名逐字对得上 | 一致 |
| T3 → T8 | `LineHeading` vs `FlatHeading` | T3 建，T8 删并收敛到 `FlatHeading` | 计划已写明收敛步骤，一致 |
| T3 ↔ T11 | `contract.ts` / `renderer.ts` | T3 加 `instance()`；T11 删 `createSession`/`RenderStages` | T11 未触及 `instance()` 与 `render()`，两者都仍被 T3/T10 需要，一致 |
| T4 → T5 → T6 | `BlockCache` | `createBlockCache` 产出 / `livePreview`、`MarkdownEditor` 消费 | 接口一致，**但见 F4** |
| T6 ↔ T7 | `MarkdownEditor.tsx`、`ReaderPage.tsx` | T7 追加 `onViewReady` | 追加式，一致 |
| T7 ↔ T8 | `src/types/document.ts` | T7 改 `ReadingPosition`，T8 改 `TocNode` | 不同接口，无冲突 |
| T6 ↔ T9 ↔ T13 | `MarkdownEditor` 的 extensions 数组 | 三次追加扩展 | 追加式，一致 |
| T10 ↔ T11 | `renderer.render()` | T10 消费，T11 只删分块相关 | 一致 |
| T11 ↔ T17 | `StatusBar.tsx` | T11 删渲染耗时，T17 加保存状态 | 先减后加，顺序正确 |
| T13 ↔ T16 ↔ T17 | `document.store.ts` | 三次追加字段（mode/writable、conflict、dirty/saveStatus） | 追加式；`setDocument`/`reset` 需一并重置新字段（已在各任务写明） |
| T14 → T15 | `SaveTarget`、`decideSaveTarget` | 签名逐字对得上 | 一致 |
| T15 → T16 | `isSelfWrite` | T15 产出实现，T16 以函数注入消费 | 一致，且注入使 T16 可纯测 |
| T13/T17 ↔ 既有 `useHotkeys` | 快捷键注册 | 新增 `mod+e` / `mod+s` | **见 F1（真雷）** |
| T1 ↔ T18 | `package.json` | T1 改 deps，T18 改 description | 不同字段，无冲突 |
| T12 ↔ 既有设置测试 | `SETTINGS_SCHEMA_VERSION` 1→2 | 已核实：`settings.store.test.ts` 与 `settings-coverage.test.ts` 均未断言版本号 | 无隐藏破坏 |

### 任务自洽（每个任务：它写的测试 vs 它写的代码，它建的文件 vs 它后面动的文件）

| 任务 | 自洽性 |
| --- | --- |
| T1 | 一致 |
| T2 | 9 个用例全部只调 `sliceTopLevelBlocks`，与实现签名一致 |
| T3 | **F7**：计划里的 `markdownRenderer` 单例**不存在**（我第一轮扫描写"已核实存在"是错的，实际核实后推翻）。`src/markdown/renderer.ts` 只导出工厂 `createMarkdownRenderer()`，且整条管线是动态 import 的懒加载；此外 T3 的脚注用例需要 `ensureBuiltinPlugins()` 已 await，测试代码没写，会直接跑挂 |
| T4 | 一致 |
| T5 | **F2**：给了两版 `livePreview`，第一版引用了未定义的 `ViewPluginDecorations` |
| T6 | **F3**：`EditorView.editable.reconfigure()` 不存在；**F4**：Files 未列出它要改的 `block-cache.ts` |
| T7 | 一致 |
| T8 | 一致 |
| T9 | **F5**：删掉自研 `highlight.ts` 后，"所有命中高亮"由谁负责未定 |
| T10 | 一致；手势约束已在 Step 5 显式标注需实测 |
| T11 | 一致 |
| T12 | 一致 |
| T13 | 受 **F1** 影响 |
| T14 | 7 个用例覆盖 `SaveContext` 的全部有意义组合，与实现分支一致 |
| T15 | 一致；`save.ts` 示例代码有未使用的 import（`registerFileHandle`/`setCurrentFileHandle`），按 Step 8 的说明会被用上 |
| T16 | **F6**：Files 写 "Modify `auto-refresh.ts`"，Step 4 写删除，自相矛盾 |
| T17 | 受 **F1** 影响 |
| T18 | 一致 |

### 裁决

Ruling R1: 不新建 git worktree，在已有的 `feat/editor` 分支上执行 — 仓库里 `node_modules` 与 `dist` 已就绪，worktree 需重装依赖且本次是长链路任务；分支本身已与 `main` 隔离，满足"不在主分支上实现"的底线 — 代价：这段时间内无法在同一仓库并行开发别的功能。

Ruling R2 (F2): T5 以"收尾后"的 `ViewPlugin.fromClass` 版本为准；删除模块级 `activeCache` 与 `cacheOf()`，`buildDecorations` 签名改为 `(view, cache)` — 第一版是残稿，模块级单例在同时存在两个编辑器实例时会串味 — 代价：无，第一版本就不可编译。

Ruling R3 (F3): 只读切换必须用 `Compartment`，不能用 `EditorView.editable.reconfigure()` — 后者是 `Compartment` 的方法，Facet 上没有，照抄会编译失败 — 代价：不提前拦截的话 T6 会浪费一整轮修复循环。

Ruling R4 (F4): T6 的 Files 补上 `src/editor/block-cache.ts` 与 `block-cache.test.ts`（加 `node.dataset.blockKey = key` 及其断言） — 代价：无。

Ruling R5 (F1，真雷): T13 的 `edit` 动作与 T17 的 `save` 动作必须带 `allowInInput: true` — 已核实 `useHotkeys.ts:46` 会在事件目标可编辑时跳过绑定，而 `isEditableTarget` 对 `isContentEditable` 返回 true，CodeMirror 的 `.cm-content` 正是 contenteditable；不改的话编辑态下 `⌘S` 与 `⌘E` 完全失效——恰恰是最需要它们的时候 — 代价：不改则核心功能不可用；改了之后这两个键在任何输入框里都会生效，可接受（保存与切模式本就是全局动作）。

Ruling R6 (F5): T9 删除 `highlight.ts` 后，"所有命中高亮可见"是硬要求；若 `@codemirror/search` 的扩展在不打开其内置面板时不提供全量命中高亮，实现者需自写 decoration 补上，不得以"CM 自带"为由交付一个没有高亮的查找 — 代价：可能增加 T9 的工作量。

Ruling R7 (F6): T16 中 `src/utils/auto-refresh.ts` 及其测试是**删除**，`decideRefresh` 是 `decideRefreshAction` 的超集 — 代价：无。

Ruling R8 (F7): 不新建 `markdownRenderer` 单例，改为把渲染器**作为参数注入**：
`renderBlocks(input: RenderInput, renderer: MarkdownRenderer): BlockRenderResult`，
`renderOffscreen` 内部自己 `await import('@/markdown')` + `ensureBuiltinPlugins()`，
`MarkdownEditor` 挂载时 await 一次并把实例存进 ref，之后同步渲染。
T3 的测试加 `beforeAll(async () => { await ensureBuiltinPlugins(); renderer = createMarkdownRenderer(); })`。
理由：(a) 单例方案会把整条 Markdown 管线（约 500KB）从懒加载块拖进 viewer 首屏，而 spec 的风险 1 只预算了 CodeMirror 那 350KB；(b) 注入与 `RendererOptions` 注释里写的"全部可注入以便单测"是同一套风格；(c) 保持 `renderBlocks` 同步，测试不必绕过异步。
代价：`renderBlocks` 多一个参数；`MarkdownEditor` 挂载后有一小段时间显示源码（插件加载完才出现 widget）。这一小段闪烁是真实代价，若实测刺眼，退路是在编辑器上方盖一层加载态而不是改回单例。

Ruling R8 (F7): 不新建 `markdownRenderer` 单例，改为把渲染器**作为参数注入**：
`renderBlocks(input: RenderInput, renderer: MarkdownRenderer): BlockRenderResult`，
`renderOffscreen` 内部自己 `await import('@/markdown')` + `ensureBuiltinPlugins()`，
`MarkdownEditor` 挂载时 await 一次并把实例存进 ref，之后同步渲染。
T3 的测试加 `beforeAll(async () => { await ensureBuiltinPlugins(); renderer = createMarkdownRenderer(); })`。
理由：(a) 单例方案会把整条 Markdown 管线（约 500KB）从懒加载块拖进 viewer 首屏，而 spec 的风险 1 只预算了 CodeMirror 那 350KB；(b) 注入与 `RendererOptions` 注释里写的"全部可注入以便单测"是同一套风格；(c) 保持 `renderBlocks` 同步，测试不必绕过异步。
代价：`renderBlocks` 多一个参数；`MarkdownEditor` 挂载后有一小段时间显示源码（插件加载完才出现 widget）。这一小段闪烁是真实代价，若实测刺眼，退路是在编辑器上方盖一层加载态而不是改回单例。

Ruling R8 (F7): 不新建 `markdownRenderer` 单例，改为把渲染器**作为参数注入**：
`renderBlocks(input: RenderInput, renderer: MarkdownRenderer): BlockRenderResult`，
`renderOffscreen` 内部自己 `await import('@/markdown')` + `ensureBuiltinPlugins()`，
`MarkdownEditor` 挂载时 await 一次并把实例存进 ref，之后同步渲染。
T3 的测试加 `beforeAll(async () => { await ensureBuiltinPlugins(); renderer = createMarkdownRenderer(); })`。
理由：(a) 单例方案会把整条 Markdown 管线（约 500KB）从懒加载块拖进 viewer 首屏，而 spec 的风险 1 只预算了 CodeMirror 那 350KB；(b) 注入与 `RendererOptions` 注释里写的"全部可注入以便单测"是同一套风格；(c) 保持 `renderBlocks` 同步，测试不必绕过异步。
代价：`renderBlocks` 多一个参数；`MarkdownEditor` 挂载后有一小段时间显示源码（插件加载完才出现 widget）。这一小段闪烁是真实代价，若实测刺眼，退路是在编辑器上方盖一层加载态而不是改回单例。

## 进度

Task 1: 实现完成（commit 1514468，248 测试通过）
Task 1: 审查 — 规范 ✅，质量批准，1 条 Important（`vite.config.ts` 注释断言 viewer 入口 350KB，实测此刻仍是 84KB）
Ruling R9 (Task 1 Important，plan-mandated): 该注释文本是计划逐字指定的，但断言与当下事实不符。不删句、不回退阈值（阈值提前调高是对的，Task 6 就要用），改为前瞻式表述「编辑器视图接入后，入口会涨到 350KB 量级」 — 理由：阈值与说明是两件事，说明必须在任何一个提交上都成立 — 代价：若最终体积远超 350KB，这句仍需在阶段 A 验收时复核。
Task 1: 待确认项（reviewer 标⚠️，我来判）— 「350KB 是否兑现」无法在本任务确认，不算缺口；已挂到 Task 11 阶段 A 验收时用实测字节数复核。基线：本任务结束时的 viewer 入口大小。

Task 1: 实现完成（commit 1514468，248 测试通过）
Task 1: 审查 — 规范 ✅，质量批准，1 条 Important（`vite.config.ts` 注释断言 viewer 入口 350KB，实测此刻仍是 84KB）
Ruling R9 (Task 1 Important，plan-mandated): 该注释文本是计划逐字指定的，但断言与当下事实不符。不删句、不回退阈值（阈值提前调高是对的，Task 6 就要用），改为前瞻式表述「编辑器视图接入后，入口会涨到 350KB 量级」 — 理由：阈值与说明是两件事，说明必须在任何一个提交上都成立 — 代价：若最终体积远超 350KB，这句仍需在阶段 A 验收时复核。
Task 1: 待确认项（reviewer 标⚠️，我来判）— 「350KB 是否兑现」无法在本任务确认，不算缺口；已挂到 Task 11 阶段 A 验收时用实测字节数复核。基线：本任务结束时的 viewer 入口大小。

Task 1: 实现完成（commit 1514468，248 测试通过）
Task 1: 审查 — 规范 ✅，质量批准，1 条 Important（`vite.config.ts` 注释断言 viewer 入口 350KB，实测此刻仍是 84KB）
Ruling R9 (Task 1 Important，plan-mandated): 该注释文本是计划逐字指定的，但断言与当下事实不符。不删句、不回退阈值（阈值提前调高是对的，Task 6 就要用），改为前瞻式表述「编辑器视图接入后，入口会涨到 350KB 量级」 — 理由：阈值与说明是两件事，说明必须在任何一个提交上都成立 — 代价：若最终体积远超 350KB，这句仍需在阶段 A 验收时复核。
Task 1: 待确认项（reviewer 标⚠️，我来判）— 「350KB 是否兑现」无法在本任务确认，不算缺口；已挂到 Task 11 阶段 A 验收时用实测字节数复核。基线：本任务结束时的 viewer 入口大小。

