### Task 12: 编辑设置分组

**Files:**
- Modify: `src/types/settings.ts`
- Modify: `src/components/settings/SettingsPanel.tsx`
- Create: `src/components/settings/sections/EditorSection.tsx`
- Modify: `src/components/settings/settings-coverage.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export interface EditorSettings {
  autoSave: boolean;
  autoSaveDelay: number;
  defaultMode: 'read' | 'edit';
  showLineNumbers: boolean;
  tabSize: number;
  indentWithTabs: boolean;
  keepVersions: number;
}
// Settings 增加 editor: EditorSettings
```

- [ ] **Step 1: 看现有的覆盖测试要求什么**

Run: `cat src/components/settings/settings-coverage.test.ts`
这个测试的存在意义是「每个设置项都必须在面板里露出」。新增分组后它会失败，这是预期的——它就是用来防止加了设置却没有 UI 的。

- [ ] **Step 2: 加类型与默认值**

`src/types/settings.ts`：

```ts
/** 编辑设置 */
export interface EditorSettings {
  /** 停笔后自动写回文件 */
  autoSave: boolean;
  /** 自动保存的防抖间隔（毫秒） */
  autoSaveDelay: number;
  /** 打开文档时的初始模式 */
  defaultMode: 'read' | 'edit';
  /** 编辑态显示行号 */
  showLineNumbers: boolean;
  /** 缩进宽度 */
  tabSize: number;
  /** 用 Tab 而不是空格缩进 */
  indentWithTabs: boolean;
  /**
   * 内存里保留多少个「保存前的版本」。
   *
   * 自动保存写的是用户真实的本地文件，没有回收站。这个缓冲是唯一的后悔药，
   * 因此不提供「0」这个选项。
   */
  keepVersions: number;
}
```

`Settings` 接口加 `editor: EditorSettings;`，`DEFAULT_SETTINGS` 加：

```ts
  editor: {
    autoSave: true,
    autoSaveDelay: 800,
    defaultMode: 'read',
    showLineNumbers: false,
    tabSize: 2,
    indentWithTabs: false,
    keepVersions: 5,
  },
```

`SETTINGS_SCHEMA_VERSION` 从 `1` 改为 `2`。不写迁移脚本——`settings.store` 的 deep-merge 兜底会给存量配置补上默认值，这正是当初那条约定存在的原因。

`SETTINGS_BOUNDS` 加：

```ts
  autoSaveDelay: { min: 300, max: 5000, step: 100 },
  tabSize: { min: 2, max: 8, step: 1 },
  keepVersions: { min: 1, max: 20, step: 1 },
```

- [ ] **Step 3: 运行覆盖测试确认失败**

Run: `npx vitest run src/components/settings/settings-coverage.test.ts`
Expected: FAIL，`editor` 分组的设置项没有对应 UI

- [ ] **Step 4: 加设置面板分区**

创建 `src/components/settings/sections/EditorSection.tsx`，照抄 `ReadingSection.tsx` 的结构（`Section` + `Field` + `Switch` / `Slider` / `Select`），逐项渲染上面 7 个设置。`autoSave` 的说明文案要把风险讲清楚：

```tsx
<Field
  label="自动保存"
  hint="停笔后自动写回原文件。写入的是你磁盘上的真实文件，没有回收站——关掉它可以改为只在按 ⌘S 时保存。"
>
```

`SettingsPanel.tsx` 里把 `EditorSection` 插在 `ReadingSection` 之后。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add src/types/settings.ts src/components/settings/
git commit -m "feat: 编辑设置分组"
```

---

