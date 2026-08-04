import { useEffect, useRef } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { decideRefreshAction } from '@/utils/auto-refresh';
import { probeCurrentFile } from '@/utils/file-open';
import { createLogger } from '@/utils/logger';

const log = createLogger('auto-refresh');

/**
 * 文件自动刷新。
 *
 * File System Access API 没有变更事件，只能轮询。因此这里的每一个决定
 * 都是围绕「把轮询的代价压到最低」展开的：
 *
 * 1. **只读时间戳**：先比对 `lastModified`，没变就完全不读内容；
 * 2. **标签页不可见时暂停**：后台标签页里持续轮询磁盘纯属浪费电，
 *    回到前台时立刻探测一次，用户不会察觉曾经停过；
 * 3. **内容相同则不重渲染**：有些编辑器保存时会更新 mtime 但内容没变
 *    （或只改了行尾），这时重新渲染是纯粹的抖动；
 * 4. **用 setTimeout 链而不是 setInterval**：一次探测如果因为磁盘慢而
 *    耗时超过间隔，setInterval 会把回调堆积起来，setTimeout 链不会。
 */
export function useAutoRefresh(): void {
  const documentId = useDocumentStore((state) => state.document?.id ?? null);
  const source = useDocumentStore((state) => state.document?.source ?? null);
  const enabled = useSettingsStore((state) => state.settings.reading.autoRefresh);
  const interval = useSettingsStore((state) => state.settings.reading.autoRefreshInterval);

  /** 保存最近一次探测的定时器，卸载时清理 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const { setWatchStatus } = useDocumentStore.getState();

    // 只有 File System Access API 打开的文档才拿得到句柄
    if (!enabled || source !== 'fs-handle' || documentId === null) {
      setWatchStatus('inactive');
      return;
    }

    let cancelled = false;

    /** 安排下一次探测 */
    const schedule = (): void => {
      if (cancelled) return;
      timerRef.current = setTimeout(() => void tick(), interval);
    };

    /** 执行一次探测 */
    const tick = async (): Promise<void> => {
      if (cancelled) return;

      // 页面不可见时不做磁盘 IO，等 visibilitychange 把我们叫醒
      if (document.hidden) {
        useDocumentStore.getState().setWatchStatus('paused');
        return;
      }

      const state = useDocumentStore.getState();
      const current = state.document;
      if (!current) return;

      const result = await probeCurrentFile(current.lastModified);
      if (cancelled) return;

      const action = decideRefreshAction(result, current.content);
      switch (action.kind) {
        case 'continue':
          break;

        case 'touch-timestamp':
          log.debug('文件时间戳变化但内容相同，跳过重渲染');
          useDocumentStore.setState({
            document: { ...current, lastModified: action.lastModified },
          });
          break;

        case 'apply':
          log.info('检测到文件变化，已重新加载');
          useDocumentStore.getState().applyRefreshedDocument(action.document);
          break;

        case 'stop':
          useDocumentStore.getState().setWatchStatus('stopped', action.message);
          return;

        case 'deactivate':
          useDocumentStore.getState().setWatchStatus('inactive');
          return;
      }

      useDocumentStore.getState().setWatchStatus('watching');
      schedule();
    };

    /** 标签页回到前台时立刻探测一次，不等下一个轮询周期 */
    const handleVisibility = (): void => {
      if (document.hidden || cancelled) return;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      void tick();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    setWatchStatus('watching');
    schedule();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [documentId, source, enabled, interval]);
}
