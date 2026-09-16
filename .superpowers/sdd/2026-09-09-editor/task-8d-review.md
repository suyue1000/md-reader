# Task 8d 审查报告（9fcb079..660453c）

审查者独立核实，不复核「测试变绿」。`npm run verify`：typecheck / lint 无输出，
**39 文件 / 393 用例全过**（2.21s），与报告一致。

---

## 〇、本次审查自己做的实测（两套，均为真实 Chrome 152 + 真实 `npm run build` 产物）

commit 时间 16:13、dist 时间 15:47，**dist 是旧的**，因此先 `npm run build` 重建后再测。

### 实测 A：直接对着构建产物量 CSS（用来独立核实缺陷三的两条「成因」）

把 `dist/assets/index-*.css` 原样 `<link>` 进一张探针页，按 `editorTheme` 手工复刻
`.cm-content` 的 `padding / max-width / line-height` 与 `.cm-lineWrapping` 的
`white-space: break-spaces`（后者已在 `node_modules/@codemirror/view/dist/index.js:6846-6849`
核对，且 `MarkdownEditor.tsx:243` 确实启用了 `EditorView.lineWrapping`），
headless Chrome 1440×900 量 `getBoundingClientRect()`：

| 块 | 本审查量到 | 报告称量到 |
| --- | --- | --- |
| h1 / h2 / h3 | 88.31 / 78.08 / 64.92 | 88.3 / 78.1 / 64.9 |
| 单行段落 `<p>甲</p>\n` | 67.16 | 67.2 |
| 3 项列表 | 238.28 | 238.3 |
| 两行引用块 | 155.09 | 155.1 |
| 4 行表格 | 279.95 | 280.0 |
| 4 行缩进代码 | 148.72 | 148.7 |

**报告里的实测数字全部复现，一个不差。** 另外量到：
- `<p>甲</p>` 不带尾换行 = 39.97，带尾换行 = 67.16，**差 27.19** —— 空行盒这一条属实；
- `.cm-md-block` computed `padding: 6.4px / 6.4px`，`border: 0`；
- 西文行盒宽 883px（10 行全部 883），中文行盒 912px，版心 916px —— `CHARS_PER_LINE=110`
  的推导（883 / 8 = 110.4）属实；
- **`.markdown-body p` 在不是块内最后一个元素时，computed `margin-bottom` = `16px`。**

### 实测 B：整套阅读器跑起来（用来核实缺陷一、二）

沿用 8c 的办法：dist 挂本地 node 静态服务器，宿主页逐行复刻 `content/index.ts:205-229`
的 `takeOver()` 握手，`chrome.storage` 用 localStorage 替身经
`Page.addScriptToEvaluateOnNewDocument` 注入，Node 内置 WebSocket 直连 CDP。
`dup.md` = 20 章，每章正文与 ```js 代码块全篇一字不差，外加两个同名 `## 重复标题`。

```
键的实际形态（从 DOM 的 data-block-key 读回来）：
  "0 ## 第 1 章"
  "0 ```js\nfunction same(a){\n  return a + 1;\n}\n```"
  "1 这是一段完全相同的正文，用来制造重复块。…"
  "1 ```js\n…"
同时挂在 DOM 上的、内容完全相同的段落：5 个，各 67px，全部非零
挂载中的块 16 个 / 不同的键 16 个（无碰撞）
目录点击 第-18-章： 828 → 6234，标题距容器顶 6px
再点     第-3-章 ： 6229 → 768， 标题距容器顶 6px
uniq.md 首次打开目录项 21；同一会话内用**完全相同的内容**重开并带 #第-9-章：
  目录项仍为 21，无「这篇文档没有标题」，scrollTop 0 → 2072，标题距顶 6px
```

**缺陷一、缺陷二在真实浏览器里确认修好。**

同时**独立复现了报告自陈的既有缺陷 A**：存在已恢复的阅读位置时，第一次目录点击被吞掉
（768 → 768，连采 4.8s 一动不动）；先做一次 60px 用户滚动再点就正常（828 → 6234）。
与报告的定位（`onEnhanced` 校正 + `userScrolledRef` 未置位）一致。

---

## ① 缺陷一的设计选择：成立

**方案**：键 = `` `${出现序号} ${源码文本}` ``（`block-render.ts:80-100`、`nextKey`）。

- **缓存价值没丢**。序号按「相同文本在本篇文档里第几次出现」算，对同一份源码是确定的，
  滚出视口再滚回来键不变 → `acquire` 命中同一节点 → `isEnhanced(key)` 为真 → Shiki /
  Mermaid 不重跑。实测 B 里 `pre.shiki` 与带色 span 均在，重复代码块各自上色。
  唯一的成本是重复块之间不再共享增强结果——这是必须付的，它们本来就得是两个节点。
- **三处键语义已对齐**，且是同源的：`acquire` 写 `node.dataset.blockKey`
  （`block-cache.ts:112`）→ `MarkdownEditor.enhanceMounted`（`MarkdownEditor.tsx:212-214`）
  读它 → `BlockWidget.eq()`（`live-preview.ts:88`）与 `toDOM()`/`estimatedHeight` 读
  `this.block.key`。**四处读的都是同一个 `RenderedBlock.key`，没有一处留在旧语义上。**
- **键的单射性成立**：序号是 `String(number)`，无前导零，按第一个空格可唯一分回
  (序号, 文本)。`trailing:N` 不以数字开头，与正文键天然不可能撞上。实测 16 个块 16 个不同键。
- **LRU 容量语义确实变了**（Minor）：重复块过去合用一个槽，现在各占一个，
  一篇文档占用的槽数从「不同块数」变成「块数」。这是修复的必然代价，但
  `DEFAULT_CAPACITY = 200` 旁边那句「按一屏几十块估算，200 足够覆盖来回滚动的范围」
  是在旧的共享假设下写的，没有跟着复核。
- 序号按「出现次数」而非「块下标」，用例 `唯一块的键与它前面有多少内容无关` 锁住了这一条，
  判断正确。

## ② 缺陷三：常量与算式对得上，**但新写的两条「成因」是错的**

### 成因核实

| 报告称的成因 | 核实结论 |
| --- | --- |
| `.cm-content` 的 `white-space: break-spaces` 继承进块 widget，每个「块级标签后的换行」各占一个 27px 空行盒 | **属实**。`@codemirror/view` 的 `.cm-lineWrapping` 规则；`MarkdownEditor.tsx:243` 启用了 `lineWrapping`；`white-space` 可继承且 markdown.css 没在 `.markdown-body` 上覆写。实测差值 27.19px。 |
| markdown.css 的块间距被 **Tailwind Preflight 归零**，`.markdown-body p{margin:0 0 1em}` 位于更低优先级的 layer | **不属实**。构建产物里 `@layer properties/theme/base/components/utilities` 的字节区间是 65–20637，而 `.markdown-body p{margin:0 0 1em}` 在偏移 23732——**在所有 layer 之外**。无层级的作者样式优先于任何 `@layer`，Preflight 的 `*{margin:0}` 反而是输的那一方。实测：块内不是最后一个元素的 `<p>`，computed `margin-bottom` = **16px**。 |

真正让「块的外层元素没有外边距」的，是本项目自己写的
`src/styles/markdown.css:467-473`：

```css
.cm-md-block > :first-child { margin-top: 0 }
.cm-md-block > :last-child  { margin-bottom: 0 }
```

同理，`WIDGET_PADDING_PX` 注释写「不是本项目写的（`editor/theme.ts` 只给 `.cm-md-block`
设了 `margin: 0`）」也不属实：`src/styles/markdown.css:475-477` 明明白白写着
`.cm-md-block { padding-block: 0.4em }`（= 6.4px），就在上面那两条规则下方 2 行，
且不在本次 diff 里，是既有代码。

**为什么这条要算 Important**：本次要修的缺陷三，定义就是「注释里的推导引用了本项目不存在的
CSS 值」。替换上去的新注释又引用了两条本项目不存在的事实——一条把原因栽给 Tailwind，
一条声明这段 padding「不是我们写的」。后果是实的：`markdown.css:467-477` 这三条规则
是全套常量的**唯一支柱**，谁去动它们（比如删掉 `> :last-child`，或把 `padding-block`
改成别的值），既不会有测试失败，也不会在 `block-height.ts` 里读到任何提示——注释还
明确告诉他「这不是我们写的」。这条错误现在还进了 commit message。

### 值与算式的自洽性：**对得上**

逐条按实测复算，全部落在 1px 以内：

- h1：行盒 29.6×1.3 = 38.48 + 下内边距 0.3em(8.88) + 边框 1 = 48.36；+ widget 内边距 12.8
  + 一个空行盒 27.2 = **88.36**，实测 88.31。h2–h6 同法成立。
  （另外量到不带尾换行的 h1 整块 = 61.13 = 48.36 + 12.8，反证「空行盒」正是那 27.2。）
- 单行段落：(1 + 1 空行盒) × 27 + 13 = 67，实测 67.16。
- 3 项列表：`>\n` 数得 5（`<ul>`、3 个 `</li>`、`</ul>`），(3 + 5) × 27 + 13 = 229，实测 238.28（−3.9%）。
- 两行引用块：markdown-it 出 `<blockquote>\n<p>a\nb</p>\n</blockquote>\n`，`>\n` = 3，
  源码行 2 → (2 + 3) × 27 + 13 = 148，实测 155.09（−4.6%）。
- 4 行表格：4 × 60 + 40 = 280，实测 279.95（TABLE_ROW_PX=60 是按这块反推的，属拟合而非推导，
  注释已如实说明「数不清也没必要数」，可接受）。
- `CHARS_PER_LINE = 110`：实测西文行盒 883px / 8 = 110.4，中文 912 / 8 = 114，取小值。属实。
- fenced 代码块不加 `BLOCK_CHROME_PX`：核对 `plugins/builtin/code-block.ts:329-335`，
  自定义 fence 渲染器返回值以 `</figure>` 收尾、不带换行。**属实**。
- 缩进代码块改按 `TEXT_LINE_PX`：实测 4 行块 148.72，按正文行高 148、按代码行高 128，改对了。

### 「偏差从 −6.3% 收到 +0.5%」可信吗：数字可信，**「偏高比偏低安全」这句不成立**

数字可信——我复现的逐块实测与它一致，方向上原模型确实系统性低估（缺了每块 27 + 13 = 40）。

但「估高只是多校正一轮，估低才会让 `scrollIntoView` 收敛不了」是**断言，不是推理**。
CodeMirror 的 measure 循环两个方向都要迭代、都受 6 轮上限约束；8c 记录的 `06cdf04`
失效（−58%）是**量级**造成的，与符号无关。真要论符号，偏高反而在文末更不利：
高度图比真实文档高，末尾章节按估算算出的目标 scrollTop 会超出真实可滚动范围被浏览器夹住
——报告自己的 dup.md 那一行「点『重复标题-1』→ 16843（已到文末，无法再把目标顶到顶边）」
正是这种情形。在 ±0.5% 的量级上这件事不影响结论，但注释该说的是「|误差| 要小」，
而不是「偏高是安全方向」。

### 空行盒计数有没有重复 / 漏算

- **不会漏**：markdown-it 的块级渲染器每个都以 `>\n` 收尾，`countOccurrences(html, '>\n')`
  正好命中；表格与代码块两支已单独走别的算式，不参与这一项。
- **会重复计**（Minor，无用例）：`>\n` 也会匹配「行内标签结尾恰好碰上软换行」。
  `<p>看<a href="x">这里</a>\n下一行</p>\n` 数出 2 个空行盒，而实际只有 1 个——
  另一个 `\n` 是真实文字行，已经被 `sourceLines` 算过了。硬换行 `<br>\n` 同理。
  中文写作里一行以 `**加粗**` / `` `代码` `` / 链接收尾很常见，这类段落会被高估约 27px
  （两行段落即 +30%）。新加的两条用例只覆盖了「标签后换行」与「纯文字软换行」两个极端，
  没覆盖这个交叉情形。方向是偏高、幅度有界，故只记 Minor。

## ③ 缺陷二的根因定位：正确，且覆盖的是整类而不是一条路径

`setDocument` **无条件**清空 `toc`（`document.store.ts:88`）并**无条件**自增 `openEpoch`
（同文件 :85）。把 `openEpoch` 列进重建依赖后，「凡是 `setDocument` 就一定重建 → 一定
`rerender` → 一定 `onHeadings`」成为不变量——不再依赖「内容变没变」这种偶然条件。
所以它堵的是整类，不是报告里那一条复现路径。

`applyRefreshedDocument` 不自增也是对的，而且理由比报告说的更硬：它**根本不清空 toc**
（`document.store.ts:113-120`），所以自动刷新压根不存在「目录被清空却没人补」的窗口，
不需要重建；反过来重建会白扔撤销栈、滚动位置与整个块缓存。区分正确。

「documentId 标识文档、openEpoch 标识一次打开」这条区分与 `useReadingPosition` 的闩锁、
`usePendingAnchor` 的撤防同源，模块内一致。

**缺口**：没有任何用例覆盖 `ReaderPage.tsx:124` 那一行 `openEpoch={openEpoch}`。
把它删掉，393 个用例照样全绿，而缺陷二原样回来。

## ④ 缺陷四的迁移取舍：可接受，孤儿记录**不会**触发白屏同类问题

关键区别：上次白屏是**值的结构**变了（`ReadingPosition` 少了 `line`，读回来
`undefined + 1 = NaN` 穿过边界检查）；这次变的是**键**，值的结构一个字节没动。
带 hash 的旧键写进来的仍是 `{documentId, line, offset, updatedAt}`，
`isCurrentShape`（`reading-position.ts:41-44`）照样通过，
只是**永远不会被查到**——`hydrate` 把它塞进 `cache`，此后没有任何 `cache.get` 会用带 hash
的 id 去问。惰性数据，不参与任何算术，不可能产生 NaN。已核对 `applyPosition` /
`scrollToLine` 的取值路径，孤儿记录不在其中任何一条上。

可见的行为异常只有两点，都可接受：
1. 升级后，上次是「带锚点打开」的那些文档，第一次回来会从头开始（滚一下就重新存上）；
2. 孤儿记录的 `updatedAt` 比干净记录**新**，而 `prune()` 淘汰的是最旧的，所以在
   `MAX_ENTRIES = 200` 被填满时，先被挤掉的是有用的记录而不是孤儿。数量以「用户点过多少个
   不同锚点」为上界，量级上够不到 200，记 Minor。

结论：不做迁移的取舍成立，且注释里给的理由（合并后选哪一条位置是新的取舍）也站得住。

## ⑤ 缺陷五：改注释不改代码，判断正确

三条理由（判据二义、等落定要多等一百多毫秒、另外两条跳转路径都是无条件写）都成立；
「用『那我不写地址栏了』掩盖定位缺陷」这个反对意见是对的。实测 B 里 `md-reader:hash`
两次点击各发一条、宿主地址栏跟着变，功能未受影响。

---

## 回归测试的效力

| 用例 | 锁的是缺陷本身还是实现细节 |
| --- | --- |
| `源码完全相同的两个块拿到不同的键` | 实现细节（键不等），单独看偏弱 |
| `重复块从块缓存里取到的是两个节点，能同时挂在文档里` | **缺陷本身**——用真实缓存 append 两次后数孩子，直接验「一个节点只能在一处」这条物理约束。有效 |
| `唯一块的键与它前面有多少内容无关` | **不变量**（缓存价值不被误伤），是这次最容易被后人改坏的一条，加得好 |
| `用完全相同的内容重开同一篇文档时，重新送一份目录出来` | **缺陷本身**（onHeadings 再次被调用）。但只覆盖组件，不覆盖 ReaderPage 的接线 |
| `只是内容变了（自动刷新）不重建编辑器` | 另一半不变量，防回退。**写法有瑕疵**：JSX 属性 `value="# 甲\n\n新增一段"` 不处理 `\n` 转义，实际传进去的是含字面反斜杠的一行文本；断言仍然成立，但并非作者以为的两块文档 |
| `块级标签后面的换行各占一个空行盒` / `段落内部的软换行不算空行盒` | 锁的是**机制项**（相对差值），有效 |
| `useEmbeddedDocument` 三条 | **缺陷本身**，且刻意补齐了 `window.parent` + `?embed=1` + `event.source` 三个前提，避免假通过。写得很好 |

**没有任何用例锁住新的常量值本身**（88/78/65…、72、60、110）。表格那条用例的上界还从
160 放宽到 220。实现者是诚实的（注释里并列了实测值），但这意味着
`markdown.css:467-477` 一改，估算全线失准而测试全绿——正是本项目已经栽过五次的那种情形。

## 超出五个缺陷的改动

只有一处：`live-preview.ts:141-143` 把 `Decoration.widget(...).range(end)` 重排了一次
（prettier 换行），无行为影响。其余改动都能一一映射到五个缺陷之一。
8c 遗留的 Minor（`MarkdownEditor.tsx:98` 只夹上界、`syncAnchorHash` 的落位、
`scroll-settle` 可用 `scrollend`）本次未动，符合「只修这五条」的范围约束。

## 关于「每块多出 27px 死白，不动」

**不动是对的**，但理由该更强也该更弱各一点：

- 更强：这不只是「会改变全篇排版」，当前状态本身就是个**渲染缺陷**——把源码编辑器的
  空白模式继承进了渲染后的 HTML。`<pre>` 有 UA 的 `white-space: pre` 兜底，
  补 `white-space: normal` 不会伤到代码块。所以它是一条该单独立项去修的缺陷，
  而不是一个可有可无的排版偏好。
- 更弱：真正拦住这次顺手改的不是排版，而是**全套常量与它绑死**。这一点报告写了，
  但 `block-height.ts` 的注释里**没写**——注释只说「会改变全篇排版」，没说
  「改了就得把 HEADING_PX / BLOCK_CHROME_PX / TABLE_ROW_PX / strayLineBoxes 一起回退」。
  下一个人照着注释动手，会得到一套每块高估 40px 的估算，且没有一个用例会失败。

---

## 结论

### 规范符合性：✅

TypeScript strict 全开、`npm run verify` 全绿（39 / 393，基线 384，+9）、注释中文且解释
「为什么」且密度达标、新增代码零网络请求、commit message 中文无署名尾注。
（注释里有两条「为什么」是错的，属质量问题而非规范问题，记在下面。）

### 任务质量：批准（附条件）

五个缺陷都真的修好了：缺陷一、二我在真实浏览器里独立验过，缺陷三的全部实测数字我独立
复现且逐条复算自洽，缺陷四的孤儿记录不会重演白屏，缺陷五的取舍判断正确。改动面克制，
回归用例里有两条（缓存物理约束、唯一块键的位置无关性）质量明显高于平均水平。
条件是下面 Important 那两条注释错误必须改掉——它们与本次要修的缺陷三是同一类错误。

### 问题清单

**Critical**：无。

**Important**

1. **`src/editor/block-height.ts:33-45`：新注释的成因 1（Tailwind Preflight 归零）是错的。**
   构建产物里 `.markdown-body p{margin:0 0 1em}` 在所有 `@layer` 之外，优先于
   `@layer base` 的 Preflight；实测非末位 `<p>` 的 computed `margin-bottom` = 16px。
   真正归零的是本项目自己的 `src/styles/markdown.css:467-473`
   （`.cm-md-block > :first-child / :last-child`），且它**只管块的最外层元素**——
   嵌套的块级元素（松散列表项、多段引用块）仍带着 16px，兜底分支没有这一项。
2. **`src/editor/block-height.ts:76-81`：`WIDGET_PADDING_PX` 说这段 padding「不是本项目写的」，也是错的。**
   `src/styles/markdown.css:475-477` 写着 `.cm-md-block { padding-block: 0.4em }`，
   就在第 1 条那两条规则下面 2 行，且是既有代码。这两条合起来的实际风险：
   `markdown.css:467-477` 是全套新常量的唯一支柱，改它既无测试失败也无注释提示，
   注释反而在误导。这条错误已进 commit message。

**Minor**

1. `src/editor/block-height.ts:204-218` `strayLineBoxes`：`>\n` 会把「行内标签结尾 + 软换行」
   （`</strong>\n`、`</a>\n`、`<br>\n`）也数成空行盒，与 `sourceLines` 重复计一次，
   每处高估 27px。中文写作常见，无用例覆盖。
2. `src/editor/block-height.ts:64-66`「偏高是安全方向」是断言。measure 循环两个方向都要迭代，
   `06cdf04` 的失效是量级不是符号；文末章节反而是偏高更难满足。建议改述为「|误差| 要小」。
3. `src/editor/block-height.ts:66-68`：记了「补 `white-space: normal` 可消掉 27px 死白」，
   但没记「一旦补上，本文件全部常量要跟着回到不含空行盒的一套」。报告写了，代码没写。
4. `src/editor/block-cache.ts:90`：注释「两者对 `.cm-md-block` 是等值的——它既没有内边距
   也没有边框」现已被本次的发现推翻（`padding-block: 0.4em`）。缺 `borderBoxSize` 的环境下
   `contentRect.height` 每块少 12.8px，而估算侧现在明确含这 12.8px，两侧口径不一致。
   实现者在本任务里发现了这段 padding，却没顺手修同一个文件里 20 行外的这句。
5. `src/viewer/pages/ReaderPage.tsx:124` 的 `openEpoch={openEpoch}` 无任何用例覆盖：
   删掉它 393 个用例照样全绿，缺陷二原样复活。
6. `src/editor/MarkdownEditor.test.tsx` 的 `只是内容变了（自动刷新）不重建编辑器`：
   JSX 属性字符串不处理 `\n` 转义，实际文档是含字面反斜杠的一行。断言仍成立，但与意图不符。
7. `src/editor/block-cache.ts:27` `DEFAULT_CAPACITY = 200` 旁的「按一屏几十块估算」是在
   「重复块共享槽位」的旧假设下写的；现在一篇文档占用的槽数等于块数，未复核。
8. `src/editor/block-render.ts:36-37`：`RenderedBlock.key` 的注释在讲完「源码文本不足以
   当键」之后，仍保留着「源码文本本身就是完美的键」这句旧话，前后打架。
9. `src/editor/live-preview.ts:141-143` 的 prettier 换行是五个缺陷之外的纯格式改动（无害）。

### 既有缺陷（本次未修，报告已自陈，本审查独立复现）

**A（Important）阅读位置恢复后的第一次目录点击被吞掉。** 实测 `dup.md`：恢复到 768 后点
「第 18 章」，连采 4.8 秒 scrollTop 恒为 768；先做一次 60px 用户滚动再点则 828 → 6234。
与报告定位一致（`onEnhanced` 校正 + `userScrolledRef` 未置位）。不在本次范围内，
但它是**最普通的用户路径**，且症状与缺陷一被修掉的那个症状肉眼无法区分，
建议排到下一个任务的最前面。

---

## 未能验证的项

1. **真实扩展环境未跑到**：Chrome 152 已移除 `--load-extension`，宿主侧仍是逐行复刻的
   内容脚本，`chrome.storage` 仍是 localStorage 替身。`pickFolder` / `readWorkspaceFile` /
   工作区侧栏切换文档这条 `setDocument` 路径都没有实测覆盖——缺陷二的修复在工作区路径上
   只做了代码推理（`openEpoch` 由 store 统一自增，与调用方无关，推理上成立）。
2. **`file://` 场景未验证**：实测全在 `http://127.0.0.1`。`stripHash` 对 `file://` 的行为
   只做了代码核对（字符串截断，不构造 URL，不会抛）。
3. **孤儿阅读位置记录未做真实存储实测**：结论来自对 `reading-position.ts` 取值路径的
   逐条核对，没有真的往 `chrome.storage` 里塞一批带 hash 的旧键跑一遍。
4. **用户改字号 / 改版心后的估算精度未测**：全部实测在默认设置、1440×900、版心 980px 下。
   新常量比旧常量更贴合默认值，也就更依赖默认值；非默认字号下的偏差量级未知。
5. **性能未测**：`strayLineBoxes` 给每个块多加一次全文串扫描，未做前后 bench 对比
   （量级上是一次 `indexOf` 循环，判断为可忽略，但没量过）。
6. **`dup.md` 之外的重复形态未测**：只测了「整章重复」。两条 `---`、两个空代码块这类
   短重复块没单独测（8c 记录称少量重复实测无影响）。
