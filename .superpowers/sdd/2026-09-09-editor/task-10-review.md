# Task 10 审查：离屏渲染，修复导出与打印

审查范围：`6ba7229..f55a92b`（12 文件 / +961 −68）。
审查方法：读全量 diff + 读相关既有实现 + **五次撤销实验**（三次复刻报告的，两次报告没做过的）
+ 三次机制查证（CSS 层叠、mermaid 源码、CodeMirror 的 rAF）。
未起浏览器实测（见文末「未能验证」）。

基线复核：`npm run verify` 退出码 0，**45 文件 / 451 用例**，与报告一致。
+3 文件（offscreen-render / print / useExport）、+21 用例（5+7+5+4）核对无误。
（报告第五节写 `export.test.ts +8`，实际数是 7；总数 21 是对的。纯笔误。）

---

## ① `eager` 触及共享 `PluginContext` —— 判定：改动是安全的，但**最核心的那一处正确性增量零覆盖**

### 1.1 会不会把屏幕路径也变成 eager —— 不会，已逐点核实

- `PluginContext.eager` 是 `readonly eager?: boolean`，可选；
- 另外两处构造 `PluginContext` 的地方（`src/markdown/renderer.ts:107`、
  `src/components/markdown/MarkdownView.tsx:93`）都不设这个字段 → `undefined` → 走懒加载分支；
- `enhanceBlock` 第 6 参默认 `false`；**屏幕路径唯一的调用点**
  `src/editor/MarkdownEditor.tsx:214` 只传 5 个参数，一个字没改；
- `code-block.ts` 的 `enhance` 读的是**自己的形参 `ctx.eager`**，不是模块级的 `currentContext`。
  所以离屏那次把 `currentContext` 换成一个 `eager:true` 的上下文，也不会污染后续滚动触发的
  推进——`drainLoop` 只从 `currentContext` 里取 `ctx.settings`。

结论：屏幕上的「按视口懒加载」没有被废掉。设计是对的：把语义放在 `PluginContext` 上、
默认关闭、只由离屏渲染这一个调用点打开。

**但这条不变量没有任何测试守着。** 我把 `src/editor/enhance.ts:33` 的默认值
`eager = false` 改成 `eager = true`（即让屏幕路径也变成 eager），跑全量：

```
Test Files  45 passed (45)      Tests  451 passed (451)
```

**全绿。** 将来谁手滑翻转这个默认值、或给屏幕调用点补上 `true`，没有任何东西会拦。

补充一条实测之外的观察，供分诊时权衡严重性：`enhance` 的 eager 分支作用域是
**一个块 widget 内部的代码块**，而块 widget 本身已经按视口虚拟化了（三段文本 = 三个块），
每块通常只含一个代码块。所以即使默认值被翻转，实际爆炸半径远小于「把懒加载废掉」——
代码块这一层的 IntersectionObserver 在块级虚拟化之后已经接近冗余。
这解释了为什么没有测试会红，也说明这条缺口的实际风险是**中等而非致命**。

### 1.2 `drainQueue` 从同步改 Promise，调用方都跟上了吗 —— 跟上了

全仓只有三个调用点，逐个核对：

| 位置 | 写法 | 判定 |
| --- | --- | --- |
| `code-block.ts:106`（观察器回调） | `void drainQueue()` | ✓ 显式弃值，注释写了「没有人等它」 |
| `code-block.ts:427`（屏幕 enhance 末尾） | `void drainQueue()` | ✓ 同上 |
| `code-block.ts:414`（eager 分支） | `await drainQueue()` | ✓ 唯一要等的那个 |

没有遗漏的同步用法。`enhance` 从 `(root, ctx) => void` 改成 `async` 也不成问题——
`DomEnhancer` 的类型本来就是 `void | Promise<void>`，`enhance.ts:49` 那里是
`Promise.all(...map(async plugin => ...))`，本来就 await。

### 1.3 「复位次序的坑」—— **坑是真的，注释讲清楚了，处理也对；但同样零覆盖**

它说的是：`startDrain()` 里 `draining = drainLoop().then(() => { draining = null })`，
复位写在 then 回调里而不是 `drainLoop` 的 `finally` 里；并且 `drainQueue()` 在
「已有一轮在途」时必须 `draining.then(() => startDrain())` **补启一轮**，而不是直接
把在途的 Promise 交出去。

我没有信它的推理，做了隔离复现（`scratchpad/race.mjs`，只保留时序骨架，
扫 1..8 个微任务刻度找那个窗口）：

```
ticks=1  无护栏:✘ 导出块没上色   有护栏:✔
ticks=2  无护栏:✔               有护栏:✔
...
```

`ticks=1` 正是「上一轮 `drainLoop` 已经跑完最后一次 `queue.size > 0` 检查、
复位回调还没执行」的那一刻。此时没有护栏的版本会把一个**已经结束的** task 交给
调用方，调用方立刻醒来，而它刚排进队列的那批块一个都没处理——导出拿到没上色的代码，
不报任何错。**坑是真实存在的，注释的描述准确。**

然后我把护栏撤掉（`drainQueue` 改成裸 `return startDrain();`），跑全量：

```
Test Files  45 passed (45)      Tests  451 passed (451)
```

**全绿。** 这是本次改动里最微妙、最难靠读代码发现、后果又完全静默的一处正确性增量，
它现在**一条用例都没有**。这与上一轮审查发现的问题是同一类。

### 1.4 顺带发现：`then` 换掉 `finally`，丢了拒绝路径

旧代码是 `try { ... } finally { draining = false }`；新代码是 `drainLoop().then(reset)`。
若 `drainLoop` 拒绝（try/catch 只裹了批内的 `Promise.all`，没裹 `yieldToMain()` 和循环骨架），
`reset` 永远不会跑 → `draining` 永久停在一个 rejected Promise 上 → **此后所有代码块
再也不会上色**，而且 `void drainQueue()` 会抛未处理拒绝。
`yieldToMain()` 实际上不会拒绝（MessageChannel / setTimeout），所以这是一个
「暂时够不着的」缺陷，但它是白白丢掉的健壮性：`.finally()` 同样满足注释里
「先复位后落定」的次序要求（finally 回调返回后原 Promise 才落定），却能同时兜住拒绝。

另一处小的：`drainLoop` 的批内 catch 只是记一条 warn，而这批块**已经从队列里删掉了**，
失败的块不会重试，eager 路径会静默交出一份少几块上色的 DOM。

---

## ② 手势约束的实测 —— 设计站得住，结论可信；余量的边界注释写得不够

### 2.1 反向对照的设计是对的

判据是「被拒 = 立刻 `SecurityError`，成功 = Promise 长期 pending」。
单看正向的 pending 确实可能是「什么都没发生」，所以必须有反向对照——
它做了：同一套脚本、只在 `showSaveFilePicker` 之前塞 6 秒（超过 5 秒瞬时用户激活期），
拿到 `sinceClick=6284ms / activationActive=false / SecurityError`。
这证明了这套观测**有能力分辨出「被拒」**，正向那个 8 秒 pending 因此不是假阳性。
这是一个合格的证伪设计，结论可信。

唯一的残余：pending ⇒「浏览器没拒绝」是硬的，pending ⇒「对话框在用户屏幕上可见」
是一步推断（没有截图）。考虑到 Chrome 对 picker 的拒绝一律是同步 reject，这一步推断可以接受。

### 2.2 余量会在什么情况下被吃掉 —— 比报告说的更近

`big.md` 192KB / 1.2 秒，距 5 秒 4 倍。但这个项目**自己的注释就是按 10MB 文档写的**：

- `src/markdown/chunker.ts:4`：「实测 10MB 文档一次渲染 **7.5s**」——
  单是 markdown-it 渲染就已经超过 5 秒手势窗口，还没算 Shiki；
- `src/plugins/builtin/code-block.ts:227,348`：「10MB 文档有六千多个代码块」。

缓和因素有两个，都查证过：
1. `docs/superpowers/specs/2026-09-09-editor-design.md:54` 明说「分块是为 10MB 级文档做的，
   而本工具的实际使用场景没有那种文档」——10MB 是理论边界不是目标场景；
2. 失败是**优雅降级**而不是崩：`src/export/download.ts:71` 捕获 `SecurityError` 后
   回落到 `<a download>`，用户仍然拿得到文件。

但 2 也正是问题：**手势超时之后用户看到的是「已导出 xxx（1.2 MB）」的成功提示，
文件却悄悄落进了下载目录而不是他选的位置。** 没有任何信号。
而 `useExport.ts` 的注释把判据写成「保存对话框弹不出来」——在有降级路径的前提下，
这个判据用户根本观察不到，只会觉得「怎么不让我选位置了」。

吃掉余量的三类场景，注释里一条都没写死：
- **文档更大**：按 192KB→1.2s 线性外推，约 800KB 起就逼近 5 秒；
- **机器更慢**：Shiki 是纯 CPU 计算，2–3 倍慢的机器直接把 4 倍余量吃掉一半以上；
- **Mermaid 特别多**：这一条最凶。`src/plugins/builtin/mermaid.ts:88` 是
  `await Promise.all(全部图)`，**本来就是全量的**（这也是为什么只有代码块需要 `eager`——
  我核过了，`src/plugins/` 下只有 `code-block.ts` 用 IntersectionObserver）。
  `big.md` 只有 20 张图；每张 Mermaid 的开销比一个代码块高一个量级，
  一篇 100+ 图的文档很可能单在 Mermaid 上就耗掉全部预算。

---

## ③ `print.css` 顺序 —— 实现者是对的，我独立核实过

CSS 层叠里媒体查询**不参与特异性计算**（特异性只由选择器决定）。
`#print-root{display:none}` 与 `@media print{ #print-root{display:block} }` 两条都是 (1,0,0)，
同特异性同来源同层，**后写的赢**。简报的片段把基础规则写在 `@media print` 之后，
打印时 `#print-root` 依然是 `display:none` → 白纸。**简报确实是错的。**

不满足于推理，用真 CSSOM 跑了一遍（`scratchpad/cascade.mjs`，以 `@media screen` 代替
`@media print` 保持层叠语义、让 jsdom 能算）：

```
基础规则在前（当前实现）: block
顺序写反（简报片段）   : none
```

**顺序锁的用例是真的能红。** 我按简报的错序改了 `print.css`（把基础规则挪到 `@media` 之后）：

```
FAIL  print.css > 隐藏 #print-root 的规则必须排在 @media print 的覆盖之前
      AssertionError: expected 16 to be less than 2
Tests  1 failed | 3 passed (4)
```

与报告的 F 组一字不差。用 CSSOM 而不是正则是正确的选择——「在不在 `@media` 里面」
「谁排在谁前面」只有解析成规则树才是可断言的事实。

唯一的盲点：用例锁的是「顺序」，锁不住「有人给其中一条加特异性」
（比如把打印那条写成 `body #print-root`，顺序就不再决定胜负）。属于可接受的残余。

---

## ④ 判据 4 的那处差异 —— **定性不对：不是「固有差别」，是可修的缺陷；而且屏幕才是走偏的那一侧**

实现者的机制归因（`markdown.css:467-477` 把块内首尾元素 margin 清零，
所以 h2 的 computed margin 是 0/0；产物走连续正文的 `1.6em/0.6em` = 37.12/13.92px）
**是查证过的、准确的**。它诚实地写了「残余那部分我没有逐项追到底，不做归因」。

但那部分残余，**这个仓库自己的注释里已经写清楚了**——`src/editor/block-height.ts`：

- 第 53–56 行：`.cm-content` 的 `white-space: break-spaces` 会继承进块 widget，
  于是净化后 HTML 里每个块级标签后的换行都保留成一个 **27.2px 的空行盒**；
- 第 83–86 行：「**每个块都白白多出一个空行盒**（一篇 60 块的文档约 1600px 的死白）。
  给 `.cm-md-block` 补一句 `white-space: normal` 就能消掉」；
- 第 92–97 行：`.cm-md-block { padding-block: 0.4em }` = 6.4px×2。

把数一对：屏幕上标题下方的 **60.8 = 6.4（块下内边距）+ 27.2（块尾那个死空行盒）+ 27.2
（两块之间那条真实的空行）**，分毫不差。上方 33.6 = 6.4 + 27.2，也对得上。

由此判定：

1. **不是「块 widget 呈现 vs 连续文档呈现」的固有差别。** 47px 的差额里有 27.2px 是一个
   **本仓库已经记录在案、并且已经写明一行 CSS 就能消掉**的渲染副产物（死空行盒）——
   它跟「块 vs 连续」没有关系，是 `white-space: break-spaces` 泄漏进 widget 的后果。
   叫它「固有」会让分诊时直接放过它。
2. **走偏的是屏幕那一侧，不是产物。** 产物走的是 `markdown.css` 原本的
   `margin: 1.6em 0 0.6em`——标题上方宽、下方窄，这是正常的排版。屏幕上却是
   上 33.6 / 下 60.8，**下方比上方还宽**，标题看起来是「浮」在下一段之上的。
   所以要对齐的话，该修的是屏幕，不是往产物里注入块间距（实现者说「往产物里注入
   `.cm-md-block` 那套间距只会让独立 HTML 变差」，这半句是对的）。
3. **用户看得出来。** 13.9 vs 60.8 是 4 倍，绝对差 47px 接近两行正文的高度，
   每一个标题下面都差这么多。屏幕上宽松、导出后紧凑，在「所见即所得」
   「屏幕与导出同源」是产品承诺的项目里，这是一个**用户一眼能看见的**违诺。
4. **本次不修是合理的**：`block-height.ts` 第 61–62 行明说「动那几行会让整套估算一起偏掉，
   而且不会有任何测试失败」，而那套估算是 Task 7/8 的高度图基础。这是真正的跨任务改动。

**结论：定性应从「固有差别、随 Task 6/8 产生」订正为「Task 6/8 引入的、机制已完全查明的、
可修的屏幕侧排版缺陷」，再进分诊清单。** 缺陷本身留到最终审查处理没问题，但标签必须换，
否则它会以「固有」为由被永久豁免。

---

## ⑤ 六组撤销验证的效力 —— 有效；我自己复刻了三组，另做了两组它没做的

### 我自己跑的（全部在还原后 `git status` 为空、全量 451 绿的前提下收工）

| # | 我撤销的东西 | 结果 | 与报告是否一致 |
| --- | --- | --- | --- |
| 1 | `renderOffscreen` 的 `eager` 改回 `false`（报告 D） | `1 failed / 4 passed`，红的是「Promise 落定时增强已经做完，包括视口外的代码块」，断言 `block.dataset['codeTheme']` 为 undefined | ✓ 一致 |
| 2 | `print.css` 两条 `#print-root` 顺序写反（报告 F） | `1 failed / 3 passed`，红的是顺序那条，`expected 16 to be less than 2` | ✓ 一致 |
| 3 | `exportHtml` 改回 `document.querySelector('.markdown-body')`（报告 A） | `3 failed / 34 passed`，三条与报告点名的完全相同 | ✓ 一致 |
| 4 | **（报告没做）** `enhance.ts` 的 `eager` 默认值改成 `true` | **451 全绿** | ✗ 零覆盖 |
| 5 | **（报告没做）** `drainQueue` 撤掉补启护栏，改成裸 `startDrain()` | **451 全绿** | ✗ 零覆盖 |

### 这些用例锁的是缺陷本身还是实现细节

锁的是**缺陷本身**，不是形状。三条证据：

- A 组那条 `useExport.test.tsx > HTML 产物包含整篇文档` 跑的是
  **真 `EditorViewProvider` + 真 `MarkdownEditor` + 真渲染管线**，三段源文本变成三个块 widget，
  并且**显式断言前提** `document.querySelectorAll('.markdown-body').length > 1`——
  把「缺陷成立的条件」先摆出来再断言产物，这是我见过的写法里最能防「测试跟着实现改」的一种；
- D 组那条靠一个**永不回调的 IntersectionObserver 替身**。实现者说得对：不装替身，
  代码块增强会走「没有观察器 → 全部直接排队」的降级路径，把懒加载整个绕开，
  撤销 eager 也测不出来。装替身才还原了真浏览器里「不进视口就不上色」的形状。
  断言的是 `dataset.codeTheme` 与 `.shiki` 数量——**产物有没有上色**，而不是「有没有调某个函数」；
- F 组那四条走 CSSOM 而不是正则，断言的是规则的结构与序号。

所以 A–F 这六组本身是扎实的。问题**不在已有的六组，而在它们没有覆盖到的第 4、5 组**：
「屏幕保持懒加载」和「在途补启护栏」——恰好是本次唯一触及共享路径的那个改动的两个关键面。

---

## 其余判断

### 超出简报范围的改动

只有一处：`src/hooks/useToolbarActions.ts:193`，打印按钮的 `disabledReason` 从
「尚未打开文件」换成与导出共用的 `exportDisabledReason`（导出期间置灰）。

**判定：合理，且是必须的。** 打印现在也要先跑一遍离屏渲染（1.2 秒量级），
不置灰的话连点两下会同时跑两趟整篇渲染 + 两趟全量 Shiki。理由写在旁边的注释里了，
报告第六节也如实列了。这不是 scope creep，是新行为的必要配套。

附带一个已知的体感问题（报告第七节第 8 条自己写了）：`window.print()` 是阻塞的，
`busy` 要等打印对话框关掉才复位，期间三个导出按钮一直灰着。行为正确，可接受。

### 注释的机制归因是否查证过

逐条核对了这次新写的几处硬归因：

| 注释里的断言 | 核实 |
| --- | --- |
| `offscreen-render.ts:36`：mermaid 不传容器时 `select("body")` 自己往 body 挂临时容器（`mermaid.core.mjs:1280`） | ✓ 我读了那一行，确是 `root = select("body")`，行号准确 |
| `code-block.ts:400-406`：`getObserver` 在 root 变化时 `disconnect()` 重建，而进过 `observed` WeakSet 的块不会再登记 | ✓ 代码即证：`getObserver` 第 91 行 `observer?.disconnect()`，`ensureObserved` 第 79 行 `if (observed.has(block)) return` |
| 同上第 408-411 行：**「第 2 条的后果实测下来是看不见的，别把这条当成修了什么缺陷」** | ✓ 这正是它推翻自己原归因后订正的那句。订正后的表述是准确的——它说的是「实测两边逐格相同」这个**观测事实**，并明确否定了因果结论。这是本次注释里我最认可的一处 |
| `print.css:12-15`：媒体查询不增加特异性 | ✓ 我用真 CSSOM 复现过（见 ③） |
| `block-cache`/一次性缓存、`no-print` 的理由 | ✓ 与 `block-cache.ts` 的既有不变量说明一致 |

**订正后的说法准确，没有发现新的「先有结论再倒编依据」。**

但发现一处**因本次改动而失效、却没跟着改**的旧注释，而且是要害位置：

> `src/export/dom-snapshot.ts` 文件头：
> 「导出 HTML 时不重跑一遍渲染管线，而是直接**快照屏幕上的 DOM**……
> 重跑管线不但慢，还得把这三段异步增强再等一遍，而且任何一处实现漂移
> 都会让「导出的样子」和「看到的样子」对不上——那正是导出功能最不该有的毛病。」
>
> 以及 `@param source 屏幕上的 `.markdown-body` 节点`

这段话现在**字面上描述的正是本次改动被否决的那条路**，而且它给出的反对理由
（「任何一处实现漂移都会让导出的样子和看到的样子对不上」）**恰恰就是判据 4 量到的那处差异**。
本次把架构翻过来了，却没有在这里留下一个字的回应。下一个读这个文件的人会得到一个
与代码完全相反的心智模型。在一个已经三次栽在注释归因上的项目里，这一条要补。

### harness 假阳性的诊断是否可信 —— **可信，我把机制核到了源码**

诊断是：窗口被遮挡 → Chrome 停 rAF → CodeMirror 不重算视口 → 滚动之后新块不挂载，
于是正反两组都读到「挂载 1 块」的相同数字，看起来像「改动无影响」，实则是环境噪声。

核实链条：
1. Chrome 确实有窗口遮挡检测，被遮挡窗口会暂停 rAF；这正是
   `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` 存在的原因；
2. **CodeMirror 的视口测量确实排在 rAF 上**：
   `node_modules/@codemirror/view/dist/index.js:8327`
   `this.measureScheduled = this.win.requestAnimationFrame(() => this.measure())`。
   rAF 停 → `measure()` 不跑 → 程序化滚动之后视口不更新 → 新块不挂载。

**机制成立，症状吻合，诊断可信。** 这条环境坑值得写进项目文档而不是只留在任务报告里。

一点技术更正：`--disable-features=CalculateNativeWinOcclusion` 是 **Windows** 侧的遮挡计算
开关，在 macOS 上不起作用（macOS 侧由 `--disable-backgrounding-occluded-windows` 覆盖）。
加着无害，但别以为是它起的作用。

**这条对前几轮的影响**：task-8c/8d/9 的实测里凡是「程序化滚动之后数挂载块 / 数上色块」
的观测，如果没加这几个 flag，结论的可靠性存疑。这不在本次审查范围内，但**建议进最终审查
的分诊清单**——尤其是任何得出「两组数据相同 ⇒ 改动无影响」结论的对照实验。

### 其他核查

- **零网络请求**：离屏渲染没有引入任何网络行为。整条管线是本地动态 import；
  `images.ts:75` 给所有图片加 `loading="lazy"`，而离屏宿主在 `left:-99999px`，
  浏览器不会去取；`css-collect` 只读本地 CSSOM。✓
- **TypeScript strict / lint**：`npm run verify`（typecheck + eslint + test）退出码 0。✓
- **注释密度与语言**：中文，讲「为什么」，与 `file-open.ts` / `chunker.ts` 同量级。
  `offscreen-render.ts` 的文件头、`code-block.ts` 的 `drainQueue` 说明、
  `print.css` 的顺序说明都达到了参照标准。✓
- **提交信息**：中文、分条、说清了病根与取舍、无署名尾注。✓
- **`prepareExportFragment` 是克隆**：`exportPdf` 塞进 `#print-root` 的是克隆，
  离屏树的所有权仍在 `dispose()` 手上，用例也锁住了这一点。✓
- **残骸清理**：`exportPdf` 开头先 `document.getElementById(PRINT_ROOT_ID)?.remove()`，
  防 `afterprint` 没来时叠成两份，有用例。✓

### 一处新暴露、报告没覆盖的风险：打印含图片的文档

`prepareExportFragment` 会**移除克隆里的 `loading` 属性**（`dom-snapshot.ts:56`，
理由写的是「避免打印时图片来不及加载而印成空白」）。旧实现里这不成问题——被打印的是
屏幕上**已经加载完**的 DOM。现在 `#print-root` 是一棵全新的克隆，它的图片从零开始加载，
而 `window.print()` 在下一行就调用了。离屏那棵树的图片因为 `loading=lazy` + 挪出视口
**一张都没加载过**，所以这些图片是冷的。

判据 2 的实测文档只含 Mermaid（内联 SVG）/ KaTeX / 代码块 / 表格，**没有 `<img>`**，
所以这条没被验到。导出 HTML 不受影响（序列化的是 src 属性）。
需要一次「打印一篇含远程/本地图片的文档」的实测来确认或排除。

---

## 结论

### 1. 规范符合性：✅

- 简报的全部 8 步都落到位；
- 三处已披露的偏离（渲染器要自己引导、`enhanceBlock` 实际 5 参且需加第 6 参、
  `ExportContext` 拆成两层）**都是必要的**，理由与实际代码对得上，不计为 ❌；
- 简报 Step 6 的 `print.css` 片段确实是错的，实现者的订正正确且有用例锁住，
  这属于「修正简报错误」而不是偏离；
- 超出简报的 `useToolbarActions` 改动是新行为的必要配套，已披露，合理；
- `npm run verify` 绿，注释规范、零网络、提交信息规范全部满足。

**一处保留**：判据 4「导出产物的样式与屏幕上一致」**并未完全达成**（标题下方留白
13.9 vs 60.8，4 倍）。因成因在 Task 6/8、修它要动高度图，本次不修是合理的，
故不计为 ❌，但**定性必须订正**（见 ④），并带着订正后的标签进分诊清单。

### 2. 任务质量：批准

核心改造是正确的、实测是扎实的、自我推翻那条错误归因的诚实度值得肯定。
下列 Important 项应在最终审查前处理。

#### Critical
（无）

#### Important

1. **`drainQueue` 的补启护栏零覆盖** — `src/plugins/builtin/code-block.ts:331-334`。
   我撤掉护栏，451 条全绿；而我用隔离复现证明了这个竞态**真实存在**
   （上一轮 drainLoop 已结束、复位回调未执行的那一刻，导出会拿到没上色的代码，静默）。
   这是本次最微妙的正确性增量，需要一条用例——可以用可控的时序替身直接测
   `startDrain/drainQueue` 的时序骨架，不必走真管线。
2. **「屏幕保持懒加载」零覆盖** — `src/editor/enhance.ts:33`。
   把默认值翻成 `eager = true` 全绿。需要一条锁住「非 eager 调用不等队列排空」的用例。
3. **`src/export/dom-snapshot.ts:1-12, 38` 的文件头注释已被本次改动推翻，却没改**。
   它现在字面描述的是与代码相反的架构，并且它反对的理由恰好命中判据 4 的实际差异。
   要么改写，要么在原处写明「这条取舍在 Task 10 被推翻，原因是…」。
4. **判据 4 的定性错误** — 应从「固有差别」订正为「可修的屏幕侧缺陷」，
   并把我查到的机制（`block-height.ts:53-56, 83-86` 的死空行盒，27.2px）写进分诊条目，
   否则它会被当成「不可修」永久豁免。
5. **手势余量的边界没写死，且超时后的失败是静默的** — `src/hooks/useExport.ts:30-38`。
   注释的判据「保存对话框弹不出来」在 `download.ts:71` 的 SecurityError 降级面前
   用户观察不到：文件照样保存成功、提示照样是「已导出」，只是悄悄落进下载目录。
   建议：(a) 注释里写清三类吃掉余量的场景（文档 >~800KB / 慢机器 / Mermaid 密集），
   (b) 考虑在走了 SecurityError 降级路径时给一个不同的提示文案。
6. **打印含图片的文档未验证**（见上一节），需要一次实测。

#### Minor

7. `code-block.ts:315-318`：`drainLoop().then(reset)` 应为 `.finally(reset)`。
   现在若 `drainLoop` 拒绝，`draining` 永久卡住 rejected Promise，全站代码块不再上色。
   `.finally` 同样满足注释里「先复位后落定」的次序要求。
8. `code-block.ts:293-296`：批内失败的块已从队列删除，不会重试，eager 路径会静默
   少上色几块。至少在 warn 里带上块数。
9. `code-block.ts:400-412` 的长注释里，第 2 条（「等于被永久摘掉了观察」）的**后果**
   已被它自己的实测否定，紧跟着的第三段也写明了这一点——但第 2 条本身仍然用肯定语气
   陈述了一个看不见的后果。建议把两段合并，避免下一个读者只读到第 2 条。
10. 报告第五节「`export.test.ts` +8 条」实际是 7 条（总数 21 正确）。
11. `--disable-features=CalculateNativeWinOcclusion` 是 Windows 侧开关，在 macOS 上无效，
    报告把三个 flag 并列成「必须加」略有误导。
12. 实测残留未清：`/var/folders/.../T/md-reader-cdp-*` 仍有 **29 个目录**（无残留进程）。
    报告已披露且给了命令，需人工执行。

---

## ⚠️ 未能验证

1. **没有起真实 Chrome 复跑任何一条判据。** 判据 1–4 的浏览器实测数字（产物 20/20、
   打印媒体下 `.cm-editor` display:none、点击→picker 1.2 秒、手势反向对照）
   我只做了**设计合理性与机制合理性**的审查，没有独立复现。三条撤销实验、
   CSS 层叠、race 复现、mermaid 与 CodeMirror 的源码核对都是我自己跑的，
   但**它们都不覆盖「真浏览器里对话框真的弹出来了」这一步**。
2. **跨源 iframe 下的打印**：与报告边界相同，本地 harness 是同源，复现不了。
3. **`file://` 场景**：全部实测（含实现者的）跑在 http 上。
4. **打印含 `<img>` 的文档**（上文 Important 6）：机制上有疑点，未验。
5. **前几轮（task-8c/8d/9）实测的可靠性**：本轮发现的 rAF/遮挡陷阱可能影响那几轮里
   所有「滚动后数块」的观测。我没有回溯核查，建议进最终审查分诊。
6. **10MB 量级文档下的手势预算**：只有外推（基于本仓库 `chunker.ts:4` 的 7.5s 数字），
   没有实测。

---

## 审查过程的清理

- 五次撤销实验全部还原，`git status --porcelain` 为空，`git diff --stat` 为空；
- 还原后重跑全量：**45 文件 / 451 用例全绿**；
- 未修改任何生产代码，未派发子代理，未起浏览器进程；
- 临时脚本（`cascade.mjs` / `race.mjs` / verify 日志）留在会话 scratchpad 内，
  不在仓库中。
