### Task 4: 块 DOM 缓存

CodeMirror 会销毁滚出视口的 widget。没有缓存的话，每次滚动都要重跑 Shiki 上色与 Mermaid 出图。

**Files:**
- Create: `src/editor/block-cache.ts`
- Test: `src/editor/block-cache.test.ts`

**Interfaces:**
- Consumes: `RenderedBlock`（Task 3）
- Produces:

```ts
export interface BlockCache {
  /** 取本块的 DOM；没有就用 html 造一个并存起来 */
  acquire(key: string, html: string): HTMLElement;
  /** 标记某块的 DOM 已完成异步增强，之后复用时不再重跑 */
  markEnhanced(key: string): void;
  isEnhanced(key: string): boolean;
  clear(): void;
  readonly size: number;
}
export function createBlockCache(capacity?: number): BlockCache;
```

- [ ] **Step 1: 写失败的测试**

创建 `src/editor/block-cache.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createBlockCache } from './block-cache';

describe('createBlockCache', () => {
  it('同一个键返回同一个 DOM 节点', () => {
    const cache = createBlockCache();
    const first = cache.acquire('a', '<p>甲</p>');
    const second = cache.acquire('a', '<p>甲</p>');
    expect(second).toBe(first);
  });

  it('不同的键返回不同节点', () => {
    const cache = createBlockCache();
    expect(cache.acquire('a', '<p>甲</p>')).not.toBe(cache.acquire('b', '<p>乙</p>'));
  });

  it('增强标记随键保存', () => {
    const cache = createBlockCache();
    cache.acquire('a', '<p>甲</p>');
    expect(cache.isEnhanced('a')).toBe(false);
    cache.markEnhanced('a');
    expect(cache.isEnhanced('a')).toBe(true);
  });

  it('超出容量时淘汰最久未使用的条目', () => {
    const cache = createBlockCache(2);
    const a = cache.acquire('a', '<p>甲</p>');
    cache.acquire('b', '<p>乙</p>');
    // 重新取用 a，使 b 成为最久未用
    cache.acquire('a', '<p>甲</p>');
    cache.acquire('c', '<p>丙</p>');
    expect(cache.size).toBe(2);
    // a 仍在缓存里，节点身份不变
    expect(cache.acquire('a', '<p>甲</p>')).toBe(a);
  });

  it('clear 清空所有条目与增强标记', () => {
    const cache = createBlockCache();
    cache.acquire('a', '<p>甲</p>');
    cache.markEnhanced('a');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.isEnhanced('a')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/editor/block-cache.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

创建 `src/editor/block-cache.ts`：

```ts
/**
 * 块 DOM 缓存。
 *
 * CodeMirror 只保留视口附近的 widget，滚出去的会被销毁、滚回来重建。
 * 而块 DOM 上跑过 Shiki 上色、Mermaid 出图、KaTeX 展开——这些都是几十到
 * 几百毫秒的异步工作。不缓存的话，上下滚动一遍就等于把整篇文档重新增强
 * 一遍，而且是每滚一次都来一遍。
 *
 * 缓存的是**节点本身**而不是 HTML 字符串：字符串还得重新解析成 DOM，
 * 更重要的是 Mermaid 出的 SVG 与 Shiki 的内联色都在节点上，存字符串等于
 * 白存。节点被 widget 的 `toDOM()` 直接返回，同一时刻只会挂在一处。
 */

/** 默认容量。按一屏几十块估算，200 足够覆盖来回滚动的范围 */
const DEFAULT_CAPACITY = 200;

export interface BlockCache {
  /** 取本块的 DOM；没有就用 html 造一个并存起来 */
  acquire(key: string, html: string): HTMLElement;
  /** 标记某块的 DOM 已完成异步增强，之后复用时不再重跑 */
  markEnhanced(key: string): void;
  isEnhanced(key: string): boolean;
  clear(): void;
  readonly size: number;
}

/**
 * 创建缓存。
 *
 * 用 Map 的插入顺序实现 LRU：命中时删掉再塞回去，Map 的迭代顺序即
 * 「最久未用在前」。比手写链表短得多，而这里的量级（几百条）下
 * 删除加插入的成本可以忽略。
 */
export function createBlockCache(capacity = DEFAULT_CAPACITY): BlockCache {
  const nodes = new Map<string, HTMLElement>();
  const enhanced = new Set<string>();

  return {
    acquire(key, html) {
      const existing = nodes.get(key);
      if (existing) {
        nodes.delete(key);
        nodes.set(key, existing);
        return existing;
      }

      const node = document.createElement('div');
      node.className = 'markdown-body cm-md-block';
      // HTML 已在 renderBlocks 出口经过 DOMPurify 净化
      node.innerHTML = html;
      nodes.set(key, node);

      while (nodes.size > capacity) {
        const oldest = nodes.keys().next();
        if (oldest.done) break;
        nodes.delete(oldest.value);
        enhanced.delete(oldest.value);
      }
      return node;
    },

    markEnhanced(key) {
      enhanced.add(key);
    },

    isEnhanced(key) {
      return enhanced.has(key);
    },

    clear() {
      nodes.clear();
      enhanced.clear();
    },

    get size() {
      return nodes.size;
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/editor/block-cache.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/editor/block-cache.ts src/editor/block-cache.test.ts
git commit -m "feat: 块 DOM 缓存"
```

---

