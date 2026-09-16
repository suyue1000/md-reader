# Task 12 报告：编辑设置分组

## 简报来源说明

指定路径 `.superpowers/sdd/2026-09-09-editor/task-12-brief.md` 不存在（该目录里只有到
task-11 的 brief/report，没有单独拆出的 task-12 brief）。改为从
`docs/superpowers/plans/2026-09-09-editor.md` 的「Task 12: 编辑设置分组」小节
（第 1947-2059 行）取得完整任务定义，内容与本次任务描述一致。

## 加了什么

- `src/types/settings.ts`
  - 新增 `EditorSettings` 接口（7 个字段：`autoSave` / `autoSaveDelay` / `defaultMode` /
    `showLineNumbers` / `tabSize` / `indentWithTabs` / `keepVersions`）。
  - `Settings` 加 `editor: EditorSettings`；`DEFAULT_SETTINGS` 补上对应默认值。
  - `SETTINGS_SCHEMA_VERSION` 从 1 改为 2，注释里写明「不配迁移脚本，靠 hydrate 的
    deep-merge 兜底」，并指向本报告的实测证据（避免以后有人只读注释就采信）。
  - `SETTINGS_BOUNDS` 补 `autoSaveDelay` / `tabSize` / `keepVersions` 三项边界。
- `src/components/settings/sections/EditorSection.tsx`（新建）
  - 3 个开关（autoSave / showLineNumbers / indentWithTabs）+ 1 个下拉（defaultMode）
    + 3 个滑块（autoSaveDelay / tabSize / keepVersions）。
  - `autoSave` 的说明文案原样采用简报给的版本：「停笔后自动写回原文件。写入的是你
    磁盘上的真实文件，没有回收站——关掉它可以改为只在按 ⌘S 时保存。」
  - `autoSaveDelay` 滑块在 `autoSave` 关闭时用 `disabledReason` 置灰，避免用户调一个
    不生效的参数。
  - 导出 `EDITOR_FIELD_KEYS`：布尔项直接复用驱动 UI 渲染的 `TOGGLES` 数组（单一数据源，
    改开关不会漏改清单），其余 4 项手写补全，供覆盖测试比对。
- `src/components/settings/SettingsPanel.tsx`：把 `EditorSection` 插在 `ReadingSection`
  之后、`AdvancedSection` 之前。
- `src/components/settings/settings-coverage.test.ts`：新增「编辑设置页覆盖度」
  describe 块，比对 `DEFAULT_SETTINGS.editor` 的 key 与 `EDITOR_FIELD_KEYS`。

### 一处简报文件清单之外的必要改动

简报的 Files 清单没有列 `src/stores/settings.store.ts`，但不改它 `EditorSection` 根本
无法工作——没有 `setEditor` action 就没有写路径。已按现有 `setReading` / `setAdvanced`
的模式补上：
- `SettingsStore` 接口加 `setEditor: (patch: Partial<EditorSettings>) => void`。
- 实现走 sync 区（`persist(next, false)`），与 appearance/markdown/reading 同一档，
  不是 advanced 那种大体积走 local 的例外。
- 顺带修了一处编译期就会暴露的遗漏：`persistSynced` 里手写的 `payload: SyncedSettings`
  字面量原本只列了 `appearance/markdown/reading`，`SyncedSettings = Omit<Settings,
  'advanced'>` 加了 `editor` 字段后这个字面量会因缺字段编译报错，已补上
  `editor: settings.editor`。

## 旧结构设置数据的实测结果（本任务重点）

**构造方式**：不经过 store 的任何 action（那些已经知道 `editor` 字段的存在，用它们
造不出「真正的旧数据」），直接手写一份 schemaVersion 1 时代的存量数据对象，其中
`appearance` 与 `reading` 里各改了一个用户自定义值（`fontSize: 20`、
`scrollSync: false`），`advanced.customCss` 也设成非默认值，且**故意不含 `editor`
键**（因为 schemaVersion 1 的时代这个分组还不存在）。

**写入路径**：用 `writeValue(STORAGE_AREAS.settings, STORAGE_KEYS.settings, legacySynced)`
和 `writeValue(STORAGE_AREAS.advanced, STORAGE_KEYS.advanced, legacyAdvanced)`
直接写内存版 `StorageDriver`（`createMemoryStorageDriver`，接口与
`chrome.storage` 一致），模拟「用户磁盘/云端上真实躺着的旧数据」。

**读取路径**：调用 `useSettingsStore.getState().hydrate()`——即生产代码真实使用的那条
`readValue` → `deepMerge(DEFAULT_SETTINGS, {...synced, advanced, schemaVersion})` 路径，
不是重新实现或 mock 一份简化版。

四条确认的结果（测试文件 `src/stores/settings.store.test.ts`，用例名
「从 schemaVersion 1 的旧结构升级：editor 分组补上默认值，其余分组的自定义值原样保留」）：

1. `settings.editor` 存在 —— 通过，等于 `DEFAULT_SETTINGS.editor`。
2. `editor` 是默认值而非 `undefined` 或半截对象 —— 通过（同一断言覆盖）。
3. 其余分组的用户自定义值没被默认值覆盖 —— 通过：
   `appearance.fontSize === 20`、`reading.scrollSync === false`、
   `advanced.customCss === 'body{color:red}'` 均保留。
4. 反方向确认（本质是第 3 条的另一种表述，已一并覆盖）：`fontSize: 20` 这个旧字段的
   用户自定义值升级后原样还在，不是被 `DEFAULT_SETTINGS` 悄悄改回 16。

结论：**deep-merge 兜得住**，`SETTINGS_SCHEMA_VERSION: 1 → 2` 不需要迁移脚本这条判断
成立，不是想当然。

## 回归测试的效力验证（撤销后失败情况）

按要求做了两轮「删掉关键一行看测试会不会红」的自检，改完立即验证后已还原：

1. **撤销 deep-merge 兜底本身**：把 `hydrate` 里的
   `deepMerge(DEFAULT_SETTINGS, {...synced, advanced, schemaVersion})` 换成完全不与
   默认值合并、直接把存量数据断言成新结构（`{ ...synced, advanced, schemaVersion } as
   typeof DEFAULT_SETTINGS`）—— 这正是当年 ReadingPosition 崩溃时的手法。
   结果：**2 个用例失败**——
   - 新增的旧结构升级回归测试：`settings.editor` 变成 `undefined`
     （`expected undefined to deeply equal {...}`）。
   - 原有的「存储为空时回落到默认设置」用例也失败（advanced 组被整体清空成 `{}`）。
   （中间还试过一版「浅层展开 `{...DEFAULT_SETTINGS, ...synced}`」，发现它对
   「整组字段缺失」这种场景其实也能兜住——因为缺失的 key 根本不出现在展开源里，
   浅合并不会覆盖它。这个中间结果说明 deep-merge 相对于「什么都不做」的价值主要在于
   同一分组内部分字段缺失时不会把整组炸成半默认值，而不是本任务这种「整组全新」的
   场景——但这不代表可以省掉 deep-merge：真正复现历史崩溃手法（完全不合并、直接断言）
   立刻让新测试和存量测试同时报错，验证了两条测试都是有效的安全网。）
2. **删掉一个字段的曝光**：把 `EDITOR_FIELD_KEYS` 里的 `'keepVersions'` 注释掉，
   `npx vitest run settings-coverage.test.ts` 中「每个编辑设置项都在设置页里出现」
   用例失败，报期望/实际数组少了 `keepVersions`。

两次自检后都已用 `cp`/`sed` 还原文件并重跑 `npm run verify` 确认恢复干净。

## 遇到的问题

- 任务给定的 brief 路径不存在，改用计划文档对应章节，已在报告开头说明。
- 简报文件清单遗漏了 `settings.store.ts`，若照单全收会导致 `EditorSection` 拿不到
  写入 action、且 `persistSynced` 的字面量因新增必填字段编译不过。已补上并在此报告中
  说明，未擅自改动简报之外的其它文件。

## 验证

`npm run verify`（typecheck + eslint + vitest）全部通过：**46 文件 / 446 用例**
（基线 443 + 本次新增 3 个：1 个 hydrate 旧结构回归用例 + 2 个 editor 覆盖度用例）。
