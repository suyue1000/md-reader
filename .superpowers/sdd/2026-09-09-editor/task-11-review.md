# Task 11 审查报告：清理分块渲染残留 + 阶段 A 验收关

审查对象：`4c4a978..0bb9fe0`。
本报告的浏览器数字全部由审查方自建 harness 重新量出，**不是复述实现者的数字**；
凡与实现者数字一致的地方都标了「独立复现」。

---

## 〇、审查方的实测环境

与 8c/8d 同路：Chrome 152 已移除 `--load-extension`，改为把 `npm run build` 的
**dist 原样**挂在本地 node 静态服务器（127.0.0.1:8731），宿主页 `/host/<name>.md`
复刻 `src/content/index.ts:180-235` 的 `takeOver()` 握手，`chrome.storage` 用
localStorage 替身经 `Page.addScriptToEvaluateOnNewDocument` 注入，Node 内置
WebSocket 直连 CDP。

**`--disable-backgrounding-occluded-windows` 与 `--disable-renderer-backgrounding`
在本报告每一次 Chrome 启动里都带着**（`cdp.mjs` 的 `ANTI_OCCLUSION_FLAGS` 是所有
启动路径共用的常量）。

一个必须先说的意外：实现者的 harness 与本次审查**共用同一个 scratchpad 目录**
（`…/scratchpad/h/`）。我起手时覆盖掉了其中的 `cdp.mjs` / `server.mjs` 与三份测试
文档。测试文档已用实现者自己的 `make-docs.mjs` 原样重新生成（生成器是确定性的，
内容逐字节一致），`cdp.mjs` / `server.mjs` 由审查方按原接口重写。实现者的
`t1`~`t9` 判据脚本、`boot.mjs`、`stubs.mjs`、`click.mjs` 全部完好，本报告对其
方法的评价基于这些原件。

---

## 一、清理是否正确且彻底 —— ✅

### 1.1 全仓库零引用

```
grep -rn "chunker|splitSource|createSession|RenderSession|ChunkResult|ChunkOptions|
renderProgress|MarkdownView|useMarkdownRender|renderDurationMs|renderStages|
RenderStages|setRenderDuration|setRenderProgress|CHUNK_THRESHOLD|CHUNK_TARGET|
renderChunk" src/
```

命中 **2 条，都是注释里的历史指代**，且都明写「已删除」：

- `src/hooks/useExport.ts:45` —「数字原记在已删除的 `markdown/chunker.ts` 模块注释里」
- `src/editor/MarkdownEditor.tsx:365` —「已删除的 `components/markdown/MarkdownView.tsx`」

这两处是有意的历史对照，不是悬空引用。`src/components/markdown/` 目录已随
`MarkdownView.tsx` 一起消失。仓库范围（排除 `node_modules` / `dist` /
`.claude/worktrees` / `.superpowers`）再扫一遍，只剩 `docs/superpowers/plans/` 里
的计划原文（历史记录，不是代码依赖）——但其中**第 18 行仍把 `src/markdown/chunker.ts`
当作「注释密度基准」**，那份文件已经不存在了，属于文档陈旧（Minor）。

### 1.2 `render()` 与 `instance()` 都还在，且都有活的调用方

| 函数 | 调用方 | 位置 |
| --- | --- | --- |
| `render()` | 离屏渲染（导出 / 打印） | `src/editor/offscreen-render.ts:65` |
| `instance()` | 块渲染（屏幕正文） | `src/editor/block-render.ts:73` |

两条路径都在，没有误删。

### 1.3 测试 459 → 443 不是「删测试让套件变绿」

用 `git show 4c4a978:…` 数原文件：

| 文件 | 原 `it(` 数 | 现 `it(` 数 | 差 |
| --- | --- | --- | --- |
| `src/markdown/chunker.test.ts` | 9 | 文件已删 | −9 |
| `src/markdown/renderer.test.ts` | 27 | 20 | −7 |

`renderer.test.ts` 原文里「分块渲染会话」describe 下正好 6 条
（行 186/196/200/215/226/256），加上行 139 的「返回渲染耗时与阶段明细」1 条，
合计 7。**9 + 7 = 16，与 459→443 的差额吻合。**

被删用例对应的被测面：`splitSource`（chunker.ts 整文件删）、
`createSession` / `renderChunk`（contract + renderer 里整体删）、
`RenderResult.durationMs` / `.stages`（契约里整体删）。逐条核过，
**没有一条是「功能还在、用例被拿掉」**。

### 1.4 `contract.ts` 文件头注释 —— 更新了，但有一处与代码不符

新注释把消费者分成「块渲染拿 `instance()`」「离屏渲染拿 `render()`」两类，
这两条核对属实（见 1.2）。

**但「目录不再从这里产出」这句与代码不符**：`RenderResult` 仍然声明 `toc`，
`render()` 里仍然执行 `collectHeadings` + `buildTocTree`（`renderer.ts:108,113`）。
准确的说法是「目录仍由 `render()` 产出，但**生产代码里没有任何消费者**」——
`offscreen-render.ts` 只取 `result.html`，全仓库读 `toc` 的五处全都读的是
`document.store` 里由块渲染写入的那份。这条 `toc` 目前只有 `renderer.test.ts`
在断言。

在一个以「不要让下一个人以为还有第二条路径」为目的的清理任务里，留一段
**没有消费者、注释还说它不存在**的产出，正是这个项目反复栽跟头的那类
「注释与代码分岔」。（Minor，见问题清单）

### 1.5 门禁

- `npm run verify`：**typecheck ✅ / lint ✅ / 46 文件 443 用例全绿**（审查方实跑）
- `npm run build`：**0 warning / 0 error**（审查方实跑，见第四节）
- 提交信息：中文、无署名尾注 ✅

---

## 二、阶段 A 验收结论可信度

### 2.1 八条判据的实测方法评级

| 判据 | 方法 | 评级 |
| --- | --- | --- |
| 1 正文渲染 | 逐元素计数（Shiki span 17 / Mermaid node 4 / KaTeX 2 / 表格 12 格 / checkbox 3 / 脚注 2 / 图 1），逐项对源码期望 | **中**——元素计数能证伪，但「共 45 块」没有与任何期望值对账（见 2.3） |
| 2 目录 | 6 个 scrollTop 采高亮 + 视口外点击后连采 12 次 + 标题距顶距离 + 8d 缺陷两情形复核 | **强** |
| 3 查找 | 30 处命中 vs 30 处高亮，19 个采样点逐点对账，自己抓出并订正了少数 1 的错 | **强**（本轮最扎实的一条） |
| 4 导出 | 12 块在屏 → 产物 105 块，导出**之后**才滚全篇统计文档块数来对账 | **强** |
| 5 打印 | 在 `print()` 被调那一刻量 `#print-root`：105 块 / 24 图全部 `complete && naturalWidth>0` / 空框 0 | **中**——只验了 DOM 与图片解码，没有验打印样式、`.no-print` 是否真被排除、分页 |
| 6 阅读位置 | 真实滚轮 → reload，10660→10708（差 0.24%）、顶部块同一块 | **强** |
| 7 锚点 | 地址栏 hash 与正文站内链接各一次，给了 scrollTop 与距顶距离 | **中**——单样本，但数字能证伪 |
| 8 自动刷新 | 状态栏文案 + 块数 2→4 + 目录 1→2 项，首次轮询（≈0.5s）内生效 | **强** |

**没有一条是「只看了没报错」就算通过的**——八条都给了能被证伪的数字。
弱的两条是 1 和 5，弱在**覆盖面**（只验了一部分可观测量），不是弱在**没验**。

### 2.2 审查方自己重跑的两条

选了历史上最容易坏的两条：**判据 2（目录跳转）** 与 **判据 4（导出 HTML）**。

#### 判据 2 —— 独立复现，**通过**

`fenced.md`（20 章 × 30 行 ```js，目录 21 项，scrollHeight 19927，视口 743）：

**视口外点击跳转**（本轮**没有做任何预热滚动**，而且因为前一轮留下了阅读位置，
点击发生时「阅读位置恢复」正处于刚消费完的状态，`before = 16046`）：

| | 结果 |
| --- | --- |
| 点「第-18-章」 | 16046 → **16886** |
| 连采 14 次（3.5s） | 16886 × 14，纹丝不动 |
| 标题距容器顶 | **0px** |
| 侧栏高亮 | 第-18-章 |

**再跳三次，确认不是一次性巧合**：

| 目标 | scrollTop | 标题距顶 | 侧栏高亮 |
| --- | --- | --- | --- |
| 第-3-章 | 16886 → 2104 | 4px | 第-3-章 |
| 第-20-章 | 2104 → 18818 | 4px | 第-20-章 |
| 第-9-章 | 18818 → 7997 | 4px | 第-9-章 |

**滚动高亮跟随**，与实现者的表格**逐格一致**：

| scrollTop | 0 | 3000 | 7000 | 11000 | 15000 | 19000 |
| --- | --- | --- | --- | --- | --- | --- |
| 审查方 | 代码文档 | 第-3-章 | 第-7-章 | 第-12-章 | 第-16-章 | 第-20-章 |
| 实现者 | 代码文档 | 第-3-章 | 第-7-章 | 第-12-章 | 第-16-章 | 第-20-章 |

顺带：8d 记的「存在已恢复的阅读位置时第一次点击被吞掉」在我这轮也**没有复现**，
与实现者一致。

#### 判据 4 —— 独立复现，**通过**，并纠正了我自己的一次误测

`long.md`（24 章）产物对账：

| 项 | 审查方 | 实现者 |
| --- | --- | --- |
| 产物字节 | **200654** | 200654 |
| `.markdown-body` 顶层块 | **105** | 105 |
| `<h2>` / 「章节 N」 | 24 / 24 | 24 / 24 |
| `<pre class="shiki">` | 24 | 24 |
| KaTeX 元素 | 20 | 20 |
| `<img>` | 24 | 24 |
| `<script>` | **0** | 0 |
| 非本地 `src`/`href` | **0** | — |

**我第一次数文档块数时数出 59，与 105 对不上。** 查下来是我自己的扫描步长
（320px）太粗：滚动过程中块高度从估算值收敛到实测值，`scrollHeight` 从 19119
掉到 16844，粗步长会跳过中间块。改成 120px 步长连跑两趟，两趟**都是
`distinct = 105`、`undefined` 键 0 个**（`block-render.ts:91` 的键是
`序号 + 源码文本`，天然唯一，不存在碰撞）。

结构上也对得上：24 章 ×（H2 + P + PRE + FIGURE）= 96，加 4 张 Mermaid、
4 个块级公式、1 个 H1 = **105**。

**实现者的「12 块在屏 → 产物 105 块」成立。**

### 2.3 审查方补做的一条实现者没做的对照：屏幕 vs `render()` 逐块比对

这是本次审查里最该补的一条——**「与改造前等价」的核心是「屏幕上的东西和
`render()` 的输出一致」**，因为改造前屏幕上显示的就是 `render()` 的输出。
实现者只对了**块数**，没有对**内容**。

方法：`features.md` 打开后先导出（走离屏 `render()`），再全篇滚动按 `offsetTop`
顺序收集每一块的 `textContent`，与产物 `.markdown-body` 的顶层子元素逐个比。

结果：**屏幕 45 块 / 产物 46 个顶层元素，45 条内容逐条同序同文**。
两处差异都查证过，都是有意为之：

1. 标题块屏幕上是 `# 代码高亮`、产物里是 `代码高亮` —— `anchor.ts` 用
   `linkInsideHeader({symbol:'#', placement:'before'})` 往标题里插了锚点链接，
   导出时 `export/dom-snapshot.ts:41` 把 `.heading-anchor` 摘掉了，
   `export/export.test.ts:22,37` 有用例锁着。
2. 45 vs 46 —— markdown-it-footnote 产出 `<hr class="footnotes-sep">` +
   `<section class="footnotes">` 两个顶层元素，块渲染把它们打成**一个 trailing 块**。
   内容一致，只是切块粒度不同。

**这条对照通过，是目前手上最强的「块渲染与整篇渲染等价」证据。**

---

## 三、三处独立判断

### ① 控制方那条快捷自检 —— 实现者的纠正**成立**，派发指令应该改

我在 `fenced.md` 上逐个 scrollTop 同时量「第一个 `.cm-md-block`」的文本**和**它的
`getBoundingClientRect()`：

| scrollTop | 第一个块的文本 | 它的 `top` | 在视口内？ | 第一个**落在视口内**的块 |
| --- | --- | --- | --- | --- |
| 0 | `# 代码文档` | 86 | 是 | `# 代码文档` |
| 4000 | `# 代码文档` | **−3914** | 否 | `const v3_0 …` |
| 8000 | `# 代码文档` | **−7914** | 否 | `# 第 9 章` |
| 12000 | `# 代码文档` | **−11914** | 否 | `# 第 13 章` |
| 16000 | `# 代码文档` | **−15914** | 否 | `第 17 章的说明文字` |

（滚动容器可视区 46~789，挂载块数 4~8）

**scrollTop=12000 处 `top = −11914`、可视区 46~789——与实现者给的数字分毫不差。**
也就是说：任何滚动位置下，第一个 `.cm-md-block` 的 `textContent` 都是文档开头那一块，
**即使视口完全正常**。控制方那条自检在本项目里是**必然误报**，纠正成立。

它建议的两个替代判据我也一并验了，都可用：
「第一个矩形落在视口内的块」逐行给出 第 9 / 第 13 / 第 17 章，随 scrollTop 单调推进；
「最后一个挂载的块」同样随 scrollTop 推进。

**→ 后续任务的派发指令必须改掉这条自检**，否则每一轮都会先被吓一跳、
甚至可能据此错误地否掉一份本来正确的实测。

**但有一个保留**：实现者给的**机制归因**（「光标默认停在文档位置 0，CodeMirror
的视口范围总把选区所在的行包进去」）我**没能查证**。我尝试从 DOM 取
`EditorView`（`.cm-editor` 上的 `cmView`）做「把选区移到文末再看第一个块」的 A/B，
取不到实例（`hasView: false`），探针没跑成。**结论（自检必然误报）已被测量证实，
但原因仍是一个未经查证的合理推测**——这正是本项目栽过三次的那类归因。
报告里应该标成「原因待查证」而不是陈述句。

### ② `render()` 里 parse/render 共享 env 的那一行 —— 处理**恰当**，但可以再补一刀

**独立复现了实现者的探针**，而且用了更狠的样例（脚注正文里再引一个引用式链接、
两条 `[ref]` 定义、表格、任务列表、行内与块级 KaTeX、Mermaid、emoji、上下标、
删除线、高亮）：

```
插件列表: anchor, highlight, subSup, deflist, footnote, taskList, emoji,
          katex, codeBlock, mermaid, images
env keys after parse: [ 'footnotes', 'references', '__mdReaderSlugger' ]
shared bytes: 4788   empty bytes: 4788
逐字节相同: true
含 footnote 区块: true | 引用链接: true
```

env 里确实攒了 `footnotes` / `references` / `__mdReaderSlugger` 三样东西，
但 render 那侧换成 `{}` **产出仍然逐字节相同**——它们全都在 parse 阶段就把
token 改完了。**实现者的查证属实，它自行证伪的那句「不共享脚注就渲染不出链接」
确实是错的。**

**判断：不硬补用例是对的。** 断言「共享 env 与空 env 产出相同」等于把一个
我们**并不想长期保持**的性质焊死；将来真有插件依赖 env，那条用例会先红，
而且红得毫无意义。

**但「当前插件集下等价」确实只是一张快照，而注释自己写明了留着这一行是
「为了将来装上依赖 env 的插件时不会莫名其妙地坏掉」——这个承诺今天就可以锁，
而且不依赖插件集**：`RendererOptions.registry` 是可注入的（`renderer.ts:13`），
写一个假插件，在 core 规则里往 `env` 塞个值、在 renderer 规则里取回来渲进 HTML，
断言 `render()` 的产出里有它——十几行，能被 `env → {}` 这个变异杀死，
且不会因为真实插件集变化而失效。

**建议补这一条**（Minor，不阻塞）。补了之后那一行就不再是零覆盖，
注释里「所以这里没有对应的用例」那句也要一并改掉。

### ③ 体积 —— 订正后的注释**如实**；不构成实际问题；但确有一块可削

**注释的每个数字我都重新量过：**

| 注释里的说法 | 审查方实测 | 结论 |
| --- | --- | --- |
| viewer 入口 626891 字节 | `npm run build` → `viewer-yeMEnPoz.js` **626.89 kB** | ✅ |
| gzip 后 217KB | vite 报 **gzip: 217.30 kB**；node zlib L6=217301 / L9=216946 | ✅ |
| 基线 84030，涨 7.5 倍 | 626891 / 84030 = **7.46** | ✅ |
| 阈值 800KB 仍高于它 | ✅ | ✅ |
| 「本次构建一条警告都没有」 | `npm run build` 输出里 **0 warning / 0 error** | ✅ |
| 最大懒加载语法包 emacs-lisp 779.93 kB | **779.93 kB** | ✅ |

**这个体积对本地扩展是实际问题吗？——不是。** 实现者那句
「这是本地扩展，资源从磁盘加载、零网络请求，这个量级不影响启动」原来是
**没有数字的断言**，我补上了：

| 指标 | 实测 |
| --- | --- |
| viewer 入口传输耗时 | **4 ms** |
| `domContentLoadedEventEnd` | **35 ms** |
| `loadEventEnd` | **36 ms** |
| 从 `Page.navigate` 到第一个块挂出（含 Chrome 导航） | **415 ms** 墙钟 |
| `usedJSHeapSize` | **30 MB** |

**有没有本可懒加载却被打进首屏的东西？有一块，可定位：`dompurify`。**

按 sourcemap 把 viewer 入口的 1,864,819 个源码字符归因到包：

| 包 | 源码字符 | 占比 |
| --- | --- | --- |
| @codemirror/view | 491,098 | 26.3% |
| @codemirror/state | 147,333 | 7.9% |
| **dompurify** | **117,772** | **6.3%** |
| @codemirror/language | 102,113 | 5.5% |
| **@codemirror/autocomplete** | **90,002** | 4.8% |
| @lezer/markdown | 86,937 | 4.7% |

- **`dompurify`**：`MarkdownEditor.tsx:15` **静态** import `renderBlocks`，
  `block-render.ts:2` 又静态 import `@/markdown/sanitize`，DOMPurify 就这么进了入口。
  注意 **markdown-it 管线本身是懒的**（`markdown-it` 根本没出现在入口归因里，
  `MarkdownEditor.tsx:299` 是 `await import`），**DOMPurify 是跟着 `block-render`
  越过那道懒加载边界溜进来的**。把 `block-render` 也改成与渲染器同一次动态
  import，这 6.3% 就能出首屏——而且不会推迟任何东西，因为块渲染本来就要等
  懒加载的渲染器就绪。
- **`@codemirror/autocomplete`**：`src/` 里对 autocomplete **零直接引用**，
  是 `lang-markdown` / `language` 传递带进来的。要不要摘是另一件事。

这两项都不是 Task 11 的份内事，记作后续可选项（Minor）。

---

## 四、实现者报告的三处新发现 —— 全部属实

| 发现 | 审查方核实 |
| --- | --- |
| `src/hooks/index.ts` 与 `src/components/index.ts` 两个桶文件全仓库零引用 | ✅ `from '@/hooks'` / `from '@/components'` 各 **0 命中**，全项目按具体路径 import |
| `.claude/worktrees/readme-developer-docs-fbd92c`（停在 `dce37da`）会被 `npm run bench` 扫到 | ✅ `npx vitest bench --run` 输出里确实有 `.claude/worktrees/…/src/markdown/renderer.bench.ts > 切分 / 一次性渲染 / 分块渲染`，与 `src/markdown/renderer.bench.ts > 整篇渲染` 并列；`vite.config.ts:77` 的 `test.include: ['src/**/…']` 锚在仓库根，`npm run test` 不受影响 ✅ |
| 导出 HTML 的 KaTeX `@font-face` 指向扩展自身地址 | ✅ 产物里 **20 条 `@font-face`**，首条 KaTeX 字体是 `url("http://127.0.0.1:8731/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2")`，真实扩展下即 `chrome-extension://<id>/assets/…` |

---

## 五、超出简报范围的改动

| 文件 | 在简报清单里？ | 判断 |
| --- | --- | --- |
| `src/markdown/renderer.bench.ts` | ❌ | **必要**——`splitSource` 被删，bench 不改就跑不起来 |
| `src/hooks/useExport.ts` | ❌ | **必要**——注释引用了被删文件，属于清理的应有之义 |
| `src/editor/MarkdownEditor.tsx` | ❌ | **必要**——同上，纯注释 |
| `vite.config.ts` | ❌（风险 1 在计划里挂在 **Task 1**，不是 Task 11） | **可接受但属扩围**：纯注释、零行为改动，且纠正的正是一句「没验过的估计」，与本项目「注释必须查证」的约束同向。应在报告里明说这是扩围 |
| `src/components/index.ts` | ✅（简报要求改） | **实现者拒绝执行是对的**——该文件从来没导出过 `MarkdownView`，简报这条是错的 |
| `src/stores/document.store.ts` 的 `reset` | ✅（简报要求改） | **实现者不动是对的**——那几个字段本来就不在 `reset` 里，diff 可证 |

没有发现夹带的行为改动。全部 diff 要么是删除，要么是注释，要么是删除后的直接后果。

---

## 六、注释里的机制归因是否查证过

| 注释 | 归因 | 查证情况 |
| --- | --- | --- |
| `renderer.ts` render() 的 env 段 | 「当前插件集下换空 env 产出逐字节相同」 | ✅ 实现者写了探针；审查方用更狠的样例独立复现 |
| `renderer.ts` 「返回 Promise 是接口留给将来的余地」 | 设计意图，非机制归因 | 不适用 |
| `StatusBar.tsx` 「一次渲染的总耗时这个量不再存在」 | ✅ 与块渲染架构一致，属实 |
| `contract.ts` 「目录不再从这里产出」 | ❌ **与代码不符**，见 1.4 |
| `vite.config.ts` 体积段 | ✅ 每个数字审查方都重量过 |
| `useExport.ts` 10MB → 7.5s 的出处 | 转述 Task 2 的旧实测，已注明出处随文件删除 | ⚠️ 出处已不可查，但实现者如实标注了这一点，处理得当 |
| 报告里「光标停在位置 0 导致第一个块恒为文档开头」 | ❌ **未查证的推测**（结论已证实，原因没证） |

**实现者这一轮自己证伪过一条自己的推断（env/脚注那条），这是对的方向。**
但 contract.ts 那句和 trap 的机制归因说明这道关还没守死。

---

## 七、结论

### 规范符合性：✅

- TypeScript strict：`npm run typecheck` 通过
- `npm run verify`：**46 文件 / 443 用例全绿**（审查方实跑，与报告一致）
- `npm run build`：0 warning / 0 error
- 注释中文且解释「为什么」：符合（一处内容失准，见 1.4）
- 零网络请求：导出产物 `<script> 0`、非本地 `src`/`href` **0**；判据 9 的 41 条请求非本地 0 条
- 提交信息中文、无署名尾注：✅

### 任务质量：**批准**

清理干净、彻底、没有误删；测试数下降逐条可追溯到被删函数，不是「删测试变绿」；
验收八条都给了能证伪的数字，我重跑的两条（含最容易坏的目录跳转与导出）
**全部独立复现**，还额外补了一条实现者没做的屏幕/`render()` 逐块比对，也通过。

**Critical：无。**

**Important**

1. **「八条全部通过」≠「与改造前等价」，而报告与提交信息都按后者措辞。**
   八条判据验的是「现在能用、数字自洽」，**没有任何一条做过 pre/post 基线对照**
   （简报 Step 8 的原话是「全部与改动前一致」）。我补的屏幕 vs `render()`
   逐块比对是目前最接近的替代证据，但它证的是「块渲染 == 整篇渲染」，
   不是「今天 == 改造前」。措辞应降级为「无已知功能回归」。
2. **harness 与生产的同源/跨源差异，导致判据 4/5 走的是生产不会走的分支，报告未声明。**
   真实扩展里 viewer 是嵌在宿主页里的**跨源** iframe，`utils/env.ts` 的
   `canUseFilePicker()` 因此返回 false，`export/download.ts:55` 会**直接绕开
   `showSaveFilePicker`、降级走 `downloadBlob`**。而 harness 的宿主页与 viewer
   同源，判据 4/5 实际走的是 `showSaveFilePicker` 那条**生产环境永远走不到**的分支。
   产物 Blob 的构建与分支无关，所以「105 块」的结论不受影响；
   **但生产里真正用的那条保存路径，阶段 A 从头到尾没验过。**

**Minor**

3. `contract.ts` 文件头「目录不再从这里产出」与代码不符：`RenderResult.toc` 仍在、
   `render()` 仍在算，只是生产代码零消费。要么改注释，要么把 `toc` 一起收掉。
4. 报告里 trap 的**机制归因**（光标停在位置 0）未查证，应标注为待查证。
   结论本身已被我独立证实。
5. `render()` 的 env 那一行建议补一条**注入假插件**的用例（`RendererOptions.registry`
   是现成的注入点），把「render 与 parse 共享 env」这个契约锁住，
   不依赖当前插件集。补后注释里「没有对应的用例」那句需一并改。
6. `dompurify`（入口源码占比 6.3%）因 `MarkdownEditor → block-render → sanitize`
   的静态 import 越过了渲染管线那道懒加载边界，可随 `block-render` 一起改为
   动态 import 移出首屏；`@codemirror/autocomplete`（4.8%）在 `src/` 零直接引用。
7. `docs/superpowers/plans/2026-09-09-editor.md:18` 仍把已删的
   `src/markdown/chunker.ts` 当作注释密度基准。
8. `vite.config.ts` 属扩围改动（风险 1 挂在 Task 1），报告未声明。

### ⚠️ 未能验证 / 边界

- **从未以「真正安装的扩展」形态验过任何一条**——Chrome 152 移除了
  `--load-extension`，8c 起就是这个边界，不是本任务的问题，但它一直在。
- **生产的导出/打印保存分支（`downloadBlob`）没验过**（见 Important 2）。
- **没有任何一条判据做过 pre/post 基线 A/B**（见 Important 1）。
- **trap 的机制归因没验成**——我取不到 `EditorView` 实例，A/B 探针没跑起来。
- **判据 5 只验了 DOM 与图片解码**，打印样式表、`.no-print` 排除、分页未验。
- `$TMPDIR` 下 **37 个 9/10 留下的 `mdr-profile-*`** 仍在。我尝试清理时同样被
  本机的破坏性命令策略挡住（`rm -rf` 需人工批准），**与实现者的记录一致**。
  本轮审查自己起的 `rev11-profile-*` 已在脚本 `finally` 里清干净（现存 0 个），
  静态服务器已停（8731 无监听），调试 Chrome 进程已全部退出。

### 阶段 A 可以判定为「功能与改造前等价」了吗？

**不能用这个措辞收官；可以按「无已知功能回归」收官，进入阶段 B。**

理由：八条判据是真验过的，我重跑的两条独立复现，额外补的等价对照也通过——
**没有发现任何功能缺陷**。但「与改造前等价」是一个**对照命题**，
而整个阶段 A **一次对照都没做过**：所有数字都是「新实现自己看起来对」，
没有一条是「新旧两个构建跑同一份输入、结果相同」。这个项目七次栽在
「测试全绿而功能是坏的」上，靠的正是「自洽」与「等价」之间的这条缝。

**要把措辞升到「等价」，还差三件事**（都不必现在做完，但要么补、要么明确记为未决）：

1. **一次真正的基线对照**：在 Task 1 的父提交上另建 worktree 构建一份旧版，
   同一份 `features.md` / `long.md` 两边各导出一次 HTML，做规范化后的
   文本 diff。这是成本最低、判别力最强的一条——我补的屏幕 vs `render()`
   比对已经把「块渲染 == 整篇渲染」这半边证掉了，剩下的半边是
   「今天的 `render()` == 改造前的 `render()`」。
2. **补验生产真正使用的保存分支**：把 harness 的宿主页换成**跨源**
   （另起一个端口/主机名），让 `canUseFilePicker()` 落到 false，
   走一遍 `downloadBlob` 降级路径，确认导出与打印在那条路上同样出全文。
3. **把 trap 的机制归因查证或降级为推测**，并**同步修改后续任务的派发指令**——
   那条「读第一个 `.cm-md-block`」的自检必须换成「第一个矩形落在视口内的块」
   或「最后一个挂载的块」，否则后续每一轮都会踩同一个假警报。
