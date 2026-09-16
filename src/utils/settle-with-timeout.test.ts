import { describe, expect, it, vi } from 'vitest';
import { settleWithTimeout } from './settle-with-timeout';

describe('settleWithTimeout', () => {
  it('全部任务在超时前完成时，不必等到超时就返回', async () => {
    const task = Promise.resolve('ok');
    const result = settleWithTimeout([task], 5000);
    await expect(result).resolves.toBeUndefined();
  });

  it('某个任务失败（reject）时，仍然当作「已落定」处理，不会让调用方看到 rejection', async () => {
    const rejected = Promise.reject(new Error('增强失败'));
    // 提前挂一个空 catch，避免这个测试里出现未处理 rejection 的告警——
    // 真正要验证的是 settleWithTimeout 本身能扛住失败,而不是这里泄漏
    rejected.catch(() => undefined);
    await expect(settleWithTimeout([rejected], 5000)).resolves.toBeUndefined();
  });

  it('某个任务永远不 resolve 也不 reject 时，超过时限后仍会返回——这是保险丝要保证的行为', async () => {
    vi.useFakeTimers();
    try {
      const hung = new Promise<void>(() => {
        // 故意什么都不做：模拟一个异常挂起、永远不结束的增强器
      });

      const result = settleWithTimeout([hung], 1000);
      const spy = vi.fn();
      void result.then(spy);

      // 时限之前：保险丝不该提前触发
      await vi.advanceTimersByTimeAsync(999);
      expect(spy).not.toHaveBeenCalled();

      // 越过时限：保险丝生效，即使那个任务依然挂起
      await vi.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
