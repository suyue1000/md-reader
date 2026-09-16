### Task 15: 保存执行、自写登记与版本缓冲

**Files:**
- Create: `src/editor/versions.ts`
- Test: `src/editor/versions.test.ts`
- Create: `src/editor/self-write.ts`
- Test: `src/editor/self-write.test.ts`
- Create: `src/editor/save.ts`

**Interfaces:**
- Consumes: `decideSaveTarget`（Task 14）、`saveFile` / `replaceExtension`（`src/export/download.ts`）、`ensureFileWritePermission`（Task 13）
- Produces:

```ts
// versions.ts
export interface VersionBuffer {
  push(content: string): void;
  /** 弹出最近一版；没有则返回 null */
  pop(): string | null;
  readonly size: number;
  clear(): void;
}
export function createVersionBuffer(capacity: number): VersionBuffer;

// self-write.ts
export function recordSelfWrite(content: string, lastModified: number): void;
export function isSelfWrite(content: string, lastModified: number): boolean;
export function clearSelfWrites(): void;

// save.ts
export type SaveOutcome =
  | { kind: 'saved'; lastModified: number }
  | { kind: 'saved-as'; handle: FileSystemFileHandle | null; filename: string }
  | { kind: 'skipped' }
  | { kind: 'cancelled' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };
export async function performSave(text: string, automatic: boolean): Promise<SaveOutcome>;
```

- [ ] **Step 1: 写版本缓冲的失败测试**

创建 `src/editor/versions.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createVersionBuffer } from './versions';

describe('createVersionBuffer', () => {
  it('后进先出', () => {
    const buffer = createVersionBuffer(5);
    buffer.push('甲');
    buffer.push('乙');
    expect(buffer.pop()).toBe('乙');
    expect(buffer.pop()).toBe('甲');
  });

  it('空缓冲弹出 null', () => {
    expect(createVersionBuffer(5).pop()).toBeNull();
  });

  it('超出容量时丢掉最旧的一版', () => {
    const buffer = createVersionBuffer(2);
    buffer.push('甲');
    buffer.push('乙');
    buffer.push('丙');
    expect(buffer.size).toBe(2);
    expect(buffer.pop()).toBe('丙');
    expect(buffer.pop()).toBe('乙');
    expect(buffer.pop()).toBeNull();
  });

  it('内容与上一版相同时不重复入栈', () => {
    const buffer = createVersionBuffer(5);
    buffer.push('甲');
    buffer.push('甲');
    expect(buffer.size).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/editor/versions.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现版本缓冲**

创建 `src/editor/versions.ts`：

```ts
/**
 * 保存前版本的环形缓冲。
 *
 * 自动保存写的是用户磁盘上的真实文件，没有回收站——撤销栈也救不了
 * 「保存后关掉标签页才发现改错了」。每次写盘前留一份上一版，是这个功能
 * 唯一的后悔药。
 *
 * 只存在内存里，页面刷新即失。这是刻意的：把用户文档的历史副本悄悄写进
 * chrome.storage 或 IndexedDB，是一种没有被请求的数据留存。
 */
export interface VersionBuffer {
  push(content: string): void;
  /** 弹出最近一版；没有则返回 null */
  pop(): string | null;
  readonly size: number;
  clear(): void;
}

export function createVersionBuffer(capacity: number): VersionBuffer {
  const stack: string[] = [];

  return {
    push(content) {
      // 内容没变就不占一格：连续保存同一份内容会把有用的历史挤出去
      if (stack[stack.length - 1] === content) return;
      stack.push(content);
      if (stack.length > capacity) stack.shift();
    },

    pop() {
      return stack.pop() ?? null;
    },

    get size() {
      return stack.length;
    },

    clear() {
      stack.length = 0;
    },
  };
}
```

- [ ] **Step 4: 写自写登记的失败测试**

创建 `src/editor/self-write.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSelfWrites, isSelfWrite, recordSelfWrite } from './self-write';

describe('self-write', () => {
  beforeEach(clearSelfWrites);

  it('登记过的内容与时间戳会被认出来', () => {
    recordSelfWrite('正文', 1000);
    expect(isSelfWrite('正文', 1000)).toBe(true);
  });

  it('内容相同但时间戳不同，不算自写', () => {
    recordSelfWrite('正文', 1000);
    expect(isSelfWrite('正文', 2000)).toBe(false);
  });

  it('未登记的内容不算自写', () => {
    expect(isSelfWrite('别的正文', 1000)).toBe(false);
  });

  it('只保留最近若干条，旧登记会被淘汰', () => {
    for (let i = 0; i < 20; i++) recordSelfWrite(`v${String(i)}`, i);
    expect(isSelfWrite('v0', 0)).toBe(false);
    expect(isSelfWrite('v19', 19)).toBe(true);
  });
});
```

- [ ] **Step 5: 运行确认失败**

Run: `npx vitest run src/editor/self-write.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 6: 实现自写登记**

创建 `src/editor/self-write.ts`：

```ts
/**
 * 自己写盘的登记表。
 *
 * 自动刷新靠轮询 `lastModified` 发现文件变化。自动保存一开，我们自己每次
 * 写盘都会让时间戳变，轮询于是判定「文件被外部改了」，把内容原样灌回来——
 * 光标跳走，正在打的字被打断。
 *
 * `decideRefreshAction` 里「内容相同就只对时」那条分支能挡住大部分情况，
 * 但那是巧合而非保证：写盘与下一次轮询之间用户完全可能又敲了几个字，
 * 此时磁盘内容与编辑器内容确实不同，那条分支就失效了。显式登记才可靠。
 */

/** 保留多少条登记。轮询间隔 1.5s，十来条足够覆盖连续保存的窗口 */
const MAX_ENTRIES = 12;

/** 「时间戳 + 内容」的组合键，按写入顺序排列 */
const entries: string[] = [];

function keyOf(content: string, lastModified: number): string {
  return `${String(lastModified)}:${String(content.length)}:${content}`;
}

/** 登记一次自己发起的写盘 */
export function recordSelfWrite(content: string, lastModified: number): void {
  entries.push(keyOf(content, lastModified));
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/** 这份内容与时间戳是不是我们刚写下去的 */
export function isSelfWrite(content: string, lastModified: number): boolean {
  return entries.includes(keyOf(content, lastModified));
}

/** 换文档时清空 */
export function clearSelfWrites(): void {
  entries.length = 0;
}
```

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run src/editor/versions.test.ts src/editor/self-write.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 8: 实现保存执行**

创建 `src/editor/save.ts`。这一层是 IO，不写单测（副作用全在浏览器 API 上），决策与缓冲的正确性由 Task 14 与上面两个模块的测试保证：

```ts
import { saveFile } from '@/export/download';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { canUseFilePicker } from '@/utils/env';
import {
  ensureFileWritePermission,
  getCurrentFileHandle,
  registerFileHandle,
  setCurrentFileHandle,
} from '@/utils/file-open';
import { createLogger } from '@/utils/logger';
import { decideSaveTarget } from './save-target';
import { recordSelfWrite } from './self-write';
import { createVersionBuffer } from './versions';

const log = createLogger('save');

/** 保存前的版本缓冲，容量随设置变化时重建 */
let buffer = createVersionBuffer(5);
let bufferCapacity = 5;

/** 取当前的版本缓冲，容量跟随设置 */
function versionBuffer() {
  const capacity = useSettingsStore.getState().settings.editor.keepVersions;
  if (capacity !== bufferCapacity) {
    buffer = createVersionBuffer(capacity);
    bufferCapacity = capacity;
  }
  return buffer;
}

/** 回到上一个保存版本；没有历史时返回 null */
export function popPreviousVersion(): string | null {
  return versionBuffer().pop();
}

export type SaveOutcome =
  | { kind: 'saved'; lastModified: number }
  | { kind: 'saved-as'; handle: FileSystemFileHandle | null; filename: string }
  | { kind: 'skipped' }
  | { kind: 'cancelled' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

/**
 * 执行一次保存。
 *
 * @param text 要写入的文本，直接来自编辑器——**不做任何规整**。
 *   导出 Markdown 时会走 `normalizeMarkdown` 整理空白，但那是「导出」这个
 *   动作的一部分；保存是把用户的文件写回去，改动一个字符都是越界。
 * @param automatic 是否由定时器触发
 */
export async function performSave(text: string, automatic: boolean): Promise<SaveOutcome> {
  const state = useDocumentStore.getState();
  const doc = state.document;
  if (!doc) return { kind: 'skipped' };

  const target = decideSaveTarget({
    dirty: text !== doc.content,
    handle: getCurrentFileHandle(),
    writable: state.writable,
    canUsePicker: canUseFilePicker(),
    automatic,
  });

  switch (target.kind) {
    case 'clean':
      return { kind: 'skipped' };

    case 'needs-permission': {
      // 走到这里一定是用户按了 ⌘S，处在手势调用栈里，可以申请
      const outcome = await ensureFileWritePermission(target.handle, true);
      if (outcome !== 'granted') return { kind: 'denied' };
      useDocumentStore.getState().setWritable(true);
      return writeThrough(target.handle, text, doc.content);
    }

    case 'write':
      return writeThrough(target.handle, text, doc.content);

    case 'save-as':
    case 'download': {
      const result = await saveFile(doc.name, new Blob([text], { type: 'text/markdown;charset=utf-8' }), {
        description: 'Markdown 文件',
        accept: { 'text/markdown': ['.md', '.markdown'] },
      });
      if (result.status === 'cancelled') return { kind: 'cancelled' };
      if (result.status === 'error') return { kind: 'error', message: result.message };
      return { kind: 'saved-as', handle: null, filename: result.filename };
    }
  }
}

/** 写回一个已授权的句柄 */
async function writeThrough(
  handle: FileSystemFileHandle,
  text: string,
  previous: string,
): Promise<SaveOutcome> {
  try {
    // 先留后悔药再动磁盘：写失败了缓冲里多一版无害，写成功了没留就没救了
    versionBuffer().push(previous);

    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();

    // 读回时间戳并登记，让自动刷新认出这是我们自己写的
    const file = await handle.getFile();
    recordSelfWrite(text, file.lastModified);
    return { kind: 'saved', lastModified: file.lastModified };
  } catch (error) {
    log.error('写回文件失败', error);
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
```

> `saveFile` 返回的是 `ExportResult`，其 `done` 分支不带句柄。另存后想让自动保存恢复，需要 `saveFile` 把句柄透出来。修改 `src/export/download.ts`：`ExportResult` 的 `done` 分支加可选字段 `handle?: FileSystemFileHandle`，`saveFile` 在走 picker 分支时带上它（`downloadViaAnchor` 分支没有句柄，不带）。`save.ts` 拿到后调 `setCurrentFileHandle(handle)` + `registerFileHandle(filename, handle)` + `setWritable(true)`。现有导出调用方忽略这个新字段，不受影响。

- [ ] **Step 9: 验证**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 10: 提交**

```bash
git add src/editor/versions.ts src/editor/versions.test.ts src/editor/self-write.ts src/editor/self-write.test.ts src/editor/save.ts src/export/download.ts src/types/export.ts
git commit -m "feat: 保存执行、自写登记与版本缓冲"
```

---

