import { useCallback, useEffect } from 'react';
import { useUiStore } from '@/stores/ui.store';
import { createLogger } from '@/utils/logger';

const log = createLogger('fullscreen');

/**
 * 全屏状态与切换（无副作用）。
 *
 * 与 `useFullscreenSync` 拆开的理由同 `useThemeMode`：读接口会被多处调用，
 * 副作用只应注册一次。
 */
export function useFullscreen(): { fullscreen: boolean; toggle: () => void } {
  const fullscreen = useUiStore((state) => state.fullscreen);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch((error: unknown) => {
        log.warn('退出全屏失败', error);
      });
      return;
    }
    void document.documentElement.requestFullscreen().catch((error: unknown) => {
      // 没有用户手势或被策略禁止时会拒绝，属于预期内的失败
      log.warn('进入全屏失败', error);
    });
  }, []);

  return { fullscreen, toggle };
}

/**
 * 把浏览器的全屏状态同步进 store。**整个应用只应调用一次**。
 *
 * 状态以浏览器为准而不是以 store 为准：用户可以用 Esc 或系统手势退出全屏，
 * 这些路径不会经过我们的按钮。只监听 `fullscreenchange` 能保证界面显示的
 * 状态与实际状态永远一致。
 */
export function useFullscreenSync(): void {
  const setFullscreen = useUiStore((state) => state.setFullscreen);

  useEffect(() => {
    const sync = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    // 初次挂载时对齐一次，避免刷新后状态错位
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [setFullscreen]);
}
