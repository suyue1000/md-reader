import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollContainerProvider } from '@/components/layout/ScrollContainerContext';
import { useDocumentStore } from '@/stores/document.store';
import { BackToTop } from './BackToTop';

let container: HTMLElement;
let scrollTo: ReturnType<typeof vi.fn>;

/**
 * 按钮只在滚过阈值之后才出现，而 jsdom 里没有真实布局，`scrollTop` 得自己写。
 * 写完还要派发一次 `scroll`——组件是靠事件而不是轮询判断可见性的，而且它把
 * 判定推到了 rAF 里（滚动一帧可能来好几次事件），所以还得把那一帧推完。
 */
async function mountScrolledDown(): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  render(
    <ScrollContainerProvider value={container}>
      <BackToTop />
    </ScrollContainerProvider>,
  );
  container.scrollTop = 1200;
  await act(async () => {
    container.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

beforeEach(() => {
  useDocumentStore.getState().reset();
  // jsdom 的 Element 没有实现 scrollTo；替身单独留一份引用，
  // 断言直接指着原型方法会被 unbound-method 拦下
  scrollTo = vi.fn();
  // scrollTo 是重载签名，vi.fn() 的类型对不上，这里的转换是必需的
  Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo'];
});

afterEach(() => {
  container.remove();
});

describe('返回顶部', () => {
  it('点击时记一次显式导航', async () => {
    /*
     * 「回到顶部」满足显式导航的三条判定（见 store 的 `navigationEpoch`）：
     * 用户点了按钮、落点由我们指定、视口真的被带走。不记的话，刚恢复过阅读
     * 位置的文档里点它，增强完成后的校正会把用户从顶部拽回上次读到的地方。
     * 平滑滚动确实会派发真实的 `scroll` 事件，但那事件迟于 `onEnhanced`，
     * 指望它撤防来不及——这正是目录点击栽过的那个坑。
     */
    const before = useDocumentStore.getState().navigationEpoch;
    await mountScrolledDown();

    fireEvent.click(screen.getByRole('button', { name: '返回顶部' }));

    expect(useDocumentStore.getState().navigationEpoch).toBe(before + 1);
  });

  it('滚动到顶部这件事本身还是要做', async () => {
    // 反向对照：别让撤防把功能本身挤掉
    await mountScrolledDown();

    fireEvent.click(screen.getByRole('button', { name: '返回顶部' }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
