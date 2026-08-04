import { useCallback, useSyncExternalStore } from 'react';

/**
 * 订阅一条 CSS 媒体查询。
 *
 * 用 `useSyncExternalStore` 而不是 useState + useEffect：媒体查询本就是
 * 外部状态源，这个 API 就是为它设计的——没有「先渲染错误值再用 effect 纠正」
 * 的中间态，服务端/测试环境也有明确的兜底值。
 *
 * 相比 ResizeObserver 测量元素宽度，媒体查询是声明式的、事件驱动的，
 * 不需要读取布局，也不会在观察器未投递时静默失效。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => matchMedia(query).matches, [query]);

  // 第三个参数是非浏览器环境（单测）的兜底值
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
