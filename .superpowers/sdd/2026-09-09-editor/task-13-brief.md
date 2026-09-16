### Task 13: 编辑态开关与写权限申请

**Files:**
- Modify: `src/stores/document.store.ts`
- Modify: `src/utils/file-open.ts`
- Test: `src/utils/file-open.test.ts`
- Create: `src/hooks/useEditMode.ts`
- Modify: `src/hooks/useToolbarActions.ts`
- Modify: `src/editor/MarkdownEditor.tsx`
- Modify: `src/viewer/pages/ReaderPage.tsx`

**Interfaces:**
- Consumes: `DocumentStore`
- Produces:

```ts
// document.store 新增
mode: 'read' | 'edit';
writable: boolean;
setMode: (mode: 'read' | 'edit') => void;
setWritable: (writable: boolean) => void;

// file-open.ts 新增
export async function ensureFileWritePermission(
  handle: FileSystemFileHandle,
  interactive: boolean,
): Promise<PermissionOutcome>;

// useEditMode.ts
export function useEditMode(): {
  mode: 'read' | 'edit';
  writable: boolean;
  /** 必须在用户手势的调用栈内调用 */
  enterEdit: () => Promise<void>;
  leaveEdit: () => void;
};
```

- [ ] **Step 1: 写失败的测试**

`src/utils/file-open.test.ts` 追加：

```ts
describe('ensureFileWritePermission', () => {
  const handle = (query: PermissionState, request?: PermissionState) =>
    ({
      queryPermission: () => Promise.resolve(query),
      requestPermission: () => Promise.resolve(request ?? query),
    }) as unknown as FileSystemFileHandle;

  it('已授权时直接返回 granted，不弹窗', async () => {
    expect(await ensureFileWritePermission(handle('granted'), false)).toBe('granted');
  });

  it('非交互模式下不申请，如实返回 prompt', async () => {
    expect(await ensureFileWritePermission(handle('prompt', 'granted'), false)).toBe('prompt');
  });

  it('交互模式下申请成功返回 granted', async () => {
    expect(await ensureFileWritePermission(handle('prompt', 'granted'), true)).toBe('granted');
  });

  it('交互模式下被拒返回 denied', async () => {
    expect(await ensureFileWritePermission(handle('prompt', 'denied'), true)).toBe('denied');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/utils/file-open.test.ts`
Expected: FAIL，`ensureFileWritePermission` 不存在

- [ ] **Step 3: 实现权限申请**

`src/utils/file-open.ts` 追加（`PermissionOutcome` 从 `handle-store.ts` 导入复用）：

```ts
/**
 * 确认（并在允许时申请）文件的写权限。
 *
 * `requestPermission` **必须在用户手势的调用栈内**，而自动保存由定时器触发，
 * 没有手势。因此写权限只有一个申请时机：用户点「编辑」的那一下。
 * 这也是编辑态与阅读态必须分开的技术原因之一。
 *
 * @param interactive 为 true 时会弹出授权提示，调用点必须在用户手势内
 */
export async function ensureFileWritePermission(
  handle: FileSystemFileHandle,
  interactive: boolean,
): Promise<PermissionOutcome> {
  const descriptor = { mode: 'readwrite' } as const;
  try {
    const current = await handle.queryPermission?.(descriptor);
    if (current === 'granted') return 'granted';
    if (!interactive) return current === 'denied' ? 'denied' : 'prompt';

    const next = await handle.requestPermission?.(descriptor);
    return next === 'granted' ? 'granted' : next === 'denied' ? 'denied' : 'prompt';
  } catch (error) {
    log.warn('申请文件写权限失败', error);
    return 'denied';
  }
}
```

- [ ] **Step 4: 扩展 store**

`src/stores/document.store.ts` 的 `DocumentStore` 加：

```ts
  /** 阅读还是编辑。两者共用同一个编辑器实例，差别只是若干扩展的开关 */
  mode: 'read' | 'edit';
  /** 是否已拿到写权限，决定保存能不能静默进行 */
  writable: boolean;
  setMode: (mode: 'read' | 'edit') => void;
  setWritable: (writable: boolean) => void;
```

初值 `mode: 'read'`、`writable: false`；`setDocument` 与 `reset` 里都要重置这两项——换文档时权限要重新判定。

- [ ] **Step 5: 实现 useEditMode**

创建 `src/hooks/useEditMode.ts`：

```ts
import { useCallback } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import { ensureFileWritePermission, getCurrentFileHandle } from '@/utils/file-open';

/**
 * 编辑态的进出。
 *
 * `enterEdit` **必须在用户手势的调用栈内调用**——它会在需要时弹出写权限
 * 授权提示。这是整个保存链路唯一能申请到写权限的地方。
 *
 * 权限被拒不阻止进入编辑态：用户可能只是想改点东西再另存到别处。
 * 这种情况下 `writable` 保持 false，保存链路会降级为「⌘S 另存」。
 */
export function useEditMode() {
  const mode = useDocumentStore((state) => state.mode);
  const writable = useDocumentStore((state) => state.writable);
  const showNotice = useUiStore((state) => state.showNotice);

  const enterEdit = useCallback(async () => {
    const { setMode, setWritable } = useDocumentStore.getState();
    const handle = getCurrentFileHandle();

    if (handle) {
      const outcome = await ensureFileWritePermission(handle, true);
      setWritable(outcome === 'granted');
      if (outcome !== 'granted') {
        showNotice('未获得写入权限，改动只能通过 ⌘S 另存', 'info');
      }
    } else {
      setWritable(false);
      showNotice('该文档没有文件句柄，改动只能通过 ⌘S 另存', 'info');
    }

    setMode('edit');
  }, [showNotice]);

  const leaveEdit = useCallback(() => {
    useDocumentStore.getState().setMode('read');
  }, []);

  return { mode, writable, enterEdit, leaveEdit };
}
```

- [ ] **Step 6: 接进编辑器与工具栏**

`ReaderPage.tsx` 把 `readOnly` 从写死的 `true` 改为 `mode === 'read'`，并把 `onChange` 接上（暂时只写进一个本地 ref，Task 15 才真正保存）。

`useToolbarActions.ts` 在 `file` 组加一个动作：

```ts
      {
        id: 'edit',
        label: mode === 'edit' ? '退出编辑' : '编辑',
        icon: mode === 'edit' ? BookOpen : Pencil,
        hotkey: 'mod+e',
        active: mode === 'edit',
        disabledReason: hasDocument ? undefined : '尚未打开文件',
        onSelect: () => {
          if (mode === 'edit') leaveEdit();
          else void enterEdit();
        },
        align: 'start',
        group: 'file',
      },
```

从 `lucide-react` 引入 `BookOpen` 与 `Pencil`，并把 `mode` / `enterEdit` / `leaveEdit` 加进 `useMemo` 依赖数组。

> 快捷键会自动生效：`useGlobalHotkeys` 从这份动作清单里注册，这正是工具栏动作被抽成数据的原因。

`MarkdownEditor.tsx` 的 extensions 里按设置加入行号与缩进：`lineNumbers()`（来自 `@codemirror/view`）、`EditorState.tabSize.of(tabSize)`、`indentUnit.of(indentWithTabs ? '\t' : ' '.repeat(tabSize))`。这些随设置变化用 `Compartment` 重配，不重建编辑器。

- [ ] **Step 7: 运行测试确认通过**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 8: 人工验收**

用「打开文件」打开一份文档 → 点「编辑」→ 浏览器弹出写入授权 → 允许 → 光标所在块变成源码，其余仍是渲染态。按 `mod+e` 退回阅读态，所有块恢复渲染。

- [ ] **Step 9: 提交**

```bash
git add src/stores/document.store.ts src/utils/file-open.ts src/utils/file-open.test.ts src/hooks/useEditMode.ts src/hooks/useToolbarActions.ts src/editor/MarkdownEditor.tsx src/viewer/pages/ReaderPage.tsx
git commit -m "feat: 编辑态开关与写权限申请"
```

---

