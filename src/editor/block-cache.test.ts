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

  it('把缓存键写进节点的 data 属性，供渲染后定位', () => {
    const cache = createBlockCache();
    expect(cache.acquire('a', '<p>甲</p>').dataset.blockKey).toBe('a');
  });

  it('invalidateEnhanced 只清增强标记，节点仍复用', () => {
    const cache = createBlockCache();
    const node = cache.acquire('a', '<p>甲</p>');
    cache.markEnhanced('a');
    cache.invalidateEnhanced();
    expect(cache.isEnhanced('a')).toBe(false);
    // 节点身份不变，DOM 不必重建
    expect(cache.acquire('a', '<p>甲</p>')).toBe(node);
  });
});

/**
 * 容量 1 这个边界曾被判为「纯覆盖增强、可以推迟」，但它**已经是生产路径**：
 * `offscreen-render.ts` 的 `renderOffscreen` 用的正是 `createBlockCache(1)`，
 * 导出 HTML 与打印每走一次就构造一个。
 *
 * 需要说清楚的是那条路径**真正用到的是哪几个方法**：`renderOffscreen` 自己
 * 造节点、不调 `acquire`，只把缓存交给 `enhanceBlock` 用 `isEnhanced` /
 * `markEnhanced`，用完 `clear()` 回收 ResizeObserver。也就是说淘汰逻辑在那条
 * 路径上根本没被走到——下面既补了容量 1 的淘汰边界（这是容量参数本身的契约），
 * 也照着离屏渲染的真实调用形状补了一条，两者不要混为一谈。
 */
describe('createBlockCache：容量 1（离屏渲染用的就是它）', () => {
  it('每取一个新键就淘汰掉上一个，缓存里始终只有一条', () => {
    const cache = createBlockCache(1);
    const a = cache.acquire('a', '<p>甲</p>');
    expect(cache.size).toBe(1);

    cache.acquire('b', '<p>乙</p>');
    expect(cache.size).toBe(1);

    // a 被淘汰了：再取同一个键拿到的是一个新造的节点，不是原来那个
    expect(cache.acquire('a', '<p>甲</p>')).not.toBe(a);
    expect(cache.size).toBe(1);
  });

  it('刚取到的那一个一定还在缓存里——容量 1 不能把自己挤掉', () => {
    // 这是「取完立刻要用」的最低保证：淘汰循环若写成 `>=` 就会把刚放进去的
    // 那个当场删掉，size 恒为 0，缓存彻底失效而没有任何报错
    const cache = createBlockCache(1);
    const node = cache.acquire('only', '<p>甲</p>');
    expect(cache.size).toBe(1);
    expect(cache.acquire('only', '<p>甲</p>')).toBe(node);
  });

  it('被淘汰的键连增强标记一起丢掉，不会让新节点被当成已增强', () => {
    const cache = createBlockCache(1);
    cache.acquire('a', '<p>甲</p>');
    cache.markEnhanced('a');
    cache.acquire('b', '<p>乙</p>');
    // 留着标记的话，a 换回来的新节点会被 enhanceBlock 直接跳过，
    // 于是这一块永远不上色、不出图，而且完全静默
    expect(cache.isEnhanced('a')).toBe(false);
  });

  it('离屏渲染的调用形状：不经 acquire，只记增强标记，clear 后复位', () => {
    /*
     * `renderOffscreen` 自己造节点再调 `enhanceBlock(node, key, cache, …)`，
     * 缓存在那里只承担「这一块增强过没有」和「回收 ResizeObserver」两件事。
     * 容量 1 对这条路径因此是够用的——这条用例把这个前提钉住：将来谁让离屏
     * 渲染改成多块，这里就得一起改。
     */
    const cache = createBlockCache(1);
    const key = 'offscreen:doc:a.md';
    expect(cache.isEnhanced(key)).toBe(false);
    cache.markEnhanced(key);
    expect(cache.isEnhanced(key)).toBe(true);
    // 没走 acquire，所以缓存里一个节点都没有，容量从头到尾没有约束力
    expect(cache.size).toBe(0);

    cache.clear();
    expect(cache.isEnhanced(key)).toBe(false);
  });
});

/**
 * 装一个能手动触发的 ResizeObserver 替身。
 *
 * 全局那个空壳（见 `src/test/setup.ts`）永远不回调，测不了「高度是怎么进来的」；
 * 这里要验的恰恰是这条链路。替身在 `run` 结束后一定还原，不影响别的用例。
 */
function withResizeObserver<T>(run: (emit: (target: Element, height: number) => void) => T): T {
  const original = globalThis.ResizeObserver;
  let notify: ResizeObserverCallback | null = null;
  const observing = new Set<Element>();

  globalThis.ResizeObserver = class FakeResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      notify = callback;
    }
    observe(target: Element): void {
      observing.add(target);
    }
    unobserve(target: Element): void {
      observing.delete(target);
    }
    disconnect(): void {
      observing.clear();
    }
  };

  const emit = (target: Element, height: number): void => {
    // 已经取消观察的节点不会再报尺寸，替身也要守这条，否则测不出 unobserve
    if (!observing.has(target) || !notify) return;
    const entry = { target, contentRect: { height } } as unknown as ResizeObserverEntry;
    notify([entry], {} as ResizeObserver);
  };

  try {
    return run(emit);
  } finally {
    globalThis.ResizeObserver = original;
  }
}

describe('createBlockCache 的真实高度记录', () => {
  it('没渲染过的块查不到高度', () => {
    withResizeObserver(() => {
      const cache = createBlockCache();
      expect(cache.measuredHeight('a')).toBeNull();
      cache.acquire('a', '<p>甲</p>');
      // 挂上去但还没量到，仍然是「不知道」——不能编一个 0 出来
      expect(cache.measuredHeight('a')).toBeNull();
    });
  });

  it('量到的高度按块的键存下来', () => {
    withResizeObserver((emit) => {
      const cache = createBlockCache();
      const node = cache.acquire('a', '<p>甲</p>');
      emit(node, 480);
      expect(cache.measuredHeight('a')).toBe(480);
    });
  });

  it('节点被摘下来时报的 0 不会覆盖已量到的高度', () => {
    withResizeObserver((emit) => {
      /*
       * widget 被销毁时节点会离开文档，观察器随即报一次 0×0。那不是
       * 「这块高度为 0」而是「现在量不到」，采信它等于每滚过一次就把
       * 好不容易量到的真实高度丢掉，估算又退回经验值。
       */
      const cache = createBlockCache();
      const node = cache.acquire('a', '<p>甲</p>');
      emit(node, 480);
      emit(node, 0);
      expect(cache.measuredHeight('a')).toBe(480);
    });
  });

  it('被淘汰的块连高度一起丢掉', () => {
    withResizeObserver((emit) => {
      const cache = createBlockCache(1);
      const a = cache.acquire('a', '<p>甲</p>');
      emit(a, 480);
      cache.acquire('b', '<p>乙</p>');
      expect(cache.measuredHeight('a')).toBeNull();
      // 淘汰时也取消了观察：游离节点不该再往缓存里写东西
      emit(a, 999);
      expect(cache.measuredHeight('a')).toBeNull();
    });
  });

  it('clear 之后高度也清空，且新节点照样能量', () => {
    withResizeObserver((emit) => {
      const cache = createBlockCache();
      emit(cache.acquire('a', '<p>甲</p>'), 480);
      cache.clear();
      expect(cache.measuredHeight('a')).toBeNull();

      // disconnect 之后观察器仍可复用，换文档不必重建缓存
      emit(cache.acquire('a', '<p>甲</p>'), 512);
      expect(cache.measuredHeight('a')).toBe(512);
    });
  });
});
