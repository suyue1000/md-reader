# Task 13 第 3 轮审查：eq() 归因复核、⌘S 文案、围栏落点，以及空代码块分歧的裁决

审查对象：`211c9e0..a07bc8e`（两个 commit：`ee7ba10`、`a07bc8e`），4 文件 / +385 −14。

结论先行：

- **规范符合性：✅**（`npm run verify` 我自己跑了两遍：48 文件 / 489 用例全过，退出码 0；
  工作树在 `a07bc8e` 上干净；注释中文且讲「为什么」；提交信息中文、无署名尾注）
- **任务质量：批准（附条件）**
- **空代码块的分歧：控制方（你）对，实现者的「风险等价」判断错了**，依据见第四节
- **本轮引入一条新的 Important**：`blockStartMouseSelection` 把编辑态下「从渲染块上起手的
  拖选 / shift 扩选 / 双击选词」一并钉死了——上一轮刚刚被实测确认修好的那条 Important
  （「编辑态选不中正文」）被这次改动**局部回退**了，见第五节

---

## 一、第 2 轮三件事的核实

### 1.1 `eq()` 的机制归因：**这次是查证过的**

新注释的核心断言是「`compare()`（即 `eq`）为真但实例不同时，CodeMirror 复用的只是 DOM，
`WidgetTile` 换上的是**新** widget 实例」。我自己去 `@codemirror/view` 6.43.11 的 dist 读了
`findWidget`（2555-2578 行）：

```js
if (tile.widget == widget && tile.length == length && (tile.flags & …) == flags) {
    this.reused.set(tile, 1 /* Reused.Full */);
    return tile;                    // 只有实例相同才整块复用
} else {
    this.reused.set(tile, 2 /* Reused.DOM */);
    return new WidgetTile(tile.dom, length, widget, …);   // widget 是新实参
}
```

与注释的说法一致。**归因属实，不是推断**。加上上一轮 review-2 已做过的 dist 对照实验
（去掉 `viewEditable` 比较行为完全一致），这条闭合。

那条用例现在断言的是：读写切换时 `eq() === false`、同一状态下 `eq() === true`。
**这两条性质本身是真的**（我跑了 EXP：见第三节，去掉 `viewEditable` 比较这条用例会红，
说明它锁的确实是现有实现的真实性质）。用例注释被完整重写，明确写了「这条锁的是一道刻意加的
保守防线，**不是**某个缺陷的成因……删掉这条比较不会导致任何已知缺陷复现」——错误理解没有
继续被固化，反而把证伪过程留在了原地。**处理得对。**

唯一的挑剔（Minor，不值得改）：注释里把 dist 里那个缓存类写成 `WidgetViewport`，实际承载
`findWidget` 的类名不是这个；函数名 `findWidget`、行为描述都对。

### 1.2 三处 ⌘S 文案：**当下如实**

| 位置 | 现文案 | 判定 |
| --- | --- | --- |
| `useEditMode.ts:53` | 「未获得写入权限，改动不会写回原文件，可用「导出 Markdown」另存一份」 | ✅ 不再承诺不存在的按键；`export-markdown` 动作今天真实存在（`useToolbarActions.ts:258-259`，我核过） |
| `useEditMode.ts:58` | 同上（无句柄分支） | ✅ |
| `EditorSection.tsx:16` | 「……关掉它之后，改动需要你手动用「导出 Markdown」另存一份（原地保存的快捷键还未加入）」 | ✅ 「还未加入」是当下事实 |
| `useEditMode.ts:35`（顺带改的 JSDoc） | 「⌘S 要到 Task 17 才会真正接上，现在按它只会触发浏览器自己的『保存网页』对话框」 | ✅ 且 **Task 号是对的**：`task-17-brief.md:183` 的动作定义里才有 `hotkey: 'mod+s'`（review-2 写的「Task 15」反而不准） |

全仓复核：`grep -rn "mod+s" src` 只命中 `hotkeys.ts` 的文档字符串与 `useToolbarActions.ts` 的
`mod+shift+o` / `mod+shift+e`，**确实没有任何 `mod+s` 绑定**。

**仍留一处未被清理的、承诺未来机制的文案**（Minor）：`useApplyDefaultMode` 的提示条
「已按设置进入编辑态；写入权限要等第一次保存时才能申请」。今天**没有任何原地保存路径**
（`grep` 保存链路只有 `src/export/download.ts` 的导出/下载），所以「第一次保存」同样是一件
今天不会发生的事。实现者在报告里明说这是刻意留的（Ruling R41 的设计意图，且不再点名 ⌘S），
比原文案软，不阻断，但它是同一类问题的最后一块残片，建议 Task 17 接上 `mod+s` 时一并回收。

### 1.3 落点统一：**做到了，且我用撤销实验确认过用例有效**

`blockStartMouseSelection` 通过 `EditorView.mouseSelectionStyle` facet 接管块 widget 上的
mousedown，返回固定落点，绕开 `posAtCoords` 的几何中点规则（dist 里那段中点代码我核对过，
与注释引用一致）。`pre` 不再落块尾——EXP2（第三节）把围栏例外拿掉后落点回到块首、用例变红，
说明落点逻辑确实被用例锁住。

---

## 二、第 3 轮的核实（围栏代码块落点改到内容第一行）

实现与报告一致：

- 新增 `FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/` 与 `fenceContentLineStart(doc, block)`；
  落点表达式为 `fenceContentLineStart(...) ?? doc.line(block.startLine + 1).from`。
- 判据**只读源码文本**（`doc.line(block.startLine + 1).text`），不摸 HTML class、不查 token。
- 边界守卫齐全：`startLine + 1 > doc.lines`、`endLine > doc.lines`、空代码块
  （`endLine - startLine <= 2`）全部返回 `null` 回退，越界不抛错。

**范围确实收着做了**，我逐项核过：本次 diff 只动 4 个文件
（`live-preview.ts`、`live-preview.test.ts`、`useEditMode.ts`、`EditorSection.tsx`），
`block-render.ts` / `block-slice.ts` **一个字没动**，`RenderedBlock` **没加字段**，
`h2`/`p`/`li`/引用块的落点逻辑没有被碰（且新增了一条引用块用例专门防「围栏例外泛化到多行块」）。
**没有任何超出这两轮范围的夹带改动。**

一处注释里的数字不成立（Minor，但正是本项目的老毛病）：
`FENCE_OPEN_RE` 上方写「用 markdown-it 直接解析核对过：`` ```js\nfunction demo() {\n  return 1;\n}\n``` ``
得到 `token.map === [4, 9]`」。我用仓库里的 markdown-it 解析**引用的这串输入**，得到的是
`map = [0, 5]`；`[4, 9]` 只有在这段 fence 前面另有 4 行时才成立（我构造了这样的文档，确认
得到 `[4,9]`）。也就是说**结论对（块首那一行就是开栅栏），但注释里贴的输入与贴的数字对不上**，
下一个人照着复现会对不上号。建议把输入补全或把数字删掉。

### 实现者第 3 轮浏览器实测的可信度

可信、但**覆盖不够**：

- 可信的部分：环境沿用 8c/8d/review-2 的绕法（真 dist + 真 Chrome + CDP 真实事件），
  判据是「敲字后开/闭栅栏两行的源码文本」与「第 2/3 章 DOM 是否完好」，都是能证伪的硬判据；
  且刻意点在块可视高度 85%（几何中点规则下最容易复现旧问题的位置），阳性对照在第 2 轮做过
  （去掉接线后同一坐标复现旧落点）。「总渲染块数 12」这个判据本身弱（它只说明没有块被吞并），
  但配合「第 2 章标题 + 代码内容完好」是够的。
- 不够的部分：**这一轮没有重做阳性对照**（第 3 轮的对照是第 2 轮的记录）；**没有测拖选**
  （而拖选正是上一轮刚闭合的 Important，也正是本轮回归的地方，见第五节）；
  空代码块只测了文末那一个（后面没有可配对的裸栅栏，属最坏情形，这点报告说清楚了）；
  没测缩进 0-3 空格的开栅栏（单测里也没有，见 EXP4）。

---

## 三、我自己动手撤销跑出来的结果

全部在工作树上改 → 跑 vitest → 观察 → `cp` 还原；最后 `git status` 干净、`npm run verify`
48/489 全过。

| 撤销的改动 | 结果 |
| --- | --- |
| **EXP1**：删掉 `EditorView.mouseSelectionStyle.of(blockStartMouseSelection)` 这一行接线 | **变红 1 条**：「接线：`EditorView.mouseSelectionStyle` facet 里确实注册了这个函数」（`expected null not to be null`）。假绿被堵住了 |
| **EXP2**：去掉围栏例外（落点回到一律块首，`fenceContentLineStart(...) ??` 拿掉） | **变红 2 条**：「点在围栏代码块上，落点是开栅栏下一行」与接线用例，`expected 8 to be 14` |
| **EXP3**：去掉空代码块守卫（`endLine - startLine <= 2`） | **变红 2 条**：「空代码块退回块首」与「空围栏代码块返回 null」 |
| **EXP4**：把 `FENCE_OPEN_RE` 的前导空格容差 `^ {0,3}` 去掉 | **全绿（28/28）**——这条分支没有任何用例覆盖。Minor：加一条「缩进 1-3 空格的开栅栏也认」的用例即可 |

另做一条**回归探针**（临时用例，跑完已删除，`git status` 干净）：把
`blockStartMouseSelection` 返回的 style 拿到手，先用 mousedown 事件调 `get()`，再用一个落在
**另一个块**上的 mousemove 事件调 `get()`，并用 `extend = true` 再调一次——

```
down: {"from":0,"to":0} ; after move over p2: {"from":0,"to":0} ; extend=true -> {"from":0,"to":0}
```

三次完全一样。这条探针是第五节那条新 Important 的直接证据。

---

## 四、空代码块落点的裁决：**控制方对，实现者错**

实现者的原话是「行尾和行首都是在同一行栅栏语法上插入字符，**风险等价**，换不来任何好处，
只是从『破坏开栅栏』换成『破坏开栅栏』」。

用仓库里的 markdown-it 直接解析对比 token 流（三种输入，尾部都接 `\n\n## 第二章\n\n第二章正文。`）：

**空代码块（``` 紧跟 ```）**

| 输入 | token 流 | 后果 |
| --- | --- | --- |
| `` ```\n``` `` 原状 | `fence map=[0,2]` + `heading` + `paragraph` | 正常 |
| **行首敲 Z**：`` Z```\n``` `` | `paragraph map=[0,1]` + `fence map=[1,6] content="\n## 第二章\n\n第二章正文。\n"` | **配对断裂，其后内容被整段吞进代码块，一路到文末** |
| **行尾敲 Z**：`` ```Z\n``` `` | `fence map=[0,2] info="Z"` + `heading` + `paragraph` | **仍是合法围栏，配对存活，后续内容毫发无损** |

**非空代码块（``` js 那一档，顺手一并验了）**

| 输入 | 结果 |
| --- | --- |
| 行首敲 Z：`` Z```js `` | `paragraph` + `fence map=[2,7]`，**吞掉 `## 第二章` 与正文** |
| 行尾敲 Z：`` ```jsZ `` | `fence info="jsZ" map=[0,3]`，标题与正文**原样保留** |

**所以「风险等价」不成立**：行尾插入的字符落进的是 **info string**，行首插入的字符改的是
**栅栏本身**。CommonMark 里 info string 是自由文本，栅栏是配对语法——这不是同一种东西。

最坏后果的量级也按你说的走：行尾那条的最坏后果只是**语言识别失效**。我核了本项目的渲染链路，
`resolveLanguage()`（`src/markdown/highlighter.ts:87`）对认不出的语言返回 `null`，
`highlightCode()` 随即降级为 `lang: 'text'`，**不抛错、不发请求、只是没有语法高亮**。
行首那条的最坏后果是**吞掉后续内容直到文末**（上表第二行的 `content` 里赫然是整段后文）。

我额外找了三条可能翻盘的因素，都没能救「风险等价」这个判断：

1. **敲的字符是反引号时，两者确实等价**：空代码块 `` ``` `` 无论在行首还是行尾插一个反引号，
   得到的都是同一串 `` ```` ``（4 个反引号的开栅栏，3 个反引号的收尾栅栏配不上它），
   实测 `fence map=[0,6]`，一路吞到文末。也就是说行尾**在这一种字符上打平，在其余所有字符上完胜**，
   没有任何一种输入让行尾比行首更糟。
2. **CodeMirror 的选区 API 没有行尾/行首之别**：两个位置都在同一条
   `Decoration.replace({block: true})` 的 `[from, to]` 内部，本仓库没有注册任何
   `EditorView.atomicRanges`（我 grep 过），`buildDecorations` 判定「光标所在块」用的是
   行号区间，行首行尾同样命中。`EditorSelection.single(line.to)` 与 `single(line.from)` 走的是
   同一条路。
3. **判据不会因此复杂化**：`fenceContentLineStart` 现在对空代码块返回 `null` 让调用方回退；
   改成返回 `doc.line(block.startLine + 1).to` 即可，是同一个分支里的一行改动
   （函数名届时应改成 `fenceLandingPos` 之类，语义才对得上）。

顺带一条不是决定性、但站在行尾这一边的理由：空代码块里在开栅栏**行尾**按回车，得到的是
`` ```\n\n``` ``——刚好腾出一行代码内容，正是用户点空代码块时想要的；在**行首**按回车只是把
栅栏整体往下推。

**裁决：空代码块的落点应改为开栅栏行尾**（`doc.line(block.startLine + 1).to`），
并把那两条用例（`blockStartMouseSelection` 的「退回块首」与 `fenceContentLineStart` 的
「返回 null」）与相应注释一并改掉。注释里要如实写：行尾只保护到「敲普通字符」这一档，
敲反引号、退格仍会破坏配对——那是 Markdown 栅栏语法本身的脆弱性，不是这条落点能解决的。

这条按 **Important** 记（不阻断本轮，但结论明确，不是「见仁见智」）。

---

## 五、本轮引入的新问题：编辑态从渲染块上起手的拖选 / shift 扩选 / 双击选词被钉死

这是本次审查最要紧的**新**发现，`ee7ba10` 引入。

`blockStartMouseSelection` 返回的 style 是：

```ts
let selection = EditorSelection.single(pos);
return {
  get: () => selection,                       // 忽略 event / extend / multiple
  update(update) { if (update.docChanged) selection = selection.map(update.changes); return false; },
};
```

而 CodeMirror 的鼠标手势**全程**依赖这个 `get`（`@codemirror/view` dist）：

- `MouseSelection.move(event)`（4762-4767）在**每一次 mousemove** 上调 `this.select(this.lastEvent = event)`；
- `MouseSelection.select(event)`（4825-4826）：
  `selection = skipAtomsForSelection(this.atoms, this.style.get(event, this.extend, this.multiple))`；
- 内置的 `basicMouseSelection`（5026-5053）正是在这里按 `event.clientX/Y` 重新取坐标、
  按 `extend`（shift）扩选、按 `multiple`（⌘/Ctrl）加范围、按 `getClickType(event)`
  处理双击选词 / 三击选行。

我们的 style 把这四件事**全部**丢掉了。第三节那条回归探针实测：mousedown 之后，把一个落在
**另一个块**上的 mousemove 交给 `get()`，返回的还是同一个**空**选区；`extend = true` 也一样。

后果（编辑态，鼠标从**渲染块**上按下时）：

- **拖选选不中任何东西**——上一轮 review-2 在 `211c9e0` 上实测拖选已从 `""` 修成
  `"第 7 章的正文段落，这一段"`，本轮把它按回了「一个塌缩的光标」；
- **shift+点击不扩选**；
- **双击不选词、三击不选行**（`getClickType` 根本没被问到）。

判定 **Important**（贴近 Critical：这是编辑器最基本的鼠标手势之一，且是上一轮刚被宣告闭合的
同一条 Important 的回退；但它不改文档、不写坏文件，键盘 shift+方向键仍可选，所以不升级）。

**建议改法**（不必推翻本轮方案）：只钉住「起手那一下」，其余手势交还 CodeMirror。两条路都行：

1. 在 provider 入口就放行非单击手势——`if (event.detail > 1 || event.shiftKey || event.metaKey || event.ctrlKey) return null;`
   让 `basicMouseSelection` 接管双击 / shift / 多选；
2. `get(event, extend, multiple)` 里判断：事件就是那次 mousedown 时返回钉住的落点，
   否则改用 `view.posAtCoords(event)` 计算（此时目标块已经让出源码，坐标能算准），
   并按 `extend` 从钉住的锚点扩选。

**⚠️ 这条没有做浏览器实测**：证据是 dist 源码链路 + 单测探针，逻辑上闭合（`get` 忽略入参是
硬事实，CodeMirror 在 mousemove 上调 `get` 也是硬事实），但真机上的表现没有被我亲眼看到。
下一轮修它时应当顺带在浏览器里对照一次「拖选 → `document.getSelection().toString()`」，
判据与 review-2 第 2.4 节完全一致，成本很低。

---

## 六、结论

### 规范符合性：✅

`npm run verify` 我独立跑了两遍：typecheck / eslint / vitest 全过，**48 文件 / 489 用例**
（与报告一致；第 2 轮基线 483、第 1 轮 478，增量 6 条也对得上）。TypeScript strict 下无新
`any` / 无 `@ts-expect-error`；注释中文、密度与 `file-open.ts` / `chunker.ts` 同级，且这次把
「为什么不选另外两个方案」写进了注释；新增代码零网络请求（判据只读 `doc` 文本）；
两条提交信息中文、分条讲清「为什么」，**无署名尾注**；工作树干净、无夹带改动。

### 任务质量：批准（附条件）

第 2 轮点名的三件事全部落实，`eq()` 这次是真查证过的（本项目连栽四次之后第一次闭合）；
第 3 轮的围栏落点是一个真实的改善，范围收得住，用例能红。放行条件如下（都不必回炉，
下一个任务捎带）：

| 级别 | 问题 |
| --- | --- |
| **Important（本轮新增）** | `blockStartMouseSelection` 的 style 忽略 `event`/`extend`/`multiple`/点击次数，编辑态从渲染块起手的**拖选、shift 扩选、双击选词、三击选行**全部失效——回退了 review-2 刚闭合的那条 Important。证据：dist `MouseSelection.move/select`（4762-4767、4825-4826）+ 单测探针。⚠️ 未做浏览器实测 |
| **Important（裁决）** | 空代码块应落**开栅栏行尾**而不是块首：行尾插入的字符进的是 info string（仍是合法围栏，最坏只是高亮降级为纯文本），行首插入的字符破坏栅栏（吞掉后续内容直到文末）。markdown-it token 流实测见第四节。实现者「风险等价」的判断不成立 |
| **Minor** | `FENCE_OPEN_RE` 的 `^ {0,3}` 前导空格容差没有任何用例覆盖（EXP4 去掉它全绿） |
| **Minor** | `FENCE_OPEN_RE` 上方注释里「解析 `` ```js…``` `` 得到 `token.map === [4,9]`」——引用的输入实际得到 `[0,5]`，`[4,9]` 需要前面另有 4 行。结论对、数字与输入对不上 |
| **Minor** | `useApplyDefaultMode` 的提示条仍写「写入权限要等第一次保存时才能申请」，而今天没有任何原地保存路径（只有导出/下载）。比原文案软、实现者刻意留作设计意图，建议 Task 17 接上 `mod+s` 时回收 |
| **Minor（沿用）** | 落点仍只到「行」，不到点中的字符；review-2 的其余遗留项（退出编辑态与 store 的内容背离、纯键盘用户无入口、提示条消失后看不出无写权限）本轮未触及，仍然挂着 |

### ⚠️ 未能验证的项

1. **第五节那条拖选回归没有浏览器实测**（证据为 dist 源码 + 单测探针）。
2. **第 3 轮的浏览器实测我没有复现**（没有重跑 Chrome/CDP）：其数字的可信度是按判据质量与
   第 2 轮已建立的阳性对照来评估的，不是我亲眼所见。
3. **空代码块落行尾的建议只在 markdown-it 层面验证**（token 流对比 + 渲染降级路径代码核对），
   没有在真浏览器里点一次空代码块敲一个字。
4. 缩进 1-3 空格的开栅栏、波浪线栅栏（`~~~`）在浏览器里都没被测过（单测里 `~~~` 只在正则里）。
