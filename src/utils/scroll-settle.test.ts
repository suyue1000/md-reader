import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterScrollSettles } from './scroll-settle';

/** 手动推进的 rAF：逐帧断言才谈得上「第几帧落定」 */
let queue: FrameRequestCallback[];

function frame(): void {
  const pending = queue;
  queue = [];
  for (const callback of pending) callback(performance.now());
}

beforeEach(() => {
  queue = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('afterScrollSettles', () => {
  it('滚动隔了两帧才发生时，等到它发生并停住才回调', () => {
    /*
     * 这正是带代码块的文档实测到的形态：CodeMirror 先按估算高度挪视口、
     * 量真实高度、再修一轮，前两帧 scrollTop 一动不动。只等一帧的话记下的是
     * 滚动**前**的值，之后的校正会把自己判成「用户滚走了」而永久撤防。
     */
    const values = [0, 0, 5656, 5656, 5656];
    let index = 0;
    const done = vi.fn();
    afterScrollSettles(() => values[Math.min(index, values.length - 1)] ?? 0, done);

    for (let i = 0; i < 4; i++) {
      index++;
      frame();
    }

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(5656);
  });

  it('一帧就落定时不白等', () => {
    const values = [0, 4082, 4082];
    let index = 0;
    const done = vi.fn();
    afterScrollSettles(() => values[Math.min(index, values.length - 1)] ?? 0, done);

    index++;
    frame();
    expect(done).not.toHaveBeenCalled();
    index++;
    frame();
    expect(done).toHaveBeenCalledWith(4082);
  });

  it('位置压根没变时靠帧数上限收尾，而不是一直等下去', () => {
    // 目标恰好就在视口顶部：值一次都不会变，没有上限就永远不回调
    const done = vi.fn();
    afterScrollSettles(() => 120, done, 3);

    frame();
    frame();
    frame();
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(120);
  });

  it('取消之后不再回调', () => {
    const done = vi.fn();
    const cancel = afterScrollSettles(() => 1, done, 2);
    cancel();
    frame();
    frame();
    frame();
    expect(done).not.toHaveBeenCalled();
  });

  it('落定后只回调一次，之后的帧不再触发', () => {
    const values = [0, 300, 300, 900];
    let index = 0;
    const done = vi.fn();
    afterScrollSettles(() => values[Math.min(index, values.length - 1)] ?? 0, done);

    for (let i = 0; i < 4; i++) {
      index++;
      frame();
    }

    expect(done).toHaveBeenCalledTimes(1);
  });
});
