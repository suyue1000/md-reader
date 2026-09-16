# Task 11 报告：删除分块渲染残留 + 阶段 A 整体验收

两件事：① 把分块渲染那一整套删干净；② 逐条实测阶段 A 的八条判据。
**所有浏览器数字都是真实 Chrome 152 + 真实 `npm run build` 产物量出来的，
并且都加了 `--disable-backgrounding-occluded-windows` 与 `--disable-renderer-backgrounding`。**

---

## 一、清理了什么

### 删除的文件（4 个）

| 文件 | 为什么能删 |
| --- | --- |
| `src/markdown/chunker.ts` | 唯一调用方是 `renderer.createSession`，一并删了 |
| `src/markdown/chunker.test.ts` | 同上 |
| `src/components/markdown/MarkdownView.tsx` | Task 6 之后正文改由 `MarkdownEditor` 渲染，全仓库零引用 |
| `src/hooks/useMarkdownRender.ts` | 同上；它是 `MarkdownView` 的数据源 |

### 收缩的文件

- **`src/markdown/contract.ts`**：删 `RenderStages` / `ChunkResult` / `RenderSession` / `ChunkOptions`；
  `RenderResult` 只剩 `html` + `toc`；`MarkdownRenderer` 去掉 `createSession`。
  文件头注释按简报要求重写了——「viewer / TOC / 搜索 / 导出四个模块都依赖渲染结果」
  这句已经不成立：屏幕上的正文走 `instance()`（`editor/block-render.ts` 自己掌控
  parse/render 时机），导出与打印走 `render()`，目录由块渲染在同一趟 parse 里抽出来，
  不再从这个契约产出。新注释按这两类消费者重写。
- **`src/markdown/renderer.ts`**：`createSession` 的逻辑内联进 `render()`，
  现在是直白的 parse → collectHeadings → render → sanitize 四步；
  删掉 `CHUNK_THRESHOLD_CHARS` / `CHUNK_TARGET_CHARS` / `mark()` 与全部计时代码。
  **`render()` 与 `instance()` 都保留**（离屏渲染与块渲染各用一个）。
- **`src/stores/document.store.ts`**：删 `renderDurationMs` / `renderStages` / `renderProgress`
  / `setRenderDuration` / `setRenderProgress`（这几项本来就不在 `reset` 里，无需改 `reset`）。
- **`src/components/layout/StatusBar.tsx`**：删 `formatStages`、渲染耗时展示、
  「渲染中 x/y」分支与 `RenderStages` 的 import。现在显示文件名、大小、顶级标题数、
  监听状态、宽度、就绪状态。
- **`src/markdown/renderer.bench.ts`**：删 `splitSource` 与「分块渲染」两组基准，
  「一次性渲染」改名「整篇渲染」。`npm run bench` 已跑通。
- **`src/markdown/renderer.test.ts`**：删「返回渲染耗时与阶段明细」与整个「分块渲染会话」describe。
- **`src/hooks/index.ts`**：去掉 `useMarkdownRender` 导出。
- **`src/components/index.ts`**：**不需要改**——它从来没有导出过 `MarkdownView`（简报里这条是多余的）。

### 顺带修的两处悬空引用（注释里的）

- `src/hooks/useExport.ts`：那段「超大文档会吃掉用户手势预算」的说明引用了
  `markdown/chunker.ts` 的模块注释作为 10MB → 7.5s 的出处。文件删了，改成把数字
  直接写在原地并注明出处已随文件删除；同时删掉「`renderOffscreen` 走的是一次性
  `render()` 而不是分块会话」这半句——现在不存在第二条路径，这个对比没有意义了。
- `src/editor/MarkdownEditor.tsx:363`：注释里「旧的 MarkdownView 正是……」指向一个
  已经不存在的文件。改写成先讲清楚「为什么这三项非重跑不可」，再把 MarkdownView
  作为已删除的历史对照提一句，并标出它原来的路径。

### 测试数变化：459 → 443（-16）

| 来源 | 条数 | 为什么是「预期内的下降」 |
| --- | --- | --- |
| `chunker.test.ts` 整个文件 | 9 | `splitSource` 已整体删除，全仓库零引用 |
| `renderer.test.ts`「分块渲染会话」describe | 6 | `createSession` / `renderChunk` 已整体删除 |
| `renderer.test.ts`「返回渲染耗时与阶段明细」 | 1 | `RenderResult.durationMs` / `.stages` 已从契约里删除 |

9 + 6 + 1 = 16，与实际差额一致（用 `git show HEAD:...` 数原文件的 `it(` 核对过）。
**没有一条是「功能还在、用例被拿掉」**——每一条对应的被测函数都已从代码库消失。
文件数 47 → 46，减少的就是 `chunker.test.ts`。

### 自检：删掉保留的关键一行，测试会不会红

对内联后的 `render()` 做了三次变异，每次只改一行，跑
`renderer.test.ts` + `offscreen-render.test.ts`（共 25 条）：

| 变异 | 结果 |
| --- | --- |
| 把 `input.settings.markdown.toc ? collectHeadings(tokens) : []` 改成无条件 `collectHeadings(tokens)` | **1 条红**（「关闭 TOC 开关后不产出目录」） |
| 把 `sanitizeHtml(html, input.settings)` 改成直接返回 `html` | **3 条红**（剥离脚本 / 剥离事件属性 / 关闭 HTML 开关后转义） |
| 把 `md.renderer.render(tokens, md.options, env)` 的 env 换成 `{}` | **全绿，零覆盖** |

第三条我没有当成「补一条用例」处理，而是先去查证它到底有没有可观测差异：
写了一个探针，用当前启用的全套插件 parse 一段含脚注 + 引用式链接的源码，
分别用共享 env 和空 env 走 `md.renderer.render`，**产出逐字节相同**——
`footnote_tail` 与引用式链接的解析都在 parse 阶段就把 token 改完了。
所以这一行在当下的插件集下确实没有可观测行为，写不出一条诚实的用例。
处理办法是把这个事实写进 `render()` 的注释里（连同它为什么仍然照 markdown-it
的约定传同一个 env），而不是留一句「不共享 env 脚注就渲染不出链接」的推断——
我第一版注释就是这么写的，探针把它证伪了。

---

## 二、阶段 A 八条判据实测

### 实测环境（先说清可信度边界）

Chrome 152.0.7977.83 已移除 `--load-extension`，沿用 8c/8d 的替代方案：

- `npm run build` 的 **dist 原样**挂在本地 node 静态服务器 `http://127.0.0.1:8731`；
- 宿主页 `/host/<name>.md` 复刻 `src/content/index.ts` 的 `takeOver()` 握手
  （同样的 `viewer.html?embed=1` iframe、`md-reader:ready` → 回发 `md-reader:load`、
  `md-reader:hash` → `history.replaceState`）；
- `chrome.storage` 用 localStorage 替身，经 `Page.addScriptToEvaluateOnNewDocument` 注入；
- 驱动：Node 22 内置 `WebSocket` 直连 CDP，无新依赖。

**本轮额外替身了三个浏览器对话框**（都是自动化里必须的，且替身的都是浏览器 API，
不是项目代码）：`showSaveFilePicker`（把 Blob 记下来）、`window.print`（在被调用的
那一刻把 `#print-root` 的 DOM 与每张图的 `complete/naturalWidth` 记下来）、
判据 8 的 `showOpenFilePicker`（返回一个 `getFile()` 去 HTTP 取磁盘真文件、
带真实 mtime 的句柄——自动刷新只对 `source === 'fs-handle'` 的文档生效）。

**两个 anti-occlusion flag：全部八条判据的每一次测量都带着跑的。** 见下一节。

### 判据 1：正文渲染 —— **通过**

`features.md`（Shiki / Mermaid / KaTeX / 表格 / 任务列表 / 脚注 / 图片各一节，
外加 12 章正文把文档撑到 6965px），全篇滚一遍逐块采样，共数到 45 块：

| 元素 | 实测 | 源码期望 |
| --- | --- | --- |
| Shiki 上色 | `.shiki span[style]` **17** 个 | 一个 ```js 块，有色 |
| Mermaid | SVG 里 **4** 个 `.node`、**20** 个 `text/tspan` | `graph TD` 四个节点 |
| KaTeX | **2** 个 `.katex`，各带 `.katex-html` | 行内 `$E=mc^2$` + 块级积分 |
| 表格 | **4** 行 / **12** 个单元格 | 表头 + 3 行 × 3 列 |
| 任务列表 | **3** 个 checkbox，其中 **2** 个已勾选 | `[x] [ ] [x]` |
| 脚注 | **2** 个 ref、**2** 个脚注条目 | 两个脚注 |
| 图片 | **1** 张，`naturalWidth > 0` | 一张 PNG |

### 判据 2：目录 —— **通过**（用带 fenced 代码块的 `fenced.md` 测的）

`fenced.md` = 20 章，每章一个 30 行 ```js 块，估算总高 19952px，目录 21 项。

**滚动高亮跟随**：

| scrollTop | 0 | 3000 | 7000 | 11000 | 15000 | 19000 |
| --- | --- | --- | --- | --- | --- | --- |
| 侧栏高亮 | 代码文档 | 第-3-章 | 第-7-章 | 第-12-章 | 第-16-章 | 第-20-章 |

**目录点击跳转（视口外）**：点「第-18-章」→ scrollTop 60 → **16832**，
连采 12 次（3s）纹丝不动，标题距容器顶 **0px**，侧栏高亮同步到「第-18-章」。
回点「第-3-章」→ 16832 → **2108**，距顶 4px。

**另外单独核了 8d 记过的既有缺陷「存在已恢复的阅读位置时第一次点击被吞掉」**：

| 情形 | 结果 |
| --- | --- |
| 全新打开，第一件事就点目录（无任何预热滚动） | 0 → **16892**，距顶 5px |
| 先滚到中段 → 刷新（阅读位置恢复处于待执行）→ 立刻点目录 | 7825 → **16868**，距顶 4px |

**两种情形都没有复现那条缺陷**，本轮不再把它列为未决项。

### 判据 3：查找 —— **通过**

`search.md` = 30 个小节，每节正文里「目标词」各出现一次（共 30 处）。

- **⌘F**（真实键盘事件，先点一下正文把焦点交给 iframe）：查找条打开，输入框拿到焦点；
- 输入「目标词」后计数器显示 **1/30**，与源文档里的 30 处一致；
- **命中数 30 vs 高亮数 30**：全篇滚一遍，累计「被画过高亮的块」= **30**，
  即每一处命中在它所在的块挂载时都被画上了。
  逐个采样点核对「此刻挂载的块里含目标词的块数」vs「此刻的高亮 Range 数」：
  **全部 19 个采样点一致，0 处不一致**（单屏最多同时 8 个 Range）。
  注意这里必须同时数 `md-search` 与 `md-search-current` 两个注册表——
  当前命中是单独一层，只数前者会稳定少 1（我第一次就少数了 1，报成 29/30）。
- **跳到视口外**：视口 743px，命中间距约 508px。连点 8 次「下一处」：
  `0 → 0 → 458 → 458 → 966 → 966 → 1474 → 1474 → 1982`，计数器 1/30 一路走到 9/30；
  再点 3 次「上一处」回到 `1982 → 1474 → 1474`，计数器 8/30 → 6/30。
  「点了不动」的那几次是因为下一处本来就在视口里（不该滚）；命中跨出视口时每次都滚到位。
  终态核对：当前命中的 Range 矩形完整落在滚动容器矩形内（`currentHitInViewport: true`）。

### 判据 4：导出 HTML —— **通过**

`long.md` = 24 章（每章一个 ```ts 块 + 一张图，每 6 章一张 Mermaid，另有 4 个块级公式），
真实滚动高度 15118px。

**打开后不滚动**（`scrollTop = 0`，此刻只挂载了 **12** 块）直接点工具栏「导出 HTML」：

| 对账项 | 数字 |
| --- | --- |
| 产物 `.markdown-body` 顶层块数 | **105** |
| 文档块数（导出**之后**才全篇滚动统计到的 `data-block-key` 去重数） | **105** |
| `<h2>` / 「章节 N」标题 | 24 / 24 |
| Shiki `<pre class="shiki">` | 24 |
| Mermaid `<svg>` | 4 |
| KaTeX 元素 | 20（4 个公式） |
| `<img>` | 24 |
| `<script>` | 0 |
| 产物体积 | 200654 字节 |

**12 块在屏 → 产物 105 块**，离屏渲染这条路是对的。

一条**观察**（不在八条判据内，也没有查证它是什么时候出现的，故不计为不通过）：
产物里 KaTeX 的字体 `@font-face` 指向扩展自身的资源地址
（本次实测是 `http://127.0.0.1:8731/assets/KaTeX_*.woff2`，真实扩展下会是
`chrome-extension://<id>/assets/...`）。把导出的 HTML 拿到扩展之外打开，
公式的**结构与排版类名都在**，但这几个字体取不到。要不要内联字体是另一件事。

### 判据 5：打印 —— **通过**（用含图片的 `long.md` 测的）

同样**不滚动**直接点「打印 / 导出 PDF」，在 `window.print()` 被调用的那一刻量 `#print-root`：

| 项 | 数字 |
| --- | --- |
| 顶层块数 | **105**（= 全文） |
| `<h2>` / Shiki / Mermaid SVG / KaTeX | 24 / 24 / 4 / 20 |
| `<img>` | **24** |
| 其中 `complete === true && naturalWidth > 0` | **24** |
| **空框（未解码）** | **0** |

样本：`{src: ".../icon-128.png", complete: true, w: 128, h: 128}`。
Task 10 补的 `waitForImages` 在这条路上是有效的。

### 判据 6：阅读位置恢复 —— **通过**

`fenced.md`，用**真实滚轮事件**（40 次 × 260px）滚到中段，等 2.5s 让位置落盘，
然后整页 `Page.reload`：

| | scrollTop | 视口顶部那一块 |
| --- | --- | --- |
| 刷新前 | 10660（总高 19873） | `const v10_0 = …` |
| 刷新后 | **10708**（总高 19925） | `const v10_0 = …`（同一块） |

差 48px，占文档总高 **0.24%**；总高本身也差了 52px（块高度是估算的，两次测量会有微小出入）。

### 判据 7：锚点 —— **通过**

- **地址栏**：直接打开 `features.md#末章` → scrollTop **6208**（文档总高 6951，
  即已到文末），「末章」块已挂载，距容器顶 60px（它是最后一个标题，顶不到 0）。
  宿主地址栏保持 `#%E6%9C%AB%E7%AB%A0`。
- **正文里的站内链接**：滚到「## 站内链接」那一节（目标在视口外），
  点 `[末章](#末章)` → **1600 → 6213**，标题距顶 61px。

### 判据 8：自动刷新 —— **通过**

（这一条用了 `showOpenFilePicker` 替身，理由见上面的环境说明。）

顶层 `viewer.html` 里点「打开文件」，拿到 `watch.md`：

| | 状态栏 | 块数 | 目录 |
| --- | --- | --- | --- |
| 打开后 | `watch.md 41 B 1 个顶级标题 监听中 宽度 980px 就绪` | 2 | 1 项 |
| 外部改写文件后 | `watch.md 99 B 1 个顶级标题 监听中 · 已更新 刚刚 …就绪` | **4** | **2 项** |

从磁盘写入到页面重新渲染，**第 1 次轮询（≈0.5s）内**就检测到了，正文变成第二版，
新增的「## 新增的一节」出现在目录里。
顺带这条也验证了改过的状态栏：不再有「渲染 xx ms」，其余各项照常。

### 额外核对：零网络请求

`features.md` 全篇滚一遍，CDP `Network` 域记录 **41 条请求，非本地 0 条**。
唯一一条失败响应是 `404 /favicon.ico`——harness 的静态服务器根目录没有 favicon，
与产品无关。控制台除这条 404 外无 error/warning。

---

## 三、两个必须复核的历史遗留

### (a) viewer 入口体积：注释**没有兑现**，已订正

| | 字节 |
| --- | --- |
| Task 1 基线（接入 CodeMirror 之前） | 84030 |
| 清理**前**（本次第一次 build） | 627499 |
| 清理**后**（最终 build，`dist/assets/viewer-yeMEnPoz.js`） | **626891** |

`vite.config.ts` 原注释写的是「编辑器视图接入后，入口会涨到 350KB 量级」——
实际是 **626891 字节（gzip 217KB）**，是基线的 **7.5 倍**，比那句预估高出 79%。
那是一句没验过的估计。已把注释改成量出来的数，并写明它是 Task 11 量的、
基线是多少、以及阈值 800KB 与它的关系。

顺带核了阈值那半句注释：本次构建 **一条 chunk-size 警告都没有**——
viewer 626.89 kB、最大的懒加载语法包 emacs-lisp 779.93 kB，都在 800 之下。
原注释「把阈值调到实际量级，让警告重新变成『有东西不对』的信号」并没有被违反，
但「实际量级」的落点和它当初以为的不一样，这一点也写进去了。

本次清理对体积的贡献是 **-608 字节**（627499 → 626891）。分块渲染那套本来就
只有 `useMarkdownRender` 这一条死引用还把它拖进 bundle 的一部分，删掉省不下多少——
真正的 600KB 是 CodeMirror + React + markdown-it 管线。

### (b) harness 陷阱：**两个 flag 全程都加了**，另外发现那条快捷自检会误报

`cdp.mjs` 里 `ANTI_OCCLUSION_FLAGS` 是所有启动路径共用的常量，
**判据 1~8 的每一次 Chrome 启动都带着这两个 flag**。

做了一次 A/B 对照（`fenced.md`，滚到 0 / 6000 / 12000 / 18000 各采一次，
看「视口里第一个块」是什么）：

- **带 flag**：`# 代码文档` → `const v7_0` → `const v13_0` → `const v19_0`
- **不带 flag**：`# 代码文档` → `const v5_0` → `# 第 13 章` → `第 19 章的说明文字`

**本次这一轮没能复现假阳性**——不带 flag 时视口照样重算了。这与 task-10 的记录
一致（「同一份构建，换一次运行就可能正常」），说明它是环境相关的偶发，
不加 flag 只是**没有办法事后分辨**，不是必然出错。所以 8c/8d/9 那几轮的
「滚动后数块」数字仍然存疑，本轮的数字则不存疑。

**新发现：task-10 给的那条快捷自检在本项目里会误报。**
「改完 `scrollTop` 后读第一个 `.cm-md-block` 的 `textContent`，如果任何滚动位置
读到的都还是文档开头，就是踩到了」——在本项目里，**任何滚动位置**读到的第一个
`.cm-md-block` **本来就永远是文档开头那一块**，即使视口完全正常。

查证过了：在 scrollTop = 12000 处逐块量 `getBoundingClientRect()`，
文档标题那一块的 `top = -11914`（滚动容器的可视区是 46~789），
也就是说它挂在 DOM 上、位置正确、只是远在视口上方。

**关于成因**：写这一段时我给的解释是「光标默认停在位置 0，CodeMirror 的视口范围
总会把选区所在的行包进去」。当时**只有现象、没有查证机制**，审查者也指出了这一点。
第 2 轮已把机制从 CodeMirror 源码与 DOM 两侧查证完毕，见下文
「第 2 轮 · 三、trap 成因：已查证」。

**可靠的判据是「最后一个挂载的块」或「第一个矩形落在视口内的块」**，
本报告判据 2/3/4 的取样全部按后者做。我第一次跑判据 1 时正是被这条自检
吓了一跳，差点据此认定自己踩坑——建议后续任务照这个新判据改。

---

## 四、发现的问题

### 阶段 A 验收不通过的项：**没有**

八条判据全部通过，每条都有上面的数字。

### 不构成不通过、但记下来的四条

1. **导出 HTML 的 KaTeX 字体指向扩展自身地址**（判据 4 那条观察）。
   产物拿到扩展之外打开，公式结构在、字体取不到。我**没有查证**这是改造引入的
   还是本来就有的，所以只作为观察记录，不归因。
2. **`src/hooks/index.ts` 与 `src/components/index.ts` 这两个桶文件全仓库零引用。**
   grep `from '@/hooks'` / `from '@/components'` 都是 0 命中，全项目都是按具体路径 import 的。
   本任务按简报只摘掉了 `useMarkdownRender` 那一行，没有动这两个文件的存废——
   删不删是另一个决定。
3. **`.claude/worktrees/readme-developer-docs-fbd92c` 是一个停在 `dce37da` 的 git worktree。**
   `npm run bench` 的默认 include 没有锚定到 `src/`，会把那份旧代码里的
   `renderer.bench.ts` 一并跑掉（所以 bench 输出里还能看到「分块渲染」「splitSource」）。
   `npm run test` 不受影响（它的 include 是 `src/**`，锚在仓库根）。
   这是既有状态，与本任务无关，没有动它。
4. **`render()` 里 parse 与 render 共享 env 的那一行零覆盖**，且经实测在当前插件集下
   无可观测差异（见第一节的自检表）。已在注释里写明「为什么留着」与「为什么没有用例」。

---

## 五、清理与实测用到的文件

浏览器 harness（静态服务器、CDP 客户端、8 个判据脚本、测试文档）全部在本次会话的
scratchpad 里，**一个字节都没有进仓库**。静态服务器与所有 Chrome 进程已退出，
端口 8731 无残留进程。

Chrome 临时 profile 每次启动 `mkdtemp('mdr-profile-')`、在 `finally` 里删掉，
**本轮（9/11）跑出来的 profile 一个都没剩下**。

但 `$TMPDIR` 下还躺着 **37 个 `mdr-profile-*`，时间戳全部是 9/10**，也就是前几轮
留下的那批（简报里说的「35 个」）。我尝试清掉时被本机的破坏性命令策略挡住了
（递归删除类命令需要人工批准），**所以没有删**。要清的话手动删掉
`$TMPDIR` 下的 `mdr-profile-*` 即可——这个前缀只有这套 harness 会用；
同目录里的 `playwright_chromiumdev_profile-*` 是别的工具的，别一起删。
