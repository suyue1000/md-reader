# 最终修复波报告（FINAL-REVIEW 的合并条件）

对象：`feat/editor`，在 `56b4687` 之上。依据：`FINAL-REVIEW.md` 的「能不能合并」三项条件。

基线 57 文件 / 562 用例 → 本次 **57 文件 / 585 用例**（+23），`npm run verify` 通过（typecheck / lint 无输出）。

---

## 一、三条 Critical

三条都在保存链路，都是对磁盘真实文件的不可逆破坏。三条的修法有一个共同点：
**把「这一次打开」（`openEpoch`）与「冲突未决」这两个事实，放进原本就该问它们的那个判据里**，
而不是在调用方各加一道判断——后者正是 C1 的成因（冲突暂停只写在 `useAutoRefresh` 里，
后加的自动保存整个绕过了它）。

### C1 冲突提示挂着的时候，自动保存照写不误

**修法**：`decideSaveTarget` 增加 `conflictPending` 输入，新增 `{ kind: 'conflict' }` 分支；
`performSave` 传 `state.conflict !== null`，返回新的 `{ kind: 'conflict-pending' }`；
`runSave` 把它翻译成：自动保存静默收场，手动 ⌘S 弹一条说明。

**为什么判在这个纯函数里**：自动保存与手动保存共用同一个判据，分两处写必然分岔——
这次的缺陷就是分岔的产物。放在纯函数里也让用例好构造（`save-target.test.ts` 新增 5 例）。

**为什么手动 ⌘S 也挡**：冲突未决意味着磁盘上那份是**别的程序**写的，而它在本应用里
没有任何副本——版本缓冲推进的是冲突**之前**的 `document.content`，`ConflictBanner` 只在
用户点「改用磁盘上的版本」时才留一份编辑器里的。手动保存同样会不可逆地抹掉它，
区别只是该不该告诉用户。挡下来之后 `dirty` 继续挂着，状态栏、关页拦截如实。

### C2 版本缓冲是模块级单例，不跟文档走

**修法**：`save.ts` 的 `versionBuffer()` 记一个 `bufferEpoch`，与 `document.store` 的
`openEpoch` 不一致时先 `buffer.clear()` 再用。`VersionBuffer.clear()` 由此有了生产调用点
（FINAL-REVIEW 问题清单第 11 条的一半）。

**为什么用「取用时按 epoch 认领」而不是在 `setDocument` 里回调**：`setDocument` 有 7 个调用点
（`useOpenFile` ×2、`useWorkspace` ×2、`useEmbeddedDocument`、`useHostWorkspace`、`useFileDrop`），
逐个加一行清空的写法，正是 C1 那种「漏一处就静默破坏」的形状。按 epoch 认领只有一个判据点，
新增打开路径不需要知道版本缓冲存在。

**为什么按 openEpoch 而不是 documentId**：同一篇文档重新打开时编辑器里已经是磁盘上的内容，
上一次打开留下的「保存前版本」对它不再成立，弹回去等于凭空改一篇用户刚打开、没动过的文档。
判据与 `useReadingPosition` 的闩锁同源（C4 的收敛也在这里兑现）。

### C3 `performSave` 的残余会让下一次保存写进另一个文件

**修法**：`performSave` 从此**不写任何全局状态**。两处 await 后的写入都上移成返回值，
由 `runSave` 在既有的 `openEpoch` 守卫之后落点：

| 原来在 `performSave` 里 | 现在 |
| --- | --- |
| save-as 分支 `setCurrentFileHandle` / `registerFileHandle` / `setWritable(true)` | `{ kind: 'saved-as', handle, filename }` → `runSave` |
| needs-permission 分支 `setWritable(true)` | `{ kind: 'saved', permissionGranted }` → `runSave` |

第二处是审查没点名、但同类的：授权框弹着的时候换文档，乙会顶着一份只对甲成立的写权限。
既然要把「不写全局状态」立成不变量，就不能留一处例外。

---

## 二、回归测试的撤销验证

每条修复逐项撤销、跑四个相关测试文件（`save-target` / `save` / `useAutoSave` / `block-cache`，
基线 61 例全绿），撤销后失败项如下；每次跑完立刻还原，最后复跑 61 例全绿。

| 撤销的修复 | 失败用例 |
| --- | --- |
| **C1**：`decideSaveTarget` 不再问 `conflictPending` | **8 例**：冲突未决时自动保存一个字节都不写／手动保存同样不写／没有句柄时也不弹另存／冲突挂着时自动保存不写盘，磁盘上那份外部改动原样留着／冲突挂着时手动保存同样不写盘／冲突条弹出后用户继续敲字，自动保存到点也不动手／冲突挂着时按 ⌘S 也不写盘，并且如实说明为什么没保存／用户决断（冲突清空）之后保存恢复 |
| **C2**：版本缓冲不再按 openEpoch 清空 | **3 例**：换了文档之后，上一篇的保存前版本不再弹得出来／同一篇文档重新打开也算新的一次打开／换文档之后点「回到上一个保存版本」，不会把甲的正文灌进乙 |
| **C3**：另存的句柄改回在 `performSave` 的 await 之后写全局状态 | **3 例**：另存把新句柄交回调用方而不是自己写进全局状态／另存进行中换了文档：乙的保存不会写进甲刚另存出来的那个文件／⌘S 只触发了下载时不许清脏状态 |
| **C6**：下载降级重新被当成「已另存」 | **2 例**：退到浏览器下载时如实报 downloaded／⌘S 只触发了下载时，不许清脏状态、不许报「已保存」 |
| **C7 变异**：块缓存淘汰条件 `>` 改成 `>=` | **4 例**：超出容量时淘汰最久未使用的条目／每取一个新键就淘汰掉上一个／刚取到的那一个一定还在缓存里／被淘汰的键连增强标记一起丢掉 |

**关于 C1 用例形状的那条教训**（`ConflictBanner` 的 4 例漏掉 C1，因为它们只测「按钮被按下之后」）：
新增用例测的是**缺陷本身**——冲突挂起期间让时间真的往前走（`advanceTimersByTimeAsync`
跨三个防抖周期），断言 `writes === []`，即「磁盘有没有被动过」。不是断言
`decideSaveTarget` 返回了某个新 kind，也不是断言某个按钮的状态。

---

## 三、两条验收标准的浏览器实测

### 实测环境与可信度边界

Chrome **153.0.8010.36**（本机）。已实测确认 `--load-extension` 仍然不生效：
加 `--disable-features=DisableLoadExtensionCommandLineSwitch` 与
`--enable-unsafe-extension-debugging`，headless 与有头各试一遍，CDP 目标列表里只有 Chrome
自带的两个组件扩展，md-reader 的 service worker 从未出现。沿用 8c/8d 的替代方案：

- `npm run build` 产出的 **dist 原样**，用无依赖的 node 静态服务器挂在 `http://127.0.0.1`；
- **两个端口 = 两个源**（8801 阅读器 / 8802 宿主），复刻「file:// 页面里嵌 chrome-extension:// iframe」
  这对跨源关系——`origin` 含端口，`inCrossOriginFrame()` 读 `top.location.origin` 照样抛 SecurityError；
- 宿主页复刻 `src/content/index.ts` 的 `takeOver()` 握手与 `md-reader:hash` 两支；
- `chrome.storage` 用 localStorage 替身；驱动方式是 Node 内置 WebSocket 直连 CDP；
- 按要求加了 `--disable-backgrounding-occluded-windows` 与 `--disable-renderer-backgrounding`
  （另加 `--disable-background-timer-throttling`）。

### 验收第 4 条「冲突提示而非静默覆盖」——**通过（11/11）**

文件是磁盘上真实的 `conflict.md`，外部改动由 Node 真的 `writeFileSync` 写进去。

| 步骤 | 实测 |
| --- | --- |
| 真实 dist 打开磁盘文件、进编辑态并拿到写权限 | ✅ 状态栏无「无法写回原文件」 |
| 打一个字 → 自动保存写回真实文件 | ✅ 磁盘内容出现「甲」（证明链路本来是通的） |
| 敲字后立刻外部改写同一文件 + 一次 `visibilitychange` 逼轮询探测 | ✅ 冲突提示条弹出 |
| 冲突挂着期间继续打字，跨过多个 800ms 周期（共 ~5.2s） | ✅ 磁盘内容 **byte-for-byte 仍是外部那份**，**mtime 一微秒都没变**（1789543388968.9526 → 同值） |
| 状态栏 | ✅ 如实挂着「未保存」 |
| 冲突期间按 ⌘S | ✅ 不写盘，且提示「请先在上方的提示条里选一份」 |
| 点「保留我的改动」 | ✅ 这一下本身不写盘 |
| 决断后继续打字 | ✅ 自动保存恢复并落盘（不是被永久封住） |

**反向对照（关键）**：把 C1 的那一行撤掉、**重新 build**、跑同一个脚本 —— 5/11 通过，
磁盘上外部程序写的那份被替换成了 `甲乙丙丁戊己# 实测文档…`，mtime 从
1789543408003.69 跳到 1789543411516.83。**这套实测确实看得见缺陷**，绿灯不是因为脚本没跑到点上。
跑完已还原源码并重新构建。

**这条实测的替身边界（必须说清楚）**：`showOpenFilePicker` 弹的是**系统原生对话框**，CDP 驱动不了，
所以文件句柄本身是一个桥接替身——它的 `getFile()` / `createWritable()` 经 CDP binding 回到 Node，
**真的读写磁盘上那个文件**，`lastModified` 取真实 mtime。句柄之上的每一层
（`probeCurrentFile`、`decideRefresh`、`useAutoRefresh`、`useAutoSave`、`decideSaveTarget`、
`performSave`、`writeThrough`、`ConflictBanner`）全是 dist 里的真实代码。
真实 `FileSystemFileHandle` 的权限语义与写入原子性没有被测到。

### 验收第 5 条「无句柄入口下 ⌘S 触发下载」——**通过（10/10）**

走的是真正的跨源 iframe 无句柄分支，键盘事件是 CDP 发的真实 ⌘S。

| 判据 | 实测 |
| --- | --- |
| 宿主握手 → 跨源 iframe 里的阅读器拿到正文 | ✅ |
| 阅读器确实读不到 `top.location.origin`（弹不出选择器的那条路） | ✅ |
| 状态栏常驻「无法写回原文件，⌘S 另存」 | ✅ |
| ⌘S 触发浏览器下载 | ✅ 下载目录里出现 `embed.md`，内容含刚敲的那句 |
| 原文件 | ✅ 一个字节都没被改动 |
| 状态栏 | ✅ 仍是「● 未保存」，**没有**「已保存」 |
| 提示语 | ✅ 含「下载目录」「原文件没有改动」，**不含**「已另存为」 |
| 关页拦截 | ✅ `beforeunload` 仍被拦下 |

修 C6 之前这条路会：报「已另存为 embed.md」、`dirty` 清零、关页拦截失效。

---

## 四、其余几处

| 项 | 处理 |
| --- | --- |
| **C6** 保存路径丢掉 `via` | `saveFile` 的 `via` 不再被吞：`performSave` 分成 `saved-as`（picker，带句柄）与 `downloaded`（下载降级）两种结果。`downloaded` **不** `markSaved`——脏状态、关页拦截、状态栏因此如实；提示用 error 色并说明「原文件没有改动，改动仍未保存」。 |
| **C5** `clearSelfWrites` 注释 | 改成如实：**生产零调用点，只有测试在用**，并写清为什么换文档不需要清（键是「mtime+长度+内容」三元组，跨文档误命中要求三者同时相等，且只留 12 条），以及它与版本缓冲的区别（那边存的是会被灌回编辑器的正文，认错文档就是写错文件；这边认错只是少刷新一次）。 |
| **C5** `onEnhanced` 锚点守卫注释 | 原注释「这是本条守卫存在的唯一理由，删掉几秒后就坏」是推断。按 R24 补充改成如实：`restoredDocRef` 先一步返回，**这一行不可达**，单独删掉没有任何用例会变红；保留是显式标注的纵深防御。 |
| **C7** `createBlockCache(1)` | 补 4 条用例。同时如实记录一件审查未及的事实：`renderOffscreen` **不调 `acquire`**，只用 `isEnhanced` / `markEnhanced` / `clear`，所以淘汰逻辑在那条生产路径上并没有被走到——用例因此分两组：容量 1 的淘汰边界（容量参数本身的契约）＋ 离屏渲染的真实调用形状。效力用变异验证（`>` → `>=`，4 例变红）。 |
| **spec 体积数字** | `docs/superpowers/specs/2026-09-09-editor-design.md` 风险 1 的「约 350KB」改成实测 **626891 字节（7.5 倍，gzip 217KB）**，并注明 `vite.config.ts` 已按同一实测订正。 |
| `document.store` 两处注释 | `writable` 的「只由 `useEditMode.enterEdit` 写入」已不成立（`runSave` 还有两处），改成如实并说明为什么那两处必须在 epoch 守卫之后；`conflict` 补上「保存链路也在这期间停手」。 |

---

## 五、没做的事

- **C9**（冲突未决时换文档的确认框不提磁盘上那份）、**C8**、以及 TRIAGE 的 18 条带走项：
  按 FINAL-REVIEW 的分诊「可以带着走」，本次不动，避免修复波夹带范围外改动。
- **决断之后不会重排那次作废的防抖**：点「保留我的改动」本身不触发写盘，恢复保存要靠
  下一次输入或 ⌘S。实测确认（第 4 条第 7、8 行），数据上没有损失（`dirty` 仍挂着、状态栏如实），
  故按现状记录而不顺手改——改它要动 `useAutoSave` 的排期依赖，属于行为变更。
- **轮询间隔与防抖间隔之间的固有竞态**：若外部改动发生在「敲字后 800ms 内」，自动保存会在
  轮询发现它之前就写回去。这不是 C1 引入的，C1 的修复也关不掉它（轮询 1.5s > 防抖 0.8s）。
  实测脚本正是用一次 `visibilitychange` 逼出即时探测来规避这个竞态的。记在这里供后续评估。
- `package.json` 0.1.0 vs `manifest.json` 1.0.0：非本次范围。

## 六、全局约束核对

TypeScript strict 全开、`npm run verify` 通过（57 文件 / 585 用例）、注释中文且解释「为什么」、
机制归因均经查证（两处失真注释已订正）、**保存链路没有增加任何文本规整**、
新增代码零网络请求、提交信息中文且无署名尾注。实测用的临时脚本、浏览器进程与临时 profile 已清理。
