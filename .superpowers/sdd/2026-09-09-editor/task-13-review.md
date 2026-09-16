# Task 13 审查：编辑态开关与写权限申请

审查对象：`6794e67`（diff 包 `review-2cb8ef8..6794e67.diff`，10 文件 / +562 −7）。

结论先行：

- **规范符合性：✅**（简报九步全部落地，接口签名一字不差）
- **任务质量：不批准**——存在一条 Critical。
- **编辑态现在不能正常用起来。**

---

## 一、实测环境

沿用 8c/8d 的绕法（Chrome 152+ 无 `--load-extension`）：

- `npm run build` 的**真实 dist**（`/Users/suyue/Desktop/github/md-reader/dist`）挂本地
  Node 静态服务器（127.0.0.1:8731/8732/8734/8735），直接开 `viewer.html`（非嵌入，
  `canUseFilePicker()` 为真，不需要宿主页复刻）。
- Chrome 153.0.8010.36，临时 profile，启动参数含
  `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`
  `--disable-features=CalculateNativeWinOcclusion --window-size=1440,1000`。
- Node 22 内置 WebSocket 直连 CDP。鼠标点击、拖选、按键全部走 `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent`（真实事件、真实用户激活）。
- **唯一替身**：`window.showOpenFilePicker`，返回一个脚本化 `FileSystemFileHandle`
  （`getFile` 给真实 `File`，`queryPermission`/`requestPermission` 按场景返回，
  并记录每次调用时的 `navigator.userActivation.isActive`）。
  这一点与实现者报告一致，结论边界相同。

测试文档：9 个块（H1 / 段落 / H2 / 无序列表 / 带链接的段落 / H2 / 段落 / js 代码块 /
H2 / 段落 / 收尾段）。

---

## 二、最要紧的一条：点击渲染块 —— **Critical**

### 2.1 实测：点不进去，而且比「点不进去」更糟

进编辑态后，对**四类渲染块的正中**各发一次真实左键单击，每次都检查
「哪些 `.cm-line` 还有非空文本」（= 哪一块让出了源码）：

| 点击目标 | 点击后让出源码的块 | `.cm-editor` 是否聚焦 |
| --- | --- | --- |
| `h2`（「第三章」，y≈640） | `# 演示文档`（**没变**） | false |
| `p`（「第三章的正文…」，y≈740） | `# 演示文档`（**没变**） | **true** |
| `pre`（js 代码块，y≈889） | `# 演示文档`（**没变**） | false |
| `li`（「列表项一」，y≈387） | `# 演示文档`（**没变**） | **true** |

四类块全部点不进去。光标始终停在文档位置 0（刚进编辑态时的默认位置，
对应首块 `# 演示文档`，此时已滚到视口外）。

双击（`clickCount:2`）无效；**拖选块内文字也无效**：

| 场景 | `document.getSelection().toString()` |
| --- | --- |
| 阅读态拖选「第三章的正文…」 | `"三章的正文，光标会"` |
| 编辑态拖选同一段 | `""` |

即：**进了编辑态反而连选中复制正文都做不到了**（阅读态可以）。
原因是 CodeMirror 给 widget 的宿主写了 `contentEditable = "false"`
（`@codemirror/view/dist/index.js:2155-2159`，`WidgetTile.of` 里
`if (!widget.editable) dom.contentEditable = "false"`），在 contenteditable=true
的根里，Chrome 把这种子树当作不可选的原子对象。

### 2.2 真正的 Critical 在这里：下一次按键静默改错地方

`p` / `li` 这两类点击**会把焦点交给 `.cm-content`**（`cm-focused`、
`document.activeElement.className === "cm-content cm-lineWrapping"`），
但选区不动。于是：

```
点「第三章的正文…」（视口中部）→ 看上去什么都没发生
立刻敲一个 Z
→ 文档第一行变成 "Z# 演示文档"
```

实测（`afterTypeZ.head`）：`"Z# 演示文档\n第一章的正文，…"`。

**用户点在屏幕中间，字落在文档开头，而且没有任何视觉反馈指出这件事。**
这不是「少了一个入口」，是**静默写坏文档**。Task 15 接上自动保存之后，
这一下会被原样写回用户的真实文件。

### 2.3 用户还剩什么办法

- **方向键**：进编辑态后焦点**留在工具栏按钮上**（实测
  `afterEdit.focused === false`，`activeElement` 是那个 `<button>`），
  此时按 ↓ 什么都不会发生（实测 `A_arrowWhileButtonFocused` 与 `afterEdit` 完全一致）。
  也就是说方向键这条路**也要先用鼠标点进正文**。
- **点块之间的空白条**：可行。块之间存在高 27px 的空 `.cm-line`
  （实测占正文总高的 25.6%），点中它光标会落上去，再按 → 一步进入下一块的源码
  （`F_afterArrowRight`：`["第三章的正文，光标会落在这一段。"]`）。
  但这条空白条**并非每两块之间都有**——列表块与其后的段落块之间就没有
  （实测 `E_gaps` 里 top=340 的列表块与 top=520 的段落块直接相邻）。
- 按 ↓ 从空白条只能跳到下一条空白条（实测 `F_afterArrowDown` 源码行仍为空），
  必须按 → 才进得去。

### 2.4 定性：**Critical**

依据三条：

1. 「点哪里改哪里」是所见即所得编辑器的**基本盘**，四类块全军覆没。
2. 可行路径是「点一条 27px 的、看不出可点的空白缝 → 按 →」。
   这不是「别扭的替代路径」，是**不看文档绝无可能摸索出来**的路径——
   更何况用户最先尝试的「点段落」会给出「焦点进了、光标没进」的假阳性反馈。
3. 最重的一条：点段落后第一次按键会静默改掉文档另一处。
   Stage B 的下三个任务全是保存，这条会直接变成数据损坏。

它虽然源自 Task 6 的 `ignoreEvent()`，但**本任务是「让用户真的进入编辑态」的关口任务**，
交付物的验收标准就是「编辑态可用」。把它记成「阶段 B 收尾前单独定夺」等于把关口放行了。

### 2.5 修法代价：低，且两全 —— 已实测验证

`WidgetType.ignoreEvent` 的签名**本来就带 event**（`ignoreEvent(event)`），
调用点是 `eventBelongsToEditor`（`@codemirror/view` 4867-4877）与
`onSelectionChange`（7239）。按事件目标区分完全可行：

```ts
override ignoreEvent(event: Event): boolean {
  const target = event.target;
  // 块里的链接、代码块折叠/复制按钮、任务列表勾选框要保住自己的点击
  if (!(target instanceof HTMLElement)) return true;
  return target.closest('a, button, input, summary, label, [role="button"]') !== null;
}
```

我把**构建产物**（`dist/assets/viewer-*.js`，git 忽略的构建物，未动任何源码）
里那一处 `ignoreEvent(){return!0}` 就地替换成上面这个逻辑，重跑同一套实测：

| 判据 | 原状 | 打补丁后 |
| --- | --- | --- |
| 点「第三章的正文」后让出源码的块 | `# 演示文档` | **`第三章的正文，光标会落在这一段。`** |
| 点后敲 `Z` | `Z# 演示文档`（改错地方） | **`Z第三章的正文，光标会落在这一段。`** |
| 点块里的 `[链接](https://example.com)` | 不移光标 | **仍不移光标**（块保持在上一处，链接照常触发） |

验证完已 `cp` 还原 dist，`grep -c "ignoreEvent(){return!0}"` 回到 1。

代价：约 4 行 + 一组用例；需要回归的是块内可点元素清单
（链接 / 代码块复制按钮 / mermaid / 任务列表勾选框 / 脚注回跳）。
**光标会落到块的起始位置而不是点击的那个字符**（widget 没有源码偏移映射），
这是 live-preview 的通行行为，可接受。

补充：`ignoreEvent` 改掉之后，2.1 里「编辑态选不中文字」那条**不会**自动好——
那是 widget 宿主 `contentEditable="false"` 决定的，属于另一件事，
但它同样是「进了编辑态反而退步」，建议一并记账。

---

## 三、那颗雷（`allowInInput`）—— 拆掉了，我自己撤销跑过

### 3.1 链路复核（逐条查证，不是推断）

- `src/hooks/useHotkeys.ts:46`：`if (editable && binding.allowInInput !== true) continue;` ✓
- `src/utils/hotkeys.ts:96`：`isEditableTarget` 对 `isContentEditable === true` 返回 true ✓
- `@codemirror/view/dist/index.js:8276`：
  `contenteditable: !this.state.facet(editable) ? "false" : "true"` ✓
  实测佐证：阅读态 `.cm-content` 的 `contenteditable === "false"`，编辑态 `"true"`。

### 3.2 我自己撤销跑的结果

把 `useToolbarActions.ts:206` 的 `allowInInput: true` 整行删掉后：

```
FAIL src/hooks/useGlobalHotkeys.test.tsx > useGlobalHotkeys >
     编辑态下在可编辑正文里按 mod+e 仍能退回阅读态
AssertionError: expected 'edit' to be 'read'
  Expected: "read"   Received: "edit"
Test Files  1 failed | 1 passed (2)
```

已 `cp` 还原，重跑 `src/hooks/useGlobalHotkeys.test.tsx` 4/4 通过，`git status` 干净。
**这条回归测试是有效力的，不是假绿。**

### 3.3 对照组设计是否站得住

站得住，而且是双重的：

- **单测对照组**（`useGlobalHotkeys.test.tsx` 第三条）：`mod+f` 未声明 `allowInInput`，
  在 contenteditable 目标上 `searchOpen` 保持 false、在 `document.body` 上变 true。
  两个方向都断言了，排除了「绑定压根没注册」这一种假绿。
  另外它显式 `Object.defineProperty(host, 'isContentEditable', { value: true })`
  并在注释里说明 jsdom 不推导这个属性——这一步没做的话整组用例会因为
  「根本没走到可编辑分支」而假绿，实现者意识到了。
- **浏览器对照组**（报告 3.2 判据 2）：同一会话里焦点在 `.cm-content` 上按 ⌘F，
  `aria-pressed` 纹丝不动；回阅读态按同一个 ⌘F 立刻变 `"true"`。设计正确、结论可信。

### 3.4 一个报告没提到的实情（不影响结论，但改变了雷的"何时炸"）

实测 `afterEdit.focused === false`——**⌘E 之后焦点留在工具栏按钮上，不在正文里**。
所以「按 ⌘E 进去、再按 ⌘E 出来」这条路即使没有 `allowInInput` 也走得通。
雷真正会炸的时刻是「用户点/走进正文之后」。
这不削弱修复的必要性（一旦开始打字就必炸），但说明**人工验收如果只按两下 ⌘E 是测不出来的**——
实现者的单测与浏览器对照组恰好覆盖到了这一点，这部分做得好。

---

## 四、手势时机的证据是否充分

### 4.1 证据本身

实测句柄调用序列（grant 与 deny 两个场景各跑一次，完全一致）：

```json
[{"fn":"query","mode":"read","activation":true},
 {"fn":"query","mode":"readwrite","activation":true},
 {"fn":"request","mode":"readwrite","activation":true},
 {"fn":"query","mode":"read","activation":true}]
```

（首尾两条 `read` 来自自动刷新轮询，与本条无关。）

`requestPermission({mode:'readwrite'})` 被调用时 `navigator.userActivation.isActive === true`
—— **中间那次 `queryPermission` 的 await 确实没把手势耗掉。**
`isActive` 正是 File System Access 规范里 `requestPermission` 所要求的
transient activation 标志，所以这个判据**用对了指标**，不是旁证。

### 4.2 但有一处系统性折扣，报告没写

替身的 `queryPermission` 是一个立即 resolve 的 Promise（一个微任务），
而真实句柄的 `queryPermission` 是一次跨进程 IPC（一个宏任务 + IPC 往返）。
**实测里那次 await 比真实情况短。** 好在 transient activation 的窗口是 ~5s，
而权限查询是毫秒级，差着三个数量级——风险低，但这是一条「实测比现实宽松」的偏差，
应当写进边界而不是当作等价。

### 4.3 原生授权弹窗没验到的缺口

风险评估：**中低，可接受，但必须显式挂账。**

- 降低风险的一点：`ensureFileWritePermission` 是既有的、已在生产里跑通的
  `handle-store.ts:111 ensureReadPermission` 的逐行镜像，只差 `mode` 是
  `'readwrite'` 还是 `'read'`。原生弹窗这条机制在本项目里**已经被目录读权限验证过**，
  未验的只是 `readwrite` 这一档（Chrome 会换成「编辑文件」那个不同的弹窗）。
- 仍然没验到的：Chrome 对 `chrome-extension://` 页面上的 readwrite 授权行为，
  以及用户在原生弹窗上点「取消」时 `requestPermission` 的真实 resolve 值
  （代码假设是 `'denied'`；若 Chrome 返回 `'prompt'`，现有实现归为
  `'prompt'` → `writable=false` + 提示条，行为仍然正确，所以这一条其实是安全的）。
- 建议：阶段 B 收尾前做一次**真人手动**验收（真的从文件选择器选一个文件、
  真的在原生弹窗上点一次「允许」和一次「取消」），一次五分钟，把这个缺口关掉。

---

## 五、其余判断

### 5.1 `allowInInput` 从 id 白名单提升为 `ToolbarAction` 字段 —— **合理，行为未变**

- 旧：`allowInInput: action.id === 'sidebar'`（`useGlobalHotkeys.ts`）。
- 新：`allowInInput: action.allowInInput === true`，`sidebar` 动作自己声明 `allowInInput: true`。
- 全仓只有 `sidebar` 一个 id 曾在白名单里（旧代码就是这一行硬编码），
  新代码里 `sidebar` 与 `edit` 各声明一次，其余动作不声明 → `=== true` 为 false。
  **`sidebar` 的行为一字未变**，其余动作也未变。
- 理由站得住：白名单离动作声明太远，漏声明的后果是「编辑态里该快捷键整个失灵，
  而且完全静默」。这正是这次差点踩中的坑，把判据搬到声明处是正确方向。
  属于「与本任务强相关的必要重构」，不算超范围。

### 5.2 `editor.defaultMode` 不接线 —— **判断对，但账要记在 Stage B 头上**

- 全仓查证：`defaultMode` 只有 `types/settings.ts`（定义 + 默认值）与
  `EditorSection.tsx`（一个 Select）三处，**确无消费方**。
- 不接线的理由成立：打开文档时没有用户手势，`requestPermission` 必被拒，
  `writable` 只能是 false，与「默认进编辑态」的用户预期相反。这需要一次产品判断。
- 但要说清楚：Task 12 已经把「打开文档的初始模式」这个 Select **摆到了设置面板上**，
  用户现在切到「编辑」会发现毫无反应。这是一条**用户可见的死设置**，
  不是 Task 13 制造的，但阶段 B 收尾前必须有人认领（接线、或先把这个 Select 隐藏）。

### 5.3 `readOnly` / `editable` 是否复用 Task 6 的 Compartment —— **是，正确**

- `editModeRef`（Task 6 既有）原封不动复用，本次没有新建第二套。
- 创建路径（`MarkdownEditor.tsx:267-270`）与重配路径（`377-380`）**都同时设置**
  `EditorView.editable.of(!readOnly)` 与 `EditorState.readOnly.of(readOnly)`。
- 全仓 grep 确认没有第三处设置这两个 facet。
- 新增的 `editingSettingsRef` 是**另一个 compartment、另一件事**（行号/缩进），
  不是把只读开关又造了一套，分开是对的。

### 5.4 注释的机制归因是否查证过 —— **是，逐条对上了**

| 注释断言 | 我的查证 | 结论 |
| --- | --- | --- |
| `.cm-content` 的 contenteditable 由 `EditorView.editable` facet 决定 | `@codemirror/view/dist/index.js:8276` `contentAttrs` | ✓ 属实（并有实测佐证） |
| `tabSize` 只管显示宽度，`indentUnit` 才决定插入什么，取值是字符串不是数字 | `@codemirror/state:2890` `EditorState.tabSize`（默认 4，仅供 `countColumn`/`findColumn` 换算列宽）；`@codemirror/language:806` `indentUnit` facet，combine 校验「全部是同一个空白字符」，**默认 `"  "`（2 空格）** | ✓ 属实，包括「只设 tabSize 仍会插 2 个空格」这句 |
| 只设 `EditorState.readOnly` 视图仍可聚焦、光标所在块会变回源码 | `live-preview.ts:127` 判的是 `EditorView.editable`；`EditorView.editable` 的官方文档明确说它不影响 API 改内容 | ✓ 属实（Task 6 既有注释） |
| `ignoreEvent` 返回 true 是为了让块内链接可点 | `eventBelongsToEditor`（4867）与 `onSelectionChange`（7239）两处调用点，且实测打补丁后链接仍可点 | ✓ 属实 |

**没有发现凭印象写的机制归因。** 这一项比前三轮有明显改善。

### 5.5 其它超范围改动 —— 无

改动文件清单 = 简报列出的 7 个 + `useGlobalHotkeys.ts`（5.1 的重构）
+ 两个新测试文件。没有夹带。

### 5.6 提交信息 —— **合规**

中文、分条说明「为什么」（不是只说改了什么）、无署名尾注。

### 5.7 `npm run verify` —— **实跑通过**

```
Test Files  48 passed (48)
     Tests  462 passed (462)
[exited with code 0]
```

与报告的 48/462 完全一致。

---

## 六、另外两条值得记账的（不阻断本任务）

1. **编辑态下拖选/复制正文失效**（见 2.1 表）。阅读态能选，编辑态选不了，
   是「进编辑态反而退步」。成因是 widget 宿主的 `contentEditable="false"`，
   与 `ignoreEvent` 是两件事，改 `ignoreEvent` 不会顺带修好。**Important。**
2. **编辑态下自动刷新仍在轮询**（实测句柄调用序列里首尾两条 `query(read)` 就是它）。
   文件在盘上被改动时 `applyRefreshedDocument` 会整篇灌回编辑器
   （`MarkdownEditor.tsx:368` 的 `[value]` effect），**会无声冲掉用户正在编辑的内容**。
   这正是 Task 16「冲突判定」的地盘，本任务不该修，但在 Task 16 落地之前
   编辑态存在这个真实的数据丢失窗口，应写进 progress 的已知风险。**Important（留给 Task 16）。**
3. **`defaultKeymap` 不绑定 Tab**（`@codemirror/commands:1796-1817` 逐条确认，
   Tab 在单独导出的 `indentWithTab` 里）。所以设置里的「用 Tab 缩进」这个开关，
   按 Tab 时并不会插入缩进（Tab 走浏览器焦点移动）；`indentUnit` 只在
   `Mod-[` / `Mod-]` 与回车自动缩进时生效。设置项名字对不上实际行为。**Minor。**
4. `ensureFileWritePermission` 与 `ensureReadPermission` 是逐行镜像（差一个 `mode`
   与一句日志文案）。复用 `PermissionOutcome` 是对的，但这 15 行本可以合成一个
   带 `mode` 参数的私有 helper。**Minor（可不改）。**

---

## 七、结论

### 规范符合性：✅

简报 Step 1–9 全部落地：`ensureFileWritePermission` 签名一致、store 新增四项且
`setDocument`/`reset` 都复位、`useEditMode` 返回值形状一致、工具栏 `edit` 动作字段齐全、
`ReaderPage` 的 `readOnly` 由 `mode` 驱动且 `onChange` 接进本地 ref、
`MarkdownEditor` 用 Compartment 挂行号与缩进、`npm run verify` 实跑通过、
提交信息中文无尾注。

### 任务质量：不批准

| 级别 | 问题 |
| --- | --- |
| **Critical** | 编辑态下点击任何渲染块都不会移动光标；点段落/列表项还会把焦点交给正文却不移选区，导致**下一次按键静默写到文档位置 0**（实测：点视口中部的段落后敲 Z，第一行变成 `Z# 演示文档`）。唯一可行入口是「点块间 27px 空白条 + 按 →」，且该空白条并非每两块之间都有。修法明确、代价低（`ignoreEvent(event)` 按目标区分，已在 dist 上实测两全）。 |
| **Important** | 编辑态下无法拖选/复制正文（阅读态可以）——widget 宿主 `contentEditable="false"` 所致，与 `ignoreEvent` 是两件事。 |
| **Important** | `enterEdit` 不聚焦正文，叠加上面那条使得「进了编辑态却无从下手」。理由（怕牵动阅读位置的 scrollTop 判据，`useReadingPosition.ts:229` 确认属实）成立，但正解是「先把选区落到视口内最近的块再聚焦」，而不是干脆不聚焦。 |
| **Important**（留给 Task 16） | 编辑态下自动刷新仍在轮询，文件外部改动会整篇灌回、冲掉在编辑的内容。 |
| **Important**（Stage B 认领） | `editor.defaultMode` 是用户可见的死设置（Task 12 已把 Select 摆出来）。本任务不接线的判断正确，但缺口要有人认领。 |
| **Minor** | 「用 Tab 缩进」设置与实际行为对不上：`defaultKeymap` 不绑 Tab。 |
| **Minor** | `ensureFileWritePermission` 与 `ensureReadPermission` 几乎逐行重复。 |
| ⚠️ 未能验证 | 浏览器原生的 readwrite 授权弹窗（CDP 驱动不了 FS Access 的原生选择器）。风险中低——同一机制已由目录读权限在生产里跑通，但建议阶段 B 收尾前做一次真人手动验收。 |
| ⚠️ 实测偏差 | 替身 `queryPermission` 立即 resolve，比真实 IPC 往返短；transient activation 窗口 ~5s 而权限查询毫秒级，差三个数量级，风险低但应显式挂账。 |

### 现在这个编辑态，用户能正常用起来吗？

**不能。**

缺的是**「把光标放到想改的地方」这个动作本身**。
⌘E 之后焦点留在工具栏按钮上；点任何渲染块都不移光标；点段落还会造成
「焦点进了、光标没进」的假象，下一次按键落到文档开头。
唯一走得通的路是「点中块与块之间那条 27px 的空白缝，再按 →」——
不看文档的普通用户不可能摸索出来，而他最先会尝试的动作恰好会静默改错地方。

放行的最低条件：`BlockWidget.ignoreEvent(event)` 改为按事件目标区分
（点在 `a`/`button`/`input`/`summary`/`[role=button]` 上就忽略，点在文字上交给编辑器）。
已在构建产物上实测：链接照常可点，点段落则光标进入该块、打字落在该块内。
