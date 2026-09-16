# Task 17 审查：自动保存、脏状态与关页拦截

审查范围：`f5dad21..c776593`（17 文件 / +1299 −37）。
基线复跑：`npm run verify` 通过，**57 文件 / 559 用例**，与报告一致。

---

## 一、端到端写盘验证：**成立**

这是本轮最要紧的一条，结论明确：**我认为这个验证成立，不打折扣。**

### 替身与真实句柄在写入路径上的差别

替身只替换了 `showOpenFilePicker` 的**返回来源**，返回的是一个真实的 OPFS
`FileSystemFileHandle`。`createWritable()` / `write()` / `close()` / `getFile()` /
`queryPermission()` 都是 Chrome 的原生实现，走的是同一套
`FileSystemWritableFileStream`。产品代码（`editor/save.ts` 的 `writeThrough`）
在两种句柄下执行的是**逐字相同的语句序列**，没有任何分支按句柄类型走。

实质差别只有两处，都不在字节完整性这条轴上：

1. **权限模型**。OPFS 句柄的 `queryPermission({mode:'readwrite'})` 无条件返回
   `granted`（实现者把这一点打进日志、如实报告了）；本地文件句柄要走授权、
   可被撤销。——这条轴由 T13 的用例与 `decideSaveTarget` 覆盖，产品代码只消费
   `'granted' | 'denied'` 两个值。
2. **后端存储**。Chrome 对本地文件的 writable stream 用的是「写交换文件 →
   close() 时重命名覆盖」，OPFS 写的是 profile 内的沙箱文件系统。这带来的是
   **失败语义**的差别（本地文件在 close() 失败时原文件不动，比 OPFS 更安全），
   不是成功路径上的字节差别。

### 「用 Node 从浏览器之外读回比对」证明了什么

它证明的是一件很具体、也确实是我们最需要的事：**这个应用产生的字节，真的
落到了一个真实文件系统上的真实文件里，且与预期逐字节相同**——整条链路上没有
任何 Node 侧的参与，比对方与写入方完全解耦。

由此坐实的是：保存路径**没有做任何文本变换**。173 → 182 字节、最长公共前后缀
切分出来是一次纯插入（删除区间为空），行尾的两个空格、三个连续空行、制表符
缩进、混用的 `-`/`*` 列表标记一个字节未动。**没有 BOM、没有行尾归一、没有
尾随换行补齐。** 这条我另外做了代码侧的独立核对：`writeThrough` 写的是
`text` 本身，另存走 `new Blob([text])`，两条路都不经过 `normalizeMarkdown`。

它**不**证明的：本地文件的授权流程、交换文件+重命名这条实现路径、以及只读
挂载/文件被占用这类 OS 级失败。

### 剩下那两步（点选文件、点允许）的遗漏风险

小。CDP 确实驱动不了原生文件选择器与权限气泡（`Browser.grantPermissions`
的枚举里没有文件系统写权限），这不是实现者偷懒。更重要的是，这个缺口落在
**授权**轴上而不是**字节完整性**轴上——而「会不会写坏用户的文件」问的正是后者，
而后者已经被真实地量过了。

一处如实记录的小缺口（实现者自己先说了）：这次插入点落在偏移 0，
「在文档中段插入」没有单独跑。因为比对是对整个文件做的，「其余部分未变」
这条结论不受插入位置影响，所以这个缺口是 Minor。

---

## 二、三条接线的核实（含我自己撤销跑出来的结果）

四处撤销实验，每次都跑完整套件，跑完用备份还原，最后 `git status --porcelain`
为空（已核对）。

| 我撤销的 | 变红 | 变红的用例 |
| --- | --- | --- |
| (a) `runSave` 里 `store.markSaved(text, outcome.lastModified);` | **4**（跨 2 文件） | 保存成功后推进 content / 保存后不被误判成冲突 / 回到上一个保存版本 / 编辑态按 mod+s 真的写盘 |
| (b) save 动作的 `allowInInput: true,` | **1** | 编辑态下在可编辑正文里按 mod+s 真的写盘 |
| (c) StatusBar 里的 `<WriteTargetIndicator />` | **1** | 编辑态且没有写权限时一直显示 |
| (d) `externalMark` 退回按 `doc.content` 同步（简报原写法的语义） | **1** | 保存回写时不会把写盘之后新敲的字吞掉 |

(a)(b)(c) 与实现者自报的数字完全吻合。(d) 是我自己加的一条，用来独立验证
「实现者改写简报是否真的有测试兜底」——是的，有。

1. **`markSaved` 回写**：✅ 接上了，`'saved'` 与 `'saved-as'` 两个分支都调。
2. **`mod+s` 的 `allowInInput: true`**：✅ 在。撤销后准确变红，而且红的正是
   「在 contenteditable 上按 ⌘S」那一条——这是能证明这一项的唯一形状。
3. **`writable = false` 常驻显示**：✅ `WriteTargetIndicator` 是持久出口。
   **只在编辑态显示**这个限制是对的：阅读态下 `writable=false` 是常态（根本
   还没问过浏览器），那时报「无法写回」不准确。

---

## 三、实现者主动报告的三件事

### (1) 改写 `ReaderPage` 的同步写法 —— 诊断正确，新写法也对

诊断成立：`markSaved` 确实会改 `doc.content`（`document.store.ts` 的
`markSaved` 明写 `{ ...state.document, content, lastModified }`），而简报的
`[doc?.id, doc?.content]` effect 会因此把编辑器倒回写盘那一刻的文本。
我的 (d) 实验证实这条不是纸上推演：把标记换回按内容同步，用例当场变红。

**外部内容还能不能正常灌进来 —— 能，我逐条核过：**

- `adopt` → `applyRefreshedDocument` → `lastRefreshedAt: Date.now()` ✅
- `ConflictBanner` 的「用磁盘的」→ 同样走 `applyRefreshedDocument` ✅
- `touch-timestamp` → 裸 `setState({ document: {...current, lastModified} })`，
  **不动 `lastRefreshedAt`** ✅

第三条是**承重的**，而且现在没有任何注释说明它承重：`touch-timestamp` 只在
「内容其实没变 / 是我们自己写的」时发生，此时编辑器里可能正有未保存的改动。
一旦有人日后把它「整理」成复用 `applyRefreshedDocument`，`lastRefreshedAt`
就会变，`externalMark` 随之变，`setText(doc.content)` 会**静默丢掉用户正在
写的东西**。建议在 `useAutoRefresh` 的 `touch-timestamp` 分支加一句注释钉住它。

渲染期调整 state 而不是放 effect：`FileTreePanel.tsx:82-86` 确有同一招，
注释理由也一致，引用属实。同一毫秒内两次刷新会被认成同一次这个已知边界，
轮询下限 500ms，够不到。

### (2) 对 T16 说法的修正 —— **实现者是对的，T16 下大了**

三道网我独立查证如下：

1. `probeCurrentFile(current.lastModified)` 时间戳一致直接 `unchanged`；
2. `decideRefresh` 里 `isSelfWrite(...)`（`self-write.ts`，`MAX_ENTRIES = 12`）；
3. `incoming.content === context.savedContent` → `touch-timestamp`。

所以「每次保存后都会被误判为冲突」不成立。值得补一句实现者说到但没展开的
要点：**第 1 道网本身就依赖 `markSaved`**（它推进 `lastModified`），所以拆掉
`markSaved` 之后真正在兜底的是第 2 道网那张只有 12 条的滚动表——日常够用，
但它确实是「纵深」而不是「冗余」。

结论：对冲突而言 `markSaved` 是**纵深防御**；对脏状态、状态栏、以及
「不要每次停笔都把同一份内容再写一遍」而言它是**必需**。这正是实现者的说法。
`useAutoSave.test.tsx` 里那条用例显式 `clearSelfWrites()` + mock 掉探测来拆
前两道网，注释写明是刻意降级构造——做法与说明都诚实。

### (3) ⌘⇧E —— **Important，并且实现者的描述不够准确，还漏了更要紧的一半**

先把事实钉准。`export-html` 的 `hotkey: 'mod+shift+e'`，**没有** `allowInInput`；
`useHotkeys` 的判据是 `if (editable && binding.allowInInput !== true) continue;`。
所以：

- 编辑态 + 焦点在 `.cm-content`（编辑态的常态）：⌘⇧E **整个不触发**，
  连导出都不会发生，键让给了浏览器。**不是**「导出了改动之前的内容」。
- 真正能走到陈旧内容的是：编辑态但焦点在编辑器之外（点过侧栏/工具栏/状态栏），
  或改完按 ⌘E 退回阅读态之后按 ⌘⇧E。此时绑定生效，而 `useExport` 的
  `useEditorView()` 在 provider 之外恒为 null → 回退到 `doc.content` → 陈旧。

**实现者漏掉的一半，比他报告的这一半更要紧**：本轮他给 `mod+p`（打印 /
导出 PDF）**新开了 `allowInInput: true`**。`mod+p` 走的是同一个 `useExport`
实例、同一个 null view。于是从本轮开始，**编辑态下焦点在正文里按 ⌘P，会用
改动之前的内容去打印 / 生成 PDF，全程没有任何提示**——而这正是编辑态最常见
的焦点姿势。这一路在本轮之前是被 `allowInInput` 挡住的，是本任务新放开的。

**定级**：
- ⌘⇧E：**Important**。用户拿到错误文件且无提示，但只在焦点不在编辑器时可达。
- ⌘P：**Important（逼近 Critical）**。同样静默错误，但本轮新放开，且在**最常见**
  的姿势下可达，属于本任务引入的回归。

**修法代价：小，而且机制已经现成。** `useAutoSave` 本轮已经为 ⌘S 维护了一份
模块级草稿 `draftText`。把它导出一个读取函数，`useExport` 的 `currentText` 改成
`view?.state.doc.toString() ?? getDraftText() ?? doc.content` 即可，约 3 行 + 1 条
用例。

**应该并入本轮，不该单开任务**：`mod+p` 那一半是本轮改出来的，修它属于把本轮
的改动做完；而且写一份移交说明的成本已经大于这 3 行。

---

## 四、其余判断

### 快捷键在编辑态的评估 —— 结论与理由基本站得住

前提我独立查证过：`MarkdownEditor` 只挂 `keymap.of([...defaultKeymap,
...historyKeymap])` 加编辑态的 `indentWithTab`，**没有** `searchKeymap`。
grep `@codemirror/commands` 的 dist，带 Mod 的绑定是
`Mod-a/i/u/y/z` 与 `Mod-Arrow*/Backspace/Delete/End/Enter/Home`——
**没有 Mod-s / Mod-f / Mod-p**。所以开这三个不会盖掉编辑器自身行为，属实。

- `mod+f` 开：**站得住**。正文按视口逐块渲染，原生查找只找得到屏幕上那几块，
  自研查找搜完整源文本。让位在这里确实是有害而不是保守。
- `mod+p` 开：**理由对，但结论不完整**。对阅读态是清清楚楚的改进；对编辑态，
  它在修掉「只印视口几块」的同时开出了「印改动前的内容」，必须与上面那个
  `useExport` 修法一起走才算完成。
- `mod+o` / `mod+shift+o` 维持关：误触代价不对称的论证成立，且已有关页拦截兜底。
- `mod+b` 留的那个「将来加加粗要重新裁决」的记号是好习惯。

### 自动保存是否只在能静默写回时才动作 —— ✅

`decideSaveTarget` 在 `handle && writable` 之后紧跟
`if (context.automatic) return { kind: 'clean' };`，接线没有绕过它：两条路都只
经 `performSave(text, automatic)`，`automatic=true` 只从防抖器传。用例连过 4 个
防抖周期断言 picker 未被调用、`notice` 为 null；浏览器实测又等了 3 秒、零字节
被写。不会变成对话框机关枪。

### 保存路径上的文本变换 —— ✅ 没有

见第一节。代码侧与字节侧两边都核过。

### 注释里的机制归因 —— 本轮抽查四条，**全部属实**

- 「`Toast` 的 info 停留 2.6 秒」→ `Toast.tsx:6` `{ info: 2600, error: 5200 }` ✅
- 「`FileTreePanel` 用的是同一招」→ `FileTreePanel.tsx:82-86` ✅
- 「CodeMirror 那两套 keymap 里没有 Mod-s/f/p」→ 已 grep dist ✅
- 「`value` 与编辑器文档相同时那个 effect 会当场短路返回」→
  `MarkdownEditor.tsx:396` `if (!view || view.state.doc.toString() === value) return;` ✅

本轮没有发现编造的机制归因。

---

## 五、我自己发现的问题

### 【Important，已复现】写盘期间换文档，`markSaved` 会落到新文档头上

`runSave` 在 `await performSave(...)` 之后重新取了一次 state，但**没有核对文档
有没有换过**。`markSaved` 用的是调用时捕获的 `text`，写进的却是**当前**的
document。

我写了一次性用例复现（已删除，`git status` 已核对干净）：句柄的 `close()` 挂起
造出「写盘进行中」的窗口，期间 `setDocument(DOC_B)`，再放行写盘。结果：

```
>>> 换文档后 document.path = b.md
>>> 换文档后 document.content = 甲改过的内容      ← 甲的文本落进了乙
>>> dirty = false
```

后果链：乙的 `document.content` 被甲的文本顶掉 → 下一次 `useAutoSave` effect
算出 `dirty = 乙编辑器文本 !== 甲的文本 = true` → 自动保存**把甲的内容写进乙的
文件**。用户从没编辑过乙，没有回收站，全程无提示。

可达性：切换前有 `confirmDiscardUnsaved`（此刻 `dirty` 仍为真）会弹确认，用户
点「确定」即可进入这个窗口。窗口只有一次写盘的时间（几十毫秒），但慢盘、网络
挂载、大文件都会把它拉长。属于「概率低但没有回收站」那一类。

修法便宜：在 `runSave` 进入前捕获 `useDocumentStore.getState().openEpoch`，
`await` 回来后不一致就整段跳过（连 `setSaveStatus` 一起）。

### 【Minor】`touch-timestamp` 不更新 `lastRefreshedAt` 是承重的，但没注释

见第三节 (1)。建议补一句，防止日后被「整理」掉。

### 【Minor】没有写权限时，自动保存每 800ms 空转一次状态

`runSave` 无条件先 `setSaveStatus('saving')`，`decideSaveTarget` 判 clean 之后
再 `setSaveStatus('idle')`。写不回原文件时用户每打一阵字就有一对无意义的 store
写入与 StatusBar 重渲染。不影响正确性。

### 【Nit】`markSaved` 在 `document === null` 时仍会置 `saveStatus: 'saved'`

`performSave` 在 `!doc` 时返回 `skipped`，实际走不到，属于松边界。

---

## 六、⚠️ 未能验证的项

1. **简报 Step 7.3「编辑态持续打字 30 秒，光标不跳动、不闪回」没有跑。**
   实现者如实记录了。这条在本轮**格外要紧**：`ReaderPage` 本轮从 `ref` 改成了
   `state`，每敲一个字符多一次阅读页重渲染，是新引入的行为。代码侧的论证
   （`value` 相同时 `MarkdownEditor` 的 effect 短路返回）我已逐行核对、成立；
   但「连续打字 30 秒 + 200ms 渲染防抖 + 中途 800ms 自动保存插进来」这个组合
   下的真实光标表现没有被观察过。
2. 「在文档中段插入」的字节比对没有单独跑（插入点落在偏移 0）。
3. 本地文件句柄的授权流程、以及 Chrome 对本地文件的「交换文件 + 重命名」
   写入实现，没有被真实执行过（CDP 能力所限，非实现者可控）。
4. 实测会话里设置全程是默认值（注入晚于 `hydrate()`），所以「改了防抖间隔 /
   关掉自动保存」这些设置驱动的路径只有单测覆盖，没有浏览器实测。

---

## 七、结论

**规范符合性：✅**
接口与 store 字段按简报交付；`useSaveCommands` 的拆分、`ReaderPage` 的改写都
偏离了简报，但两处都有充分理由、有注释、有钉住它的用例——是正确的偏离。
TypeScript strict 全开，`npm run verify` 通过（57/559，我复跑过）。注释中文且
解释「为什么」。无新增网络请求。提交信息中文、无署名尾注。

**任务质量：批准（附两项必修）**

- **Important（必修，建议并入本轮）**：写盘期间换文档 → `markSaved` 落到新文档，
  可导致把甲的内容写进乙的文件。已复现。
- **Important（必修，建议并入本轮）**：`useExport` 在 `useGlobalHotkeys` 那一路
  拿不到 view，⌘P（本轮新放开）与 ⌘⇧E 会用改动之前的内容打印 / 导出。
- **Minor**：`touch-timestamp` 的承重性没注释；无写权限时自动保存空转状态；
  `markSaved` 的 null 边界。

**现在这套编辑 + 保存，敢交给用户用吗？**

**先修掉上面两条 Important，就敢；现在还差一步。**

敢的理由是实的：写盘路径的字节完整性被真实量过（纯插入、全文一字未动、
无 BOM / 无行尾归一），自动保存在拿不到写权限时确实一动不动，脏状态、关页
拦截、状态栏常驻提示三条接线我逐条撤销跑过、每条都准确变红。这比「第一次
通电」通常能达到的水平高。

差的那一步也是实的：一条我亲手复现出来的、会把 A 文件内容写进 B 文件的时序
窗口，和一条本轮新放开的、会静默导出错误内容的快捷键。两处都是几行的修法，
不是架构问题——但在一个「写坏了没有回收站」的功能上，这两条都不该带着上线。
