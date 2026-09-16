# Task 13 第 4 轮审查：拖选回归修复 + 空代码块落行尾裁决落实

审查对象：`a07bc8e..d1a06a4`（1 个 commit），4 文件 / +229 −55。

结论先行：

- **规范符合性：✅**（`npm run verify` 独立跑通：48 文件 / 498 用例全过，退出码 0；工作树干净）
- **任务质量：批准**
- **四项相邻行为均未被本轮捅破**（结论见下）
- 本轮未引入新的 Critical / Important；未发现超出两条 Important + 四条 Minor 范围的改动
  （diff 只动 `live-preview.ts`/`.test.ts`、`useEditMode.ts`、`ReaderPage.test.tsx`，与两个待办
  完全对应）

---

## 一、两条 Important 的核实

### 1.1 拖选回归

实现选择“非单击手势直接 `return null`”（复审给的成本更低的方向）。用 `@codemirror/view`
6.43.11 的 dist 独立核对：

- `handlers.mousedown`（4967-4995）：facet 里的 provider 返回 `null` 时循环继续问下一个，
  全部为空且 `button==0` 时才退回 `basicMouseSelection`——`return null` 确实是把整个手势原样
  交还给 CodeMirror 默认逻辑，不是丢弃事件。
- `basicMouseSelection`（5026-5053）用 `posAndSideAtCoords` 现算位置，双击/三击走
  `rangeForClick` 的 `groupAt`/取整行；shift 走 `startSel.main.extend(...)`；ctrl/cmd 走
  `addRange`。这些路径完全不知道渲染块的存在，落点由 `posAtCoords` 对 `block:true` 装饰的
  **几何中点规则**给出（块上半→`block.from`，下半→`block.to`，dist 3825-3827，与文件内注释
  引用一致）。
- 代价确认：双击/shift/三击/多选落在渲染块上时，精度退回到「块首或块尾」二选一，不是块内
  语义精确定位（比如双击代码块下半可能在 `block.to` 处 groupAt，选中的是收尾栅栏附近的边界，
  不是用户视觉上双击的那个词）。但这正是 **Round 1 之前、这一整套块渲染方案启用之前**
  CodeMirror 对块级 widget 的原生行为，不是本轮引入的新缺陷，也不会破坏文档（最坏是选区
  不精确，不会像单击落点缺陷那样写坏栅栏配对）。复审报告本身也只要求「不再钉死同一个空
  选区」，没有要求双击/shift 达到块感知精度——这个收窄在范围内是**可接受**的，报告如实说明
  了这一点、未夸大成「已优化」。

`get()` 的新实现：

```ts
get(curEvent) {
  if (curEvent === event) return EditorSelection.single(anchor);
  const cur = view.posAtCoords({ x: curEvent.clientX, y: curEvent.clientY }, false) ?? anchor;
  return EditorSelection.single(anchor, cur);
},
```

用 dist 核对了 `curEvent === event` 这个身份判据的可靠性：`handlers.mousedown` 里
`new MouseSelection(view, event, style, mustFocus)` 与随后的 `mouseSel.start(event)` 用的是
同一个 `event` 引用；`MouseSelection.start(event)` 在 `dragging === false`（我们这条路，见下）
时立即用这同一个引用调 `select(event)`，因此手势第一次调用 `get` 时 `curEvent` 确实是同一个
对象，锚点判据成立。

一处未在报告和上一轮审查里提到、但值得记录的边界（不构成 Important，理由见下）：
`MouseSelection.dragging` 由 `isInPrimarySelection(view, startEvent) && getClickType==1 ? null
: false` 决定。若点击落点的屏幕坐标恰好落在**上一次残留的非空选区**的 client rect 内，
`dragging` 会是 `null`（“可能是拖文本”的模糊态），此时 `start()` 不会立即调用 `select`，
要等 mousemove 越过 10px 阈值才第一次调用 `get`（此时 `curEvent` 已经不是原始 `event`），
落点会走 `posAtCoords` 现算分支而不是钉住的锚点。这是 CodeMirror 自身对“点在旧选区内”场景
的固有歧义（`basicMouseSelection` 同样受它影响），不是本轮改动引入的新问题，且触发条件很窄
（渲染块的可视位置恰好与残留选区的旧 client rect 重叠），不要求本轮处理。

**结论：修法本身经得起 dist 源码验证，代价是可接受的收窄，如实记录在注释里，未虚报。**

### 1.2 空代码块改落行尾

用仓库自带 `markdown-it` 独立重跑三种输入验证（未采信报告数字，自己跑的）：

```
empty original       : fence[0,2] "", heading[3,4], paragraph[5,6]
行首插 Z（Z```\n``` ）: paragraph[0,1], fence[1,6] content="\n## 第二章\n\n第二章正文。\n"（后文被吞）
行尾插 Z（```Z\n``` ）: fence[0,2] ""（与原样完全同构），heading/paragraph 完好
```

与实现者报告、上一轮裁决完全一致：行尾安全（信息串扩展，不影响栅栏语法），行首破坏栅栏
配对、吞掉后续内容到文末。落实：`fenceContentLineStart` 的空代码块分支从 `return null`
改成 `return openLine.to`；两条用例（`blockStartMouseSelection` 的“空的围栏代码块”与
`fenceContentLineStart` 的“空围栏代码块”）断言同步改成 `lineEnd(9)` / `state.doc.line(5).to`。

**已清干净的证伪内容**：`fenceContentLineStart` 上方注释里“退回块首”那一整段理由
（“风险等价”“不主动插入内容行”“与其余块类型共用同一条规则”）已被完整替换为查证后的机制
说明，没有残留半句已被推翻的归因——这正是上一轮点名的老毛病，这次没有再犯。

---

## 二、四项相邻行为的回归结论

1. **单击落点（h2/p/li/有内容的围栏代码块）：未被捅破。** 顶部新增的手势门禁
   （`button/detail/shiftKey/ctrlKey/metaKey`）只排除非单击手势，单击路径完全没动；
   `fenceContentLineStart` 的非空分支未改。EXP-A（见第三节）证实门禁本身被用例锁住，且
   门禁逻辑与落点逻辑是两段独立代码，互不干扰。
2. **块内控件（链接/复制/下载按钮）：未被波及。** 本轮 diff 完全没有碰
   `widgetIgnoresEvent`/`INTERACTIVE_IN_BLOCK`，这些控件的 `mousedown` 在到达
   `handlers.mousedown` 之前就已经被 `ignoreEvent` 挡下，`blockStartMouseSelection` 根本
   不会被问到。
3. **编辑态拖选 / shift 扩选 / 双击选词：本轮的修复对象，确认修好。** EXP-A/EXP-B（见下）
   独立复现了报告declared的红/绿模式，浏览器实测（报告第四节）也给出了非空选区的正向证据。
4. **阅读态：未被波及。** `widgetIgnoresEvent(event, editable)` 在 `!editable` 时一律
   `return true`，`mousedown` 走不到 `eventBelongsToEditor` 判定之后的阶段，
   `blockStartMouseSelection` 不会被调用——本轮改动全部在这个函数内部，阅读态的调用路径
   本轮完全没有触碰。

---

## 三、我自己动手撤销跑出来的结果

在 `src/editor/live-preview.ts` 上原地改、跑 `vitest run src/editor/live-preview.test.ts`、
`diff` 核对与备份完全一致后用 `cp` 还原，最后 `git status` 干净、`npm run verify` 48/498 全过。

| 撤销的改动 | 结果 | 与报告是否一致 |
| --- | --- | --- |
| EXP-A：删掉顶层 `button/detail/shiftKey/ctrlKey/metaKey` 门禁判据 | **6 条变红**：双击、三击、shift、ctrl、cmd/meta、非左键 | 完全一致 |
| EXP-B：`get` 改回 `() => EditorSelection.single(anchor)`（忽略 `curEvent`） | **1 条变红**（`expected 14 to be 50`）：「mousedown 落在锚点，后续 mousemove…现算落点」；另一条「拿不到位置退回锚点」按报告所说未变红（两版实现在这个退化场景下结果一致） | 完全一致 |
| EXP-C：`fenceContentLineStart` 空代码块分支改回 `return null` | **2 条变红**：`blockStartMouseSelection`「空的围栏代码块」+ `fenceContentLineStart`「空围栏代码块」 | 完全一致 |

另外独立用仓库的 `markdown-it`（不依赖报告贴出的数字）重新解析三组输入，结果与报告、
第 3 轮裁决完全吻合（见第一节 1.2）。`FENCE_OPEN_RE` 上方注释的 `token.map === [0, 5]`
也重新跑了一遍 `md.parse`，数值对得上。

---

## 四、四条 Minor 的核实

1. **`^ {0,3}` 前导空格容差缺覆盖**：已补——`fenceContentLineStart` 描述块新增一条用例，
   开栅栏前置 1 个空格（doc 第 9 行 `` ` ``+ 反引号），断言落点是内容第一行。核对了行号
   计算（startLine=8, endLine=11，非空分支，`doc.line(10).from`），与新增 doc 行吻合。
2. **`token.map` 数字订正**：原「`[4, 9]`」改成「单独成篇 `[0, 5]`，前面另有 4 行时才是
   `[4, 9]`」，我用 `node -e` 独立重跑 `md.parse('```js\nfunction demo() {\n  return 1;\n}\n```\n')`
   得到 `fence [0,5]`，与新注释一致。
3. **`useApplyDefaultMode` 文案**：已改成「没有写入权限，且今天没有原地保存的入口可以申请，
   改动需要用「导出 Markdown」另存一份」，不再承诺「等第一次保存时申请」。全仓
   `grep "第一次保存\|等保存时"` 只剩测试注释里说明「不该再说」的那一行，`grep "mod+s"` 仍然
   只命中文档字符串与其余两个真实存在的组合键，没有任何遗留的 ⌘S 原地保存承诺。
4. **缩进栅栏（1-3 空格）**：单测已覆盖（同 Minor 1）；报告称浏览器里也验证过 1 空格缩进
   代码块的落点（判据 4 表格第 4 行），此项浏览器结果我未复现（见下方未验证项）。

---

## 五、⚠️ 未能验证的项

1. 报告第四节的浏览器实测（拖选/shift/双击/单击落点/空代码块）**我没有重新拉起真实
   Chrome + CDP 复现**——判据链路和判据质量本身没问题（沿用前几轮已验证过的绕法与硬判据：
   源码文本、DOM 完好性），但这是报告方的一次性记录，我只做了 dist 源码链路 + 单测撤销
   验证 + markdown-it 独立复核这三重交叉验证，没有亲眼看到浏览器画面。
2. 第一节 1.1 提到的 `dragging === null`（点击坐标落在残留选区 client rect 内）边界场景
   没有被任何一方实测过，我判断风险很窄、不要求处理，但严格说是一个未覆盖的角落。
