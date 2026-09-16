# Task 10 报告：离屏渲染，修复导出与打印

分支 `feat/editor`。`npm run verify` 通过：**45 文件 / 451 用例**（基线 42 / 430，本次 +3 文件 / +21 用例）。

四条验收判据全部在真实 Chrome 152.0.7977.83 + 真实 `npm run build` 产物上实测；
手势约束做了**正反两次**实验（真调用不被拒 / 人为超时被拒），回归测试做了五组撤销验证。

---

## 〇、先说三处与简报对不上的地方，以及一处简报本身的错误

| 简报 | 实际 | 本次采用 |
| --- | --- | --- |
| `markdownRenderer.render(...)` | `src/markdown` 只导出工厂 `createMarkdownRenderer()`，且整条管线懒加载 | `renderOffscreen` 自己引导：`await Promise.all([import('@/markdown'), ensureBuiltinPlugins()])` 后 `createMarkdownRenderer()` |
| `enhanceBlock(node, key, cache, baseUrl)` 4 参 | 实际 5 参，末尾是 `force` | 按实际来，并**再加一个** `eager`（理由见第二节） |
| `ExportContext { doc, theme, content }` | 现有是 `{ doc, theme }` | 按实际扩展：`ExportContext` 加 `source`，另开 `HtmlExportContext extends ExportContext` 加 `content` |

**简报 Step 6 的 print.css 片段是错的**，照抄会让打印永远是一片空白：

```css
@media print { #print-root { display: block; } }
#print-root { display: none; }          /* ← 写在后面 */
```

媒体查询**不增加特异性**：两条规则都是 (1,0,0)，后写的赢。照这个顺序，打印时
`#print-root` 依然是 `display: none`，纸上什么都没有——而屏幕上一切正常、控制台一声不吭。
已改成「基础规则在前、`@media print` 覆盖在后」，并写了一条专门锁顺序的用例
（`print.css > 隐藏 #print-root 的规则必须排在 @media print 的覆盖之前`）。

---

## 一、离屏渲染的实现与取舍

`src/editor/offscreen-render.ts`：

```
渲染管线引导（动态 import + ensureBuiltinPlugins）
  → createMarkdownRenderer().render({ source, settings, documentId })
  → 造宿主节点（absolute / left:-99999px / aria-hidden / no-print）挂进 document.body
  → enhanceBlock(node, `offscreen:${id}`, createBlockCache(1), baseUrl, force=true, eager=true)
  → { node, dispose }
```

### 为什么挂进文档而不是留在游离节点里

`DomEnhancer` 是对插件开放的公共契约，「拿到的是一棵挂在文档里的树」是它一直以来的前提，
游离节点上计算样式与尺寸全是 0。

**但这一条对当前三个内置增强器其实都不成立**，如实记录，免得后人把它当成硬约束：

- Mermaid：`mermaid.render(id, source)` 不传容器时走 `root = select("body")`，自己往
  `document.body` 上挂临时容器出图（`node_modules/mermaid/dist/mermaid.core.mjs:1280`，已读源码确认）；
- Shiki：`highlightCode(source, lang, themes)` 字符串进、字符串出，不碰 DOM；
- 图片增强：只改属性和挂监听；
- 代码块增强里唯一要量尺寸的 `enqueueVisible`，在 eager 路径上根本不执行。

所以挂进文档是**给契约留的余量**，不是眼下的硬需求。用绝对定位挪出可视区而不是
`display: none`，是因为后者连盒子都不生成，尺寸一律归零。

### 宿主节点为什么带 `no-print`

`window.print()` 是阻塞的，`dispose()` 要等它返回才跑——**打印进行时离屏那棵树仍然挂在文档上**。
它是绝对定位、高度等于整篇文档，不隐藏会把纸撑出大片空白页。

实测（真 CSS 引擎，`Emulation.setEmulatedMedia`）：

| 媒体 | display | 高度 |
| --- | --- | --- |
| screen | block | 20000px |
| print | **none** | **0** |

### 一次性块缓存

`createBlockCache(1)`，`dispose()` 里 `cache.clear()`。不复用编辑器那份：缓存的键是
「文档里的一个位置」，塞进去会和屏幕上的块抢同一个节点（`block-cache.ts` 里写明了这条不变量）。
`clear()` 不能省——缓存自带一个 `ResizeObserver`。

---

## 二、必须加 `eager`，否则产物里的代码块是黑白的

这是实现过程中最大的一处「简报没提、但不做就是坏的」。

`code-block.ts` 的增强是**按视口懒加载**的：`enhance` 把块登记到 `IntersectionObserver`、
调一下 `drainQueue()` 就返回，**不等上色**。离屏那棵树永远不在视口里，
快照时刻拿到的会是一份「结构齐了但没上色」的 DOM——不报任何错。

做法：

- `PluginContext` 加 `readonly eager?: boolean`——「一次做完并等它做完」，是对所有
  按需推进型增强器开放的语义，不是给代码块开的后门；
- `enhanceBlock` 加第 6 个参数 `eager`（默认 false，现有三个调用点一个字没改）；
- `code-block.ts` 的 `enhance` 改为 `async`，eager 时整篇排队 + `await drainQueue()`，
  **观察器一概不碰**；
- `drainQueue()` 从返回 `void` 改为返回 `Promise<void>`。

### `drainQueue` 改造里踩到的一个次序坑（已写进注释）

原来的写法是 `draining` 布尔量 + `finally` 复位。改成 Promise 后，如果把复位写在
`drainLoop` 的 `finally` 里，`currentContext` 为空那条**一个 await 都不走**的返回路径
会让 `finally` 早于赋值执行，把一个已完成的 task 永久留在 `draining` 上，队列从此再也推不动。
现在拆成 `startDrain()`（复位与落定写在同一个 then 回调里，先置 null 后落定）+
`drainQueue()`（在途时先等它结束再补启一轮）。

补启一轮不是洁癖：上一轮可能**刚好**跑完最后一次 `queue.size > 0` 检查、正等着复位回调，
而我们的块是在那之后才排进队列的。此时把在途的 Promise 直接交出去，调用方会立刻醒来，
而那批块一个都没处理——导出拿到的就是一份没上色的代码。

顺带给 `drainLoop` 的每一批加了 try/catch：一块上色失败不该让整条队列停摆。

### 关于「不碰观察器」的理由：**一条猜测被实测推翻了，已改写**

我原来在注释里写的是：`getObserver` 在 root 变化时会 `disconnect()` 重建，离屏树的 root
（body 下，`findScrollParent` 给 null）与屏幕上那棵（AppShell 的 `<main>`）不同，
「走一遍就会把屏幕上所有已登记的代码块一并摘掉观察，之后往下滚再也不会上色」。

**做了对照构建实测，后半句不成立。** 把 eager 分支改成也走一遍 `ensureObserved` 重新
`npm run build`，导出之后再往下滚：

| scrollTop | 不碰观察器（已提交） | 也登记观察（对照） |
| --- | --- | --- |
| 4000 | 挂载 3 / 上色 **3** | 挂载 3 / 上色 **3** |
| 9000 | 3 / **3** | 3 / **3** |
| 15000 | 2 / **2** | 2 / **2** |
| 20000 | 2 / **2** | 2 / **2** |

逐格相等。原因是每轮 `enhance` 末尾的 `enqueueVisible` 本来就会把视口附近的块直接排队，
新挂上来的块也会在重建后的观察器上重新登记。

注释已改写成实测出来的表述，并明确写了「这条后果实测看不见，别把它当成修了什么缺陷」。
保留不碰观察器的理由退回到两条站得住的：离屏树用完就丢，登记观察没有下一次回调可等；
以及不想在一个共享的全局对象上做无谓的拆建。

> 这一处差点又是「先有结论再倒编依据」。第一次跑对照实验时我以为已经证实了
> （对照组 `mountedCodeBlocks` 一直是 1），**结论是错的**——那是窗口被遮挡、Chrome 停掉 rAF
> 导致 CodeMirror 的视口测量周期不跑，与改动无关。重跑正向构建拿到同样的 1 才发现。
> 补了 `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
> --disable-features=CalculateNativeWinOcclusion` 之后两边才都正常。
> **这条环境坑值得记下来：这个 harness 里凡是依赖「滚动之后 CodeMirror 重算视口」的观测，
> 不加这三个 flag 就是随机的。**

---

## 三、手势约束的实测结果（最关键的一条）

结论：**不需要两段式。一段式实测通过，且余量充裕。**

### 3.1 正向：真的调 `showSaveFilePicker`，对话框弹出来了

判据很干脆——手势失效时 Chrome 立刻以 `SecurityError` 拒绝；手势有效时 Promise 一直挂着
（对话框开着等用户选路径）。用真实 `Input.dispatchMouseEvent` 点工具栏的「导出 HTML」，
不做任何替换，只在调用前后记一笔：

```
t≈1s  {"picker":{"sinceClick":276.1,"activationActive":true},"outcome":"pending"}
t≈2s  … "outcome":"pending"
t≈3s  … "outcome":"pending"
t≈5s  … "outcome":"pending"
t≈8s  … "outcome":"pending"
```

点击 → `showSaveFilePicker` 之间 **276ms**，那一刻 `navigator.userActivation.isActive === true`，
8 秒后仍是 pending、没有任何异常。**对话框弹出来了。**

### 3.2 反向对照：证明上面那个判据真的能分辨出「被拒」

同一套脚本，只在 `showSaveFilePicker` 之前人为塞 6 秒（超过 Chrome 瞬时用户激活的 5 秒有效期）：

```
延迟 6000ms -> {"picker":{"sinceClick":6284.3,"activationActive":false},
                "outcome":"SecurityError: Failed to execute 'showSaveFilePicker' on 'Window':
                           Must be handling a user gesture to show a file picker."}
```

被拒了，而且是**立刻**被拒。所以 3.1 的「pending」不是「什么都没发生」。

### 3.3 手势预算还剩多少

| 文档 | 大小 / 行数 | 文档总高 | 点击 → picker（三次） | 那一刻 activation |
| --- | --- | --- | --- | --- |
| `export.md`（20 章） | 38,223 B / 852 行 | 24,776px | **240 / 234 / 230 ms** | active |
| `big.md`（100 章） | 191,993 B / 4,228 行 | 121,991px | **1255 / 1198 / 1171 ms** | active |

`big.md` 含 100 个 30 行 js 代码块（实测产物里 48,100 个 `--shiki-light` 内联变量）、
20 张 Mermaid、101 处公式，整篇渲染 + 全量增强 1.2 秒出头，距 5 秒还有约 4 倍余量。

`useExport` 的注释里写明了这个边界：能过不是无限的，若将来在 `saveFile` 之前再插耗时步骤、
或文档大到离屏渲染要跑几秒，就必须改两段式，判据是「保存对话框弹不出来」。

### 3.4 顺带：导出 Markdown 不再白等一遍渲染

`exportAs('markdown')` 走的是源文本，不需要正文节点，所以**跳过离屏渲染**。
实测点击 → picker：`export.md` 0~62ms、`big.md` 4ms。

---

## 四、四条验收判据的实测数字

### 实测环境

沿用 task-8c/8d/9 趟平的办法（Chrome 152 已移除 `--load-extension`）：真实 `npm run build`
产物挂本地零依赖 node 静态服务器，宿主页 `/host/<name>.md` 复刻 `content/index.ts` 的
`takeOver()` 握手（`md-reader:ready` → 回发 `{type:'md-reader:load', …}`、`md-reader:hash`
→ `replaceState`），Node 22 内置 WebSocket 直连 CDP，有头 1440×900。
**本次没有装 `chrome.storage` 替身**——本任务不依赖跨刷新的持久化，`storage.ts` 会自动降级到
内存驱动。唯一被替身的是「内容脚本宿主」这一处。

测试文档（合成，未入库）：`export.md` 20 章 / `big.md` 100 章，每章含
一个 30 行 ```js、一段带行内公式的正文、一张表；每 5 章一张 Mermaid 图；开头一段块级 KaTeX。

### 判据 1：不滚动直接导出 HTML —— 通过

**导出前（scrollTop = 0，一次都没滚）**：

| | `export.md` | `big.md` |
| --- | --- | --- |
| 文档总高 / 可视区 | 24,776 / 743 px（**3.0%**） | 121,991 / 743 px（**0.6%**） |
| 屏幕上挂载的块 | **6** | **6** |
| 屏幕上的 `.markdown-body` | **6**（旧实现只取得到其中 1 个） | **6** |
| 屏幕上的 `<h2>` | **1** / 全文 20 | **1** / 全文 100 |
| 屏幕上已上色的代码块 | **1** / 全文 20 | **1** / 全文 100 |
| 屏幕上的 Mermaid SVG | **0** / 全文 4 | **0** / 全文 20 |
| 屏幕上的 KaTeX | 2 | 2 |

**产物**：

| | `export.md` | `big.md` |
| --- | --- | --- |
| 字节 | 874,566 | 4,032,309 |
| `<h2>` | **20 / 20** | **100 / 100** |
| `CHAPTER-n-MARK`（每章一处） | **20 / 20** | **100 / 100** |
| 上色的代码块 `class="shiki` | **20 / 20** | **100 / 100** |
| Shiki 内联色变量 `--shiki-light:` | 9,620 | 48,100 |
| Mermaid 内联 SVG | **4 / 4** | **20 / 20** |
| KaTeX | **21 / 21** | **101 / 101** |
| 表格 | **20 / 20** | **100 / 100** |
| 末章标记在不在 | 是 | 是 |
| 内联 CSS | 103,211 B，含 `.markdown-body` 与 `.katex` | 198,385 B |
| 控制台错误 | **0 条** | **0 条** |

也就是：**屏幕上只有 1 个 h2、1 个上过色的代码块、0 张图，产物里 20/20、20/20、4/4。**
旧实现在这里会导出「开头那一小段」。

`.katex` 样式**出现在产物里**这一点值得单记：KaTeX 的样式表是按需注入的
（`syncPluginStyles` 的 `stylesNeeded(root)`），离屏渲染的是整篇文档，所以即使用户
从没滚到任何一处公式，导出前也一定注入过一次，`collectDocumentCss()` 收得到。

**导出结束后**：离屏宿主节点 0 个（`div[aria-hidden="true"].no-print`），
`.markdown-body` 回到 6 个 —— `dispose()` 干净。

### 判据 2：打印预览是完整文档 —— 通过

`window.print()` 换成记录型替身让 `#print-root` 留在页面上，再用
`Emulation.setEmulatedMedia({media:'print'})` 让真 CSS 引擎按打印媒体重算一遍
（比截一张预览图硬：读的是浏览器自己算出来的 display 与尺寸）：

| | 屏幕媒体 | 打印媒体 |
| --- | --- | --- |
| `.cm-editor` display / 高度 | flex / 24,776px | **none / 0** |
| `#print-root` display / 高度 | none / 0 | **block / 20,228px** |
| `#print-root` 里的 `<h2>` | 20 | **20** |
| 代码块 / 已上色 | 20 / 20 | **20 / 20** |
| Mermaid SVG | 4 | **4** |
| KaTeX | 21 | **21** |
| 复制/下载/折叠按钮 | 0 | **0** |
| 含末章标记 | 是 | **是** |
| `body.scrollHeight` | 813 | **20,210** |

`afterprint` 派发之后 `#print-root` **已撤掉**。

编辑器确实被 print.css 藏掉了（判据里点名的那条），纸上只剩离屏渲染出来的完整正文。

> 边界：本 harness 里阅读器是**同源** iframe，而真实接管场景下它是跨源 iframe，
> `window.print()` 打哪个文档由浏览器决定——这一层没能复现。上面验的是
> print.css 与 `#print-root` 本身，这也正是本任务改动的范围。

### 判据 3：导出 Markdown 拿的是编辑器当前文本 —— 通过

浏览器里：从 `.cm-content` 的 `cmView` 顺着 `parent` 找到 `EditorView`，
`view.dispatch` 往文首插一行 `EDITOR-ONLY-EDIT`（`ReaderPage` 是 `readOnly` 且没接
`onChange`，store 里的 `document.content` 不会被回写，divergence 是真的），再点「导出 Markdown」：

```
改编辑器文本: "EDITOR-ONLY-EDIT\n\n"
导出 Markdown 开头: "EDITOR-ONLY-EDIT\n\n# 导出验收文档\n\n这是"
含 EDITOR-ONLY-EDIT: true
```

单测侧另有一条同形状的用例（`导出 Markdown 拿的是编辑器当前文本，不是 store 里的副本`），
并显式断言前提「store 那份确实还是旧的」。

### 判据 4：导出产物的样式与屏幕上一致 —— 通过（有一处已量化的差异）

同一批元素在阅读器（滚到第 3 章）与产物里各读一次计算样式与几何：

| 项 | 阅读器 | 产物 | |
| --- | --- | --- | --- |
| `data-theme` | light | light | ✓ |
| body 背景 | rgb(255,255,255) | rgb(255,255,255) | ✓ |
| 版心宽度 | **916px** | **916px** | ✓ |
| h2 字体 / 字号 / 字重 / 行高 / 颜色 / 字距 | 同左 | 逐项相同（23.2px / 600 / 30.16px / rgb(31,35,40)） | ✓ |
| h2 下边框 | 1px rgb(228,232,237) | 1px rgb(228,232,237) | ✓ |
| p 字体 / 字号 / 行高 / 颜色 / 字距 | 16px / 27.2px / rgb(31,35,40) | 逐项相同 | ✓ |
| 代码块 `pre` 背景 / 等宽字体 / 字号 / 圆角 / 内边距 / 宽度 | 13.6px、914px… | 逐项相同 | ✓ |
| Shiki 某个 span 的内联变量 | `--shiki-light:#D73A49;--shiki-dark:#F97583` | **一字不差** | ✓ |
| 该 span 解析出的颜色 | rgb(215,58,73) | rgb(215,58,73) | ✓ |
| 表格字号 / 合并模式 | 14.72px / collapse | 14.72px / collapse | ✓ |
| 表格宽度 | 115px | 114px | 1px 取整差（表格是内容自适应宽度） |
| KaTeX 字号 | 19.36px | 19.36px | ✓ |
| **h2 的上下 margin** | **0 / 0** | **37.12 / 13.92px** | ✗ |

**唯一的实质差异是标题周围的纵向留白**，机制已查证（不是推断）：

- 屏幕上每个块各是一个 `.cm-md-block`，`markdown.css:467-477` 把块内首尾元素的 margin 清零
  （`.cm-md-block > :first-child { margin-top: 0 }` / `> :last-child { margin-bottom: 0 }`），
  改用 `.cm-md-block { padding-block: 0.4em }`。那个 h2 是它所在块的唯一子元素，
  所以两边 margin 都被清掉——计算样式读回来正是 0 / 0；
- 产物是一整篇连续的 `.markdown-body`，走 `markdown.css` 里标题原本的
  `margin: 1.6em 0 0.6em`，23.2px × 1.6 / 0.6 = 37.12 / 13.92px，与读回来的值吻合。

实际视觉间距（量的是相邻盒子之间的距离）：

| | 标题上方 | 标题下方 | 标题高度 |
| --- | --- | --- | --- |
| 阅读器（块 widget） | 33.6px | 60.8px | 38.1px |
| 产物（连续正文） | 37.1px | 13.9px | 38.1px |

上方基本一致（33.6 vs 37.1），下方差 47px。

**这不是本任务引入的**：它是「块 widget 呈现」与「连续文档呈现」之间的固有差别，
随 Task 6/8 的编辑器改造一起产生；旧的导出（快照屏幕节点再塞进 `.export-article >
.markdown-body`）落到产物里走的也是同一套连续正文规则。本次没有去抹平它——
往产物里注入 `.cm-md-block` 那套间距只会让独立 HTML 变差，而改屏幕侧的块间距会动到
高度图，超出本任务范围。**建议进最终审查的分诊清单。**
残余那部分（阅读器 33.6 / 60.8 的具体构成）我没有逐项追到底，不做归因。

---

## 五、回归测试的效力验证

新增 21 条用例，分布在三个文件：`src/editor/offscreen-render.test.ts`（5）、
`src/export/export.test.ts`（+8）、`src/hooks/useExport.test.tsx`（5）、
`src/styles/print.test.ts`（4，新文件）。

逐项撤销修复后 `npx vitest run` 的结果：

| 撤销的东西 | 变红的用例 |
| --- | --- |
| **A. `exportHtml` 改回 `document.querySelector('.markdown-body')`**（旧实现的形状） | `exportHtml > 导出的是传入的正文节点，不是页面上的第一个 .markdown-body`、`exportHtml > 页面上一个 .markdown-body 都没有时照样能导出`、`导出 > HTML 产物包含整篇文档，而不是屏幕上的第一块`（3 failed / 34 passed） |
| **B. `exportMarkdown` 改回 `context.doc.content`** | `exportMarkdown > 导出 context.source 而不是 doc.content`、`导出 > 导出 Markdown 拿的是编辑器当前文本，不是 store 里的副本`（2 failed / 35 passed） |
| **C. `exportPdf` 改回裸 `window.print()`**（不挂 `#print-root`） | `exportPdf > 把完整正文挂进 #print-root，afterprint 之后撤掉`、`exportPdf > 上一次打印留下的残骸会被清掉，不会叠成两份`、`导出 > 打印把完整正文挂进 #print-root`（3 failed / 34 passed） |
| **D. `renderOffscreen` 的 `eager` 参数改回 false** | `renderOffscreen > Promise 落定时增强已经做完，包括视口外的代码块`（1 failed / 4 passed） |
| **E. print.css 里删掉 `.cm-editor { display: none }`** | `print.css > 打印时隐藏编辑器`（1 failed / 3 passed） |
| **F. print.css 的两条 `#print-root` 规则顺序写反** | `print.css > 隐藏 #print-root 的规则必须排在 @media print 的覆盖之前`（1 failed / 3 passed） |

六种撤销**各自**都有用例变红，而且红的不是同一条——「正文从哪来」「源文本从哪来」
「打印往哪去」「增强等不等」「编辑器藏不藏」「规则顺序」六件事分别被锁住了。

### 关键用例的设计说明

**判据 A 的那条为什么有效**：`useExport.test.tsx` 跑的是**真编辑器 + 真渲染管线**
（`EditorViewProvider` + `MarkdownEditor`，三段源文本 = 三个块 widget），
并显式断言前提 `document.querySelectorAll('.markdown-body').length > 1`——
缺陷成立的条件先摆在那里，再断言产物里三段都在。

**判据 D 的那条为什么需要一个 IntersectionObserver 替身**：jsdom 本来没有
IntersectionObserver，而代码块增强在「没有观察器」时会退化成「全部直接排队」，
那条降级路径把懒加载完全绕开了，用它测不出 eager 的作用（实测：不装替身时撤销 eager
仍然全绿）。装一个永不回调的替身，才还原真实浏览器里「不进视口就不上色」的形状。

**print.css 那四条为什么是 CSSOM 而不是正则**：把文件真的解析成样式表再遍历，
「规则写在了 `@media print` 里面还是外面」「谁排在谁前面」才成为可断言的事实；
正则匹配文本只能证明字符串在，证不了结构。

---

## 六、改了什么

| 文件 | 改动 |
| --- | --- |
| `src/editor/offscreen-render.ts` | **新增**。离屏渲染整篇 + 跑完增强 + dispose |
| `src/editor/offscreen-render.test.ts` | **新增**，5 条 |
| `src/styles/print.test.ts` | **新增**，4 条（CSSOM 结构性用例） |
| `src/hooks/useExport.test.tsx` | **新增**，5 条（真编辑器端到端） |
| `src/export/index.ts` | 删 `CONTENT_SELECTOR`；`ExportContext` 加 `source`，新增 `HtmlExportContext`；`exportMarkdown` 改用 `source`；`exportPdf(content)` 挂 `#print-root`；导出 `PRINT_ROOT_ID` |
| `src/export/export.test.ts` | +8 条 |
| `src/hooks/useExport.ts` | 取 `useEditorView()` 拿当前文本；HTML/PDF 前先离屏渲染、`finally` 里 dispose；Markdown 跳过渲染；提示逻辑抽成 `report` |
| `src/hooks/useToolbarActions.ts` | 打印按钮改用 `exportDisabledReason`——它现在也要先离屏渲染，同样有等待期 |
| `src/styles/print.css` | `#print-root` 的显隐（顺序有讲究）；打印时隐藏 `.cm-editor` |
| `src/types/plugin.ts` | `PluginContext` 加 `readonly eager?: boolean` |
| `src/editor/enhance.ts` | `enhanceBlock` 加第 6 参 `eager`（默认 false，现有调用点不受影响） |
| `src/plugins/builtin/code-block.ts` | `enhance` 改 async 并支持 eager；`drainQueue()` 返回 Promise；批内加 try/catch；新增 `startDrain`/`drainLoop` |

---

## 七、遇到的问题与遗留

1. **窗口遮挡会让 CodeMirror 的视口观测变成随机数**（第二节末）。这个 harness 里凡是依赖
   「滚动之后新块挂上来」的测量，必须加
   `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
   --disable-features=CalculateNativeWinOcclusion`，否则会拿到「正反两组数据一样」的假结论。
   **我第一次就是这么差点得出错误结论的。**
2. **标题纵向留白的屏幕/产物差异**（第四节判据 4），已量化未修，建议进分诊清单。
3. **跨源 iframe 下的打印未验证**：`window.print()` 在跨源 iframe 里打哪个文档由浏览器决定，
   本 harness 是同源，复现不了。与 task-8c/8d/9 的边界相同。
4. **`file://` 场景未验证**，全部实测跑在 `http://127.0.0.1` 上。
5. **真实 `chrome.storage` 未参与**：本次直接让它降级到内存驱动（本任务不依赖持久化）。
6. **离屏树在文档里的那一小段时间内，锚点 id 与屏幕上的正文重复**。
   `getElementById` 按文档树序返回第一个，而离屏宿主是追加到 `body` 末尾的，
   所以屏幕上那份总是赢；窗口也只有几百毫秒。没有为此改锚点生成规则。
7. **编辑态未验证**：`ReaderPage` 目前固定 `readOnly`。判据 3 是靠 `view.dispatch` 造出
   「编辑器与 store 不一致」来验的，等编辑态真正接上后值得再看一次。
8. **`exportPdf` 之后 `busy` 要等打印对话框关掉才复位**：`window.print()` 是阻塞的，
   期间工具栏的导出按钮一直置灰。行为上没问题，但如果将来嫌它「卡住了」，原因在这里。

## 八、本轮用到但未入库的实测脚本

全部在 scratchpad：`server.mjs`（静态服务 + 宿主页）、`cdp.mjs`（启动 Chrome + CDP）、
`gen-doc.mjs` / `gen-big.mjs`（合成文档）、`t1-gesture.mjs`（判据 1 + 产物统计）、
`t2-real-dialog.mjs`（真对话框）、`t3-control.mjs`（手势超时反向对照）、
`t4-print.mjs`（判据 2）、`t5-parity.mjs` / `t6-gap.mjs`（判据 4）、
`t7-big-and-text.mjs` / `t8-view-probe.mjs`（判据 3 + 手势预算）、
`t9-observer.mjs`（观察器对照）、`t10-noprint.mjs`（离屏宿主在打印时的显隐）。
