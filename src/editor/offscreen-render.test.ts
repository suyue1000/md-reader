import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderOffscreen } from './offscreen-render';

/**
 * 整条 Markdown 管线是动态 import 的，第一次用到时要把 markdown-it、
 * 全部内置插件、Shiki 的语言与主题一并拉起来，几秒起步。
 */
const PIPELINE_TIMEOUT = 30_000;

/** 造一篇有 `chapters` 章的文档，每章一个标题、一段正文、一个 js 代码块 */
function longDocument(chapters: number): string {
  const parts: string[] = [];
  for (let i = 1; i <= chapters; i++) {
    parts.push(`## 第 ${String(i)} 章`, `这是第 ${String(i)} 章的正文。`, '```js', `const a${String(i)} = ${String(i)};`, '```');
  }
  return parts.join('\n\n');
}

/**
 * 永不回调的 IntersectionObserver 替身。
 *
 * jsdom 本来没有 IntersectionObserver，而代码块增强在「没有观察器」时会
 * 退化成「全部直接排队」——那条降级路径把懒加载完全绕开了，用它测不出
 * 「离屏渲染有没有等增强做完」。装上一个永不回调的替身，才还原真实浏览器里
 * 「不进视口就不上色」的形状。
 */
class NeverFiringObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {
    // 故意什么都不做：模拟「这些块永远不会进入视口」
  }
  unobserve(): void {
    // 同上
  }
  disconnect(): void {
    // 同上
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe('renderOffscreen', () => {
  let original: typeof globalThis.IntersectionObserver | undefined;

  beforeEach(() => {
    original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = NeverFiringObserver;
  });

  afterEach(() => {
    if (original) globalThis.IntersectionObserver = original;
    else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it(
    '产出带 markdown-body 类的完整正文节点',
    async () => {
      const { node, dispose } = await renderOffscreen('# 标题\n\n正文', 'doc:a', undefined);
      expect(node.classList.contains('markdown-body')).toBe(true);
      expect(node.querySelector('h1')?.textContent).toContain('标题');
      expect(node.querySelector('p')?.textContent).toBe('正文');
      dispose();
    },
    PIPELINE_TIMEOUT,
  );

  it(
    '渲染的是整篇文档，不是视口附近的一小段',
    async () => {
      // 这一条守的正是旧实现的病根：屏幕上每个块 widget 各带一个
      // `.markdown-body`，取第一个只能拿到开头一小段
      const { node, dispose } = await renderOffscreen(longDocument(40), 'doc:long', undefined);
      expect(node.querySelectorAll('h2')).toHaveLength(40);
      expect(node.querySelectorAll('.code-block')).toHaveLength(40);
      expect(node.textContent).toContain('第 40 章的正文');
      dispose();
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'Promise 落定时增强已经做完，包括视口外的代码块',
    async () => {
      /*
       * 撤销 `enhanceBlock(..., eager = true)` 这一个参数，这条就会红：
       * 代码块增强是按视口推进的，`enhance` 不等队列排空就返回，
       * 快照拿到的是一份「结构齐了但没上色」的 DOM——而且不报任何错。
       */
      const { node, dispose } = await renderOffscreen(longDocument(12), 'doc:eager', undefined);
      const blocks = Array.from(node.querySelectorAll<HTMLElement>('.code-block'));
      expect(blocks).toHaveLength(12);
      // 每一块都上过色（Shiki 的产物带 `--shiki-*` 内联变量），而不是只有前几块
      for (const block of blocks) {
        expect(block.dataset['codeTheme']).toBeTruthy();
      }
      expect(node.querySelectorAll('.shiki').length).toBe(12);
      dispose();
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'dispose 之后节点从文档中移除',
    async () => {
      const { node, dispose } = await renderOffscreen('正文', 'doc:a', undefined);
      expect(node.isConnected).toBe(true);
      dispose();
      expect(node.isConnected).toBe(false);
    },
    PIPELINE_TIMEOUT,
  );

  it(
    '宿主节点挂在文档里、移出可视区，并且标了 no-print',
    async () => {
      const { node, dispose } = await renderOffscreen('正文', 'doc:a', undefined);
      const host = node.parentElement;
      // 挂进文档而不是留在游离节点里：增强钩子的契约是「树在文档里」
      expect(host?.isConnected).toBe(true);
      // 挪出可视区而不是 display:none——后者让尺寸全部归零
      expect(host?.style.display).not.toBe('none');
      expect(host?.style.left).toBe('-99999px');
      // 一棵高度等于整篇文档的绝对定位子树留在纸上会撑出大片空白页
      expect(host?.classList.contains('no-print')).toBe(true);
      dispose();
    },
    PIPELINE_TIMEOUT,
  );
});
