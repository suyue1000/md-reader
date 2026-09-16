# Task 8e 审查报告（c386914..69b560b）

审查者独立核实。`npm run verify`：typecheck / lint 无输出，**40 文件 / 406 用例全过**
（2.21s），与报告一致（基线 397 + 9）。工作树干净，commit 信息中文、无署名尾注。

审查方式：全量读 `useReadingPosition.ts` / `usePendingAnchor.ts` / `useRelativeLinks.ts` /
`TocPanel.tsx` / `MarkdownEditor.tsx` / `ReaderPage.tsx` / `document.store.ts` 现状代码，
不只读 diff；对实现者要求确认的不对称写了一条**一次性 vitest 探针**独立求证（已删除）。
未复建 8c/8d 的 CDP 实测台（见文末「未能验证」）。

---

## 一、四道已有防线

### 防线 1：锚点优先 —— 完好

`anchorOpenRef` 的置位 effect、判定表达式 `pendingAnchor !== null || anchorOpenRef.current === openEpoch`
一字未动，diff 里只改了它上方的注释。新加的 `isDisarmed()` 在**首次恢复**里排在锚点守卫
**之后**、在 `onEnhanced` 里排在锚点守卫**之前**——两处都是 early-return，先后不影响结论，
不构成语义变化。`markNavigation` 没有任何一条路径由「带锚点打开」触发（`usePendingAnchor`
不调、`useEmbeddedDocument` 不调，全仓仅 TocPanel:109 与 useRelativeLinks:110 两处调用点），
因此闩锁不可能被新信号绕过。报告的 12252 / 6.6px 与对照一致可信。

### 防线 2：闩锁不粘 —— 完好

`navigationBaselineRef` 的复位与 `restoredDocRef` / `userScrolledRef` / `expectedScrollTopRef`
写在**同一个** `useEffect(..., [openEpoch])` 里（useReadingPosition.ts:152-159），
不存在「一个复位了另一个没有」。`openEpoch` 由 `setDocument` 与 `reset` 无条件自增
（8d 审查已核）。用例「上一次打开里点过目录，不影响这一次打开的恢复」锁住这条。
`navigationEpoch` 单调不复位的设计是对的：它把「复位」变成「重新取一次基线」，
消除了布尔量必然带来的「抹除与置位谁先跑」的时序要求——这正是闩锁当年栽的坑。

### 防线 3：校正仍生效 —— 完好，且没有发现过度撤防

这是最需要警惕的一条（静默失效）。逐条排查「谁能让 `isDisarmed()` 意外为真」：

- `markNavigation` 全仓只有两个调用点，都在**用户点击的同步路径**里，且都有前置条件
  （TocPanel 在 `if (view)` 之内；useRelativeLinks 在 `findHeadingLine !== null &&
  currentView` 之内）。没有任何 effect / 定时器 / 滚动回调调它。
- Scroll Spy 的 `setActiveHeadingId` 不经过 `handleSelect`；侧栏自身的
  `item.scrollIntoView({block:'nearest'})`（TocPanel.tsx:127）滚的是侧栏 DOM，不碰阅读容器。
- 基线未初始化的窗口（首次提交里子组件 effect 先于父组件跑）不可达：那一刻
  `restoredDocRef.current !== documentId`，`onEnhanced` 已经先行 return。
  同一篇文档重开的那一轮里 `restoredDocRef` 恰好等于 documentId，此时基线是上一次打开的
  陈旧值——但结果只会是「少做一次校正」，而且随后的复位 effect 立刻纠正，无害。

正向对照用例「没有导航时，增强完成后的校正照常生效」存在且撤销后仍绿，作用正确
（它排除了「1~3 变绿是因为把 onEnhanced 整个打断了」这种假通过）。报告的 9087→9091 /
9052→9056 两组逐 50ms 采样能看到 scrollTop 在增强后确实动了，并按**内容**（同一块回到
视口顶边）核对落点，不是只看数字——这一点比 8d 时的证据质量高。可信。

### 防线 4：手动滚动后不被拽回 —— 完好

`checkUserScrolled` / `userScrolledRef` / `SCROLL_TOLERANCE_PX` 写入路径一字未动，
只是读取处并入 `isDisarmed()` 的第一项（短路的第一个操作数，行为等价）。9087→9147 恒定
与对照一致可信。

### 「与对照构建数字逐位相同」这个说法

**可信，但覆盖不完整。** 防线 1/2/4 与对照逐位相同这件事本身有强证据力——这三条走的代码路径
本次一行未改，数字相同正是应该出现的结果，反过来若不同才要警觉。防线 3 的数字相同同理。
不完整之处在于：**这四条都是在单一时序下测的**，而报告自己刚证明了这块代码的行为是
时序敏感的（缺陷只在 700~1500ms 的窗口里出现）。防线 1/2/4 因为代码未改，单点测量足够；
防线 3 做了 50ms 逐点采样 + 冷启动复测，也够。真正的漏网不在这四条里，而在下面②。

---

## 二、三处独立判断

### ① 撤防判据的新设计 —— 抽象成立，未过度撤防，但**枚举不完整**

「撤防要表达的是『用户已经明确表示要待在别处』，用户滚动只是其中一种形态」这个抽象是
对的，而且比旧判据更贴近真实意图。旧判据是**手段**（比对 scrollTop），新判据是**意图**，
用手段去近似意图正是这次缺陷的根源。

过度撤防：按上面防线 3 的逐条排查，**没有发现**任何「不该算显式导航却触发了它」的情形。
两个调用点的前置条件都收得很紧，两条「没真跳就不记导航」的用例（view 为空、锚点不是标题）
把这层收紧钉住了。这一点做得好——它防的恰恰是「白撤一次防吃掉一次本该发生的恢复」。

不完整之处：`isDisarmed` 的注释把显式导航**枚举**成「点侧栏目录、点正文 `#锚点` 链接」，
而仓里至少还有两条同样满足这个定义、却没有接线的路径：

- `src/hooks/useSearch.ts:118`——跳到下一个搜索命中，用原生
  `scrollIntoView({block:'center'})`。它同步改 scrollTop，但 `scroll` 事件仍是异步派发的，
  而 `onEnhanced` 只隔一个微任务（见下），所以存在同一个窗口：校正抢先 `scrollToLine`
  把用户从搜索命中处拽回记录位置。这是**同一族缺陷**，只是入口不同。
- `src/components/reader/BackToTop.tsx:48`——`scrollTo({top:0, behavior:'smooth'})`。
  平滑滚动会立刻开始派发真实 scroll 事件，窗口比上面窄得多，风险低。

这两条都是既有行为、不是本次引入的回归，但新抽象一旦立起来，「哪些算显式导航」就成了
一份需要维护的清单，注释里的枚举应当明说它不是穷举、并指出判定标准。

### ② 与 `usePendingAnchor` 的不对称 —— **不可接受，是一个已经能被咬到的隐患**

实现者的理由是「实测『带锚点打开后立刻点目录』在对照与修复后都正常，所以没有理由改」。
这条理由**不成立**，而且栽在报告自己第六节警告过的同一个坑里：那次实测用的是
「**立刻**点目录」，也就是延迟≈0——而报告自己的扫描表明 0ms / 200ms 这两格在**对照构建上
也是通过的**，失败只出现在 700~1500ms。用一个已知落在窗口外的延迟去证明「这条路径没问题」，
证据力为零。

我按代码逻辑推演出了具体的相反组合，并写了一次性 vitest 探针求证（已删除）：

```
① 带 #第二节 打开 → usePendingAnchor 跳到第 37 行，afterScrollSettles 记下 expectedScrollTop
② 增强尚未全部落定的窗口内，用户点目录去第三节：markNavigation() + scrollToLine(99)
   （useReadingPosition 这边正确地撤了防，且本来就被 anchorOpenRef 闩着，不动）
③ CodeMirror 的测量周期还没把 scrollTop 挪走 —— 这正是本次缺陷的成立条件
④ 同一次 dispatch 同步触发 viewportChanged → enhanceMounted → 微任务后 onEnhanced
⑤ usePendingAnchor.onEnhanced：anchorLineRef 非空，container.scrollTop 与
   expectedScrollTopRef 仍相等（容差内）→ 判定「用户没滚走」→ scrollToAnchor(view, 37)
```

探针结果：`scrollToLine(view, 37)` **被调用**——用户被拽回锚点。这与本次修掉的缺陷是
**同一个缺陷**，只是发生在锚点路径上；两套判据在这个组合下给出的正是相反结论
（`useReadingPosition` 说「撤防」，`usePendingAnchor` 说「用户没动」）。

需要说明探针的局限：jsdom 里 `scrollTop` 恒为 0，「滚动尚未落定」是**假设**而非测量。
但这个假设正是本任务根因分析的核心结论，并有报告的浏览器证据（点击后 4.8 秒 trail
恒为 768、全程无中间值）支撑；`ReaderPage.tsx:112-115` 的 `handleEnhanced` 也确实把两个
回调串在一起调，链路是通的。因此我认为这是一个**真实可达**的隐患，只是尚未被实测捕获。

不对称本身（一处用显式信号、一处用现量 scrollTop）不是问题，问题是**用现量 scrollTop 的
那一处，恰好就是本次证明「现量 scrollTop 判不出程序化导航」的那类场景**。报告第二节
「为什么不改成『校正前再量一次 scrollTop』」把这条路走不通的道理写得很清楚，却没有把这个
结论回推到 `usePendingAnchor`。

不主张在本任务里改（范围控制是对的），但**必须开一个后续任务**，且注释里现有的
「实测都正常，所以不动」这个理由要改成事实——「未在竞态窗口内测过」。

### ③ 顺带修掉正文 `#锚点` 链接 —— 合理的同源修复，不算范围蔓延

判断依据：
- **同根**：同一个 `onEnhanced` 校正、同一个「程序化滚动认不出」的判据缺口，不是「顺路看到
  的另一个 bug」；
- **同机制**：两条路径调的是**同一个** store action，同样写在 `scrollToLine` 之前、
  同样带「没真跳就不记」的前置条件，没有各写一套；
- **成本极小**：生产代码 8 行（其中 7 行是注释），2 条用例；
- **拆出去反而更差**：留着它，`isDisarmed` 的注释就得说明「另一条同样的路径为什么没修」，
  而且它的症状更隐蔽（地址栏改成了 `#第-18-章`、画面停在第 7 章，分享出去的链接与所见不符），
  对照构建下已实测复现。

唯一的实现差异：TocPanel 用 selector 订阅 action，useRelativeLinks 用 `getState()` 现读。
这个差异有正当理由并已写在注释里（后者是纯事件委托监听器，进依赖数组会被反复拆装），
不是两套机制。

---

## 三、撤销验证与用例效力

撤销后 5 例失败。逐条看它们锁的是什么：

| # | 锁住的东西 | 判断 |
| --- | --- | --- |
| 1 | markNavigation 之后，`onEnhanced` 不再 `scrollToLine` | 锁**缺陷的契约结论**，不是实现细节 |
| 2 | 反复 `onEnhanced` 都不漏 | 锁「撤防是持久的」，有价值（只挡一次会让用户往下读几屏被拽回） |
| 3 | 首次恢复未落地时导航 → 整次恢复作废 | 锁恢复与导航的先后，有价值 |
| 4 / 5 | 两条点击路径**同步**发出信号 | 锁接线 + 同步性 |

**「单元测试怎么把几百毫秒窗口的缺陷稳定复现出来」——它没有，也不该。** 这 5 条把时序竞态
替换成了根因诊断的**结论**（「发生过显式导航 → 校正必须放弃」），再由 4/5 保证信号在点击那
一刻同步发出。这个分工是对的：竞态本身由浏览器扫延迟实测负责，用例负责钉住机制不被改坏。
我验证过这层保护的有效性——把 `markNavigation()` 挪进 `afterScrollSettles` 之类的异步回调，
用例 4/5 会当场失败，因为它们在 click 之后**同步**断言 epoch。

残留缺口（可接受）：没有用例锁「`markNavigation` 在 `scrollToLine` **之前**」——把两行调换
所有用例仍绿。但这个顺序其实**不是**必要条件（见下面 Minor 1），所以不构成缺口。

真正的缺口是：**没有任何用例覆盖 `ReaderPage.tsx:112-115` 把两个 `onEnhanced` 串起来调这一段**
（8d 审查已就 `openEpoch={openEpoch}` 记过同型缺口）。②里那个组合恰恰只在这一段里成立。

---

## 四、注释质量

密度与「解释为什么」的要求达到了 `file-open.ts` / `chunker.ts` 的水准，中文，
`isDisarmed` 与 store 的 `navigationEpoch` 两段把「为什么需要这道撤防」「为什么是序号不是
布尔量」「为什么放 store」讲透了，而且是**从根因推出来的约束**而不是事后追认。
就「注释归因是推断还是查证」这条教训而言，本次的归因（`checkUserScrolled` 比对的是我们自己
写入的值 / dispatch 同步触发 viewportChanged / onEnhanced 隔一个微任务）我逐条对着
`MarkdownEditor.tsx:209-217, 255` 核过，**全部属实**。只有一处措辞过强，见 Minor 1。

---

## 五、结论

### 规范符合性：✅

verify 全绿（40/406，基线 397）、TS strict 无 any 无 ts-ignore、注释中文且解释为什么、
零网络请求、commit 信息中文且无署名尾注、diff 只动了报告列出的 7 个文件。

### 任务质量：批准（Important 项须开后续任务）

修法本身正确、抽象成立、四道防线逐条完好、没有引入 Critical 回归。扣分在②：实现者要求
确认的那处不对称，给出的实测理由是无效证据，而我用探针求出了具体的相反组合。

### 问题清单

**Critical：无。**

**Important 1 — `usePendingAnchor` 的不对称是一个可达的同源缺陷（`src/hooks/usePendingAnchor.ts:182-201`）**
带锚点打开后，在增强未落定的窗口内点目录，`onEnhanced` 会因为「scrollTop 还没变」判定用户
没滚走，把用户拽回锚点。vitest 探针已复现该逻辑路径。报告第三节末尾用来支持「不必改」的
实测是延迟≈0 的单点测量，落在已知窗口之外，不构成证据。要求：开后续任务，在
700~1500ms 的窗口内扫延迟实测；在此之前把该处注释里的理由改成「未在竞态窗口内验证」。

**Important 2 — 新抽象的枚举不完整，`useSearch` 未接线（`src/hooks/useSearch.ts:114-119`）**
「跳到下一个搜索命中」满足 `isDisarmed` 注释给出的显式导航定义，但不调 `markNavigation`；
它依赖 `scroll` 事件撤防，而这次修的就是「`scroll` 事件来不及」。同族缺陷，入口不同。
`BackToTop.tsx:48` 同理但窗口窄得多。建议：要么接线，要么在 `document.store.ts:26-44`
的注释里写明判定标准与「为什么这两条不算/暂不接」。

**Important 3 — `ReaderPage.tsx:112-115` 的 `handleEnhanced` 合并点无任何用例覆盖**
两个 `onEnhanced` 的先后与共存关系全靠注释维系，删掉其中一行调用 406 个用例照样全绿；
Important 1 描述的组合正好只在这一段里成立。与 8d 记过的 `openEpoch={openEpoch}` 同型。

**Minor 1 — `TocPanel.tsx:98-102` 对顺序的必要性说过头了**
注释称 `markNavigation` 必须在 `scrollToLine` **之前**，否则「撤防晚一步就会被校正抢先」。
实际上 `onEnhanced` 恒由 `settleWithTimeout(...).then()` 触发（`MarkdownEditor.tsx:216-218`），
永远隔一个微任务，因此**同一个点击处理函数内的任何同步位置都够**。真正的约束是
「必须同步完成，不能等测量或事件」——这一句 `isDisarmed` 的注释写对了。放在前面是好的防御性
写法，但把「防御性」写成「必要条件」，正是这个项目要避免的那类归因。

**Minor 2 — `document.store.ts:26-44` 的 `navigationEpoch` 只增不减，无上界说明**
实际不会溢出（Number.MAX_SAFE_INTEGER），且 store 不持久化，无实际风险；仅记录。

**Minor 3 — 撤防一旦触发即覆盖整次打开，目录点击后的落点不再有任何增强后校正**
既有行为（目录跳转本来就没有 re-correct 机制），不是本次回归，但「点目录跳到含大量代码块的
章节 → Shiki 上色后落点偏移」这个体验缺口现在被这次修复固化下来了，值得记一笔。

---

## 六、⚠️ 未能验证的项

1. **没有复建 8c/8d 的 CDP 实测台**，因此报告第三节的所有浏览器数字（扫延迟表、12252/6.6px、
   14074、9087→9091、9087→9147）**均未由本审查独立复现**。判断依据是代码路径核对 + 用例 +
   逐条一致性推理。就防线 1/2/4 而言这不构成风险（相关代码一行未改，数字相同是应然结果）；
   防线 3 与主判据的数字我认为可信但**未独立测量**。
2. **Important 1 的浏览器实证缺失**：探针在 jsdom 里跑，`scrollTop` 恒为 0，「滚动尚未落定」
   是按根因分析假设的而非测量所得。该组合在真实 Chrome 的 700~1500ms 窗口内是否必然触发，
   未测。
3. **Important 2 的 `useSearch` / `BackToTop` 路径未实测**，仅按代码推理。
4. 竞态窗口宽度与机器相关，本审查没有在第二台机器上验证窗口位置。
