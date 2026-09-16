# 编辑能力设计

- 日期：2026-09-09
- 状态：待评审
- 范围：把 Markdown Reader 从只读阅读器扩展为「可读可写」的本地 Markdown 编辑器

## 背景

当前扩展只做渲染：`markdown-it` 把源文本编译成 HTML，`MarkdownView` 分块插进 DOM，
Shiki / Mermaid / KaTeX 再做异步增强。整条管线是**单向**的，没有任何反向能力。

目标是让用户在同一个界面里直接修改文档并写回本地文件，且**不牺牲现有的阅读体验**。

## 目标

1. 所见即所得的编辑：正文保持渲染态，只有正在编辑的那一块显示 Markdown 源码。
2. **无损**：保存写回的必须是用户自己的文本。任何语法都不会被"规范化"、改写或丢失。
3. 写回本地原文件；无法写回的入口降级为另存，并明确告知用户。
4. 阅读态的观感与今天完全一致。

## 非目标

以下明确不做，避免第一版失焦：

- 左右分栏（源码 / 预览）布局
- 内联级的标记现形（见「已知取舍」）
- 多文档同时编辑、多标签
- 图片粘贴上传、拖拽插图
- 表格可视化编辑器、Markdown 快捷插入工具栏
- 协同编辑
- 磁盘上的版本历史（只保留内存里最近若干版）

## 决策记录

### D1：编辑形态 —— 实时预览式 WYSIWYG

选定：底层存的始终是 Markdown 原文，编辑器用装饰把渲染结果显示出来。

否决 **结构化编辑器（Tiptap / ProseMirror）**：它把文档存成结构树，保存时需要
`树 → Markdown` 回写。这条路上，凡是没在树里建模的语法（脚注、定义列表、容器、
上下标）保存后会被改写甚至丢失；即使建了模，回写也会把用户原有的格式"规范化"
（列表符号、缩进、引号），让 `git diff` 面目全非。对一个操作用户真实文件的工具，
这是不可接受的。

### D2：集成方案 —— 单一 CodeMirror 视图

选定：呈现层收敛成一个 CodeMirror 6 文档视图。阅读态是它的 `readOnly` 状态，
编辑态是可写状态。**没有第二条渲染路径。**

否决 **双模式（阅读态保留现有 DOM 渲染 + 编辑态另起一套）**：两套「文档呈现」实现
并存，正文排版要对齐两遍，TOC / 查找 / 滚动定位各写两份，长期维护成本高于收益。

代价是现有的分块渲染（`chunker.ts`、`RenderSession`）失去用武之地并被删除。
这是有意识的取舍：分块是为 10MB 级文档做的，而本工具的实际使用场景没有那种文档，
它在为不存在的场景付复杂度。

### D3：现形粒度 —— 块级

选定：光标 / 选区所在的**整个块**（段落、标题、表格、代码块、引用块……）显示源码，
其余块保持渲染。

否决 **内联级现形**（只有光标处的 `**` 现形，同段其他标记仍隐藏）：需要为强调、链接、
行内代码、高亮、上下标等逐个语法写 Lezer 装饰，且这套装饰的样式与 markdown-it 的
产物存在漂移风险——同一段文字在编辑时和导出后长得不一样，正是这类工具最不该有的毛病。
块级方案让屏幕上的每一块都由 markdown-it 渲染，**屏幕与导出天然一致**。

段落通常只有几行，块级与内联级的实际观感差别不大；而编辑表格或代码块时看到源码
反而更好用。

### D4：保存 —— 自动保存为主，⌘S 为辅

选定：停笔 800ms 自动写盘（可在设置中关闭），⌘S 立即写盘。

代价与防护见「保存」一节。核心风险是自动保存写的是用户真实文件、没有回收站，
因此版本环形缓冲是必需品而非锦上添花。

### D5：保留阅读态 / 编辑态切换

选定：默认进阅读态，`mod+e` 或双击正文进编辑态。

理由：没有阅读态时，读文档时随手点一下正文，那一块会当场变成源码。对一个主要用来
读的工具，这个抖动是实打实的退步。阅读态下不存在光标，任何块都不会现形。

这不违背 D2：阅读态与编辑态共用同一个 CodeMirror 实例与同一套装饰代码，差别只是
三个开关——`EditorView.editable`、光标块是否现形、是否申请写权限。

## 架构

### 新增模块

```
src/editor/
  EditorView.tsx      CodeMirror 实例的 React 宿主，取代 MarkdownView
  extensions.ts       扩展组装：主题、快捷键、装饰、只读态、搜索
  live-preview.ts     核心装饰：块级 widget 的 StateField / ViewPlugin
  block-render.ts     全篇解析 → 按 token.map 切成「行区间 + HTML」
  block-cache.ts      块指纹 → 已增强 DOM 的缓存
  save.ts             保存决策（纯函数）与执行
  conflict.ts         自写回环识别与冲突判定（纯函数）
  versions.ts         保存前版本的环形缓冲
  toc-source.ts       从解析结果产出带行号的 TOC
  offscreen-render.ts 供导出 / 打印使用的离屏渲染
```

### 被删除的代码

- `src/markdown/chunker.ts` 及 `chunker.test.ts`
- `contract.ts` 中的 `RenderSession` / `ChunkResult` / `ChunkOptions`，以及
  `renderer.ts` 里对应的 `createSession`
- `src/components/markdown/MarkdownView.tsx` 的分块插入逻辑（整个组件被 EditorView 取代）
- `document.store` 的 `renderProgress`、`setRenderProgress`
- `useMarkdownRender` 的分块调度（保留一次性渲染路径供离屏渲染使用）

### 数据流

```
文件句柄 ──读──▶ MarkdownDocument.content ──▶ CodeMirror Doc（唯一真相）
                                                    │
                        ┌───────────────────────────┼───────────────────────┐
                        ▼                           ▼                       ▼
                 block-render（防抖 200ms）    保存（防抖 800ms / ⌘S）   toc-source
                        │                           │                       │
                        ▼                           ▼                       ▼
                  块 widget 装饰              写回文件句柄              TOC 面板（带行号）
```

**CodeMirror 的文档是唯一真相。** `document.store.document.content` 退化为「上次从磁盘
读到 / 上次写回磁盘的内容」，用于脏判定与冲突比对，不再是渲染输入。

## 块级实时预览

### 解析与切块

文本变化后（防抖 200ms）执行一次 `md.parse(全文, env)`，遍历 `level === 0` 的块级开标签，
读取它们的 `map`（`[startLine, endLine)`），再用**同一个 `env`** 调
`md.renderer.render(该块的 token 切片, options, env)` 得到该块 HTML。

用整篇的 `env` 而不是逐块独立解析，是这一步的关键：脚注定义、引用式链接定义、
有序列表的起始编号都是跨块的上下文，独立解析会让 `[^1]` 渲染不出链接、`[ref]: url`
定义在别处的链接变成纯文本。

产出：`ReadonlyArray<{ startLine: number; endLine: number; html: string; hash: string }>`。

### 装饰规则

一个 `StateField<DecorationSet>`：

- 选区**不与**某块的行区间相交 → `Decoration.replace({ widget, block: true })`，
  widget 内容是该块 HTML（挂 `.markdown-body` 类，直接吃现有 `markdown.css`）。
- 选区与之相交 → 不装饰，显示原始源码，由 `@codemirror/lang-markdown` 提供语法高亮，
  标记字符以弱化色显示。
- 阅读态（`readOnly`）下没有选区，因此**所有块都渲染**。

### 增量与缓存

`block-cache.ts` 以块内容 hash 为键缓存已增强的 DOM 节点（Shiki 上色后的代码块、
Mermaid 出图后的 SVG、KaTeX 展开后的公式）。CodeMirror 会销毁滚出视口的 widget，
没有缓存的话每次滚动都要重跑 Shiki 与 Mermaid。

只有 hash 变化的块才重建 widget，其余复用。缓存按 LRU 限量，随文档切换清空。

### 已知取舍

1. 编辑一个块时该块整体变源码。段落影响很小，表格与代码块反而更好用。
2. 块高度在渲染态与源码态之间会变化，进出编辑时可能有轻微跳动。缓解：进入编辑时
   以块的顶端为锚定点调整滚动，保证光标所在行不移动。
3. 极端情况（整篇是一个巨大的段落）退化为「编辑时整篇显示源码」。可接受。

## 文档状态与保存

### 状态模型

`document.store` 新增：

```ts
mode: 'read' | 'edit';
dirty: boolean;                                          // 编辑器文本 ≠ 上次落盘内容
saveStatus: 'idle' | 'saving' | 'saved' | 'error';
saveError: string | null;
writable: boolean;                                       // 是否已拿到 readwrite 权限
lastSavedAt: number;
```

### 写权限的时机（关键约束）

`FileSystemFileHandle.requestPermission({ mode: 'readwrite' })` **必须在用户手势的
调用栈内**，而自动保存由定时器触发，没有手势。

因此：**点击「编辑」按钮（或按 `mod+e`）那一下就是申请写权限的时机。**

- 拿到 `granted` → `writable = true`，之后可静默写盘。
- 被拒或无句柄 → 仍进入编辑态，但 `writable = false`，自动保存不生效，状态栏明确
  显示「本文档无法直接写回原文件，⌘S 另存」。

### 保存决策（纯函数，可测）

```ts
export type SaveTarget =
  | { kind: 'clean' }                                        // 无改动，什么都不做
  | { kind: 'write'; handle: FileSystemFileHandle }          // 静默写回原文件
  | { kind: 'needs-permission'; handle: FileSystemFileHandle } // 有句柄但无写权限，需手势
  | { kind: 'save-as' }                                      // 无句柄，走 showSaveFilePicker
  | { kind: 'download' };                                    // 连选择器都弹不出（跨源 iframe）

export function decideSaveTarget(input: {
  dirty: boolean;
  handle: FileSystemFileHandle | null;
  writable: boolean;
  canUsePicker: boolean;
}): SaveTarget;
```

采用可辨识联合而非「返回 null + 抛异常」，与既有的 `FileProbeResult` 保持同一风格：
这几种结果都是**预期内**的，各自需要不同的界面反馈。

执行侧：`write` 走 `handle.createWritable() → write → close`；
`save-as` / `download` 复用 `export/download.ts::saveFile`——它已经处理好了
「优先选择器、跨源 iframe 里退回 `<a download>`」的完整降级链。另存成功后拿到新句柄，
升格为 `writable = true`，自动保存随之恢复。

**`save-as` 与 `download` 只能由 ⌘S 触发**，自动保存在 `writable = false` 时不做任何事——
不可能每 800ms 弹一次保存对话框或下载。

### 自写回环与冲突

现有 `useAutoRefresh` 轮询 `lastModified`。自动保存会让它把我们自己写的内容再灌回来，
光标随之跳走。防护分两层：

1. **自写登记**：每次写盘后记录 `{ lastModified, contentHash }`。轮询结果命中登记表时
   判为 `self-write`，只更新时间戳、不替换内容。
2. **冲突判定**：

```ts
export type RefreshDecision =
  | { kind: 'self-write'; lastModified: number }   // 我们刚写的，只对时
  | { kind: 'adopt'; document: MarkdownDocument }  // 外部改动且本地无脏数据，直接采用
  | { kind: 'conflict'; document: MarkdownDocument } // 外部改动 + 本地有脏数据
  | { kind: 'ignore' };
```

`conflict` 弹一次性选择：**保留我的**（把编辑器内容标脏，等下次保存覆盖磁盘）或
**用磁盘的**（丢弃本地改动，丢弃前先入版本缓冲）。第一版不做差异视图。

### 版本安全网

自动保存写的是用户真实文件，没有回收站。因此每次写盘**之前**把上一版全文推入内存
环形缓冲（默认 5 版），并在编辑器菜单里提供「回到上一个保存版本」。

缓冲只在内存里，页面刷新即失。这是刻意的：把用户文档的历史副本写进 chrome.storage
或 IndexedDB 是一种没有被请求的数据留存。

## 现有能力的迁移

| 能力 | 现在 | 之后 |
| --- | --- | --- |
| TOC | 渲染时从 token 抽取 | 同一次解析产出，节点附带 `line` |
| Scroll Spy | IntersectionObserver 观察标题元素 | CodeMirror viewport 首行 vs TOC 行号 |
| 目录点击跳转 | 锚点 `scrollIntoView` | `dispatch(EditorView.scrollIntoView(行首))` |
| 查找 ⌘F | 自研 SearchBar 操作渲染后的 DOM | SearchBar 外观保留，底层换 `@codemirror/search` 查源文本 |
| 阅读位置 | anchorId + 像素偏移 + ratio 三重兜底 | 行号 + 行内偏移；比现在更稳且更简单 |
| 相对链接 | 拦截渲染 DOM 里的 `<a>` | widget 里仍是真 DOM，在编辑器容器上做事件代理 |
| 导出 HTML | 快照屏幕上的 `.markdown-body` | 离屏渲染后快照 |
| 打印 / PDF | 打印页面 DOM | 离屏渲染进 print-only 容器，打印时隐藏编辑器 |
| 导出 Markdown | `doc.content` | 编辑器当前文本 |
| 状态栏 | 渲染耗时 / 分块进度 | 保存状态、字数、行数 |
| 自动刷新 | 直接替换文档 | 经 `conflict.ts` 判定后再决定 |

### 关于查找的说明

改用 `@codemirror/search` 意味着查找的是**源文本**而非渲染结果。差别在于：搜
"粗体"能命中 `**粗体**`（好），但搜一段跨越了行内标记的连续文字可能落空（可接受，
且这是所有源码型编辑器的一致行为）。SearchBar 的外观、上一条 / 下一条、命中计数
全部保留。

### 关于导出的说明

现在导出快照的是屏幕 DOM，理由是屏幕上那份已经跑完了 Shiki / Mermaid / KaTeX。
方案 B 之后页面上不再有完整的 `.markdown-body`（CodeMirror 只渲染视口内的块），
因此改为**离屏渲染**：`renderer.render()` → 注入隐藏容器 → 跑完增强器 → `prepareExportFragment`。

这是本方案最实在的一笔额外工作量，但顺带修掉一个既有毛病：现在导出隐含要求
「文档已经渲染完」，离屏渲染之后不再有这个前提。

`exportHtml` / `exportPdf` 必须在用户手势的调用栈内调用的约束不变；离屏渲染是
异步的，需确认 Chrome 的手势有效期能覆盖它，否则改为「先渲染、后弹保存对话框」
的两段式，把选择器调用留在手势里。

## 设置与快捷键

新增 `EditorSettings` 分组，`SETTINGS_SCHEMA_VERSION` 升至 2（现有 deep-merge 兜底
可让存量配置平滑过渡，无需迁移脚本）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `autoSave` | `true` | 停笔后自动写回 |
| `autoSaveDelay` | `800` | 300–5000 ms |
| `defaultMode` | `'read'` | 打开文档时的初始模式 |
| `showLineNumbers` | `false` | 编辑态显示行号 |
| `tabSize` | `2` | |
| `indentWithTabs` | `false` | |
| `keepVersions` | `5` | 内存版本缓冲条数 |

快捷键：`mod+e` 切换模式、`mod+s` 立即保存 / 另存。撤销重做交给 CodeMirror 的 history。
`mod+f` 沿用现有 SearchBar。

## 测试策略

沿用项目现有取向：纯函数吃重，视图层只做冒烟。

- `block-render`：给定源文本 → 期望的行区间切分。覆盖围栏代码块、嵌套列表、表格、
  引用块、脚注定义、HTML 块、setext 标题。
- `block-render` 的跨块上下文：脚注引用与定义分处两块时，引用块的 HTML 含正确链接。
- `decideSaveTarget`：句柄 × 权限 × 脏态 × 能否弹选择器的组合。
- `conflict.decide`：自写回环、外部改动无脏、外部改动有脏、文件消失。
- 行号版 `reading-position`。
- `versions` 环形缓冲的入队与容量。
- EditorView 冒烟：挂载 / 切模式 / 输入一个字符后触发脏标记。装饰不做 DOM 级断言。

## 风险与代价

1. **首屏体积**：CodeMirror 成为唯一视图，无法懒加载。viewer 入口预计从 84KB 涨到
   约 350KB。本地扩展从磁盘加载、零网络请求，代价可接受，但确实与项目"能懒的都懒"
   的取向相反。
2. **浏览器直开 `.md` 路径下自动保存不可用**：那里的阅读器是跨源 iframe，既无句柄
   也弹不出选择器，只能 ⌘S 下载另存。而这是最常用的入口，需要在状态栏明确提示。
3. **块高度跳动**：进出编辑态时块高度变化。已有缓解方案，但需在真实文档上验证。
4. **导出与屏幕的一致性**：块级方案让二者共用 markdown-it，理论上一致；仍需在含
   Mermaid / KaTeX / 脚注的文档上实测确认。

## 验收标准

1. 打开一份含表格、脚注、Mermaid、KaTeX、任务列表、定义列表、上下标的文档，
   阅读态观感与改动前一致。
2. `mod+e` 进编辑态，修改一处文字，800ms 后文件被写回；用外部编辑器打开确认内容正确，
   且**除改动处外全文逐字节不变**。
3. 在编辑态持续打字 30 秒，光标不跳动、不闪回。
4. 编辑态下用外部编辑器改同一文件，出现冲突提示而非静默覆盖。
5. 无句柄入口（浏览器直开 `.md`）下可编辑，⌘S 触发下载，状态栏有明确提示。
6. 导出 HTML / 打印 PDF 产物与屏幕一致，含 Mermaid 图与公式。
7. `npm run verify` 通过。
