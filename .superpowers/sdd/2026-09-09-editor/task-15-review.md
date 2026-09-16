# Task 15 代码审查

审查对象：`bc2039b`（`feat: 保存执行、自写登记与版本缓冲`），对照
`task-15-brief.md`、`task-15-report.md`、`review-7358dab..bc2039b.diff`。

## 一、三条红线核实

1. **版本缓冲入栈先于写盘**：`save.ts` 的 `writeThrough` 中
   `versionBuffer().push(previous)` 在 `handle.createWritable()` 之前执行，
   注释明确写了理由（写失败缓冲多一版无害，写成功没留就没救）。失败路径
   （`createWritable`/`write`/`close` 抛异常）落进 `catch`，返回
   `{ kind: 'error' }`，此时缓冲里已经有 `previous`——不会出现"写失败且无
   备份"的情况。核实通过。

2. **保存路径零文本规整**：`performSave` 的 `text` 参数直接来自调用方，
   `writeThrough` 里 `writable.write(text)` 未经任何变换；`normalizeMarkdown`
   仅在 `src/export/index.ts`（导出链路）里被引用，`save.ts` 未 import 它。
   全仓搜索确认保存路径上没有行尾归一化、BOM 处理等操作。核实通过。

3. **版本缓冲纯内存**：`versions.ts` 用闭包里的普通数组 `stack`，没有任何
   `chrome.storage`/`indexedDB`/`localStorage` 调用；注释明确写了"这是刻意
   选择"及理由（未被请求的数据留存，越过"数据只在本机"的承诺边界）。核实
   通过。

## 二、句柄透出

- `saveFile`（`download.ts`）在 `showSaveFilePicker` 成功分支返回值里加了
  `handle`；`downloadViaAnchor` 降级分支的两处 `return` 均未改动，不带
  `handle`（`ExportResult.done.handle` 类型是可选字段，`undefined` 语义
  正确）。
- 既有调用方：`export.test.ts` 唯一受影响的用例是"选择器成功"那条，原用
  `toEqual` 做整体精确比对，加字段后自然不匹配。修复方式是让 mock handle
  被同一个引用捕获，断言里显式加上 `handle: mockHandle`——这是**适配新字段
  并把"句柄确实透出"钉成回归点**，不是放松断言迁就实现（没有改成
  `expect.objectContaining` 之类会漏检的写法）。检查了导出 HTML/Markdown/
  打印几条链路的调用点，它们都只读 `status`/`filename`/`bytes`/`via`，不
  解构整个对象，新增的可选字段不会破坏它们。
- 语义未混淆：`via` 仍只用于 UI 文案（"存到你选的位置"vs"落进下载目录"），
  `handle` 只在 `save.ts` 里被用来升格 writable。`types/export.ts` 的注释
  也显式指出两者不等价（"`via: 'picker'` 不保证一定带 `handle`"）。

## 三、自写登记表

键为 `${lastModified}:${content.length}:${content}`，值域按写入顺序保存
最近 12 条，`isSelfWrite` 做等值查找。

- **漏判**（该认出自写却没认出）：仅当同一时间戳 + 相同内容组合超过 12 条
  窗口后被挤出——注释解释了 1.5s 轮询间隔下十来条覆盖连续保存足够。可能
  的边界：`recordSelfWrite` 记录的是 `handle.getFile()` 读回的
  `lastModified`，如果文件系统的 mtime 分辨率不足以区分两次连续写入
  （某些文件系统精度到秒），后一次探测可能报告与登记不同的 `lastModified`
  ——但这只会导致漏判（多刷新一次），不是误判。
- **误判**（把外部改动当自写而丢弃）：只有当外部编辑器凑巧写出与登记表中
  某条完全相同的 `(lastModified, content)` 组合时才会发生，而 `lastModified`
  是操作系统时间戳（通常毫秒级），外部程序复现出与我们自己写入时刻完全
  相同的时间戳的概率可忽略。设计上以"字符串等值"而非"仅时间戳"为键，
  已经把误判概率压到最低。**结论：键设计合理，误判优先于漏判被规避，这
  与"误判后果更严重"的要求方向一致。**
- 需要指出的差距：`self-write.ts` 本身没有被接入 `decideRefreshAction` /
  `useAutoRefresh` 的调用链——`recordSelfWrite`/`isSelfWrite` 在生产代码里
  除 `save.ts` 写入侧外，读取侧（自动刷新判断）尚无消费者。报告如实说明
  这是有意留给 Task 17（届时自动保存定时器与 ⌘S 才真正接入 `performSave`，
  同一时刻才该把 `isSelfWrite` 接进轮询）。核实：搜索全仓确认
  `isSelfWrite`/`recordSelfWrite` 除测试外只在 `save.ts` 出现，与报告描述
  一致，不是"声称留给下一任务、实际藏了半成品"。

## 四、"未实测"依据核查

WICG File System Access 规范 Local File System Permissions §3.1 原文：
"Additionally for calls to showSaveFilePicker the permission state for a
descriptor with handle set to the returned handle, and mode set to
readwrite should be granted." 与注释里的转述一致，规范依据准确。若该行为
在某浏览器实现里出现偏差，后果是"另存后 writable 被误置为 true，下次自动
保存尝试 `createWritable()` 可能抛出权限错误"——`writeThrough` 有 try/catch
兜底，会返回 `{ kind: 'error' }` 而不会静默丢数据或崩溃，但这不等于验证过
真实行为，仍属于合理但未实测的假设，报告的标注方式（不包装成已验证事实）
是恰当的。

## 五、测试效力自查（亲自撤销复现）

亲自撤销并跑测试确认变红，随后 `diff` 校验文件与备份完全一致地还原：

- 删 `save.ts` 中 `versionBuffer().push(previous);`
  → `save.test.ts` 1 例失败（`popPreviousVersion()` 断言，`expected null to
  be '旧内容'`）。与报告描述一致。
- 删 `save.ts` 另存分支里 `setCurrentFileHandle(result.handle);`
  → `save.test.ts` 1 例失败（`getCurrentFileHandle()` 断言）。与报告描述
  一致。
- 两次实验后 `diff` 原文件与还原后文件完全相同，`npm run verify`
  （52 文件/521 用例）通过，工作区 `git status` 干净。

未逐一复现报告里另外 3 处（`self-write.ts`/`versions.ts` 内部 push、
`recordSelfWrite` 调用），因简报只要求验证"至少两处"；已验证的两处均命中
预期，且这两处恰好覆盖了"红线一"（版本缓冲顺序）与"句柄透出消费端"两个
本次审查重点最关心的位置。

行为 vs 实现细节：`save.test.ts` 的 8 个用例断言的是可观察行为——写盘
后磁盘收到的内容（`writes` 数组）、`popPreviousVersion()`/`isSelfWrite()`
的对外查询结果、`useDocumentStore` 的 `writable` 状态、句柄登记表——都是
通过公开 API 验证，没有断言私有变量或调用次数这类实现细节。用假句柄做
的集成测试能验证的是"编排正确"（分支选对、调用顺序对、参数传对），但无法
验证真实 `FileSystemFileHandle` 的系统级行为（真实弹窗、真实磁盘 IO、
真实的 `queryPermission` 状态机、`showSaveFilePicker` 返回句柄的真实权限
状态）——报告对此边界的描述准确，没有夸大测试覆盖范围。

## 文案与范围检查

- 全仓搜索 `⌘S`/`Cmd+S`/`mod+s`/`Ctrl+S`，本次 diff 未引入任何新的
  ⌘S 相关文案；`save.ts`/`save-target.ts` 里提到 ⌘S 的两处都是注释，且
  准确描述"目前没有真实触发入口"，未做出用户可见的承诺。`useEditMode.ts`
  里 Task 13 遗留的三处清理仍然保持原样，未被本任务破坏。
- 机制归因：`self-write.ts` 注释提到 `probeCurrentFile`/
  `decideRefreshAction` 的行为，核对 `src/utils/file-open.ts` 与
  `src/utils/auto-refresh.ts` 源码，描述准确（轮询用 `lastModified`，
  `decideRefreshAction` 确有"内容相同只 touch 时间戳"分支）。
  `showSaveFilePicker` 权限声明已核实符合规范原文（见第四节）。
- 范围：diff 只涉及简报列出的文件，外加简报要求的 `download.ts`/
  `export.test.ts`/`types/export.ts` 联动改动。`save.test.ts` 是简报判断
  "不写单测"之外实现者主动补的，但内容单纯是编排逻辑的行为测试，未超出
  Task 15 的功能边界，也未涉及 Task 17 的实际接线。未发现越界改动。

## 结论

1. **规范符合性**：✅
2. **任务质量**：批准。未发现 Critical/Important 问题。
   - Minor：`self-write.ts` 尚无消费者（读取侧未接入 `decideRefreshAction`），
     属于有意延后且已如实说明，不构成缺陷，仅建议 Task 17 落地时同步补充
     `self-write.test.ts` 里"lastModified 精度不足导致漏判"这一场景的回归
     测试（当前测试未覆盖该边界，但也不影响本任务判定）。
   - Minor：`save.test.ts` 的假句柄测试无法覆盖真实浏览器权限状态机，
     报告已如实标注为已知缺口，非新问题。
3. **敢不敢写真实文件**：敢。三条红线全部核实通过，句柄透出与既有调用方
   的兼容性经过检查未受影响，自写登记键设计把误判概率压到可忽略、优先
   保护用户在别处的真实修改，"未实测"的规范依据经查证准确且有失败兜底。
   真正的风险敞口（真实浏览器端到端行为）在没有调用入口（Task 17 尚未接
   `performSave`）之前也无从触发，与当前交付范围相符。

## ⚠️ 未能验证的项

- 未在真实 Chrome 扩展环境里跑一遍另存 → 自动保存的端到端流程（本环境
  无可用的真实浏览器/扩展沙盒，与实现者报告的缺口一致）。
- 报告中另外三处删行自检（`self-write.ts`/`versions.ts` 内部 push、
  `recordSelfWrite` 调用）本次未亲自复现，只复现了两处（简报要求的下限）。
