import { describe, expect, it, vi } from 'vitest';
import { clamp, debounce, deepMerge, throttle } from './fn';

describe('deepMerge', () => {
  it('用 patch 覆盖 base 的同名字段', () => {
    const base = { a: 1, nested: { x: 1, y: 2 } };
    const result = deepMerge(base, { nested: { y: 9 } });
    expect(result).toEqual({ a: 1, nested: { x: 1, y: 9 } });
  });

  it('忽略 patch 中值为 undefined 的字段', () => {
    const result = deepMerge({ a: 1 }, { a: undefined });
    expect(result).toEqual({ a: 1 });
  });

  it('数组整体替换而不是逐项合并', () => {
    const result = deepMerge({ list: [1, 2, 3] }, { list: [9] });
    expect(result).toEqual({ list: [9] });
  });

  it('base 中不存在的字段会被补充进来', () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe('debounce', () => {
  it('只在最后一次调用后触发一次', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced(1);
    debounced(2);
    debounced(3);
    vi.advanceTimersByTime(99);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });

  it('cancel 后不再触发', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('flush 立即执行挂起的调用', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);
    debounced('x');
    debounced.flush();
    expect(spy).toHaveBeenCalledWith('x');
    vi.useRealTimers();
  });
});

describe('throttle', () => {
  it('首次调用立即执行', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const throttled = throttle(spy, 100);
    throttled(1);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('clamp', () => {
  it('把数值裁剪到区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
