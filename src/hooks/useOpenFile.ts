import { useCallback } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { FilePickerCancelled, openMarkdownFile, reloadCurrentFile } from '@/utils/file-open';
import { createLogger } from '@/utils/logger';
import { confirmDiscardUnsaved } from './useAutoSave';

const log = createLogger('use-open-file');

/** 打开 / 重载文件的动作集合 */
export interface OpenFileActions {
  /** 弹出选择器打开一个 Markdown 文件 */
  open: () => Promise<void>;
  /** 重新读取当前文件（手动刷新） */
  reload: () => Promise<void>;
}

/**
 * 文件打开与刷新。
 *
 * 把「用户取消」与「真的出错」区分开：取消是正常操作，不该在界面上
 * 留下一个红色错误；只有读取失败才写进 document store 的 error。
 */
export function useOpenFile(): OpenFileActions {
  const setLoading = useDocumentStore((state) => state.setLoading);
  const setDocument = useDocumentStore((state) => state.setDocument);
  const setError = useDocumentStore((state) => state.setError);
  const addRecent = useWorkspaceStore((state) => state.addRecent);
  const addAvailablePath = useWorkspaceStore((state) => state.addAvailablePath);

  const open = useCallback(async () => {
    // 打开新文件会顶掉当前这份；有未保存改动时先问一句，见 confirmDiscardUnsaved
    if (!confirmDiscardUnsaved()) return;

    try {
      setLoading();
      const doc = await openMarkdownFile();
      setDocument(doc);
      addRecent({ id: doc.id, name: doc.name, path: doc.path, openedAt: Date.now() });
      // 只有拿到句柄的才登记为「可再次打开」——input 兜底打开的没有句柄，
      // 记进去只会在历史列表里留下一条点不开的条目
      if (doc.source === 'fs-handle') addAvailablePath(doc.path);
    } catch (error) {
      if (error instanceof FilePickerCancelled) {
        // 用户取消：恢复到打开前的状态即可
        useDocumentStore.setState((state) => ({
          status: state.document ? 'ready' : 'idle',
        }));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      log.error('打开文件失败', error);
      setError(`打开文件失败：${message}`);
    }
  }, [setLoading, setDocument, setError, addRecent, addAvailablePath]);

  const reload = useCallback(async () => {
    try {
      const doc = await reloadCurrentFile();
      if (!doc) {
        setError('该文件是通过文件选择框打开的，无法自动重新读取，请重新打开。');
        return;
      }
      setDocument(doc);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('重新读取失败', error);
      setError(`重新读取失败：${message}`);
    }
  }, [setDocument, setError]);

  return { open, reload };
}
