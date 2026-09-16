# Task 13 报告：编辑态开关与写权限申请

## 一、做了什么

| 文件 | 改动 |
| --- | --- |
| `src/utils/file-open.ts` | 新增 `ensureFileWritePermission(handle, interactive)`，复用 `handle-store.ts` 的 `PermissionOutcome` |
| `src/utils/file-open.test.ts` | 新增 7 个用例（含「非交互模式下**一次都不调** requestPermission」与「句柄抛错归为 denied」） |
| `src/stores/document.store.ts` | 新增 `mode` / `writable` 与两个 setter；`setDocument` 与 `reset` 都把两者复位 |
| `src/hooks/useEditMode.ts` | 新建。`enterEdit`（用户手势内申请写权限）/ `leaveEdit` |
| `src/hooks/useEditMode.test.tsx` | 新建，5 个用例 |
| `src/hooks/useToolbarActions.ts` | 新增 `edit` 动作（`mod+e`，**`allowInInput: true`**）；`ToolbarAction` 新增 `allowInInput` 字段 |
| `src/hooks/useGlobalHotkeys.ts` | `allowInInput` 改为从动作声明转发，不再按 id 白名单判断 |
| `src/hooks/useGlobalHotkeys.test.tsx` | 新建，4 个用例（含对照组） |
| `src/editor/MarkdownEditor.tsx` | 新增编辑设置 compartment：行号（仅编辑态）、`tabSize`、`indentUnit` |
| `src/viewer/pages/ReaderPage.tsx` | `readOnly` 由 `mode === 'read'` 驱动；`onChange` 接进一个本地 ref（Task 15 才消费） |

`npm run verify`（typecheck + eslint + vitest）通过：**48 文件 / 462 用例**（基线 46 / 446，新增 2 个文件 / 16 个用例）。

### 两处设计决定（简报之外的）

1. **`allowInInput` 提升为 `ToolbarAction` 的字段**。原来这一项写在 `useGlobalHotkeys`
   里，是 `action.id === 'sidebar'` 的白名单。编辑态一上线，这个白名单离动作声明太远——
   漏声明的后果是那个快捷键在编辑态里整个失灵，而且完全静默。改成动作自己声明，
   `sidebar` 的行为一字未变（实测见下）。
2. **行号只在编辑态挂**（`showLineNumbers && !readOnly`）。设置项本身就叫「编辑态显示行号」；
   阅读态下满屏是块 widget，widget 内部的视觉行与源码行对不上，挂上只会误导。

### 刻意没做的

- **`editor.defaultMode` 设置项仍然没有消费方**（Task 12 引入，Task 14–18 的简报里也没有
  任何一处读它）。本任务没有去兑现它：打开文档时自动进编辑态意味着**没有用户手势**，
  那一刻申请不到写权限，`writable` 只能是 false，与「defaultMode: edit」的用户预期相反。
  这需要一次产品判断（是进编辑态但不申请权限？还是首次交互时补申请？），不该顺手塞进本任务。
- **`enterEdit` 不自动把焦点移进正文**。加 `view.focus()` 会牵动阅读位置恢复那套
  「谁滚的」判定，属于额外风险，简报也没有要求。代价是 ⌘E 之后要先点一下正文才能打字。

---

## 二、那颗雷（`allowInInput`）的验证过程

### 链路确认

- `src/hooks/useHotkeys.ts:46`：`if (editable && binding.allowInInput !== true) continue;`
- `src/utils/hotkeys.ts:101`：`isEditableTarget` 对 `isContentEditable === true` 返回 true。
- `node_modules/@codemirror/view/dist/index.js:8276`（`contentAttrs`）：
  `contenteditable: !this.state.facet(editable) ? "false" : "true"`。
  即 `.cm-content` 的 contenteditable **正是由 `EditorView.editable` facet 决定的**，
  而本项目的 `MarkdownEditor` 用的就是这个 facet 切换读写。

结论：**阅读态下 `isEditableTarget` 为 false（属性是 `"false"`），一进编辑态它对每一次按键都返回 true。**
所以照简报原样加 `mod+e`，编辑态里 ⌘E 与将来的 ⌘S 会同时失效——进得去出不来。

### 单测层面的效力验证（删掉关键一行）

删掉 `edit` 动作上的 `allowInInput: true` 后重跑：

```
FAIL src/hooks/useGlobalHotkeys.test.tsx > 编辑态下在可编辑正文里按 mod+e 仍能退回阅读态
AssertionError: expected 'edit' to be 'read'
```

同一文件里还有一条**对照组**用例：`mod+f`（未声明 `allowInInput`）在 contenteditable 目标上
不生效、在普通目标上生效。它保证前一条不是因为「绑定压根没注册」而假绿。

另一处自检：把 `useEditMode` 里的 `ensureFileWritePermission(handle, true)` 改成 `false`
（相当于删掉「在手势里申请」这一步），`useEditMode.test.tsx` 的
「尚未授权时在这一下申请写权限」立刻变红（requestPermission 调用数 0 ≠ 1）。
两次自检后都已还原并重跑 `npm run verify` 确认干净。

---

## 三、浏览器实测

### 3.1 环境与可信度边界

- 本机 Chrome 实际版本 **153.0.8010.36**（任务里写的是 152；`--load-extension` 同样不可用）。
- 方法沿用 8c/8d：`npm run build` 的**真实 dist** 挂本地 node 静态服务器
  （`http://127.0.0.1:8731`），Node 22 内置 WebSocket 直连 CDP，临时 profile，
  启动参数带 `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`
  与 `--window-size=1440,1000`。
- 本次**不需要**宿主页复刻：直接开 `viewer.html`（非嵌入），`canUseFilePicker()` 为真。
- **唯一的替身是 `window.showOpenFilePicker`**：它返回一个脚本化的 `FileSystemFileHandle`
  （`getFile` 给真实 `File`，`queryPermission` / `requestPermission` 按用例返回，
  并记录每次调用时的 `navigator.userActivation.isActive`）。
  其余全部是真的：真实 dist、真 CodeMirror、真块渲染、真鼠标/键盘事件（CDP `Input.*`）。
- `chrome.storage` 不存在，设置走默认值；本次判据不涉及持久化，未注入 localStorage 替身。

**因此没有验到的一条：浏览器原生的「写入授权」弹窗本身。** 真实句柄只能由真实文件选择器
产出，而 CDP 无法驱动 File System Access 的原生选择器（它不走可拦截的 file chooser 通道）。
验到的是「我们这一侧的行为」：在真实用户激活状态下调 `requestPermission({mode:'readwrite'})`，
以及 granted / denied 两条分支各自的结果。

### 3.2 五条判据

#### 判据 1：点「编辑」→ 申请写入授权 → 允许 → `writable` 为 true —— **部分验到**

`queryPermission` 返回 `prompt`、`requestPermission` 返回 `granted` 的场景下，真实鼠标点击
「编辑」按钮后，句柄上记录到的调用序列是：

```json
[{"fn":"query","mode":"readwrite","activation":true},
 {"fn":"request","mode":"readwrite","activation":true},
 {"fn":"query","mode":"read","activation":true}]
```

三点结论：
1. 申请的是 **readwrite**，不是 read；
2. `requestPermission` 被调用时 `navigator.userActivation.isActive` 为 **true**——
   即**中间那次 `queryPermission` 的 await 没有把用户手势耗掉**，这正是「唯一申请时机」
   这条设计能成立的实测依据；
3. 第三条 `read` 查询来自自动刷新轮询，与本条无关。

界面侧：按钮 label 变为「退出编辑 (⌘E)」，`.cm-content` 的 `contenteditable` 变为 `"true"`，
**没有**出现提示条。

**没验到的部分**：`writable` 这个 store 字段目前没有任何界面出口（消费方在 Task 15），
所以浏览器里只能间接判断——`useEditMode` 只在 `outcome !== 'granted'` 时弹提示条，
granted 场景无提示条 / denied 场景有提示条（见判据 5），二者对照即为 `writable` 的取值。
`writable` 本身的直接断言在单测里（`useEditMode.test.tsx` 4 条）。

#### 判据 2：编辑态按 `mod+e` 能退回阅读态 —— **通过（这是雷的直接判据）**

按键前的焦点实测：`document.activeElement.className === "cm-content cm-lineWrapping"`，
`activeElement.isContentEditable === true`（即 `isEditableTarget` 此刻必然返回 true）。

CDP 发真实 `⌘E`（modifiers=4, code=KeyE）后：

| 项目 | 编辑态 | ⌘E 之后 |
| --- | --- | --- |
| 按钮 label | 退出编辑 (⌘E) | 编辑 (⌘E) |
| `.cm-content` contenteditable | `"true"` | `"false"` |
| 块 widget 数 | 8 | 9 |
| 未被 widget 替换的正文行 | `["第三章的正文，光标会落在这一段。"]` | `[]` |

**同一次会话里的对照组**（证明这条链路真的被 `isEditableTarget` 卡着）：
焦点仍在 `.cm-content` 时按 `⌘F`（未声明 `allowInInput`），「查找正文」按钮的
`aria-pressed` 保持 `"false"`、焦点仍在 `.cm-content`；退回阅读态后按同一个 `⌘F`，
`aria-pressed` 变为 `"true"`。即：**编辑态里没声明 `allowInInput` 的快捷键确实是死的，
⌘E 能活下来只因为它声明了。**

#### 判据 3：编辑态下光标所在的块变回源码，其余块保持渲染 —— **通过**

- 刚进编辑态（光标默认在位置 0）：块 widget 从 9 个降到 **8** 个，
  未被替换的正文行恰为 `["# 演示文档"]`——**只有**光标所在的首块变回源码。
- 光标移到文档中部（见下）后：块 widget 仍是 8 个，未被替换的正文行变为
  `["第三章的正文，光标会落在这一段。"]`，其余 8 块（含前后相邻块）保持渲染。
  按照任务提醒，这里刻意**没有**用「第一个挂载的块」当判据（光标默认在位置 0，那条恒成立）。

顺带实测到一件与本任务无关、但阶段 B 后面会撞上的事（详见第五节）：
**鼠标点击渲染块不会把光标移进去**（`live-preview.ts` 的 `BlockWidget.ignoreEvent()` 返回 true，
Task 6 的既有设计，为了让块里的链接可点）。方向键可以：
↓ 只在块之间的空行上落脚（此时 9 块全渲染），→ 一步就进入块内的源码行。

#### 判据 4：退回阅读态后所有块恢复渲染、没有光标 —— **通过**

⌘E 之后：块 widget 回到 **9** 个（与进编辑态前逐个 blockText 一致），
未被 widget 替换的正文行为 `[]`，`.cm-content` 的 `contenteditable` 为 `"false"`，
`.cm-editor` 不带 `cm-focused`。

关于「没有光标」的措辞要精确：本项目没有启用 `drawSelection()`，编辑态用的是浏览器原生
插入符，所以 DOM 里始终没有 `.cm-cursor` 元素（实测两态都是 0 个）。
「没有光标」的可靠判据是 **contenteditable="false" + 编辑器未聚焦**——不可编辑且未聚焦的
元素不会显示插入符。`document.getSelection()` 里仍残留一个折叠的 range，这是浏览器行为，
不产生可见光标。

#### 判据 5：权限被拒时仍能进编辑态，且 `writable` 为 false —— **通过**

`requestPermission` 返回 `denied` 的场景，点「编辑」后：

- 按钮 label：**退出编辑 (⌘E)**，`.cm-content` contenteditable：**`"true"`** → 确实进了编辑态；
- 块 widget 8 个、未替换行 `["# 演示文档"]` → 编辑态的表现完全正常；
- 提示条（`role="status"`）文案：**「未获得写入权限，改动只能通过 ⌘S 另存」**
  → 这条提示只在 `outcome !== 'granted'` 时弹，等价于 `writable === false`。

---

## 四、回归测试的效力验证

| 删掉的关键一行 | 结果 |
| --- | --- |
| `edit` 动作的 `allowInInput: true` | `useGlobalHotkeys.test.tsx`「编辑态下…仍能退回阅读态」变红 |
| `ensureFileWritePermission(handle, true)` 的 `true`（= 不在手势里申请） | `useEditMode.test.tsx`「尚未授权时在这一下申请写权限」变红 |

两次都已 `cp` 还原并重跑 `npm run verify` 确认恢复干净。

---

## 五、遇到的问题 / 留给后续的

1. **编辑态里光标进不进得去块，取决于输入方式。** 鼠标点击渲染块**不会**移动光标
   （`BlockWidget.ignoreEvent()` 返回 true，Task 6 为了让块内链接可点而设），方向键可以。
   本任务的判据不受影响（光标所在块确实会变回源码），但「所见即所得编辑」少了最自然的
   那个入口。这属于 live-preview 的设计取舍，不在本任务范围内，建议在阶段 B 收尾前单独定夺。
2. **`writable` 目前在界面上没有任何出口**，浏览器实测只能靠提示条间接判断。
   Task 17 的 StatusBar 会把它显性化，届时这条判据可以直接看。
3. **`editor.defaultMode` 仍是悬空设置**（见第一节「刻意没做的」）。
4. 实测环境拿不到真实的写入授权弹窗，原因与边界已在 3.1 写明。
