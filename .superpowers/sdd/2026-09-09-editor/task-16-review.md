# Task 16 代码审查

## 一、顺序红线核实

代码顺序（`ConflictBanner.tsx` `useDisk`）确实是「先 push 版本缓冲，再 `applyRefreshedDocument`」，与简报要求一致。

**「测不出来」的说法：部分成立，但结论下得过大。**

亲自实验（做完已还原，工作区已确认 clean）：

1. 把 `useDisk` 两行顺序颠倒后跑 `ConflictBanner.test.tsx` 原有 4 条用例——**全部通过**。原因查实：`applyRefreshedDocument` 只改 Zustand store，不会同步触碰测试里那个独立的 `EditorView`；`view.state.doc.toString()` 是否读到新内容，取决于 `MarkdownEditor` 的 `value` 同步 `useEffect` 有没有跑过，而这个 effect 要等 React 完成一次渲染提交才会触发，不会在同一个同步的点击处理函数内发生。所以在当前架构（没有 `flushSync`）下，用「内容断言」这种测试风格确实测不出这处顺序颠倒——**这部分实现者说对了**。
2. 但「结构性验证不了」不等于「顺序完全无法钉住」。我另写了一个基于 `vi.spyOn` + `invocationCallOrder` 的临时用例，直接断言 `pushVersionBeforeOverwrite` 的调用顺序早于 `applyRefreshedDocument`：顺序颠倒时该用例**准确变红**（`expected 2 to be less than 1`），顺序正确时通过。也就是说，用户在 Part 1 里的怀疑是对的——vitest 的调用顺序断言不需要 React flush 参与，可以钉住这条红线，只是实现者没有写这种测试。

**结论**：现状是——这条全功能最重要的顺序红线，**在已交付的测试里事实上是 0 覆盖**（内容断言测不出，也没有调用顺序断言）。报告如实说明了限制，这是诚实的，但报告的措辞（「这条自动化测试测不出来」）容易让人以为"任何自动化测试都测不出"，而事实是"可以测，只是没写"。判定为 **Important**：应当补一条 `invocationCallOrder` 断言，成本很低（我验证只需十几行）。

## 二、三件交接核实

1. `src/utils/auto-refresh.ts`、`auto-refresh.test.ts` 已确认物理删除（`ls` 报 No such file，`git log` 显示本次提交移除）。`useAutoRefresh.ts` 已完全改用 `decideRefresh`（`decideRefreshAction` 全仓库搜索仅剩注释里的历史提及，无实际调用）。简报文件清单写"Modify"确系笔误，实际交付是删除，与报告一致。
2. `missing` / `permission-lost` / `error` 三种文案断言均已在 `conflict.test.ts` 中原样存在（`toContain('删除')` / `toContain('刷新')` / `toContain('磁盘 IO 失败')`），不是数量对齐的障眼法，是真实的文案锁定用例迁移。
3. Task 13 护栏（`MarkdownEditor.tsx` 的 `readOnlyRef`）已被正式移除并替换为新注释，注释里明确指出安全性判断现在落在 `decideRefresh` + `useAutoRefresh` + `ConflictBanner` 三处，不再是"留给未来"的悬空表述。对应两条回归用例改写为验证新行为（而非删除不测）。核查无误。

## 三、`isSelfWrite` 消费端 / 脏判据

- `useAutoRefresh.ts` 确认将 `self-write.ts` 的 `isSelfWrite` 作为 `RefreshContext.isSelfWrite` 传入 `decideRefresh`，回路已接通：自动保存 → `recordSelfWrite` 登记 → 下次轮询 `isSelfWrite` 命中 → `touch-timestamp`，不回灌、不跳光标。若自写识别失效（比如登记表清空或键不匹配），回路会退化为按内容比较：`incoming.content === savedContent` 时仍能被"内容未变"分支挡住，但如果用户在写盘后、下次轮询前又敲了几个字，则两个安全网都会失效，判定权落到 `dirty` 上——若此时编辑器内容恰好等于新落盘内容（不常见但可能），会被误判为 `adopt` 而非期望的 `touch-timestamp`；实际后果只是多刷新一次、不丢数据，方向仍然安全。
- `decideRefresh` 是纯函数，`isSelfWrite` 以依赖注入（函数类型字段）方式传入，未在 `conflict.ts` 内部直接 `import` 模块级登记表——可测性设计符合简报要求，`conflict.test.ts` 里确实用 `() => true/false` 精确构造了三种情形。
- **脏判据**：`editorText !== savedContent`，其中 `savedContent` 取自 `document.store.document.content`。理由站得住：`setDocument`/`applyRefreshedDocument` 是仅有写入点，语义对应"上次落盘内容"。已知误判方向验证：这一判据只会在"未落盘的编辑其实和上次落盘内容一样"时误判为 clean（这种情况下 dirty 本来就该是 false，无害）；真正值得关注的是实现者自己指出的缺口——Task 17 接入真实保存后，若保存成功不同步 `document.content`，会在自写识别失效的边界情况下把"已保存"误判为"脏"，方向是多弹冲突提示，不是静默覆盖，不违反安全红线，且已如实记录移交给 Task 17。

## 四、自查删行 + 我自己的独立验证

实现者自检的 3 处（`isSelfWrite` 分支、`dirty` 三元、`ConflictBanner` push 行）经复核确实都是真实覆盖，删除后测试变红。

我另外独立撤销了两处未被实现者点名验证过的行：

1. `conflict.ts` 里"内容相同只对时"（mtime 抖动）分支——删除后 `conflict.test.ts` 的"时间戳变了但内容没变，只对时"用例**变红**（返回 `adopt` 而非预期的 `touch-timestamp`）。
2. `ConflictBanner.tsx` 的 `keepMine` 里 `clearConflict()` 调用——删除后 `ConflictBanner.test.tsx` 的"保留我的改动"用例**变红**（`conflict` 未被清空）。

两处均已确认变红后原样恢复，`git status` 干净，`npm run verify` 回到 53 文件 / 528 用例全绿。

未能进行类似删行验证的部分：`useAutoRefresh.ts` 本身（`hasConflict` 轮询暂停、`viewRef` 闭包同步、`isSelfWrite`/`decideRefresh` 的实际接线）**没有对应的 hook 级测试文件**（`src/hooks/useAutoRefresh.test.ts` 不存在，且这是全仓库历史上从未有过的文件，不是本任务新增的缺口，但也确实是本任务新增逻辑里覆盖最弱的一层，只能靠代码走查和 `decideRefresh`/`ConflictBanner` 两端的单测间接兜底）。

## 五、其余核查项

- 6 种 `RefreshDecision`（`continue`/`touch-timestamp`×2 情形/`adopt`/`conflict`×2/`stop`×3/`deactivate`）在 `conflict.test.ts` 里均有用例覆盖，`conflict` 分支（本任务核心价值）有两条用例（kind 判断 + 携带文档内容判断）。
- 全仓库搜索未发现新增代码承诺 `⌘S`；`save.ts` 里出现的一处 `⌘S` 字样是既有注释（本次 diff 未触碰该行），且措辞是"目前还没有…会调用"，属实描述而非承诺。
- 逐条核对本次改动里涉及机制归因的注释（`useEditorView` 的 `dom.isConnected` 判活、`viewRef` 闭包陈旧问题、React 状态更新与 CodeMirror 视图同步不在同一同步调用栈内等）：均与代码实际行为一致，未发现推断当作事实的情况。
- 未发现超出简报范围的改动；`AppShell.tsx`、`document.store.ts`、`save.ts` 的改动都直接服务于本任务接口。

## 结论

**规范符合性**：✅（TypeScript strict、`npm run verify` 通过 53/528，中文注释密度与既有文件相当，无网络请求引入，提交信息中文且无署名尾注）

**任务质量**：**批准**，但有一条 Important 需要后续任务或本任务补丁跟进。

问题清单：
- **Important**：全功能最关键的顺序红线（先 push 版本缓冲、后覆盖）目前是 0 自动化覆盖。报告的"测不出来"结论对具体测试风格成立，但过度泛化；应补一条基于 `vi.spyOn`/`invocationCallOrder` 的调用顺序断言，成本很低且能精确钉住这条回归。
- **Minor**：`useAutoRefresh.ts` 缺少 hook 级测试文件（历史遗留，非本任务引入，但本任务给它加了新逻辑，风险随之上升）。
- **Minor（已被实现者自己记录，非新问题）**：脏判据依赖 `document.content` 在保存成功后被同步更新，Task 17 接入真实保存时需要顺带处理，否则可能导致保存后被误判为冲突（方向安全，仅体验问题）。

**会不会丢数据**：**不会**。冲突分支在编辑态下必定触发 `ConflictBanner`，且实测（多次撤销相关行）证明"保留我的改动"「无操作」和"用磁盘的"「先 push 后 apply」两条路径在当前实现里确实分别把用户改动保住或推进版本缓冲；顺序本身经我独立实验确认目前是对的（代码走查 + 我自己写的调用顺序断言均验证通过），只是这条正确性缺乏常驻的自动化回归覆盖，属于"现在没丢、未来重构有风险且无测试兜底"，不是"现在就会丢"。
