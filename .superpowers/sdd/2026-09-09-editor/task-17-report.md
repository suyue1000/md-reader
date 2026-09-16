# Task 17 实现报告：自动保存、脏状态与关页拦截

## 完成概述

把 Task 14/15/16 造好但从未被调用过的保存链路第一次接上电：新增
`src/hooks/useAutoSave.ts`（停笔防抖自动保存、脏状态、关页拦截、即时保存命令），
`document.store` 增加 `dirty / saveStatus / saveError / lastSavedAt` 与
`setDirty / setSaveStatus / markSaved`，`ReaderPage` 持有编辑器正文并交给
`useAutoSave`，工具栏新增「保存」（`mod+s`）与「回到上一个保存版本」，状态栏
新增保存状态与「无法写回原文件」的常驻提示，切换文档前加了未保存确认。

**`performSave` 从此有了两个真实入口**：停笔 800ms 的防抖定时器（automatic）
与 ⌘S / 工具栏按钮（manual）。

## 交付文件

新增：
- `src/hooks/useAutoSave.ts`、`src/hooks/useAutoSave.test.tsx`（10 用例）
- `src/components/layout/StatusBar.test.tsx`（7 用例）
- `src/hooks/unsaved-guard.test.tsx`（5 用例）

修改：
- `src/stores/document.store.ts`：新增四个字段与三个 action；`setDocument` /
  `reset` 一并复位（否则新开一份干净文档会顶着上一篇的「未保存」，连带让关页
  拦截对着没改过的文档弹确认）
- `src/viewer/pages/ReaderPage.tsx`：`draftRef` 换成 `text` state，接
  `useAutoSave(text)`，`value={text}` / `onChange={setText}`
- `src/components/layout/StatusBar.tsx`：`SaveIndicator` + `WriteTargetIndicator`
- `src/hooks/useToolbarActions.ts`：`save` / `restore-version` 两个动作，
  并给 `mod+f`、`mod+p` 补上 `allowInInput`
- `src/hooks/useOpenFile.ts`、`src/hooks/useWorkspace.ts`：切换文档前确认
- `src/hooks/useEditMode.ts`、`src/editor/save.ts`、
  `src/components/settings/sections/EditorSection.tsx`：回收「⌘S 还没接上」
  这类现在已经作废的文案与注释
- `src/hooks/useGlobalHotkeys.test.tsx`、`src/hooks/useEditMode.test.tsx`、
  `src/viewer/pages/ReaderPage.test.tsx`：随行为变化调整并补接线用例

## 三条接线的落实

### 1. `markSaved` 回写

按简报实现，并在注释里写明它的语义：把 `document.content` 推进到刚写下去的
文本（「上次与磁盘一致的内容」，是脏判定与冲突判定的共同基准，不是渲染输入）。

**但 T16 移交时的说法需要修正一处**：它写的是「不做这件事，每次保存后都会
立刻被自动刷新误判为冲突」。实际查证下来，保存后到下一次轮询之间挡在冲突
前面的有**三道**网，`markSaved` 是最后一道：

1. 时间戳比对：`probeCurrentFile` 先只读 `lastModified`，与 store 里的一致就
   直接返回 `unchanged`——而 `markSaved` 同时推进了 `lastModified`，所以这道
   网本身也依赖它；
2. 自写登记表（`self-write.ts`，只留最近 12 条）：命中就只对时；
3. `markSaved` 推进 `document.content`，于是 `decideRefresh` 看到磁盘内容与
   「上次落盘内容」相同，走 `touch-timestamp`。

所以准确的说法是：**前两道网失效时（自写登记滚过 12 条、或时间戳比对被绕过），
缺了 `markSaved` 就会真的报冲突**；而 `markSaved` 更日常的价值是脏状态——
没有它 `dirty` 永远为真，状态栏常亮「未保存」、每次停笔都把同一份内容再写一遍、
关页永远弹确认。`useAutoSave.test.tsx` 里那条冲突用例就是**显式拆掉前两道网**
（`clearSelfWrites()` + mock 掉探测强制报 changed）之后测第三道的，注释里写明了
这是刻意的降级构造，不是「每次保存都会这样」。

### 2. `mod+s` 的 `allowInInput: true`

已加，并在动作声明处注明它是最需要这一项的一个。`useGlobalHotkeys.test.tsx`
新增「编辑态下在可编辑正文里按 mod+s 真的写盘」——删掉这一项它准确变红
（见下方自检）。

### 3. `writable = false` 的持久出口

`StatusBar` 新增 `WriteTargetIndicator`：编辑态且 `writable` 为 false 时常驻显示
「⚠ 无法写回原文件，⌘S 另存」（`--app-warning` 色，快捷键文案按平台用
`formatCombo` 算，Windows 上是 Ctrl+S）。

**只在编辑态显示**，这是刻意的：阅读态下 `writable` 为 false 是常态（写权限只在
点「编辑」那一下申请），那时报「无法写回」既没有意义也不准确——根本还没问过
浏览器。

## 五条硬性验收判据的实测结果

### 实测环境（先说清可信度边界）

沿用 8c/8d 的办法并按要求加了 `--disable-backgrounding-occluded-windows` 与
`--disable-renderer-backgrounding`：真实 Chrome **153.0.8010.36**（有头）、
`npm run build` 的**真实 dist** 挂在 `http://127.0.0.1:8731`、Node 22 内置
WebSocket 直连 CDP、临时 profile 用完即删。驱动脚本是临时文件（未入库，跑完
已清理），复现所需的全部信息——替身的形状、注入时机、判定方式——都写在下面。

被替身的只有两处，都不在保存链路上：

1. **`chrome.storage`**：扩展装不进来（Chrome 152+ 已移除 `--load-extension`）。
   实测发现 `Page.addScriptToEvaluateOnNewDocument` 那份注入**根本没生效**
   （拿到的是原生 `showOpenFilePicker` 抛的 `SecurityError: Must be handling a
   user gesture`，且 `window.__injected` 计数为 1 = 只有载入后那次执行过），
   改成载入后用 `Runtime.evaluate` 注入。代价是它晚于 `hydrate()`，因此**设置
   走的是内存驱动、全程为默认值**（自动保存开、防抖 800ms）——本次五条判据
   都不需要改设置，需要「有未保存改动」的场景改用「没有写权限」制造。
2. **`showOpenFilePicker`**：替身返回一个**真实的 `FileSystemFileHandle`**
   （OPFS 里的文件）。`createWritable()` / `write()` / `close()` / `getFile()` /
   `queryPermission()` 全部是 Chrome 的真实实现，字节真的落在磁盘上。

**做不到的那一件**：真实的文件选择器与写权限授权弹窗是浏览器原生 UI，CDP
驱动不了（`Browser.grantPermissions` 的枚举里没有文件系统写权限，也没有自动
授予的命令行开关）。因此「用户在系统对话框里选中文件、并在权限气泡里点允许」
这一步没有被真实执行；替身直接给出授权之后的状态。顺带量到一个事实：**真实
OPFS 句柄的 `queryPermission({mode:'readwrite'})` 答复就是 `granted`**（打印在
实测日志里），所以「已授权句柄」这一侧不是我编的。

### 判据 1：真的写了一次磁盘上的文件 —— 通过

夹具 173 字节（含行尾空白、硬换行、连续空行、制表符、混用列表标记、emoji），
在编辑器里真敲入 `【改】`（先 `Input.dispatchMouseEvent` 真实点击取焦点，再
`Input.insertText` 走真实输入路径），停笔后状态栏出现「已保存」。

- 从**浏览器里另一条路径**（不经过编辑器状态，直接 `getFile()` 读 OPFS）读回：
  **182 字节**，正好是 173 + 9（`【改】` 三个字符 × 3 字节）。
- 从**浏览器之外**：Node 遍历 Chrome profile 目录，在
  `<profile>/Default/File System/000/t/00/00000003` 找到内容**完全一致**的
  文件（命中 1 个）。这是「用编辑器之外的方式确认磁盘上的文件真的变了」。

### 判据 2：除改动处之外全文逐字节未变 —— 通过

把「原始 → 落盘」做最长公共前缀/后缀切分，结果是**一次纯插入**（被删除的
区间为空），插入内容恰好是 `"【改】"`。也就是说行尾的两个空格（Markdown 硬
换行）、三个连续空行、制表符缩进、行尾留白、混用的 `-` / `*` 列表标记、代码块
里的行尾空白，**一个字节都没有被动过**——保存这条路上确实没有 `normalizeMarkdown`。

一处如实说明：这次点击把光标落在了文档位置 0，所以插入点在开头（偏移 0）。
比对是对**整个文件**做的，因此「其余部分未变」这条结论不受插入位置影响；但
「在文档中段插入」这个具体情形本次没有单独跑。

### 判据 3：保存后不会被自动刷新误判为冲突 —— 通过

保存落地后连续观察 **7 秒**（轮询间隔 1.5s，≥4 轮）：
- `[role="alert"]`（`ConflictBanner`）**始终没有出现**；
- 编辑器里的文本没有被回灌；
- 文件内容也没有再被改写。

一处如实说明：`window.__editorText()` 没能从 DOM 上拿到 `EditorView` 实例
（日志里写明「编辑器文本读取方式：textContent」），所以「编辑器内容没被回灌」
这条是按**渲染后的文本**比对的，不是按源文档字符串。冲突条未出现 + 文件未变
两条是直接观察。

### 判据 4：关页拦截 —— 通过

有未保存改动时 `Page.navigate` 到 `about:blank`，收到
`Page.javascriptDialogOpening`，**`type` 为 `beforeunload`**，随后用
`handleJavaScriptDialog({accept:false})` 留在页面上。

（第一次跑这条时报 `Not attached to an active page`——那是实测台自己的问题：
对话框一弹出页面就被挡住，`await` 那条 `Page.navigate` 等于在处理对话框之前
先把自己抛出去。改成不 await 导航、只等对话框事件后通过。）

### 判据 5：`writable = false` 时状态栏常驻显示 —— 通过

权限答复为 denied 的会话里，状态栏实测文本：

```
task17-实测.md 173 B 已停止 无法写回原文件，⌘S 另存 ● 未保存 宽度 980px 就绪
```

并且 —— **等了 3 秒（远超 800ms 防抖）之后，文件一个字节都没被写**，与
`decideSaveTarget`「自动保存 + 写不回去 = 什么都不做」一致，不会变成对话框
机关枪。

其中的「已停止」是**替身的副作用不是产品行为**：我的权限代理对任何 mode 都
答 denied，包括轮询用的 `{mode:'read'}`，于是 `probeCurrentFile` 报
`permission-lost`、监听停止。真实场景里读权限还在，这一格会是「监听中」。

### 简报里另一条人工验收：没做

简报 Step 7.3「编辑态持续打字 30 秒，光标不跳动、不闪回」**本次没有跑**。
本次只验证了一次插入之后光标与内容正常。这条留作缺口如实记录。

## 快捷键在编辑态的逐项评估

背景：`allowInInput` 不显式开就等于没有——编辑态正文是 contenteditable，
`isEditableTarget` 对每一次按键都返回 true。原先只有 `mod+b`、`mod+e` 开着。

先查证了一件事，它是下面几条判断的前提：`MarkdownEditor` 只挂了
`defaultKeymap` 与 `historyKeymap`，**没有**挂 `@codemirror/search` 的
`searchKeymap`。翻 `@codemirror/commands` 的 dist，这两套 keymap 里带 Mod 的
绑定只有 `Mod-a/i/u/y/z` 与若干方向键类（`Mod-ArrowLeft` 等），**没有
Mod-s / Mod-f / Mod-p**。所以下面开的三个都不会盖掉编辑器自身的行为。

| 快捷键 | 动作 | 结论 | 理由 |
| --- | --- | --- | --- |
| `mod+s` | 保存 | **开**（本次新增） | 用武之地几乎全在编辑态；不开就只剩浏览器的「保存网页」，而用户以为自己存好了 |
| `mod+f` | 查找正文 | **开**（本次改） | 「在正在写的长文里找一处」正是最需要它的时候。让位给浏览器原生查找在这里是**有害**的：正文按视口逐块渲染，原生查找只找得到屏幕上那几块，自研查找搜的是完整源文本 |
| `mod+p` | 打印 / 导出 PDF | **开**（本次改） | 同上，而且更严重：原生打印印的是屏幕 DOM，编辑态下印出来只有视口附近那几块；我们这条路会先整篇离屏渲染 |
| `mod+b` | 侧边栏 | 维持开 | 不产生文本。**留一个记号**：若将来加「加粗」这类格式化命令，⌘B 是它的常规归属，届时这条要重新裁决 |
| `mod+e` | 进出编辑态 | 维持开 | 不开就进得去出不来（Task 13 的原缺陷） |
| `mod+o` | 打开文件 | **维持关** | 打字时误触的代价不对称：让给浏览器的话它会把当前标签页导航去打开的文件，而那条路现在已经被关页拦截挡住（有未保存改动会弹确认），不会丢数据。留着不开，换取打字时不被一个文件对话框打断 |
| `mod+shift+o` | 打开文件夹 | **维持关** | 同上，且 Chrome 上 ⌘⇧O 是书签管理器，误触后果无害 |
| `mod+shift+e` | 导出 HTML | **维持关** | 与正在写的内容无关，编辑态里没有非抢不可的理由 |
| `mod+,` | 设置 | **维持关** | 同上。它现在还兼任测试里的「对照组」，用来证明可编辑判断本身没坏 |

顺带说明一条现在的行为：**阅读态按 ⌘S 什么都不会发生**（编辑器内容与上次
落盘内容一致，`decideSaveTarget` 判成 clean），只是顺带把浏览器的「保存网页」
挡掉了。保存按钮因此也没有按编辑态置灰——按了没反应比按钮变灰更省事。

## 自检：删行验证

四处关键行逐一删除、跑完整套件、再还原（还原用的是文件备份而不是
`git checkout`——本次改动尚未提交，`git checkout` 会把整轮工作一起抹掉）：

| 删掉的行 | 变红用例数 | 变红的用例 |
| --- | --- | --- |
| `runSave` 里的 `store.markSaved(text, outcome.lastModified);` | **4** | 保存成功后推进 content / 保存后不被误判成冲突 / 回到上一个保存版本 / 编辑态按 mod+s 真的写盘 |
| save 动作的 `allowInInput: true,` | **1** | 编辑态下在可编辑正文里按 mod+s 真的写盘 |
| 自动保存的防抖触发 `if (mode === 'edit' && enabled && dirty) scheduleRef.current?.();` | **3** | 停笔到点后写回文件 / 保存成功后推进 content / 保存后不被误判成冲突 |
| `window.addEventListener('beforeunload', handler);` | **1** | 有未保存改动时拦下关页 |

四处都有测试兜底，删除后确实变红；还原后 `git status` 与还原前一致，
`npm run verify` 全绿。

## 遇到的问题与判断

1. **简报给的 `ReaderPage` 同步写法会吞掉用户新敲的字。** 简报建议
   `useEffect(() => setText(doc?.content ?? ''), [doc?.id, doc?.content])`。
   但 `markSaved` **也会改 `doc.content`**（改成刚写下去的那份），而保存是
   异步的——用户在写盘那几十毫秒里又敲了几个字的话，这个 effect 会把编辑器
   倒回写盘那一刻的文本，刚敲的字当场消失、光标跳走。改成用
   `openEpoch + lastRefreshedAt` 作为「这份内容是外部给的」标记：这两个都不会
   被 `markSaved` 碰到，正好把「外部来的内容」与「我们自己刚存的内容」分开。
   `ReaderPage.test.tsx` 里「保存回写时不会把写盘之后新敲的字吞掉」就是钉这条的。
   同时改成**渲染期调整 state**（React 官方的「随 props 变化重置 state」，仓库里
   `FileTreePanel` 用的是同一招）而不是 effect：放 effect 里的话，换文档那一次
   提交里子组件会先拿着上一篇文档的文本重建一遍编辑器（子 effect 早于父 effect）。
   已知边界：同一毫秒内连续两次自动刷新会被这个标记认成同一次——轮询间隔
   下限 500ms，真实场景到不了。
2. **`useAutoSave` 不能被实例化两次**，否则两个防抖定时器对同一份文本各存
   一次盘、两个 `beforeunload` 各拦一次。所以它只挂在 `ReaderPage`（全应用一份），
   而工具栏与快捷键要的「立刻存一次」拆成了 `useSaveCommands`（不排定时器、
   不挂监听，多份实例无害）。这与 `useApplyDefaultMode` 不并进 `useEditMode`
   是同一条理由。
3. **⌘S 要保存的文本不能从 `useEditorView()` 取。** `useGlobalHotkeys()` 是在
   `App` 的组件体里调用的，而 `EditorViewProvider` 是 `App` 渲染出来的子树，
   组件体读到的是 provider 之外的默认值 null。真按 view 取，⌘S 会拿到
   `document.content`（上次落盘的那份），`decideSaveTarget` 判成 clean——
   **按 ⌘S 什么都不会发生**。所以编辑器正文存在模块作用域的一份草稿里，由
   `useAutoSave` 那个唯一实例写入。
4. **顺带发现一个既有问题（本次未修）**：`useExport` 也从 `useEditorView()`
   取「当前文本」，于是同一个原因让**快捷键那一路的导出**（⌘⇧E）拿到的是
   `doc.content` 而不是编辑器里的活文本，工具栏按钮那一路则是对的。也就是说
   编辑态下用快捷键导出 HTML，导出的是改动之前的内容。不属于本任务范围，
   如实记录移交。
5. **eslint 的 `react-hooks/refs` 不允许在渲染期把读 ref 的函数交给
   `debounce`**，因此防抖器改在 effect 里创建；声明顺序有硬要求（建防抖器的
   effect 必须排在排期的 effect 之前，否则首次改动永远等不到自动保存），
   注释里写明了。
6. **实测台踩的三个坑**（都已查证成因，不是猜的）：工具栏按钮的 `aria-label`
   带着快捷键后缀（`切换侧边栏 (⌘B)`），选择器要用前缀匹配；
   `addScriptToEvaluateOnNewDocument` 的注入没生效，改成载入后注入；
   beforeunload 对话框挡住页面时不能 `await Page.navigate`。

## 质量检查

```
Typecheck: PASS
Lint:      PASS
Test:      PASS (57 文件 / 559 用例)
```

基线 54 文件 / 533 用例 → 57 文件 / 559 用例（+3 文件 / +26 用例）：
`useAutoSave.test.tsx` 10、`StatusBar.test.tsx` 7、`unsaved-guard.test.tsx` 5，
`useGlobalHotkeys.test.tsx` +2（mod+s 写盘、mod+f 在编辑态生效），
`ReaderPage.test.tsx` +2（脏状态接线、保存回写不吞字）。10+7+5+2+2 = 26。

---

# 复审轮追加：两项必修 + 三条 Minor + 两条补做的实测

## 必修 1：快捷键发起的打印 / 导出会用改动**之前**的内容

### 先更正我上一轮说法里的两处不准

1. 我写的是「⌘⇧E 导出的是改动之前的内容」。**不准确**：`export-html` 没有
   `allowInInput`，而 `useHotkeys` 的判据是
   `if (editable && binding.allowInInput !== true) continue;`——焦点在
   `.cm-content`（编辑态的常态）时 ⌘⇧E **整个不触发**，连导出都不会发生。
   真正可达的是「编辑态但焦点在编辑器之外（点过侧栏/工具栏/状态栏）」或
   「改完退回阅读态之后」。
2. **我漏掉了更要紧的一半**：本轮我给 `mod+p` **新开了** `allowInInput`，
   而打印走的是同一个拿不到 `EditorView` 的 `useExport` 实例。于是**从本轮起**，
   编辑态下焦点在正文里按 ⌘P，会用改动之前的内容打印 / 出 PDF，全程没有提示——
   而这恰恰是编辑态最常见的姿势。这是本轮改动引入的回归，不是既有问题。

### 修法（3 行）

`useAutoSave` 导出 `getDraftText()`，`useExport` 的 `currentText` 改成三级回退：

```ts
view?.state.doc.toString() ?? getDraftText() ?? doc.content
```

中间那一级不是可有可无的：本 hook 经 `useToolbarActions` 有**两份实例**，
工具栏那份在 provider 里（view 拿得到），`useGlobalHotkeys` 那份在 `App` 的
组件体里、provider 之外（view 恒为 null）。⌘S 早先踩的是同一个坑，用的也是
同一份模块级草稿。

### `mod+shift+e` 的 `allowInInput`：**维持关闭**，并说明为什么这不算「留一半」

协调者要求不要留下「一个入口对、另一个入口悄悄给错结果」的状态。修完之后
**没有任何入口会给出错误结果**——两个入口的内容来源已经统一到同一份草稿。
⌘⇧E 在编辑态不触发属于「安全的失败」（什么都不发生，键让给浏览器），与我
上一轮记录的逐项评估一致：导出与正在写的内容无关，不值得在打字时抢这一下。
⌘P 必须开是因为它的替代行为是**错的**（原生打印只印视口那几块），⌘⇧E 的
替代行为是**没有行为**，两者不对称，结论也就不同。

### 测试与撤销验证

`useExport.test.tsx` 新增两条（都在「拿不到编辑器实例时」这个 describe 下）：
「导出拿的是编辑器里的活文本」与「打印也一样：纸上必须有刚写的内容」。

把 `getDraftText() ??` 去掉 → **3 条变红**：上面两条新增的，外加一条连带的
「导出结束后离屏节点不留在文档里」——打印用例失败后 `#print-root` 残留在
文档里，那条按 `.markdown-body` 计数的用例跟着红。如实记录这一条是连带，
不是独立信号。

### 浏览器实测（真实 Chrome 153 + 真实 dist）

编辑态、焦点确认在正文里（实测 `focused=true`），敲入 `PRINTMARK` 后按 ⌘P：

```
PASS  编辑态焦点在正文里按 ⌘P，纸上包含刚敲的内容
      焦点在正文=true；#print-root 长度 30，含刚敲的内容
```

`window.print` 用了替身：原生打印预览会把渲染进程整个挡住、CDP 从此无响应
（这一点 `export/index.ts` 里已有既往实测记录，本轮沿用）。替身只挡住原生
对话框，`#print-root` 里的内容仍然完全由产品代码生成。

## 必修 2：写盘期间换文档，结果会落到新文档头上

### 先复现

新增用例用一个「`close()` 卡住」的句柄精确造出写盘进行中的窗口，期间
`setDocument(乙)` 再放行。窗口的入口是日常操作：切换文档前那个未保存确认框
弹出时 `dirty` 仍为真，用户点「确定」就换了文档，而上一次写盘还在 `await` 里。

复现由**撤销验证**反证：把守卫改成 `if (false)`，这条用例准确变红，而且**只红
这一条**（562 用例里 1 红）——与审查亲手复现的形状一致。

### 修法

`runSave` 进入前捕获 `openEpoch`，`await` 回来不一致就整段跳过（连
`setSaveStatus` 一起，否则刚打开的乙会顶着一条不属于它的「已保存」）。
写盘本身照常发生而且是对的——`performSave` 在进入时就取好了甲的句柄与文本，
写进的是甲自己的文件；要丢掉的只是**结果的落点**。

用例断言三件事：`writes === ['甲改过的内容']`（确实写了，且写的是甲的文件）、
乙的 `content` / `lastModified` 一字未动、`saveStatus` 仍为 `idle`。

## 三条 Minor

1. **`touch-timestamp` 的承重性**（审查点名）：已在 `useAutoRefresh` 的该分支
   补注释，写明**别**把它「整理」成复用 `applyRefreshedDocument`——那个 action
   会推进 `lastRefreshedAt`，而 `ReaderPage` 拿它当「外部内容」的标记，一变就
   用 `document.content` 覆盖编辑器；而 touch-timestamp 恰恰发生在编辑器里
   很可能正有未保存改动的时候，复用会**静默冲掉**它们。
2. **没有写权限时自动保存空转状态**：改成「保存中…」只给手动保存看
   （`if (!automatic) setSaveStatus('saving')`）。自动保存在写不回原文件时
   压根不动手，无条件先闪一下只会让用户每停一次笔白看一对 idle→saving→idle。
   副作用如实记录：自动保存不再显示「保存中…」，状态栏从「● 未保存」直接到
   「已保存」——抖动更少，而且写盘期间显示「未保存」本来就是准确的。
3. **`markSaved` 的 null 边界**（Nit）：被 openEpoch 守卫顺带关上了——`reset()`
   同样自增 `openEpoch`，`await` 期间发生 reset 的话守卫会跳过整段。

## 补做：简报 Step 7.3「连续打字 30 秒」——跑了两次，第一次不算数

### 第一次：连续打字 31.4 秒（200 字 × 150ms）

字符一个不丢、顺序不乱（落盘文件包含这 200 个字符的连续串）；15 次采样里
失焦 0 次、光标离开正文 0 次、闪回 0 次；光标 x 单调前进，第 9 次采样处自然
换行（y 90→117）后 x 归位继续前进，正文长度 46→242 单调增长。

**但这一次没能测到审查真正关心的那个组合。** 每 150ms 敲一个字会不断把 800ms
的防抖推后，于是整整 30 秒里**一次自动保存都没发生**——「保存导致重渲染 →
光标跳动」这条路压根没被走到。我发现后补了第二次，如实记下这一点，而不是
拿第一次的绿当成覆盖。

### 第二次：一阵一阵地敲（10 阵 × 8 字，阵间停 1.4 秒，逼自动保存落在两阵之间）

```
PASS  自动保存确实插进了打字中间 — 10 阵里状态栏显示「已保存」10 次、落盘文件变大 10 次
PASS  每次自动保存前后，光标一动不动 — 10 次保存里光标发生位移的次数：0
PASS  自动保存没有把焦点从正文上夺走 — 失焦次数：0
PASS  80 个字符一个不丢、顺序不乱
```

每阵的原始数据（保存前 x,y → 保存后 x,y / 文件字节）：

```
#1 451,90 → 451,90 / 42B    #6  755,90 → 755,90 / 82B
#2 509,90 → 509,90 / 50B    #7  813,90 → 813,90 / 90B
#3 571,90 → 571,90 / 58B    #8  874,90 → 874,90 / 98B
#4 628,90 → 628,90 / 66B    #9  932,90 → 932,90 / 106B
#5 686,90 → 686,90 / 74B    #10 990,90 → 990,90 / 114B
```

文件每阵稳定 +8 字节，说明 10 次自动保存真的都落盘了；而**每一次保存前后
光标坐标完全相同**。`ref` 改 `state` 带来的每字符重渲染，没有让光标动过。

## 复审轮的质量检查

```
> md-reader@0.1.0 typecheck && lint && test
 Test Files  57 passed (57)
      Tests  562 passed (562)
```

559 → 562（+3）：`useAutoSave.test.tsx` +1（写盘期间换文档）、
`useExport.test.tsx` +2（导出/打印用活文本）。

## 仍然留着的缺口（复审轮之后）

1. 真实文件选择器与写权限授权弹窗仍未被真实点过（CDP 能力所限），
   替身给的是授权之后的状态。
2. 「在文档中段插入」的字节比对仍未单独跑（上一轮插入点落在偏移 0，
   比对覆盖整个文件）。
3. 实测会话里设置全程是默认值（注入晚于 `hydrate()`），「改防抖间隔 /
   关自动保存」这些设置驱动的路径只有单测覆盖。
4. `performSave` 内部在 `await` 之后还有两处 store 写入（needs-permission 与
   save-as 分支里的 `setWritable(true)` / `setCurrentFileHandle`），本轮的
   openEpoch 守卫在 `runSave` 这一层，盖不住它们。触发条件比必修 2 窄得多
   （要在一次**手势发起**的授权或另存对话框跨越换文档），且不会污染文件内容，
   本轮未动；如实记录移交。
