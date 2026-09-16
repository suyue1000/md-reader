### Task 17: 自动保存、脏状态与关页拦截

**Files:**
- Create: `src/hooks/useAutoSave.ts`
- Modify: `src/stores/document.store.ts`
- Modify: `src/components/layout/StatusBar.tsx`
- Modify: `src/viewer/pages/ReaderPage.tsx`
- Modify: `src/hooks/useToolbarActions.ts`

**Interfaces:**
- Consumes: `performSave` / `popPreviousVersion`（Task 15）
- Produces:

```ts
export function useAutoSave(text: string): {
  /** 立即保存（⌘S 与工具栏按钮调用，处在用户手势内） */
  saveNow: () => Promise<void>;
};
// document.store 新增
dirty: boolean;
saveStatus: 'idle' | 'saving' | 'saved' | 'error';
saveError: string | null;
lastSavedAt: number;
setDirty: (dirty: boolean) => void;
setSaveStatus: (status: DocumentStore['saveStatus'], error?: string | null) => void;
markSaved: (content: string, lastModified: number) => void;
```

- [ ] **Step 1: 扩展 store**

`markSaved` 是关键的一个：保存成功后 `document.content` 必须更新为刚写下去的文本，否则 `dirty` 永远为 true。

```ts
  /**
   * 标记保存成功。
   *
   * 把 `document.content` 推进到刚写下去的文本——它的语义是「上次与磁盘
   * 一致的内容」，是脏判定与冲突判定的基准，不是渲染输入（渲染输入是
   * 编辑器自己的文档）。不更新它，`dirty` 会永远为 true。
   */
  markSaved: (content, lastModified) =>
    set((state) => ({
      document: state.document ? { ...state.document, content, lastModified } : null,
      dirty: false,
      saveStatus: 'saved',
      saveError: null,
      lastSavedAt: Date.now(),
    })),
```

- [ ] **Step 2: 实现 useAutoSave**

创建 `src/hooks/useAutoSave.ts`：

```ts
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { performSave } from '@/editor/save';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import { debounce } from '@/utils/fn';

/**
 * 自动保存与手动保存。
 *
 * 两条路都汇到 `performSave`，区别只有一个 `automatic` 标志——它决定了
 * 「写不回原文件」时是弹对话框还是安静地什么都不做。把这个分支放在
 * `decideSaveTarget` 这个纯函数里，而不是在这里写两套流程。
 */
export function useAutoSave(text: string): { saveNow: () => Promise<void> } {
  const mode = useDocumentStore((state) => state.mode);
  const enabled = useSettingsStore((state) => state.settings.editor.autoSave);
  const delay = useSettingsStore((state) => state.settings.editor.autoSaveDelay);
  const showNotice = useUiStore((state) => state.showNotice);
  const textRef = useRef(text);
  textRef.current = text;

  const run = useCallback(
    async (automatic: boolean) => {
      const store = useDocumentStore.getState();
      store.setSaveStatus('saving');
      const outcome = await performSave(textRef.current, automatic);

      switch (outcome.kind) {
        case 'saved':
          store.markSaved(textRef.current, outcome.lastModified);
          break;
        case 'saved-as':
          store.markSaved(textRef.current, Date.now());
          showNotice(`已另存为 ${outcome.filename}`);
          break;
        case 'denied':
          store.setSaveStatus('error', '未获得写入权限');
          showNotice('未获得写入权限，改动尚未保存', 'error');
          break;
        case 'error':
          store.setSaveStatus('error', outcome.message);
          showNotice(`保存失败：${outcome.message}`, 'error');
          break;
        case 'cancelled':
        case 'skipped':
          store.setSaveStatus('idle');
          break;
      }
    },
    [showNotice],
  );

  const scheduleSave = useMemo(() => debounce(() => void run(true), delay), [run, delay]);

  // 文本变化时更新脏标记并排一次自动保存
  useEffect(() => {
    const store = useDocumentStore.getState();
    const saved = store.document?.content ?? '';
    store.setDirty(text !== saved);
    if (mode === 'edit' && enabled && text !== saved) scheduleSave();
  }, [text, mode, enabled, scheduleSave]);

  const saveNow = useCallback(() => run(false), [run]);
  return { saveNow };
}
```

- [ ] **Step 3: 加关页拦截**

同样在 `useAutoSave` 里：

```ts
  // 有未保存改动时拦截关页。浏览器只允许显示自己的固定文案，
  // 因此这里不必也无法自定义提示内容
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!useDocumentStore.getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, []);
```

同时在 `useOpenFile` 的 `open()` 与文件树的切换文档路径里加一道确认：`dirty` 为 true 时先问「有未保存的改动，确定切换吗」。用现有的 Toast 做不到阻塞式确认，这里用 `window.confirm`——它是同步的，且这是唯一一处真的需要阻塞用户的地方。

- [ ] **Step 4: 状态栏显示保存状态**

`StatusBar.tsx` 在 Task 11 腾出来的位置加一个保存指示：

```tsx
/** 保存状态对应的文案。未保存用点而不是文字，避免和监听状态抢注意力 */
const SAVE_META = {
  idle: null,
  saving: { text: '保存中…', tone: 'muted' },
  saved: { text: '已保存', tone: 'muted' },
  error: { text: '保存失败', tone: 'danger' },
} as const;
```

`dirty` 为 true 且 `saveStatus !== 'saving'` 时显示「● 未保存」。`writable` 为 false 且处于编辑态时，额外显示一条「无法写回原文件，⌘S 另存」，用 `--app-warning` 色——这是用户最需要知道、也最容易忽略的一条信息。

- [ ] **Step 5: 接线**

`ReaderPage.tsx` 用 state 持有编辑器文本，传给 `useAutoSave`：

```tsx
  const [text, setText] = useState(doc?.content ?? '');
  useEffect(() => {
    setText(doc?.content ?? '');
  }, [doc?.id, doc?.content]);
  const { saveNow } = useAutoSave(text);
```

`MarkdownEditor` 的 `onChange={setText}`。

`useToolbarActions.ts` 加保存动作：

```ts
      {
        id: 'save',
        label: '保存',
        icon: Save,
        hotkey: 'mod+s',
        disabledReason: hasDocument ? undefined : '尚未打开文件',
        onSelect: () => void saveNow(),
        align: 'start',
        group: 'file',
      },
```

以及「回到上一个保存版本」放进「更多」菜单（`collapsible: true`，`align: 'end'`），调 `popPreviousVersion()`，取到内容就 `setText(previous)`，取不到就提示「没有更早的版本了」。

> `mod+s` 必须阻止浏览器默认的「保存网页」。确认 `useGlobalHotkeys` 对注册过的组合键调用了 `preventDefault`——现有的 `mod+p`（打印）已经依赖这个行为，若没有则一并补上。

- [ ] **Step 6: 验证**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 7: 人工验收（这是整个功能的核心验收）**

1. 打开文件 → 编辑 → 改一处文字 → 等 1 秒 → 状态栏显示「已保存」。
2. 用外部编辑器打开该文件，确认改动已落盘，且**除改动处外全文逐字节未变**（用 `git diff` 或 `diff` 核对）。
3. 编辑态持续打字 30 秒，光标不跳动、不闪回。
4. 关掉自动保存，改一处 → 状态栏「● 未保存」→ ⌘S → 「已保存」。
5. 有未保存改动时关标签页 → 浏览器弹出离开确认。
6. 浏览器直开一份 `.md` → 编辑 → ⌘S → 触发下载；状态栏一直显示「无法写回原文件」。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 自动保存、脏状态与关页拦截"
```

---

