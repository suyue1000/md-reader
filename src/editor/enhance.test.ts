import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pluginRegistry } from '@/plugins';
import type { MarkdownPlugin, PluginContext } from '@/types';
import { createBlockCache } from './block-cache';
import { enhanceBlock } from './enhance';

/** 第一次用到时要拉起整条管线与 Shiki，给宽一点 */
const PIPELINE_TIMEOUT = 30_000;

/**
 * 永不回调的 IntersectionObserver 替身。
 *
 * jsdom 本来没有它，而代码块增强在「没有观察器」时会退化成「全部直接排队」——
 * 那条降级路径把懒加载整个绕开了，用它根本区分不出 eager 与否。
 * 装一个永不回调的替身，才还原真实浏览器里「不进视口就不上色」的形状。
 */
class NeverFiringObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {
    // 故意什么都不做
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

/** 造一个带 n 个代码块骨架的正文节点，结构与 markdown-it 出口一致 */
function makeBody(count: number): HTMLElement {
  const node = document.createElement('div');
  node.className = 'markdown-body';
  node.innerHTML = Array.from(
    { length: count },
    (_, i) =>
      '<figure class="code-block" data-lang="js">' +
      '<figcaption class="code-block__bar"><span class="code-block__lang">js</span>' +
      '<span class="code-block__actions"></span></figcaption>' +
      `<pre class="code-block__pre"><code>const a${String(i)} = ${String(i)};</code></pre>` +
      '</figure>',
  ).join('');
  return node;
}

/** 已经上过色的代码块数 */
function colored(node: HTMLElement): number {
  return node.querySelectorAll('.code-block[data-code-theme]').length;
}

describe('enhanceBlock 的 eager 参数', () => {
  let original: typeof globalThis.IntersectionObserver | undefined;

  beforeEach(() => {
    original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = NeverFiringObserver;
  });

  afterEach(() => {
    if (original) globalThis.IntersectionObserver = original;
    else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  /**
   * 守的是「屏幕上仍然按视口懒加载」这条性能设计。
   *
   * 把 `eager` 的默认值翻成 true，屏幕路径就会跟着一次做完整篇——
   * 10MB 文档六千多个代码块要算二十多秒，而其中绝大多数用户永远不会滚到。
   * 这条用例是这个默认值唯一的守卫。
   */
  it(
    '默认不 eager：屏幕路径不等队列排空就返回',
    async () => {
      const node = makeBody(40);
      document.body.appendChild(node);

      await enhanceBlock(node, 'screen:a', createBlockCache(1), undefined);

      // 落定的那一刻整篇还没上完色——增强是「排好队就走」的
      expect(colored(node)).toBeLessThan(40);

      // 但队列确实在推进：等下去它们会陆续上色。
      // 没有这一步，上面那条断言在「压根不上色」时也会绿，等于什么都没守住
      const deadline = Date.now() + 20_000;
      while (colored(node) < 40 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(colored(node)).toBe(40);

      node.remove();
    },
    PIPELINE_TIMEOUT,
  );

  it(
    'eager 为真时，落定即代表整篇都做完了',
    async () => {
      const node = makeBody(40);
      document.body.appendChild(node);

      await enhanceBlock(node, 'offscreen:a', createBlockCache(1), undefined, true, true);

      expect(colored(node)).toBe(40);
      node.remove();
    },
    PIPELINE_TIMEOUT,
  );

  /**
   * 同一件事在契约那一层再钉一次。
   *
   * 上一条看的是行为（等没等），这一条看的是**传给插件的是什么**——
   * 默认值翻了之后，即使将来代码块增强换了实现、行为那条不再敏感，
   * 这条仍然会红。`eager` 是对所有增强器开放的语义，不只是代码块的。
   */
  it(
    '传给插件的 ctx.eager：默认 false，显式传入才为 true',
    async () => {
      const seen: (boolean | undefined)[] = [];
      const probe: MarkdownPlugin = {
        id: 'test-eager-probe',
        name: '探针',
        enhance: (_root: HTMLElement, ctx: PluginContext) => {
          seen.push(ctx.eager);
        },
      };
      pluginRegistry.register(probe);
      try {
        const node = makeBody(0);
        await enhanceBlock(node, 'k1', createBlockCache(1), undefined);
        await enhanceBlock(node, 'k2', createBlockCache(1), undefined, false, true);
        expect(seen).toEqual([false, true]);
      } finally {
        pluginRegistry.unregister('test-eager-probe');
      }
    },
    PIPELINE_TIMEOUT,
  );
});
