# Task 8 报告：目录跳转与滚动同步改为行号定位

## 一、做了什么

### 1. 行号进入类型系统

- `src/types/document.ts`：`TocNode` 增加 `line: number`。
- `src/markdown/toc.ts`：`FlatHeading` 增加 `line: number`；`collectHeadings` 从
  `token.map?.[0] ?? 0` 取行号；`buildTocTree` 透传。
- 新增纯函数 `activeHeadingAt(flat, line)`：在展平目录里二分查找「行号不大于 line 的
  最后一个标题」。抽出来是为了能脱离 CodeMirror 单测——它就是滚动同步的判据本身。

### 2. 收敛重复的标题类型（必做三）

`src/editor/block-render.ts` 里的 `LineHeading` 与 `collectLineHeadings` 已删除，
改为 `import { collectHeadings, type FlatHeading } from '@/markdown/toc'`，
`BlockRenderResult.headings` 改为 `readonly FlatHeading[]`，
`MarkdownEditor` 的 `onHeadings` 签名同步改成 `readonly FlatHeading[]`。

`block-render.test.ts` **不需要改**：它只按结构断言 `headings.map(h => [h.text, h.line])`，
没有引用过 `LineHeading` 这个名字。已确认现有用例原样通过。

`toc.ts` 里 `extractText` 的注释改了——原注释说「导出给编辑器的带行号标题收集器复用」，
那个收集器已经不存在了。

### 3. 滚动同步（Step 4，坏功能 1）

`src/hooks/useScrollSpy.ts` 从 `useScrollSpy(contentKey: string)` 改为
`useScrollSpy(view: EditorView | null)`，IntersectionObserver 整套删除，改为
「视口顶行 vs 标题行号」。

### 4. 目录点击（Step 5，坏功能 2）

- 新增 `src/editor/EditorContext.tsx`。
- `TocItem` 的 `onSelect` 改为 `(id, line) => void`。
- `TocPanel.handleSelect` 改为 `scrollToLine(view, line)`，不再 `querySelector`。

### 5. `usePendingAnchor` 迁移（必做一）

改为 `usePendingAnchor(view: EditorView | null)`，从 store 的 TOC 里按锚点 id 查行号，
调 `scrollToLine`。

### 6. 临时桥拆除（必做二）

`ReaderPage.tsx` 的 `renderToken`、`contentKey` 以及那段「这是一座**临时桥**」注释
**已全部删除**。拆完后全仓库 `grep -rn "renderToken\|contentKey\|临时桥" src/` 只剩
三处无关命中：`plugins/builtin/mermaid.ts` 的 `self.renderToken`（markdown-it API）、
`hooks/useMarkdownRender.ts` 的 `rerenderToken`（旧渲染路径自己的状态）、
`hooks/useSearch.ts` 自己定义的 `contentKey`（基于 `renderProgress`，与本桥无关）。
**没有发现别的消费者。**

---

## 二、对简报的调整，以及为什么

### 调整 1：滚动判据不读 `view.scrollDOM.scrollTop`

简报写 `view.lineBlockAtHeight(view.scrollDOM.scrollTop)`。这是错的：滚动容器是
AppShell 的 `<main>`，`.cm-scroller` 的 overflow 是 visible，`scrollDOM.scrollTop`
恒为 0。改成与 `useReadingPosition` 同一套换算：

```ts
heightInDocument(container.getBoundingClientRect().top + 偏移, view.documentTop)
```

### 调整 2：不用 `EditorView.updateListener`，用容器 scroll + ResizeObserver

简报要求监听 `updateListener` 的 `geometryChanged`。但扩展只能在创建编辑器时装配，
而 hook 是外部拿到 view 之后才介入的，事后加扩展要 `StateEffect.appendConfig`，
比问题本身重。真正要感知的是两件事：容器滚动（`scroll` 事件）和编辑器高度变化
（`ResizeObserver` 观察 `view.dom`，覆盖 widget 挂载、Shiki 上色、Mermaid 出图）。
两者都 rAF 节流，每帧只做一次 `getBoundingClientRect` + 一次二分，与标题数量无关。

配套：`src/test/setup.ts` 补了一个空壳 `ResizeObserver`（jsdom 没有实现）。

### 调整 3：EditorContext 不是简报里那两行

简报给的是裸 `createContext` + `EditorProvider = Context.Provider`，但没说状态由谁持有。
侧栏与正文是 AppShell 里的**兄弟子树**，view 由正文创建、侧栏消费，状态必须在
AppShell **之上**。所以做成一个自己拿 `useState` 的 `EditorViewProvider`（挂在
`App.tsx` 里包住 AppShell），配一读一写两个 context：`useEditorView` / `useSetEditorView`。
拆成两个 context 是为了让「只写方」（ReaderPage 交出 view）不因为读而订阅上变化。

view **没有**进 Zustand，理由按简报所述（不可序列化的宿主对象）。

### 调整 4：删掉了「顶部 25% 窄带」

旧实现有 `SPY_BAND_RATIO = 0.25`，是为了压住 IntersectionObserver 的抖动。行号判据
对滚动位置单调，本来就不抖；留着窄带反而会让「点目录跳到某个短章节」之后高亮当场
蹦到下一节。已删除，换成 2px 的次像素余量（见下文缺陷 A）。

### 调整 5（简报没提，但必须做）：`collectHeadings` 加 `lineOffset`

`renderer.ts` 的分块渲染是**逐块独立 parse** 的，`token.map` 只是块内行号。给
`FlatHeading` 加 `line` 之后，不补偏移的话第二块之后的标题行号会退回从 0 重新计数。
虽然分块路径（`useMarkdownRender` / `MarkdownView`）当前已不被 ReaderPage 使用，
但既然收敛成了一份类型，就不能让它产出撒谎的字段。`collectHeadings(tokens, lineOffset = 0)`，
`createSession` 按块累加行数算出偏移。加了回归测试。

### 调整 6（简报没提）：`setDocument` 顺手清 `pendingAnchor`

见下文缺陷 C。

---

## 三、实测中发现并修掉的三个缺陷

这三个都是 `npm run verify` **全绿**的情况下、在真实浏览器里才暴露的。

### 缺陷 A：点目录跳过去，高亮停在上一节

**现象**：点「第 9 章」，正文确实跳到了第 9 章，侧栏却高亮「第 8 章 小节」。

**测量**：跳转落定后量 `.cm-md-block` 顶边相对容器顶边的距离，稳定是 **+4.5 ~ +5.2px**。

**根因**：CodeMirror 的 `EditorView.scrollIntoView` 默认 `yMargin = 5`，目标行会停在
容器顶边**下方** 5px，于是按顶边取到的是上一个块。

**修法**：`scrollToLine` 显式传 `yMargin: 0`（`MarkdownEditor.tsx`）。这同时修掉了阅读
位置恢复里同一个 5px 偏差——它是在 `scrollToLine` 之上再叠行内偏移的。
另外在 spy 里留 `SPY_PROBE_OFFSET_PX = 2` 吞掉浏览器把 `scrollTop` 夹到整数像素的
四舍五入（与 `useReadingPosition` 的 `SCROLL_TOLERANCE_PX` 同一类余量）。

**修后测量**：落点从 +5.2px 变成 +6.1px 的**标题元素**位置（块顶边对齐），全部 27 项
点击高亮正确。

### 缺陷 B：文档末尾的章节在目录里永远点不亮

**现象**：点最后一节，正文滚到底了，但那一节的标题距顶边还有 14.5px，高亮落在它的上一节，
而且怎么滚都回不来——`scrollTop === scrollHeight - clientHeight`，已经没有余量了。

**修法**：`useScrollSpy` 加「到底特例」——滚到底时改用视口**底边**做探测点，把最后一屏里
最后一个标题算作当前位置。附带 `scrollTop > 0` 条件，否则整篇比视口还短的文档会变成
「无论看哪儿都高亮最后一节」。

**残留**：`fixtures/sample.md` 最后两个标题（「九、重复标题测试」与它的去重副本）挤在同一屏里，
点前一个会高亮后一个。

> **措辞更正（第 1 轮修复循环）**：初稿这里写的是「严格优于修之前」，这不准确，已改正。
> 到底规则是**取舍，不是全面改善**：自然滚到底、正在看倒数第二节时，修之前按顶边算出来的
> 高亮 H_k 其实是**对的**，修之后一律变成最后一个标题。换来的是末尾章节从「永远无法高亮」
> 变成「可达」。我认为这一边更值，但代价是实打实的，不该写成没有代价。

### 缺陷 C：带锚点**换文档**时，锚点被提前吃掉，永远停在文档顶部

**现象**：冷启动带锚点正常；已经打开一篇文档后再打开 `另一篇.md#某标题`，
`pendingAnchor` 被清掉了，但 `scrollTop` 全程是 0（用 rAF 逐帧采样确认，从头到尾没动过）。

**根因**：本仓库旧 `useScrollSpy` 的注释里其实已经写过这个坑——Zustand 走
`useSyncExternalStore`，`setToc` 会**同步冲刷一次渲染**。换文档时那一帧的组合是
「目录已经是新文档的、context 里的 view 还是上一篇文档**已经销毁**的实例」。
`usePendingAnchor` 在这一帧能查到目标行号，于是对着死掉的视图 dispatch——
CodeMirror 静默无视，而锚点已经被当成「跳过了」清掉。

**修法**（两层）：

1. `useEditorView()` 统一过滤失效实例：`view?.dom.isConnected === true ? view : null`。
   CodeMirror 的 `destroy()` 会把根节点从文档里摘掉，所以这是准确的存活判据。
   放在 context 里而不是各消费方各判一次——`useScrollSpy` / `useReadingPosition` /
   `TocPanel` 面对的是同一个陷阱。
2. `usePendingAnchor` 增加 `toc.length === 0` 时**什么都不做**（尤其不清锚点）的门槛；
   配套让 `setDocument` 清 `pendingAnchor`，这样「文档一个标题都没有」时残留的锚点
   不会漏到下一篇文档上被莫名兑现。

**回归测试**：`src/editor/EditorContext.test.tsx` 两个用例锁住存活判据。

---

## 四、验证命令与实际输出

### `npm run verify`

```
> tsc --noEmit
> eslint .
> vitest run

 Test Files  32 passed (32)
      Tests  293 passed (293)
   Duration  1.62s
```

（改动前基线为 31 files / 291 tests；新增 `EditorContext.test.tsx` 2 个用例，
`toc.test.ts` 新增 5 个、`renderer.test.ts` 新增 1 个，另有若干现有用例补 `line` 字段。）

### 新增/改动的测试

- `toc.test.ts`：`折叠成树时保留行号`；`activeHeadingAt` 五个用例（取最后一个不大于目标的、
  远超末尾仍停在最后一节、落在第一个标题之前返回 null、空目录返回 null）。
- `renderer.test.ts`：`跨块的标题行号仍然是整篇文档的行号`——断言逐块渲染出的行号序列
  与源码里 `## ` 出现的实际行号**逐个相等**，不只是递增。
- `EditorContext.test.tsx`：存活判据两个用例。

---

## 五、两个坏功能的实测结果

实测环境：`npx vite --port 5199` 起真实 dev server，Chrome（Playwright MCP 驱动），
视口 1280×800，`<main>` 可视高 730px。零新增依赖、零网络请求（页面本身仍不发任何外部请求）。

> 踩过的坑，记下来免得复现：Vite 在 HMR 之后会给模块 URL 带上 `?t=` 时间戳，
> 页面里再 `import('/src/stores/document.store.ts')` 会拿到**第二份**模块实例，
> 表现为「store 里明明有文档，界面却显示空状态」。每次改完源码要**重启 dev server**
> 再测，否则测的是一个和界面无关的 store。下面所有结论都是重启后取得的。

### 功能 1：滚动时侧栏高亮跟随当前章节 —— 已修复

测试文档：13 章 × (h2 + h3) + 一个 h1 = **27 个标题**，文档高 19548px。
关键前提确认：**滚到顶部时 DOM 里只有 2~4 个标题元素**（27 个里的），
虚拟化场景真实成立——这正是旧 IntersectionObserver 失效的原因。

连续滚动（每次 +320px，共 60 次）观察到的高亮变化序列：

```
第-1-章-标题 → 第-1-章-小节 → 第-2-章-标题 → 第-2-章-小节 → … → 第-13-章-标题
distinctSections: 25，monotonic: true
```

25 个不同章节按文档顺序依次点亮，**没有跳过、没有回退、没有抖动**。
`sidebarBold`（按 `getComputedStyle(el).fontWeight >= 500` 取实际加粗项）每一步都
恰好只有一项，且与 `activeHeadingId` 一致——即侧栏 DOM 上真的看得见。

滚到底（反复滚到 `scrollHeight` 直到稳定，因为 CodeMirror 的估算高度会被真实高度顶开）：
`scrollTop 18818 / max 18818`，高亮 `第-13-章-标题`。

`scrollSync` 设置关掉后：滚动 0 → 3000px，`activeHeadingId` 全程不变（冻结正确）；
重新打开后再滚，高亮恢复跟随（`typescript` 一节）。

### 功能 2：点击目录项跳到对应位置 —— 已修复

**合成文档（27 项，全量遍历）**：每次先滚回顶部再点，逐项检查。

```
clickAllOk: true
clickTargetsNotInDomBefore: 24 / 27
clickFailures: []
```

即 27 项**全部**跳转正确，其中 **24 项在点击前根本不在 DOM 里**——这正是旧实现
`container.querySelector('[id=...]')` 查不到、整个跳转失效的那些。
落点：目标标题元素稳定停在容器顶边下方 **6.0 ~ 6.8px**。

**真实 fixture（`fixtures/sample.md`，17 个标题，含 Shiki 代码块 / KaTeX 公式 / Mermaid 图 / 表格 / 脚注 / 重复标题去重）**：

```
total: 17, ok: 16
failures: [ { id: 九重复标题测试, got: 九重复标题测试-1, topRel: 54.3, atBottom: true } ]
```

唯一一项不符是缺陷 B 描述的到底特例：该标题与它的去重副本挤在最后一屏，
滚动已经到 `max`，物理上推不到顶边。**滚动本身是正确的**（它已被带到 54.3px 处，
文档允许的最近位置），只是高亮归给了同屏更靠后的那个。

其中「七、Mermaid 图表」一项，在**首次遍历**（Mermaid 还在异步出图、块高度未定）时
落点偏了一节，图渲染完之后重复点击稳定正确（连续 6 次采样，2.5s 内 `topRel` 恒为 6.3px，
高亮恒为该项）。这与阅读位置恢复需要 `onEnhanced` 再校正一次是同一类问题，
不是本次改动引入的。

### 附带实测：`usePendingAnchor`（必做一）

| 场景 | scrollTop | 目标距顶边 | activeHeadingId | 锚点已清 |
|---|---|---|---|---|
| 冷启动带锚点 | 9006 | 6.0px | 命中锚点 | ✅ |
| 换文档带锚点 | 5158 | 6.5px | 命中锚点 | ✅ |
| 再换一次带锚点 | 11248 | 6.5px | 命中锚点 | ✅ |
| 锚点指向不存在的标题 | 0 | — | 首个标题 | ✅ |
| 无锚点打开 | 0 | — | 首个标题 | ✅ |

三个跳转场景的目标标题**点击前均不在 DOM 里**。

### 控制台

整轮实测（含所有文档切换、上百次点击与滚动）控制台**零应用错误**，
只有 dev server 自身的 `favicon.ico 404` 与重启 server 导致的 HMR WebSocket 断连。

### 视觉确认

点「第 6 章 小节」后截图核对：侧栏该项高亮（蓝底 + 蓝字），正文顶部正是「第 6 章 小节」。
截图为临时产物，已随 `.playwright-mcp/` 一并删除，未留在仓库里。

---

## 六、遗留与顾虑

1. **到底特例的取舍**：最后一屏里若挤着多个标题，只有最靠后的那个会被高亮。
   已在代码注释里说明。这是「让末尾章节可达」的代价，我认为是正确的一边。

2. **异步增强期间的落点漂移**：Mermaid / Shiki 出图前跳转，落点会偏一节。
   `useReadingPosition` 有 `onEnhanced` 再校正一次，目录跳转没有对应机制
   （用户也不太可能在图还没画出来时就去点目录）。没有处理，如实记下。

3. **正文里的 `#锚点` 链接（本任务范围外，但同源）**：`useRelativeLinks` 明确把
   `href.startsWith('#')` 交给浏览器原生处理。虚拟化之后浏览器同样找不到视口外的目标，
   所以「点正文里的目录链接」这条路径**仍然是坏的**。它不在本任务的三件事里，我没有动。
   修法与本任务一致（拿 hash 查 store 里的 `line` 再 `scrollToLine`），建议单开一项。

4. **旧渲染路径仍在**：`useMarkdownRender` / `MarkdownView` / `renderer.createSession`
   已经没有任何页面使用，但仍从 `hooks/index.ts` 导出。我给它补了 `lineOffset` 让它产出的
   行号不撒谎，但更该做的是删掉它。不在本任务范围。

5. **`useEditorView` 的存活判据在渲染期读 `dom.isConnected`**：这是一次 DOM 属性读取，
   不触发布局，代价可以忽略。但它依赖 CodeMirror「`destroy()` 会摘掉根节点」这一实现细节——
   已在注释里写明依赖点，CodeMirror 大版本升级时值得复查。

---

# 第 1 轮修复循环（回应审查）

## Important-1：锚点跳转会被阅读位置恢复覆盖 —— 已修

审查者的推演是对的，而且我的实测矩阵确实**没有**这一条：我测的锚点场景用的都是新文档
（`anc:1`…`anc:5`），从来没有存档的阅读位置，所以两条恢复路径本来就没触发过。

### 缺陷成立的完整链条（复核后确认）

`ReaderPage` 里 `useReadingPosition` 排在 `usePendingAnchor` 之前，同一轮提交里恢复先跑：

1. 恢复 effect 此刻读到的 `pendingAnchor` 还是非空的（还没被消费），但它**根本没看**这个字段
   → 取到存档位置 → `restoredDocRef.current = documentId` → `applyPosition`；
2. `applyPosition` 排的 rAF 在 CM 测量之后执行 `scrollTop += offset`，把**阅读位置的行内偏移**
   叠到锚点落点上（审查意见第 1 点）；
3. 更要命的是第 1 步把 `restoredDocRef` 置了位，于是几秒后 `onEnhanced` 通过了
   `restoredDocRef.current === documentId` 这一关，`userScrolledRef` 又拦不住（锚点跳转是程序化
   滚动），**把用户从锚点整个拽回上次读到的位置**（审查意见第 2 点）。

### 修法：闩锁 `anchorDocRef`

```ts
/** 「带着锚点打开的」是哪一篇文档 */
const anchorDocRef = useRef<string | null>(null);
useEffect(() => {
  if (pendingAnchor !== null && documentId !== '') anchorDocRef.current = documentId;
}, [pendingAnchor, documentId]);
```

两条恢复路径都加同一道守卫：

```ts
if (pendingAnchor !== null || anchorDocRef.current === documentId) return;
```

三个设计点：

- **存 documentId 而不是布尔值**，换文档后自然对不上，不需要单独的复位逻辑，也就不可能出现
  「上一篇的闩锁挡住了下一篇」。
- **闩锁 + 现读双条件**。闩锁负责审查者点名的时序陷阱（锚点消费后 `pendingAnchor` 已是 null）；
  现读那一半负责「锚点刚设上、置位 effect 还没跑过」的那一帧。置位 effect 声明在两条恢复路径
  **之前**，保证同一轮提交里先置位后判定。
- **`onEnhanced` 里的守卫看似冗余**（恢复被跳过 → `restoredDocRef` 没置位 → `onEnhanced` 本来
  就会在上一关返回），我仍然留着：让「锚点优先」这条不变量在两个出口各自成立，而不是靠
  另一个 ref 的副作用间接保证。注释里写明了这一点。

顺带发现并处理的一件事：把 `pendingAnchor` 加进恢复 effect 的依赖后，**锚点被清空这件事本身
会让 effect 立刻重跑一遍**——这正好是闩锁必须存在的直接证据，不是可有可无的加固。

### 回归测试：`src/hooks/useReadingPosition.test.tsx`（5 例）

按上一轮的标准做了**撤销验证**，确认它们扎得住：

| 撤销的内容 | 失败用例数 |
|---|---|
| 两处守卫全删（完全回到修复前） | **4 / 5 失败** |
| 只留「现读 `pendingAnchor`」、去掉闩锁（审查者点名的天真写法） | **3 / 5 失败** |
| 完整修复 | 5 / 5 通过 |

失败明细（完全撤销时）：

```
× 带锚点打开时不恢复阅读位置，把落点让给锚点
× 锚点被消费清空之后，也不能补一次恢复
× 增强完成后的校正也不能把用户从锚点拽回上次位置
× 无关的重渲染不会让恢复重新生效
```

第一个用例「没有锚点时，照常恢复上次阅读位置」是正向对照，两种撤销下都通过——证明其余四条
的「没有恢复」不是因为这条路本来就不通。

## Important-2：到底特例

### (a) 抽成纯函数 —— 已做

`src/utils/scroll-math.ts` 新增 `isScrolledToBottom(scrollTop, scrollHeight, clientHeight, tolerance)`。
`useScrollSpy` 改为调用它。

顺带把原来内联判据里的 `scrollTop > 0` 换成了更准确的「可滚余量本身是否超过容差」：
`scrollTop > 0` 只是「短文档恒判到底」的一个近似挡板，它挡不住「只比视口高 1px」这种
勉强可滚的退化情形——那 1px 余量没有任何阅读意义，却会让到底规则在文档顶部就成立。

`src/utils/scroll-math.test.ts` 新增 7 例：文档顶部、滚到中途、恰好到底、容差内（含小数
`4198.4`）、超出容差、内容一屏放得下、可滚余量在容差内。

### (b) 放宽容差 —— 已做，选了 2px

选 2px 而不是 `Math.ceil`：`Math.ceil` 只能吞掉一个方向上不足 1px 的残差，而这里两端
（`scrollTop` 与 `scrollHeight`）在缩放 / 非整数 DPR 下都可能带小数，一个显式的、和
`SCROLL_TOLERANCE_PX` 同一族的常量更好解释，也更好在注释里写清「为什么不能取 0」。
常量 `BOTTOM_TOLERANCE_PX = 2` 定义在 `useScrollSpy.ts`，理由写在它上方。

审查者指出的静默复发风险是准确的：判据一旦失效不会有任何报错，只是末尾章节又点不亮了。
`isScrolledToBottom` 的文档注释里把这句话原样记下了。

### (c) `usePendingAnchor` 两处守卫的测试 —— 已补

`src/hooks/usePendingAnchor.test.tsx`（7 例）。同样做了撤销验证：

| 撤销的内容 | 失败用例 |
|---|---|
| 去掉 `toc.length === 0` 门槛 | 2 失败（「目录还没到齐时什么都不做」「目录随后到齐时补上这次跳转」） |
| 去掉 `setDocument` 清锚点 | 1 失败（「换文档时清掉上一篇没能消费的锚点」） |

其中「带锚点打开的正常时序（先 `setDocument` 再 `setPendingAnchor`）不受影响」一例，
锁住的是 `setDocument` 清锚点**不能误伤本次锚点**——`useEmbeddedDocument` 正是这个顺序。

## 验证命令与实际输出

```
> tsc --noEmit
> eslint .
> vitest run

 Test Files  34 passed (34)
      Tests  312 passed (312)
   Duration  1.79s
```

（上一轮为 32 files / 293 tests；本轮新增 `useReadingPosition.test.tsx` 5 例、
`usePendingAnchor.test.tsx` 7 例、`scroll-math.test.ts` 7 例。）

## 浏览器实测：Important-1 的复现条件

按审查者给的条件构造：**之前读过、存有阅读位置的文档 + 锚点 + Shiki 代码块与 Mermaid 图**。
文档为 13 章，每章带一个 ts 代码块，末尾一张 Mermaid 图。

时序：打开 A → 滚到 45% → 位置存下 → 切到 B（模拟离开）→ 带锚点 `#a-第-11-章` 重新打开 A。

存档位置：`{ line: 82, offset: 5.69 }`，对应「A 第 5 章」，`scrollTop = 2684`。
锚点目标「A 第 11 章」故意选在存档位置的另一侧。

重新打开后连续采样 6 秒：

| t(ms) | scrollTop | 锚点标题距视口顶 | 存档章节是否在视口 | Shiki 已上色 |
|---|---|---|---|---|
| 300 | 5191 | 10.4px | 否 | 是 |
| 800 | 5191 | 10.4px | 否 | 是 |
| 1500 | 5191 | 10.4px | 否 | 是 |
| 2500 | 5191 | 10.4px | 否 | 是 |
| 4000 | 5191 | 10.4px | 否 | 是 |
| 6000 | 5191 | 10.4px | 否 | 是 |

**落点是锚点（第 11 章），不是上次读到的位置（第 5 章，2684），并且在增强完成后的 6 秒内
一动没动。** 修复前这里会在增强结束时跳回 2684 附近。

正向对照（同样的「读过 → 离开 → 回来」，但**不带锚点**）：`scrollTop` 从 2922 恢复到 3093，
高亮同为 `p-第-5-章`。恢复功能没有被守卫误伤。

### 无回归复测（Important-2 改动之后）

27 个标题的合成文档：

- 滚动跟随：25 个章节按序点亮，`monotonic: true`；
- 到底：`scrollTop 19320 / max 19320`，高亮 `第-13-章-小节`（末尾章节仍可达，容差放宽到 2px
  之后到底规则照常生效）；
- 全量点击：**27 / 27 正确**，无失败项。

## 本轮新发现的问题（未修，请分诊）

带锚点打开时，**落点比目录点击少滚约 8px**，导致侧栏高亮落在上一节。同一篇文档、同一个目标，
两条路径对照：

| 路径 | scrollTop | 锚点标题距视口顶 | 高亮 |
|---|---|---|---|
| 带锚点打开（内容尚在增强） | 5191 | 10.4px | 第 10 章 ❌ |
| 目录点击（内容已全部增强） | 5199 | 6.8px | 第 11 章 ✅ |

**成因**：锚点跳转发生在 Shiki 上色完成之前，上方内容随后变高约 8px，而锚点这条路径**没有
增强完成后的再校正**（阅读位置有 `onEnhanced`，锚点没有）。用户小幅滚动**不会**自愈——
高亮其实忠实反映了视口顶边的真实位置，是落点本身短了 8px。

**没有动它的原因**：修法要把增强完成的信号也接给 `usePendingAnchor`，是一套新的接线，
而且会和我这轮刚加的闩锁直接互动（校正必须只补锚点、不能顺手把阅读位置补回来）。
这超出了本轮两条 Important 的范围，按「不要扩大本轮范围」处理，交给最终审查分诊。
影响程度：用户看到的是正确的章节（标题就在视口顶部 10px 处），只有侧栏高亮差一格。

## 本轮未处理的（按指示）

- 正文里 `#锚点` 链接仍然是坏的（`useRelativeLinks` 把它交给浏览器原生处理）——已确认协调者
  会单开一项。
- Minor 三条（`EditorContext` 首个用例是正向对照、`useScrollSpy` 依赖 `flat` 导致打字时反复
  拆装监听、`lineOffset` 是给死代码打的补丁）按指示推迟到最终审查分诊。
