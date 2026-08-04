/**
 * 主线程让步。
 *
 * 分块渲染的价值全在这一个函数上：块与块之间把主线程交还给浏览器，
 * 让它有机会处理输入、滚动和绘制。不让步的话分块只是把一次长任务
 * 拆成了连续的几段长任务，用户感受不到任何差别。
 */

/**
 * 把控制权交还主线程，在下一个任务中继续。
 *
 * 用 `MessageChannel` 而**不是** `scheduler.yield()`，尽管后者更新更专用。
 * 原因是二者的排队语义不同：`scheduler.yield()` 的续体带有高优先级，
 * 会插到已排队的普通任务**前面**——而 React 的渲染提交正是通过
 * MessageChannel 排的普通任务。实测下来的后果是分块循环一路插队跑完，
 * React 才第一次提交，于是所有块在最后一起出现：分块照做了，
 * 首屏却从 655ms 退化到 1728ms，等于白做。
 *
 * MessageChannel 与 React 用的是同一种任务队列，先进先出，
 * 每让步一次 React 就能提交一块，正文才是真的自上而下长出来。
 *
 * 也刻意不用 `requestAnimationFrame` / `requestIdleCallback` / `setTimeout`：
 * 前两者在标签页不可见时根本不触发，后台打开的文档会永远停在第一块；
 * `setTimeout` 则会被后台节流到秒级（实测 20 次让步耗时 12.5 秒）。
 */
export function yieldToMain(): Promise<void> {
  if (typeof MessageChannel !== 'function') {
    // 只在没有 MessageChannel 的环境（如部分测试运行器）才退到定时器
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}
