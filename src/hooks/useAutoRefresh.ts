import { useEffect, useRef } from 'react';
import { decideRefresh } from '@/editor/conflict';
import { useEditorView } from '@/editor/EditorContext';
import { isSelfWrite } from '@/editor/self-write';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
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
 *
 * 第五点是编辑能力带来的：**磁盘变了但编辑器里也有未保存改动**时不能再
 * 无脑覆盖——那是用户正在写的东西，`decideRefresh`（`src/editor/conflict.ts`）
 * 把这种情况判成 `conflict`，这里转交给 `document.store` 的 `conflict` 字段，
 * 交由 UI（`ConflictBanner`）弹条让用户决断，同时暂停轮询：决断没做完之前
 * 每 1.5 秒弹一次同样的提示只会更慌，也不该在用户看着提示条的时候又偷偷
 * 判一次「这回又冲突了」。
 */
export function useAutoRefresh(): void {
  const documentId = useDocumentStore((state) => state.document?.id ?? null);
  const source = useDocumentStore((state) => state.document?.source ?? null);
  const hasConflict = useDocumentStore((state) => state.conflict !== null);
  const enabled = useSettingsStore((state) => state.settings.reading.autoRefresh);
  const interval = useSettingsStore((state) => state.settings.reading.autoRefreshInterval);
  /**
   * 编辑器里当前的活文本，用来判断「本地是否有未保存改动」（见下面 tick
   * 里的 `editorText`）。阅读态下编辑器内容恒等于 `document.content`
   * （`MarkdownEditor` 会把外部变化原样灌进去），因此冲突只可能在编辑态下
   * 被判定出来。
   *
   * 用 ref 存而不是直接在 tick 里闭包引用 `view`：`view` 变化（重开同一篇
   * 文档、documentId 不变但 openEpoch 变）不在下面 effect 的依赖数组里，
   * 直接闭包会让 tick 一直用着重建之前那个已销毁的旧实例。写在 effect 里
   * 同步，是因为渲染期间改 ref 是 React 明令禁止的（同一约束见
   * `MarkdownEditor` 的 `readOnlyRef`）。
   */
  const view = useEditorView();
  const viewRef = useRef<typeof view>(null);
  useEffect(() => {
    viewRef.current = view;
  });

  /** 保存最近一次探测的定时器，卸载时清理 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const { setWatchStatus } = useDocumentStore.getState();

    // 只有 File System Access API 打开的文档才拿得到句柄
    if (!enabled || source !== 'fs-handle' || documentId === null) {
      setWatchStatus('inactive');
      return;
    }

    // 冲突等待用户决断期间完全不轮询；决断一结束（conflict 被清空）
    // 这个 effect 会因为依赖变化重新跑一遍，从头安排下一次探测
    if (hasConflict) return;

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

      // 编辑态下用 CodeMirror 里的活文本；拿不到 view（阅读态、或还没就绪）
      // 时退回 store 里的内容——阅读态下两者本来就应该相等
      const editorText = viewRef.current?.state.doc.toString() ?? current.content;
      const decision = decideRefresh(result, {
        editorText,
        savedContent: current.content,
        isSelfWrite,
      });

      switch (decision.kind) {
        case 'continue':
          break;

        case 'touch-timestamp':
          log.debug('文件时间戳变化但内容相同（或是我们自己写的），跳过重渲染');
          /*
           * 这里**故意**只裸改时间戳，不走 `applyRefreshedDocument`——别把它
           * 「整理」成复用那个 action。
           *
           * 那个 action 会推进 `lastRefreshedAt`，而 `ReaderPage` 拿
           * (openEpoch, lastRefreshedAt) 当作「这份内容是外部给的」的标记，
           * 一变就用 `document.content` 覆盖编辑器里的文本。而
           * touch-timestamp 恰恰发生在「内容其实没变 / 是我们自己刚写的」时，
           * 此刻编辑器里很可能**正有未保存的改动**——复用那个 action 会把它们
           * 静默冲掉，而且没有任何提示、版本缓冲里也不会留下副本。
           */
          useDocumentStore.setState({
            document: { ...current, lastModified: decision.lastModified },
          });
          break;

        case 'adopt':
          log.info('检测到文件变化，已重新加载');
          useDocumentStore.getState().applyRefreshedDocument(decision.document);
          break;

        case 'conflict':
          // 冲突要用户决断，在此期间停止轮询——见上面 hasConflict 的说明
          log.info('检测到文件变化，但本地有未保存改动，等待用户决断');
          useDocumentStore.getState().setConflict(decision.document);
          return;

        case 'stop':
          useDocumentStore.getState().setWatchStatus('stopped', decision.message);
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
  }, [documentId, source, enabled, interval, hasConflict]);
}
