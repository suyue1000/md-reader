# 最终全分支审查（16fcce9..56b4687，43 提交）

审查方式：读 BRANCH-MAP 定位 → 通读保存/冲突/编辑态/定位四个子系统的最终形态（不是各轮 diff）
→ 对三处可疑耦合写临时探针实测 → 探针删除、工作树已确认干净（`git status` 无输出）。
`npm run verify` 通过（57 文件 / 562 用例，exit 0）。

**562 全绿不构成质量证明**：下面三条 Critical 全部在链路层面可复现，而且现有用例全绿。

---

## 一、跨任务发现

### C1（Critical）冲突提示挂着的时候，自动保存照写不误

- Task 16（33b3bbd）建立冲突判定，明确「冲突期间**暂停轮询**」，`useAutoRefresh` 依赖里有 `hasConflict`。
- Task 17（c776593）后加的自动保存**从未问过 conflict**：
  - `useAutoSave` 排期判据 = `mode==='edit' && enabled && dirty`
  - `decideSaveTarget` 判据 = `dirty && handle && writable`
  - 两处都没有 conflict 这一项。`grep conflict src/hooks/useAutoSave.ts src/editor/save*.ts` 零命中。

**实测（探针 A，走真实 useAutoSave → performSave → 句柄替身）**：
冲突条弹出后用户敲一个字，800ms 后 `writes === ['原文X']`——外部编辑器写的那份被静默覆盖。
而 `writeThrough` 推进版本缓冲的是 `document.content`（冲突**前**的旧内容），
磁盘上那份外部改动**没有任何副本**，没有回收站。

这正是验收标准第 4 条「冲突提示而非静默覆盖」的反面，且是整条分支里唯一一处
对**第三方数据**（别的程序写的内容）的不可逆破坏。
ConflictBanner 的 4 条用例全绿，因为它们只测「按钮被按下之后」。

### C2（Critical）版本缓冲是模块级单例，不跟文档走

`save.ts` 的 `buffer` 只在 `keepVersions` 变化时重建；`setDocument` / `reset` 都不清它。

**实测（探针 B）**：甲保存一次后 `setDocument(乙)`，`popPreviousVersion()` 仍返回甲的正文。

后果链：工具栏「回到上一个保存版本」只按 `mode==='edit'` 置灰 → 在乙上点它 →
甲的正文灌进乙的编辑器 → dirty → 800ms 后自动保存把**甲的内容写进乙的文件**。
`runSave` 的 openEpoch 守卫注释把这个后果称作「本功能里最坏的一类缺陷」——
它守住了一条入口，这是同一后果的第二条入口。README 还明确把这个缓冲宣传成后悔药。

附带：`VersionBuffer.clear()` 已实现、生产代码零调用点。

### C3（必须修，定级需上调）`performSave` 在 await 之后写全局状态，且真的污染文件内容

TRIAGE 860 / R45 定级为「不污染文件内容，只打破 writable 不变量」。**实测推翻**：

save-as 分支在 await 之后调 `setCurrentFileHandle(result.handle)` + `setWritable(true)`。
**探针 C**：另存进行中换到乙，落定后 `getCurrentFileHandle()` 变成**甲刚另存出来的那个文件**；
乙的下一次自动保存写进甲的新文件——`a.writes === [Blob, '乙改过的内容']`，`b.writes === []`。

### C4 一个抽象只被用在三分之一该用的地方

「这一次打开」（openEpoch）在 T8 建立（阅读位置闩锁）、T18 扩展（保存结果落点）。
保存子系统里另外三处同样跨 await / 跨文档的状态没有接上它：
版本缓冲（C2）、`performSave` 后半段（C3）、`self-write.ts` 的登记表。

### C5 注释宣称的机制与代码最终形态不符（这是第 5、6 次）

- `self-write.ts`：`clearSelfWrites` 注释写「换文档时清空」——**生产代码没有任何调用点**，只有测试在用。
- `useReadingPosition.onEnhanced` 的锚点守卫注释写「这是本条守卫存在的**唯一**理由，
  删掉它……坏的是几秒之后」。R24 补充已认定它是**不可达分支**（`restoredDocRef` 先挡住），
  更准确的结论留在 RULINGS 里，没有回写到代码。

### C6 同一件事在两处做法不一致，而且新的那处丢了信息

`saveFile` 返回 `via: 'picker' | 'download'`。
- 导出（T10，`useExport.report`）区分得很清楚：「已下载 …… 到浏览器下载目录——这次没能弹出保存对话框」。
- 保存（T15，`performSave`）把 `via` **整个丢掉**，两条路都返回 `saved-as`，
  `runSave` 一律 `markSaved(text, Date.now())` + 提示「已另存为 x.md」。

后果落在验收第 5 条那条路上（跨源 iframe，⌘S → 下载）：原文件一个字节没变，
但 dirty 被清零、关页拦截随之失效、状态栏报「已保存」。
这是**读代码就能看出的语义错配**，而那条分支恰好从未在真实浏览器里走到过。

### C7 一处被推迟的边界，在后续任务里变成了生产路径

TRIAGE 113「未覆盖 capacity=0/1」在 T4 判为纯覆盖增强。
T10 的 `renderOffscreen` 用的正是 `createBlockCache(1)`——导出与打印每次都走这条从没被测过的路。
（行为读下来是对的，但它已经不是假想边界。）

### C8 编辑态点击那条链：三道防线并存，没有单一权威判据

`widgetIgnoresEvent`（按 editable + 事件目标）、`blockStartMouseSelection`（按手势形状 + `[data-block-key]`）、
`BlockWidget.eq`（按 key + viewEditable）现在同时在管「编辑态点击」。
其中 `eq` 里的 `viewEditable` 比较已被实现者自己查证为**非必需**，作为冗余防线保留（注释诚实写明）。
记录良好，不要求改；但这条链上确实没有谁覆盖谁的关系，将来任一处改动都得三处一起看。

### C9（Minor）冲突未决时换文档，确认框不提磁盘上那份

`confirmDiscardUnsaved` 只说「改动会丢失」，不知道 conflict 存在。

### 做得好的一处（特意核过，没有分岔）

`markNavigation` 的四个调用点（TocPanel / useRelativeLinks / useSearch / BackToTop）判据完全统一，
store 里那段「什么算显式导航」的三条判定标准足够硬。
`dirty` 的三处算法（useAutoSave / performSave / decideRefresh）基准一致。
这是分支里跨任务收敛得最好的部分。

---

## 二、TRIAGE 28 条分诊

### 必须修（3）

| 编号 | 判断 |
| --- | --- |
| 860（R45 残余） | 必须修，**且定级上调**：探针 C 证明会污染文件内容，不止打破不变量 |
| 270（onEnhanced 锚点守卫的定性） | 必须修**注释**（不改代码）：本项目第 5 次注释归因失真，成本近零 |
| 113（capacity 0/1 边界） | 必须修：它已是导出/打印的生产路径（`createBlockCache(1)`），不再是假想边界 |

### 已不适用 / 就此结清（7）

104（R12 包装，内容即 100/101/102，按那三条处理）、172、173、174、203、207（parked 项已执行并通过，T11 已关闭）、
492（**我在此结清**：不回溯重验。8c/8d/9 的滚动观测风险限于精确数值，不影响任何判定逻辑；
T11 的收官措辞已按「无已知功能回归」兜住）。

### 可以带着走（18）

100、101、102、111、112、121、122、224、246、247、248、264、361、400、412、448、503、679。

其中三条值得点名（不阻塞，但别忘）：
- **247**（useScrollSpy 每 200ms 拆装监听）是打字期间的真实开销，不是纯洁癖；
- **224**（settle-with-timeout 落败侧定时器不清）已核实属实，最长多挂 5s 空定时器；
- **503**（10s 保险丝到期静默印空框）建议顺手补一句提示。

---

## 三、已知缺口的风险评估

1. **验收 4 & 5 只有单测** — 第 4 条已不是「没验证」而是「验了会挂」（C1）。
   第 5 条除了没实测，还有 C6 那个读代码就能看出的语义错配。**两条都必须在真实浏览器走一遍**，
   第 4 条现在有确定的复现脚本。
2. **首屏 7.5 倍** — 对本地扩展（零网络、磁盘加载）风险可接受，`vite.config.ts` 的注释已按实测订正，诚实。
   但 **spec 风险 1 仍写着「约 350KB」，没跟着订正**——下一个人还会按错的预算做决策。近零成本，建议一并改。
   CodeMirror+Lezer 占 77.3% 是结构性的，dompurify 39KB 的拒绝理由（同步嵌在 XSS 最后一道闸上）成立。
3. **R45 残余** — 见 C3，上调。
4. **版本号 0.1.0 vs 1.0.0** — 非本分支引入，可带着走；但本轮已经在改 README/STORE 文案，顺手统一成本近零。
5. **harness 陷阱** — 早期几轮观测的风险限于精确数值，不要求重验（同 492 的结清）。

---

## 四、能不能合并

**不能直接合。有条件合。**

合并前必须完成：

1. 修 C1、C2、C3，各补一条回归用例（三条都是磁盘上真实文件的不可逆破坏，都在保存链路）。
   建议方向（仅方向，未写代码）：
   - C1：给 `decideSaveTarget` 加一个 `conflictPending` 输入，冲突未决一律不写盘——
     与现有判据同处一个纯函数，用例好构造；
   - C2：换文档时 `buffer.clear()`（该方法已存在、零调用点），或让缓冲按 openEpoch 归属；
   - C3：把 `performSave` 的两处 await 后全局写入**上移成返回值**交给 `runSave`（那里已有 openEpoch 守卫），
     `performSave` 从此不写全局状态。
2. 订正 C5 的两处注释、C6 的提示语义、spec 风险 1 的体积数字（合计近零成本）。
3. 验收第 4、5 条各在真实浏览器走一遍。

可以带着走：C7、C8、C9 与 18 条 Minor。

---

## 问题清单

**Critical**
1. C1 冲突未决期间自动保存静默覆盖外部改动（违反验收 4；探针实证）
2. C2 版本缓冲跨文档，可把甲的正文写进乙的文件（探针实证）
3. C3 `performSave` await 后改全局句柄，乙的保存写进甲的另存文件（探针实证，定级上调）

**Important**
4. C6 下载降级被当成「已保存」：dirty 清零、关页拦截失效、提示措辞错（验收 5 那条路）
5. C5 两处注释与代码实际形态不符（`clearSelfWrites` 从未被调用；锚点守卫实为不可达分支）
6. C7 `createBlockCache(1)` 已是生产路径而无用例
7. spec 风险 1 的体积预算未随实测订正

**Minor**
8. C9 冲突未决时换文档的确认框不提磁盘上那份
9. C4 openEpoch 抽象覆盖不全（修完 C2/C3 即自然收敛）
10. TRIAGE 中 18 条带走项，其中 247 / 224 / 503 值得优先处理
11. `VersionBuffer.clear()`、`clearSelfWrites()` 两个 API 实现了但生产零调用
12. package.json 0.1.0 vs manifest.json 1.0.0
