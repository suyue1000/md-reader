### Task 16: 冲突判定

**Files:**
- Create: `src/editor/conflict.ts`
- Test: `src/editor/conflict.test.ts`
- Modify: `src/hooks/useAutoRefresh.ts`
- Modify: `src/utils/auto-refresh.ts`

**Interfaces:**
- Consumes: `FileProbeResult`（`src/utils/file-open.ts`）、`isSelfWrite`（Task 15）
- Produces:

```ts
export type RefreshDecision =
  | { kind: 'continue' }
  | { kind: 'touch-timestamp'; lastModified: number }
  | { kind: 'adopt'; document: MarkdownDocument }
  | { kind: 'conflict'; document: MarkdownDocument }
  | { kind: 'stop'; message: string }
  | { kind: 'deactivate' };

export interface RefreshContext {
  /** 编辑器里的当前文本 */
  editorText: string;
  /** 上次从磁盘读到或写回磁盘的内容 */
  savedContent: string;
  /** 这份内容与时间戳是不是我们自己刚写的 */
  isSelfWrite: (content: string, lastModified: number) => boolean;
}

export function decideRefresh(result: FileProbeResult, context: RefreshContext): RefreshDecision;
```

- [ ] **Step 1: 写失败的测试**

创建 `src/editor/conflict.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { MarkdownDocument } from '@/types';
import { decideRefresh, type RefreshContext } from './conflict';

const doc = (content: string, lastModified = 1000): MarkdownDocument => ({
  id: 'doc:a',
  name: 'a.md',
  path: 'a.md',
  content,
  size: content.length,
  lastModified,
  source: 'fs-handle',
});

const ctx = (overrides: Partial<RefreshContext> = {}): RefreshContext => ({
  editorText: '原文',
  savedContent: '原文',
  isSelfWrite: () => false,
  ...overrides,
});

describe('decideRefresh', () => {
  it('文件没变时继续监听', () => {
    expect(decideRefresh({ kind: 'unchanged' }, ctx())).toEqual({ kind: 'continue' });
  });

  it('时间戳变了但内容没变，只对时', () => {
    const result = decideRefresh({ kind: 'changed', document: doc('原文', 2000) }, ctx());
    expect(result).toEqual({ kind: 'touch-timestamp', lastModified: 2000 });
  });

  it('是我们自己刚写的，只对时而不回灌', () => {
    const result = decideRefresh(
      { kind: 'changed', document: doc('新内容', 2000) },
      ctx({ editorText: '新内容', isSelfWrite: () => true }),
    );
    expect(result).toEqual({ kind: 'touch-timestamp', lastModified: 2000 });
  });

  it('外部改动且本地没有未保存改动，直接采用', () => {
    const result = decideRefresh({ kind: 'changed', document: doc('外部改的') }, ctx());
    expect(result).toEqual({ kind: 'adopt', document: doc('外部改的') });
  });

  it('外部改动且本地有未保存改动，报冲突而不是静默覆盖', () => {
    const result = decideRefresh(
      { kind: 'changed', document: doc('外部改的') },
      ctx({ editorText: '我改的', savedContent: '原文' }),
    );
    expect(result.kind).toBe('conflict');
  });

  it('文件消失时停止监听', () => {
    expect(decideRefresh({ kind: 'missing' }, ctx()).kind).toBe('stop');
  });

  it('权限失效时停止监听', () => {
    expect(decideRefresh({ kind: 'permission-lost' }, ctx()).kind).toBe('stop');
  });

  it('没有句柄时停用', () => {
    expect(decideRefresh({ kind: 'no-handle' }, ctx())).toEqual({ kind: 'deactivate' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/editor/conflict.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

创建 `src/editor/conflict.ts`。它取代 `src/utils/auto-refresh.ts` 的 `decideRefreshAction`——多了「自写识别」与「冲突」两种结果：

```ts
import type { MarkdownDocument } from '@/types';
import type { FileProbeResult } from '@/utils/file-open';

/**
 * 一次探测之后应该做什么。
 *
 * 比原来的 `RefreshAction` 多两种结果，都是编辑能力带来的：
 * - `touch-timestamp` 现在还要覆盖「是我们自己写的」这一种；
 * - `conflict` 是全新的——磁盘变了而本地也有未保存的改动，
 *   这时候把磁盘内容灌回来就是在丢用户正在写的东西。
 */
export type RefreshDecision =
  /** 无事发生，继续监听 */
  | { kind: 'continue' }
  /** 内容实质未变（或就是我们自己写的），只需同步时间戳 */
  | { kind: 'touch-timestamp'; lastModified: number }
  /** 外部改动，本地无未保存内容，直接采用 */
  | { kind: 'adopt'; document: MarkdownDocument }
  /** 外部改动 + 本地有未保存改动，交给用户选 */
  | { kind: 'conflict'; document: MarkdownDocument }
  /** 出现不可恢复的情况，停止监听并告知用户 */
  | { kind: 'stop'; message: string }
  /** 当前文档不具备监听条件 */
  | { kind: 'deactivate' };

export interface RefreshContext {
  /** 编辑器里的当前文本 */
  editorText: string;
  /** 上次从磁盘读到或写回磁盘的内容 */
  savedContent: string;
  /** 这份内容与时间戳是不是我们自己刚写的 */
  isSelfWrite: (content: string, lastModified: number) => boolean;
}

export function decideRefresh(
  result: FileProbeResult,
  context: RefreshContext,
): RefreshDecision {
  switch (result.kind) {
    case 'unchanged':
      return { kind: 'continue' };

    case 'changed': {
      const incoming = result.document;

      // 我们自己刚写的：内容与时间戳都对得上，只需把时间戳同步过来，
      // 免得下一轮又读一次内容
      if (context.isSelfWrite(incoming.content, incoming.lastModified)) {
        return { kind: 'touch-timestamp', lastModified: incoming.lastModified };
      }

      // 有些编辑器保存时会更新 mtime 但内容一字未改，重新渲染纯属抖动
      if (incoming.content === context.savedContent) {
        return { kind: 'touch-timestamp', lastModified: incoming.lastModified };
      }

      // 磁盘变了而本地也有未落盘的改动——两边都有值钱的东西，不能自作主张
      const dirty = context.editorText !== context.savedContent;
      return dirty ? { kind: 'conflict', document: incoming } : { kind: 'adopt', document: incoming };
    }

    case 'missing':
      return { kind: 'stop', message: '文件已被删除或移动，自动刷新已停止' };

    case 'permission-lost':
      return { kind: 'stop', message: '文件访问权限已失效，点击工具栏的刷新按钮重新授权' };

    case 'no-handle':
      return { kind: 'deactivate' };

    case 'error':
      return { kind: 'stop', message: `读取失败：${result.message}` };
  }
}
```

- [ ] **Step 4: 删除旧的决策函数**

`src/utils/auto-refresh.ts` 与 `src/utils/auto-refresh.test.ts` 整体删除——`decideRefresh` 是它的超集，留两份决策逻辑必然分岔：

```bash
git rm src/utils/auto-refresh.ts src/utils/auto-refresh.test.ts
```

把 `auto-refresh.test.ts` 里仍然有价值的用例（`missing` / `permission-lost` / `error` 的文案断言）搬进 `conflict.test.ts`。

- [ ] **Step 5: 接进 useAutoRefresh**

`src/hooks/useAutoRefresh.ts` 改用 `decideRefresh`，并处理新的两种结果：

```ts
        case 'adopt':
          log.info('检测到文件变化，已重新加载');
          useDocumentStore.getState().applyRefreshedDocument(action.document);
          break;

        case 'conflict':
          // 冲突要用户决断，在此期间停止轮询——每 1.5 秒弹一次同样的提示
          // 只会让人更慌
          useDocumentStore.getState().setConflict(action.document);
          return;
```

`document.store` 加 `conflict: MarkdownDocument | null` 与 `setConflict` / `resolveConflict(choice: 'mine' | 'disk')`。

- [ ] **Step 6: 加冲突提示 UI**

在 `AppShell` 里加一个条状提示（复用 `Toast` 的样式变量，但不自动消失——这是需要决断的事，不是通知）：

> 文件在编辑器之外被修改了。**保留我的改动** / **改用磁盘上的版本**

选「保留我的」→ 清掉 conflict，什么都不做（下次保存会覆盖磁盘）。
选「用磁盘的」→ 把当前编辑器文本推进版本缓冲，再 `applyRefreshedDocument`。

- [ ] **Step 7: 运行确认通过**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 8: 人工验收**

编辑态下改几个字（先别保存），用外部编辑器改同一个文件并保存。
Expected: 出现冲突提示而不是内容被静默替换；选「保留我的」后本地改动还在。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: 外部改动的冲突判定"
```

---

