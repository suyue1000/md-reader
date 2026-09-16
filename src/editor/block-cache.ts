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
 * 白存。
 *
 * ## 对键的要求：它必须标识「文档里的一个位置」
 *
 * 一个键固定对应一个 DOM 节点，而一个 DOM 节点在文档树里只能存在于一个
 * 位置——第二处挂上同一个节点，等于把它从第一处摘走。所以调用方给的键
 * **不能只表示内容**：一篇文档里有两个源码完全相同的块时，两个 widget 会
 * 轮流抢同一个节点，块高度塌陷、高度图错位，跳转彻底失效且不报错。
 * 这条不变量由 `block-render.ts` 的 `RenderedBlock.key` 负责满足（给重复
 * 内容编号），那里有完整的说明。
 *
 * 这里不做「返回克隆」之类的自保：克隆出来的节点没有 Mermaid 画好的 SVG 的
 * 后续绑定，也会让 `markEnhanced` / `measuredHeight` 记的到底是哪一份变得
 * 含糊。缓存只守「一个键一个节点」这条简单契约，唯一性交给键的生产者。
 */

/** 默认容量。按一屏几十块估算，200 足够覆盖来回滚动的范围 */
const DEFAULT_CAPACITY = 200;

export interface BlockCache {
  /** 取本块的 DOM；没有就用 html 造一个并存起来 */
  acquire(key: string, html: string): HTMLElement;
  /** 标记某块的 DOM 已完成异步增强，之后复用时不再重跑 */
  markEnhanced(key: string): void;
  isEnhanced(key: string): boolean;
  /**
   * 这一块**上次挂在 DOM 上时量到的真实高度**（像素）；从没渲染过时为 null。
   *
   * 给 `BlockWidget.estimatedHeight` 用：已经渲染过的块，真实高度比任何
   * 经验公式都准，而且是免费的——高度由 ResizeObserver 在布局之后异步送来，
   * 读的时候只是一次 Map 查询，不触发同步布局。见下方 observer 的说明。
   */
  measuredHeight(key: string): number | null;
  clear(): void;
  /**
   * 只清增强标记，保留节点本身。
   *
   * 用在主题切换这类「DOM 还能用，但增强结果过期了」的场合：Shiki 的配色、
   * Mermaid 的图都是按当时的主题画的，换了主题就得重画，但块的 HTML 结构
   * 没变，没必要连节点一起丢掉重建。
   */
  invalidateEnhanced(): void;
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
  /** 每块最后一次量到的真实高度，键与 nodes 同步存亡 */
  const heights = new Map<string, number>();

  /**
   * 记录块的真实高度。
   *
   * 为什么是 ResizeObserver 而不是「要用的时候读一次 `offsetHeight`」：
   * 1. 读 `offsetHeight` 会强制同步布局，而调用方（`estimatedHeight`）是在
   *    CodeMirror 重建高度图时对**每个块**各调一次的热路径；
   * 2. 更要命的是，需要高度的时刻恰恰是这块**不在 DOM 里**的时刻——widget
   *    被销毁后节点是游离的，那时量到的只会是 0。
   * 观察器把这件事倒过来：块挂上去、Shiki 上色、Mermaid 出图，每次高度变化
   * 都在布局之后被动送来，读取端只剩一次 Map 查询。
   *
   * 回调里只写一个 Map，不碰 DOM，因此不会引发 ResizeObserver 的重入循环。
   */
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.blockKey;
            if (key === undefined) continue;
            /*
             * borderBoxSize 在个别环境（含 jsdom 替身）里缺席，退回 contentRect。
             * 两者对 `.cm-md-block` **不等值**：markdown.css 给它设了
             * `padding-block: 0.4em`（12.8px），contentRect 不含这一段。差值只在
             * 缺席 borderBoxSize 的降级路径上出现，代价是那一路量到的高度每块
             * 偏小 13px——好过完全量不到，但别把这两条当成一回事。
             */
            const box = entry.borderBoxSize as readonly ResizeObserverSize[] | undefined;
            const height = box?.[0]?.blockSize ?? entry.contentRect.height;
            /*
             * 0 不是「这块高度为 0」，而是「现在量不到」——widget 被销毁时
             * 节点会从文档里摘掉，观察器随即报一次 0×0。拿它覆盖上一次的
             * 真实值，等于每滚过一次就把好不容易量到的高度丢掉。
             */
            if (height > 0) heights.set(key, height);
          }
        });

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
      // 把键写到 DOM 上：渲染完一轮后，编辑器要靠它认出「这个节点是哪一块」，
      // 才能只对没增强过的块跑 Shiki / Mermaid
      node.dataset.blockKey = key;
      // HTML 已在 renderBlocks 出口经过 DOMPurify 净化
      node.innerHTML = html;
      nodes.set(key, node);
      observer?.observe(node);

      while (nodes.size > capacity) {
        const oldest = nodes.keys().next();
        if (oldest.done) break;
        const evicted = nodes.get(oldest.value);
        if (evicted) observer?.unobserve(evicted);
        nodes.delete(oldest.value);
        enhanced.delete(oldest.value);
        // 高度跟着节点一起淘汰：键里含着块的源码文本，留着它等于把整篇文档
        // 又存了一份，而节点都丢了，这个高度也没有下一个消费者
        heights.delete(oldest.value);
      }
      return node;
    },

    markEnhanced(key) {
      enhanced.add(key);
    },

    isEnhanced(key) {
      return enhanced.has(key);
    },

    measuredHeight(key) {
      return heights.get(key) ?? null;
    },

    clear() {
      observer?.disconnect();
      nodes.clear();
      enhanced.clear();
      heights.clear();
    },

    invalidateEnhanced() {
      enhanced.clear();
    },

    get size() {
      return nodes.size;
    },
  };
}
