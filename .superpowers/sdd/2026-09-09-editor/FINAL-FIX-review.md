# 最终修复波的定向复审（56b4687..f6dd6bb）

审查方式：读本轮 diff 与两份报告 → 通读保存链路最终形态（`save-target.ts` / `save.ts` /
`useAutoSave.ts` / `document.store.ts` / `useAutoRefresh.ts` / `ConflictBanner.tsx` /
`export/download.ts`）→ **自己动手做 5 处撤销/变异实验**，每次跑完立刻 `git checkout --` 还原。
`npm run verify` 复跑通过（57 文件 / 585 用例，typecheck 与 lint 无输出）。
除本文件外工作树干净（`git status` 无输出）。

---

## 一、三条 Critical 的核实

### C1 冲突未决时不写盘 —— **ADDRESSED**

**判据落在哪一层**：`decideSaveTarget`（纯函数）。`performSave` 传
`conflictPending: state.conflict !== null`，命中即返回 `{ kind: 'conflict' }` →
`{ kind: 'conflict-pending' }`，`runSave` 翻译成「自动静默、手动弹说明」。

**判在这一层是对的**，而且是三层里唯一正确的选择：

- 判在 `useAutoSave` 的排期处（`mode==='edit' && enabled && dirty`）只挡得住定时器，
  手动 ⌘S 走的是 `useSaveCommands.saveNow → runSave`，**完全不经过那个 effect**，
  会原样漏过去——那正是本缺陷的成因（冲突暂停只写在 `useAutoRefresh` 里）。
- 判在 `performSave` 的 switch 里则与既有判据分家，下一个分支还会再漏一次。

**我逐条查了有没有别的入口绕过它**：

| 可能的绕行 | 结论 |
| --- | --- |
| 手动 ⌘S / 工具栏「保存」 | 与自动保存共用 `runSave → performSave`，同一判据，挡住 |
| 全局写盘点 | `grep createWritable` 全仓库只有两处：`save.ts:216`（`writeThrough`）与 `download.ts:65`（`saveFile`）。前者只被 `performSave` 调用，后者的保存侧调用点也只有 `performSave`，均在判据下游 |
| 导出 / 打印（`export/index.ts` 的两处 `saveFile`） | 写的是用户新选的文件，不碰原文件，不构成第三方数据破坏 |
| 冲突决断的中间态 | `ConflictBanner.keepMine` 只 `clearConflict()`；`useDisk` 先 `pushVersionBeforeOverwrite` 再 `applyRefreshedDocument` 再 `clearConflict`，两条都不写盘 |

**一处过宽（Minor，不阻塞）**：`conflictPending` 判在 `dirty` 之后、`handle` 之前，
于是冲突期间连 `save-as` / `download` 也被挡下。这两条**不写原文件**，挡住它们等于
拿掉了用户「先把我这份捞出来」的出口。提示语让用户先决断，行为安全，但不是最优。

### C2 版本缓冲跟随「这一次打开」 —— **ADDRESSED**

`versionBuffer()` 记 `bufferEpoch`，与 `document.store.openEpoch` 不一致时先 `clear()`。

**两条路都覆盖到了**：`setDocument` 与 `reset` 都自增 `openEpoch`（store 第 211、299 行），
而缓冲的**全部**三个出入口（`popPreviousVersion` / `pushVersionBeforeOverwrite` /
`writeThrough` 里那次 push）都经由 `versionBuffer()`，没有直接碰模块级 `buffer` 的旁路。
「取用时按 epoch 认领」比在 7 个 `setDocument` 调用点各加一行更难漏，判据点只有一个。

**清早了会不会把用户还需要的那一版清掉**——专门查了两个反例，都成立：

- `applyRefreshedDocument`（自动刷新、以及冲突决断选「用磁盘的」）**不**自增 `openEpoch`，
  所以 `ConflictBanner.useDisk` 刚推进的那份「编辑器里的未保存改动」不会被随后的清空带走。
  这是最关键的一处，如果按 `documentId` 或在 `applyRefreshedDocument` 里清，就会把用户
  唯一的后悔药当场毁掉。
- 同一篇文档重开算新的一次打开、缓冲清空，是**正确**的：此时编辑器里已是磁盘内容，
  上一次打开的「保存前版本」弹回去等于凭空改一篇用户没动过的文档。

### C3 `performSave` 不写全局状态 —— **ADDRESSED**

两处 await 后的全局写入都上移成返回值，落点在 `runSave` 的 `openEpoch` 守卫**之后**
（守卫在 switch 之前，第 83–92 行，`return` 直接丢弃整个结果）。

**`needs-permission` 分支是否一并受守卫保护——是。** 它返回
`{ kind: 'saved', permissionGranted: true }`，`runSave` 的 `case 'saved'` 里
`if (outcome.permissionGranted) store.setWritable(true)` 位于守卫之后。
这一处审查原本没点名，实现者主动收进同一条不变量里，判断正确：
授权框弹着时换文档，乙会顶着一份只对甲成立的写权限。

`save.ts` 现在只 import `getCurrentFileHandle`（只读），
`setCurrentFileHandle` / `registerFileHandle` 已移到 `useAutoSave.ts`，
「本函数不写全局状态」这条不变量在 import 层面就被钉住了。

---

## 二、我自己跑的撤销 / 变异实验

每次只改一处、跑相关用例、立刻还原。结果与报告声称的完全一致。

| 实验 | 变红 | 与报告声称 |
| --- | --- | --- |
| 撤销 C1（`decideSaveTarget` 不再问 `conflictPending`） | **8 例** | 一致（8） |
| 撤销 C2（去掉按 `openEpoch` 清空的那段） | **3 例** | 一致（3） |
| 撤销 C3（把 `setCurrentFileHandle` 等搬回 `performSave` 的 await 之后） | **3 例** | 一致（3） |
| 撤销 C6（`download` 折回 `saved-as`） | **2 例** | 一致（2） |
| 变异 C7（`nodes.size > capacity` → `>=`） | **4 例** | 一致（4） |

变红的用例名断言的是**缺陷本身**，不是实现细节：
「冲突挂着时自动保存不写盘，磁盘上那份外部改动原样留着」（断言 `writes === []`）、
「换文档之后点『回到上一个保存版本』，不会把甲的正文灌进乙」（断言编辑器 DOM 文本没被顶掉）、
「另存进行中换了文档：乙的保存不会写进甲刚另存出来的那个文件」（断言两个句柄各自的 `writes`）。
这与 `ConflictBanner` 那 4 条只测「按钮被按下之后」的用例形状不同，是这一轮的实质改进。

**额外验证了一条本项目最容易栽的注释归因**：`useReadingPosition.onEnhanced` 的锚点守卫，
注释新写的是「单独删掉它，没有任何用例会变红」。我把 `onEnhanced` 里那一行删掉跑全量——
**585 用例仍全绿**，注释属实（该守卫行在文件里出现两次，334 行那处在恢复路径上是可达的，
注释只描述 386 行那处，范围没有写错）。这是第 7 次查证，这次没有失真。

---

## 三、阳性对照与替身的可信度

### 阳性对照的设计站得住，但证明范围有限

「撤掉 C1 → 重新 build → 同一脚本 5/11、外部内容被替换、mtime 跳变」，
这是一次**标准的变异对照**，它排除的正是最常见的假绿：脚本没跑到断言点、
断言写在一个恒真的量上、或者被测的根本不是 dist 里那份代码。就这一条结论而言成立。

**它没有证明的**（三点，按重要性排）：

1. **只对 C1 这一个变异有效力**。一次变异只说明这套脚本看得见**这一处**缺陷，
   不能推广成「这套实测看得见保存链路上的缺陷」。C2、C3 没有对应的浏览器阳性对照。
2. **我无法复现它**。脚本按清理要求已删除，仓库里不留痕迹，11/11、10/10、5/11
   这三个数字目前只有自我报告这一个来源。
3. 「重新 build」引入的是整条构建产物，若撤销时不慎带出别的改动，对照就不纯——
   无法事后核验。

**但这不影响合并判断**，理由是：C1/C2/C3 各自都被仓库内的用例扎住，而这些用例的效力
**我自己撤销验证过**（上表 8/3/3）。浏览器实测在这里是**旁证而非承重墙**——
即使 11/11 这个数字打折，三条 Critical 仍有可复现的回归保护。

### 桥接替身削弱结论，但削弱得很轻——因为它与被断言的事恰好错开

替身位置在文件句柄这一层，`getFile()` / `createWritable()` 经 CDP 回到 Node 真读真写磁盘。

关键在于**验收 4 断言的是一次「没有发生的写」**：判定不写盘的整条决策链
（`probeCurrentFile` → `decideRefresh` → `setConflict` → `useAutoSave` → `decideSaveTarget`
→ `performSave`）**全部在句柄之上**，替身在决策点的下游。对一个否定式断言
（磁盘字节与 mtime 未变），替身与真句柄的区别几乎为零——真句柄也不过是「没有被调用」。

替身真正测不到的是**肯定式**的那一半，而那一半恰好是代码注释自己已经标注为未测的：

- `showSaveFilePicker` 返回的句柄权限即为 `granted`（`runSave` 的 `saved-as` 注释按规范
  推断，明写「本仓库没有条件在真实浏览器里复测」）；
- `createWritable` 的写入原子性（Chrome 实际走 swap 文件 + rename）与部分写入后的 mtime 语义；
- `requestPermission` 授权的生命周期。

**结论**：对验收 4 的核心结论削弱很轻，可以接受；留下的是一块**既有的、已被诚实标注的**
未测区域（另存后的权限语义），不是本轮新增的。

---

## 四、两处残留的定级

### 残留 1：轮询 1.5s 与防抖 0.8s 之间的固有竞态 —— **可带着走（不阻塞）**

**窗口有多大（我自己算的）**：外部改动落在上一次轮询之后 t 毫秒处，若防抖在
（t, 1500ms）之间到点就会盖写。即单个轮询周期内最大暴露约 **1.5 秒**，且还要求
用户恰好在这段里停笔满 800ms。默认值下这是个**亚秒级的巧合窗口**。
但设置项允许 `autoRefreshInterval` 调到 5000、`autoSaveDelay` 调到 300
（`src/types/settings.ts:227-228`），那组合下窗口可扩大到**约 5 秒**——这一点没人写下来。
另有一处同源的更窄窗口：`performSave` 在入口读 `state.conflict`，其后还有三次 await
才真正落盘，这期间被判出的冲突拦不住这一次写入。

**和 C1 是同一类风险吗**：后果同类（第三方数据被无声覆盖），**性质不同**。
C1 是「应用**已经发现**冲突、已经把提示条摆在用户面前，然后照写不误」，
状态持久、用户每敲一个字就重新武装一次，暴露可达数分钟——那是逻辑错误。
残留 1 是「应用**还不知道**」，属于轮询固有的探测延迟。
File System Access API 没有变更事件，这个窗口**原理上关不到零**，只能收窄。

**不阻塞的理由**：不是本轮引入；不是逻辑错误而是探测延迟下界；默认值下需要多重巧合；
README 已明写「自动保存写的是磁盘上的真实文件，没有回收站」并建议配合 Git。
**建议的后续（不阻塞）**：在 `writeThrough` 里 `createWritable()` 之前再探一次 mtime，
与 `document.lastModified` 不符就转成冲突——约十行，能把窗口从「一个轮询周期」
收窄到「一次写入耗时」，比压低轮询间隔（全程耗电）更划算。同时建议约束设置组合，
不让 `autoRefreshInterval` 大于 `autoSaveDelay` 太多。

### 残留 2：决断「保留我的改动」后不重排作废的那次防抖 —— **可带着走（定性准确）**

我核对了代码，实现者的定性**准确**：
`ConflictBanner.keepMine` 只调 `clearConflict()`；`useAutoSave` 的排期 effect 依赖是
`[text, savedContent, mode, enabled]`，**不含 conflict**，所以决断本身不会重新排期；
`dirty` 自始至终为真，状态栏「● 未保存」与 `beforeunload` 拦截都照常。
**没有数据损失**，最坏情况是用户点完「保留我的改动」就走开，那份改动一直停在内存里
——但关页会被拦下。与 README「停笔约 0.8 秒后自动写回」的承诺有一处小出入，属体验缺口。
当前无用例覆盖「决断后恢复排期」这一面（`ConflictBanner.test.tsx` 的 5 条都不让时间前进）。

---

## 五、C5 / C6 / C7 / spec 的核实

| 项 | 结论 |
| --- | --- |
| **C5a** `clearSelfWrites` | ✅ 已订正。`grep` 确认生产代码零调用点，只有 `useAutoSave.test.tsx` 与 `self-write.test.ts` 在用；新注释如实写明，并说清了「为什么换文档不需要清」（键是 mtime+长度+内容三元组、只留 12 条）与版本缓冲的区别。归因经得起查。 |
| **C5b** `onEnhanced` 锚点守卫 | ✅ 已订正，且**我实测复核**：删掉该行全量 585 仍全绿，注释所述「不可达、保留为纵深防御」属实。 |
| **C6** 保存路径丢 `via` | ✅ 已修。`performSave` 分出 `downloaded`；`runSave` 的 `downloaded` 分支**不** `markSaved`，只 `setSaveStatus('idle')` + error 色提示，措辞含「下载目录」「原文件没有改动」、不含「已另存为」。撤销后 2 例变红（含「不许清脏状态、不许报已保存」与 `beforeunload` 仍拦截）。 |
| **C7** `capacity=1` | ✅ 已补 4 例，`>`→`>=` 变异 4 例变红（我自己跑的）。并如实记录了一件审查未及的事实：`renderOffscreen` 不调 `acquire`，淘汰逻辑在那条生产路径上并未走到，因此用例分「容量契约」与「离屏真实调用形状」两组——这个区分是诚实的，没有把覆盖率当成效力。 |
| **spec 体积数字** | ✅ 已改为实测 626891 字节（gzip 217KB，7.5 倍），`vite.config.ts` 第 47–50 行与之一致。**一处观察（不算缺陷）**：当前 `dist/assets/viewer-*.js` 已是 648025 字节，比该数字大约 3%——两处都明确标注了「阶段 A 收尾 Task 11 量的」，属点值而非现值，标注诚实。 |

---

## 六、本轮有没有引入新的 Critical / Important

**没有新的 Critical。** 本轮全部改动都在收窄写盘条件或把全局写入后移，方向是单调变安全的。

**一处新发现（Minor，非本轮引入，但与本轮刚立的不变量同源）**：
`useEditMode.enterEdit`（`src/hooks/useEditMode.ts:56-71`）是 C3 的**第四个同类现场**，
本轮没有覆盖到：

```ts
const outcome = await ensureFileWritePermission(handle, true);
setWritable(outcome === 'granted');   // ← await 之后写全局状态，无 openEpoch 守卫
...
setMode('edit');                       // ← 同上
```

授权框弹着时用户换到乙，这两行会落到乙头上：乙顶着一份只对甲成立的 `writable=true`，
并被动进入编辑态。**危害远小于 C3**——句柄此时已是乙自己的，写的内容也是乙自己的文本，
最坏结果是 `createWritable()` 因无权限抛错、弹一条保存失败提示，**不会写错文件、不丢数据**，
所以定 Minor、不阻塞。但本轮刚把「跨 await 的全局写入必须在 epoch 守卫之后」立成不变量，
FINAL-REVIEW 的 C4 也只点了三处，这第四处建议记进带走清单。

**超出范围的改动：没有。** 本轮 11 个文件：3 个生产文件的实质改动
（`save-target.ts` / `save.ts` / `useAutoSave.ts`）、4 个测试文件、
3 处纯注释订正（`self-write.ts` / `useReadingPosition.ts` / `document.store.ts`）、
1 处 spec 数字。`useReadingPosition.ts` 与 `document.store.ts` 的改动**确认为纯注释**，
无一行可执行代码变动。C8/C9 与 18 条带走项按分诊未动，克制得当。

---

## 七、红线核对

- **保存路径上没有任何文本变换。** `performSave` 把编辑器文本原样交给
  `new Blob([text])` 与 `writable.write(text)`，中间无行尾归一、无尾随空行处理、无 BOM。
  `normalizeMarkdown` 的调用点只有 `export/index.ts:75`（导出 Markdown），
  与保存链路完全分离，`save.ts:125-127` 的注释把这条界线写明了。**红线守住。**
- **零网络请求**：本轮无新增。全仓库唯一的 `XMLHttpRequest` 在 `utils/file-listing.ts`，
  读的是 `file://`（注释说明 Chrome 的 fetch 不支持 file 协议），非网络。
- TypeScript strict：`npm run verify` 全绿（typecheck / lint 无输出，57 文件 585 用例）。
- 注释中文且解释「为什么」：本轮新增注释均说明动机与后果，两处失真注释已订正并经复核。
- 提交信息：中文，**无署名尾注**，正文如实列出撤销验证的数字。

---

## 八、结论

**三条 Critical：C1 ADDRESSED / C2 ADDRESSED / C3 ADDRESSED**，
三条都不只堵住了报告里那一条复现路径，而是堵在了各自缺陷的判据层，且都有
我亲自撤销验证过效力的回归用例。

**两处残留：均可带着走**，不阻塞合并（理由见第四节）。

**可以合并。** 建议带走的三条（都不阻塞）：
1. 残留 1 的收窄（写盘前再探一次 mtime）+ 限制轮询/防抖的设置组合；
2. `useEditMode.enterEdit` 的 epoch 守卫（C4 的第四处）；
3. 冲突期间对 `save-as`/`download` 的过宽拦截，可放开为「不碰原文件的出口允许」。

## 问题清单

**Minor（带走）**
1. `useEditMode.enterEdit` 在 await 之后写 `writable` / `mode`，无 openEpoch 守卫（C4 第四处）
2. 冲突未决时连不碰原文件的 `save-as` / `download` 也被挡下，拿掉了用户捞出改动的出口
3. 残留 1 的窗口在极端设置组合下可达约 5 秒（`autoRefreshInterval` 5000 + `autoSaveDelay` 300），无人写明
4. 残留 2「决断后恢复排期」这一面无用例覆盖
5. spec / `vite.config.ts` 的 626891 字节是 Task 11 的点值，现值已 648025（标注诚实，非缺陷）
6. 浏览器实测脚本已清理，11/11 与 10/10 两组数字无法复现核验（但不承重，见第三节）
