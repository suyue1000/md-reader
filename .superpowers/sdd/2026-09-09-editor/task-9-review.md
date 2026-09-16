# Task 9 审查：查找改用 CodeMirror 源文本搜索

审查对象：`1d2eac2..dafaf23`（9 文件 / +833 −312）。
审查方式：读全部相关生产代码 + 独立复跑 `npm run verify` + 独立做了三次撤销对照实验。
**未做真实浏览器实测**（见文末「未能验证」）。

---

## 〇、独立复核基线

```
npm run verify → EXIT=0
Test Files 42 passed (42)     Tests 428 passed (428)
```

与报告一致。工作树在审查前后均为 clean，未修改任何生产代码（撤销实验用
scratchpad 备份 + `cp` 还原，非 `git checkout`）。

提交信息中文、无署名尾注；`src/search/**` 与 `useSearch.ts` 内无任何网络调用。

---

## 一、三处偏离，逐条独立判断

### ① 不用 `search({top:true})` + `highlightSelectionMatches()`，改为自写 313 行 —— **偏离成立且必要，不计为 ❌**

**论断核实：成立。** 证据链在 `src/editor/live-preview.ts`：

- `buildDecorations`（`live-preview.ts:132`）对每个非 trailing 块产出
  `Decoration.replace({ widget: new BlockWidget(...), block: true }).range(from, to)`
  （`live-preview.ts:148-150`），`from` / `to` 取自 `block.startLine+1` 到 `block.endLine`
  的整行区间。
- 只读态下 `EditorView.editable` 为 false → `selection = null`（`live-preview.ts:122-129`）
  → `visibleBlocks` 直接 `return blocks`（`live-preview.ts:40`），即**所有块**都被
  `replace` 掉，没有「光标所在块让出源码」这个例外。

因此屏幕上不存在任何被渲染的源码字符，`Decoration.mark` 型高亮（
`highlightSelectionMatches()` 与 CM 搜索面板的全量命中高亮都是这一类）确实一个像素
都画不出来。加 `search()` / `highlightSelectionMatches()` 是纯死重量，且会误导后来人
以为高亮归 CodeMirror 管。**实现者的判断正确，自写高亮是必要的而非偏离。**

一处需要补充的边界（不影响结论）：块与块之间的空行、以及被
`live-preview.ts:145` 行号越界守卫跳过的块，其源码文本**不**在 replace 之下，理论上
CM 的 mark 在那里可见——但那些行没有可见正文，结论不变。

**`SearchQuery.getCursor(state)` 不需要 `search()` 扩展**这一点也属实，
`MarkdownEditor.tsx` 一个字没改是自洽的。

#### `block-highlight.ts` 本身的设计评估

| 维度 | 结论 |
| --- | --- |
| CSS Highlight API vs 插 `<mark>` | **正确**。`block-cache.ts:117-120` 确认块 DOM 按 key 复用并打 `data-block-key`，插标签会把搜索痕迹焊进缓存、并污染 `export/dom-snapshot.ts` 直取屏幕节点的导出产物 |
| 按块建索引 | **正确**，是唯一可行的做法。旧实现的 `document.querySelector('.markdown-body')` 确实只取第一块——`block-cache.ts:117` 给每个块设的类名正是 `'markdown-body cm-md-block'`，缺陷属实 |
| 索引失效时机 | **正确，且是最安全的一档**：索引根本不缓存，每次重画从 DOM 现建。牺牲 CPU 换「不存在陈旧索引」这个性质。考虑到失效来源有三种（块挂载/卸载、Shiki 换 DOM、Mermaid 出图），缓存的收益远小于风险，这个取舍合理 |
| MutationObserver 频率 | **只读态下可接受**。rAF 合并；重画只走 `CSS.highlights`，不碰 DOM，不会自触发（已核对 `paintBlockHighlights` 全程只调 `CSS.highlights.set/delete` 与 `ensureHighlightStyle`，后者写的是 `document.head`，不在被观察子树内）。单次重画成本 = 挂载中的块数（实测 6~8）× TreeWalker + `indexOf`。**打字场景未验证**：`characterData: true` 会让编辑态下每一帧都对每个挂载块全量重建索引，见 Minor-2 |
| 内存 / Range 泄漏 | **无泄漏**。Range 每次重画重建，旧的随 `CSS.highlights.set` 被替换后可回收；`clearHighlights()` 在 effect cleanup 里执行，覆盖卸载与关闭查找条两条路径（`SearchBar` 关闭时返回 null 但 hook 仍在跑，`reset()` 也会清）。同时注册的 Range 数受「挂载块数」限制，不是「命中总数」，实测 60~90 |

### ② 简报的对外字段名是错的 —— **确认；实现者一个字段名都没改**

`git show 1d2eac2:src/hooks/useSearch.ts` 的 `SearchApi` 为
`query / setQuery / total / current / truncated / go / reset`，简报第 11 行写的
`count / next / previous / close` 在代码里从未存在。新 `SearchApi`（`useSearch.ts:36-50`）
逐字相同。`SearchBar.tsx` 的整份 diff 只有一行：`@/search/highlight` →
`@/search/block-highlight`。**结构、解构列表、渲染全部未动。**

### ③ `SearchBar` 移进 `EditorViewProvider` —— **理由属实，无副作用**

- 理由核实：`EditorContext.tsx` 的 view 是 provider 自己的 `useState`，
  `useEditorView()` 在 provider 之外只能拿到 `createContext` 的默认值 `null`。
  而 `useSearch` 在 `view` 为 null 时 `findSourceMatches` 根本不跑
  （`useSearch.ts:135`），`total` 恒为 0 → `SearchBar` 的计数区渲染成空串
  （`query !== ''` 且 `total === 0` 时显示「无匹配」……**修正**：会显示「无匹配」而不是空白，
  报告说的「计数永远空白」略有出入，但「静默哑掉」的实质成立）。
- 副作用检查：
  - **渲染顺序**：`<SearchBar />` 现在排在 `<AppShell>` **之后**、provider 之内。
    React 的 effect 按子树完成顺序执行，因此 `MarkdownEditor` 的 effect（在 AppShell 子树里）
    先于 `SearchBar` 的 effect 跑完——这对「store 的 content 变了、view 的 doc 还没变」
    这类竞态是**有利**方向，不是隐患。
  - **provider 生命周期**：provider 自己持有状态，子节点增减不影响它；
    `SetEditorViewContext` / `EditorViewContext` 两层拆分保持不变，`SearchBar` 只订阅读侧。
  - **兄弟关系**：`SearchBar` 仍在 `AppShell` 之外（全局浮层，`fixed top-12 right-3 z-40`），
    与 `SettingsDrawer` / `Toast` 的相对顺序未变，无层叠上下文变化。
  - 唯一新增行为：`SearchBar` 现在会随 view 变化重渲染。这是功能所必需的。

---

## 二、`markNavigation` 接线 —— **保住了，且经独立撤销实验确认**

我自己做了撤销对照（非采信报告）：删掉 `useSearch.ts:189` 那一行后
`npx vitest run src/hooks/useSearch.test.tsx` → **2 failed / 4 passed**，
失败的正是 `跳到命中处时记一次显式导航` 与 `按下一处再记一次导航`，与报告一致。

接线是真的载荷：`useReadingPosition.ts:176-185` 的 `isDisarmed()` 现读
`navigationEpoch` 与本次打开的基线比对，`onEnhanced`（`useReadingPosition.ts:373-383`）
据此放弃校正。基线只在 `openEpoch` 变化时重置（`useReadingPosition.ts:158`）。

### 三条判定标准逐条对照

| 判定 | 结论 |
| --- | --- |
| 1. 起因是用户的一次明确操作 | **基本满足，有一处例外**。跳转 effect 的依赖是 `[view, matches, current, active, debounced]`，而 `matches` 在 `content` 变化（文件监听自动刷新）或 `view` 重建（换文档）时也会重算并把 `current` 归零 → 会触发一次非用户发起的跳转 + `markNavigation`。这是**页面自己的时序**，严格讲违反第 1 条。但旧实现以 `documentId:renderProgress.done` 为键，同一形状且触发更频繁（分块渲染每完成一块就来一次），**不是本次引入的回归**。见 Minor-4 |
| 2. 它真的把视口带到别处 | **满足，且确实收窄了**。`useSearch.ts:168-172` 先取渲染侧 Range，完整落在可视区内就 `return`。`viewportBounds()`（`useSearch.ts:60-71`）不用 `view.scrollDOM` 的理由已核实为真：`editor/theme.ts:34` 确实把 `.cm-scroller` 设成 `overflow: 'visible'`，注释描述准确。例外：`activeMatchRange` 返回 null 时（纯语法标记命中、或块列表未就绪）无条件滚+记，此时可能白撤一次防。见 Minor-3 |
| 3. 落点是我们自己算出来的 | **满足**。`EditorView.scrollIntoView(match.from, { y: 'center' })`，落点由源码偏移算出 |

时序论断（必须在同一同步流程里记，不能等 `scroll` 事件）与
`useReadingPosition.ts:163-175` 的文件注释完全一致，注释归因准确。

---

## 三、两类不对齐 —— **可接受，如实注释即可**

- **只匹配语法标记（`**粗体**` → 计数 1、高亮 0）**：不建议让计数也跳过。
  要让计数跳过，就得知道「哪些源码字符不参与渲染」，那正是实现者明确拒绝的
  「源码偏移 → 渲染偏移」映射（`matcher.ts:110-118` 说明了 markdown-it 的 token
  只带行号、不带行内字符偏移）。而且跳转仍把那一块带进视口，用户不会被困住。
- **Mermaid 图内标签（计数但不画）**：同理，让计数跳过等于让**计数依赖渲染结果**，
  而「渲染结果只有一屏」正是本次要修的根因——那会把刚修好的缺陷换个形状装回去。

两类都已写进 `block-highlight.ts` 的文件注释与 `SHADOW_SELECTOR` 上方，
并各有用例锁住（`查的是源文本：语法标记本身可以被搜到`、`跳过 SVG 内的文字`）。
**结论：如实注释即可，不需要额外处理。**

---

## 四、撤销验证的效力：锁的是缺陷还是实现细节

独立复现了两组：

| 撤销 | 我的复现 | 锁的是什么 |
| --- | --- | --- |
| A. 删掉 `markNavigation()` | **2 failed / 4 passed**（与报告一致） | **缺陷本身**。断言是 store 的 `navigationEpoch`，即对外可观察的契约，不是调用方式 |
| C. `querySelectorAll` → `querySelector` | **1 failed / 5 passed**（与报告一致） | **缺陷本身**，而且是原缺陷的原形：「只画第一块」 |
| B / D | 未复现，形状可信（B 断言 painted 数、D 断言跨块计数） | 缺陷本身 |

反向对照用例（`命中已经在视口里时不记导航`）在撤销 A 后仍绿，我在复现 A 时确认了
——它确实排除了「A 组变红只是因为根本没人调 store」这个解释。

### ⚠️ 但有一处**没有被任何用例锁住**（见 Important-1）

我做了第三次撤销：保留 `MutationObserver` 的构造、只删掉 `observer.observe(...)`
那一行（即彻底停掉「随块挂载/增强重画」这个机制）：

```
npx vitest run src/hooks/useSearch.test.tsx src/search/search.test.ts
→ Test Files 2 passed (2)   Tests 29 passed (29)
```

**全绿。** 而「重画」恰恰是新实现相对旧实现最核心的正确性机制（报告第三节那张
60→90→60 的对账表验的就是它）。jsdom 没有布局、没有滚动、不会发生块的挂载/卸载，
所以任何单测都碰不到它。

---

## 五、注释准确性逐条核对

核对了本次新增/修改的全部注释归因。**两处不达标：**

1. `block-highlight.ts` 的 `SHADOW_SELECTOR` 注释称 KaTeX 的 MathML 影子
   「其中一遍还落在 **`display: none`** 的节点上」。查证 `node_modules/katex/dist/katex.css:159-163`：
   `.katex .katex-mathml` 用的是 `position: absolute` + `clip-path: inset(50%)`
   的无障碍隐藏手法，**不是 `display: none`**。结论（跳过）正确，机制归因错误。
   这正是本项目栽过两次的那种错误形状。
2. 同一段注释称跳过 `svg` 的理由是「Mermaid 为量文字宽度会再渲染一份隐藏的标签，
   一处源码命中会被画成两处」。报告第一节的实测只给了**开启跳过之后**的结果
   （5 处源码命中、画出 4 处），**没有任何「不跳过 → 画成两处」的测量**。
   这条因果是断言，不是查证。

其余注释均核对属实，尤其：
- `viewportBounds` 关于 `.cm-scroller { overflow: visible }` 的说明 → `theme.ts:34` 属实；
- `useGlobalHotkeys` 新注释「`mod+f` 由工具栏动作带进来、无文档时停用、快捷键让位给浏览器」
  → `useToolbarActions.ts:170-179`（`hotkey: 'mod+f'`、`disabledReason: hasDocument ? undefined : '尚未打开文件'`）
  + `useGlobalHotkeys.ts:28`（`enabled: action.disabledReason === undefined`）
  + `useHotkeys.ts:49-52`（未命中就不 `preventDefault`）三处印证，**准确**；
  并且它订正的旧注释（「注意 `Ctrl+F` 没有被注册……要到 Phase 10」）在 `1d2eac2` 时
  就已经是错的（那时 `mod+f` 已存在），属于订正陈旧注释，不是新增偏差。
- `matcher.ts` 的 `literal: true`、Unicode 折叠两条说明与代码一致，且各有用例。

---

## 六、超出简报范围的改动

- `useGlobalHotkeys.ts`：**只改注释**，订正的是与查找直接相关的陈旧陈述。可接受。
- `viewer/App.tsx`：`SearchBar` 移位，属已披露偏离 ③，必要。
- 新增 `block-highlight.ts`：属已披露偏离 ①，必要。
- **无**其他生产代码改动，无新依赖，无网络调用。

---

## 七、行为变化是否写明

「搜『是粗体』在 `这是**粗体**字` 上落空」，**三处写明**：
`matcher.ts:110-118` 的 `countMatches` 注释（正反两个方向都写了）、
`search.test.ts` 的 `查的是源文本：语法标记本身可以被搜到`（把 `是粗体` → 0 锁进断言）、
以及提交信息末段。**达标。**

---

## 八、问题清单

### Critical
无。

### Important

**I-1. 「随块挂载/增强重画」这个新机制没有任何用例锁住** — `src/hooks/useSearch.ts:200-231`

删掉 `observer.observe(...)` 一行，428 条用例全绿（我实测：两个搜索测试文件 29/29 通过）。
这个机制是本次相对旧实现的核心增量，一旦被后来人当成「多余的优化」删掉，
表现将是「滚一屏高亮就断了」，而 `npm run verify` 依旧全绿——正是本项目栽过六次的形状。
报告的四组撤销（A/B/C/D）都没有覆盖它。

建议（不阻塞合并）：在 jsdom 里手工制造一次块 DOM 变更（例如渲染完成后
`block.appendChild(document.createTextNode('命中'))` 或摘掉再挂回一个块节点），
等一帧后断言 `paintedCount()` 跟着变。这不需要真实滚动，只需要一次 MutationRecord。

**I-2. 注释归因未查证两处** — `src/search/block-highlight.ts:118-128`（`SHADOW_SELECTOR`）

见第五节。`display: none` 一句与 katex.css 实际不符（应为 `position:absolute` +
`clip-path: inset(50%)`）；Mermaid「不跳会画成两处」缺少实测支撑。
按项目对注释准确性的要求，这两处应订正或降级为「未实测的推断」措辞。

### Minor

**M-1. 编辑态下 `characterData: true` 的重画开销未验证** — `useSearch.ts:222`
只读态下块内容只在增强时变，rAF 合并后可接受；编辑态一旦接上，每次按键都会产生
characterData 变更 → 每帧对所有挂载块全量重建 TreeWalker 索引。报告第七节已把
「编辑态未验证」列为遗留，此处补一条具体的关注点。

**M-2. `activeMatchRange` 返回 null 时无条件滚 + 记导航** — `useSearch.ts:168-190`
纯语法标记命中（`**`、`](`）与「块列表尚未就绪」两种情形都会走到这里。前者是刻意取舍
（把那一块带进视口是最好落点），但即使目标块**已经完整在屏幕上**也会记一次导航，
违反「没真的滚就不要记」。代价是白撤一次阅读位置恢复。

**M-3. `locateActive` 返回 null 时不画「当前命中」层** — `block-highlight.ts:265-270`
命中落在块与块之间的空行、或 `blocksField` 尚未填充时，`active` 为 null，
`md-search-current` 层被 delete，用户看不出「当前是哪一处」，且是静默的。

**M-4. 自动刷新 / 换文档会触发一次非用户发起的跳转** — `useSearch.ts:130-144`
`content` 变化（文件监听刷新）或 `view` 重建都会重算 `matches` 并把 `current` 归零，
随后跳转 effect 把视口带到第 1 处命中并记一次导航。旧实现同形状且更频繁，
**不是本次回归**，但值得在未来收敛（例如刷新后保留 `current`、或只在用户操作时归零）。

**M-5. 只有 1 处命中时「下一处」不再回中** — `useSearch.ts:238-243`
`stepIndex(0, 1, 1) === 0`，`setCurrent` 同值 → React bail out → 跳转 effect 不重跑。
用户滚走之后按「下一处」纹丝不动。

**M-6. `countMatches` 在生产代码里没有调用方** — `matcher.ts:120`
只被 `search.test.ts` 用。它是简报 Step 2/4 硬性要求的 API，也承担了「源文本行为变化」
这段说明的落点，保留可以理解；但严格讲是导出的死代码。

**M-7. 活动块的 `rangesInBlock` 每次导航算两遍** — `useSearch.ts:168` 与
`block-highlight.ts:290`。纯浪费，不影响正确性。

---

## 九、两个独立结论

1. **规范符合性：✅**
   三处偏离全部经独立核实为必要（①：`live-preview.ts` 的 `Decoration.replace({block:true})`
   使 CM 的 mark 高亮不可见，论断成立；②：简报字段名确为事实错误，实现者按代码实际
   保持七个字段一字未改；③：provider 作用域问题属实，移动无副作用）。
   简报未覆盖的部分（删 `highlight.ts`、保 `SearchBar` 结构、保 `markNavigation`）均已满足。

2. **任务质量：批准**
   无 Critical。两条 Important 都不阻塞功能正确性：I-1 是回归网的缺口（机制本身经浏览器
   实测有效），I-2 是注释归因。建议合并前顺手补 I-2 的注释订正，I-1 可作为跟进项。

---

## ⚠️ 未能验证

1. **真实浏览器行为全部采信报告**：本次审查未启动 Chrome，报告第三节的四条判据
   （高亮逐项对账 60/90/60、20 处命中的跳转与回绕、7 格延迟扫描与撤销对照 8955 vs 17）
   我只做了**结构上的可信性核对**（代码路径与所述现象一致），未独立复现。
2. **Mermaid「不跳过 svg 会画成两处」未验证**（见 I-2）。
3. **编辑态、`file://` 场景、真实 `chrome.storage`、10MB 级大文档重画开销**均未验证，
   与报告第七节自述的边界一致。
4. **`truncated`（5000 上限）路径未验证**：命中超 5000 时 `current` 可能指向被截断之外
   的位置这类边界没有用例，也未实测；沿用旧值，不是本次引入。
