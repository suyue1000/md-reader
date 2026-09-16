import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/stores/settings.store';
import type { PluginContext } from '@/types';
import { codeBlockPlugin } from './code-block';

/** 第一次用到时要把 Shiki 的语言与主题拉起来 */
const PIPELINE_TIMEOUT = 60_000;

/**
 * 扫多少个微任务刻度。
 *
 * 要命中的窗口只有一个刻度宽：上一轮 `drainLoop` 已经 resolve、它的复位回调
 * 还排在微任务队列里没跑。从「启动上一轮」到「它结束」之间隔了多少个微任务，
 * 取决于 Shiki 那条链上有几个 await，会随实现变。逐格扫过去，总有一格落在窗口里。
 * 24 是实测够用的余量（真正命中的那一格在个位数）。
 */
const TICKS = 24;

/** 永不回调的 IntersectionObserver 替身，还原「不进视口就不上色」 */
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

/** 造一个带一个代码块骨架的根节点，结构与 markdown-it 出口一致 */
function makeRoot(tag: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML =
    '<figure class="code-block" data-lang="js">' +
    '<figcaption class="code-block__bar"><span class="code-block__lang">js</span>' +
    '<span class="code-block__actions"></span></figcaption>' +
    `<pre class="code-block__pre"><code>const ${tag} = 1;</code></pre>` +
    '</figure>';
  document.body.appendChild(root);
  return root;
}

function context(eager: boolean): PluginContext {
  return {
    settings: useSettingsStore.getState().settings,
    requestRerender: () => undefined,
    eager,
  };
}

/** 这一块上完色了没有 */
function isColored(root: HTMLElement): boolean {
  return root.querySelector('.code-block')?.hasAttribute('data-code-theme') === true;
}

describe('代码块上色队列', () => {
  let original: typeof globalThis.IntersectionObserver | undefined;

  beforeEach(() => {
    original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = NeverFiringObserver;
  });

  afterEach(() => {
    if (original) globalThis.IntersectionObserver = original;
    else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    document.body.replaceChildren();
  });

  /**
   * 守的是 `drainQueue` 里那道「在途时先等它结束、再补启一轮」的护栏。
   *
   * 竞态长这样：上一轮 `drainLoop` **刚刚**跑完最后一次 `queue.size > 0` 检查、
   * 正等着自己的复位回调，而这一批块是在那之后才排进队列的。此时若把在途的
   * Promise 直接交出去（`if (draining) return draining`），`await` 会立刻醒来，
   * 而这批块一个都没处理——导出拿到的就是一份没上色的代码，**不报任何错**。
   *
   * 窗口只有一个微任务宽，撞不撞得上全看时序，所以这里逐格扫：
   * 在「启动上一轮」之后的每一个微任务刻度上各插一次 eager 调用，
   * 每一格都必须上完色。撤掉护栏后，其中若干格会红。
   */
  it(
    'eager 调用在任何一个微任务刻度插进来，都必须等到自己那批做完',
    async () => {
      const failed: number[] = [];

      for (let ticks = 0; ticks <= TICKS; ticks++) {
        // 上一轮：非 eager，排好队就走，不等
        const inFlight = makeRoot(`a${String(ticks)}`);
        await codeBlockPlugin.enhance?.(inFlight, context(false));

        // 精确走 ticks 个微任务，把下面这次调用推到不同的时序上
        for (let i = 0; i < ticks; i++) await Promise.resolve();

        // 这一批：eager，落定就必须已经上完色
        const mine = makeRoot(`b${String(ticks)}`);
        await codeBlockPlugin.enhance?.(mine, context(true));

        if (!isColored(mine)) failed.push(ticks);
      }

      expect(failed).toEqual([]);
    },
    PIPELINE_TIMEOUT,
  );

  /**
   * 反向对照，防止上面那条因为「压根没有懒加载」而空绿。
   *
   * 非 eager 的调用返回时**不**该已经上好色——它只负责把块排进队列。
   */
  it(
    '非 eager 的调用不等上色',
    async () => {
      const root = makeRoot('lazy');
      await codeBlockPlugin.enhance?.(root, context(false));
      expect(isColored(root)).toBe(false);

      const deadline = Date.now() + 20_000;
      while (!isColored(root) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      // 队列确实在推进，只是不等它
      expect(isColored(root)).toBe(true);
    },
    PIPELINE_TIMEOUT,
  );
});
