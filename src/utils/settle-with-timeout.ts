/**
 * 等一批任务全部“落定”（无论成功还是失败），但不超过给定时限。
 *
 * 用 `Promise.allSettled` 而不是 `Promise.all`：调用方要的是“这批都有了
 * 结果”这个时机信号，某个任务失败不该让整个信号跟着 reject 掉——那样
 * 反而会把信号从「迟到」变成「永远拿不到」，比超时本身还糟。
 *
 * 超时分支是一根**保险丝**，不是性能开关：正常情况下所有任务会在超时前
 * 结束，超时只在某个任务异常挂起（既不 resolve 也不 reject）时才会真正
 * 生效。调小它不会让什么东西「更快」，只会让保险丝更容易在正常任务还没
 * 跑完时就误触发。
 */
export function settleWithTimeout(tasks: readonly Promise<unknown>[], timeoutMs: number): Promise<void> {
  const allSettled = Promise.allSettled(tasks).then(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
  return Promise.race([allSettled, timeout]);
}
