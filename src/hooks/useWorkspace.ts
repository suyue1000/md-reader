import { useCallback } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { scanDirectory } from '@/utils/directory';
import {
  FilePickerCancelled,
  clearHandleRegistry,
  fileToDocument,
  getFileHandleByPath,
  setCurrentFileHandle,
} from '@/utils/file-open';
import {
  clearRootHandle,
  ensureReadPermission,
  loadRootHandle,
  saveRootHandle,
} from '@/utils/handle-store';
import { canUseFilePicker, hasFileSystemAccess } from '@/utils/env';
import { STORAGE_AREAS, STORAGE_KEYS, writeValue } from '@/utils/storage';
import { wellKnownStartIn } from '@/utils/start-in';
import { clearWorkspaceUrls, getWorkspaceUrl, readFileUrl } from '@/utils/file-listing';
import { isEmbedded } from './useEmbeddedDocument';
import { requestHostFile, requestHostFolder } from './useHostWorkspace';
import { createLogger } from '@/utils/logger';

const log = createLogger('workspace');

/** 工作区操作 */
export interface WorkspaceActions {
  /**
   * 弹出选择器打开一个文件夹。
   *
   * @param startIn 选择器的起始位置。传入当前文件的句柄，选择器就会直接
   *   停在它所在的目录上——用户点一下「确定」即可，不必自己翻到那里。
   *   这是能做到的最接近「自动打开上一级目录」的效果：浏览器不允许
   *   在没有用户确认的情况下把一整个目录交给页面。
   */
  openFolder: (startIn?: FileSystemHandle) => Promise<void>;
  /** 打开文件树里的某个文件 */
  openPath: (path: string) => Promise<void>;
  /**
   * 尝试恢复上次打开的文件夹。
   *
   * @param interactive 为 true 时允许弹授权提示（必须在用户手势里调用）
   * @returns 是否成功恢复
   */
  restoreFolder: (interactive?: boolean) => Promise<boolean>;
  /** 关闭当前文件夹 */
  closeFolder: () => void;
}

/**
 * 文件夹的打开与文件树内导航。
 *
 * 从文件树打开文件走的是**已登记的句柄**，因此和「打开文件」一样支持
 * 自动刷新——这一点很重要，否则用户会发现从侧栏点开的文件不会自动更新，
 * 而从工具栏打开的会，行为不一致最让人困惑。
 */
export function useWorkspace(): WorkspaceActions {
  const setScanning = useWorkspaceStore((state) => state.setScanning);
  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace);
  const addRecent = useWorkspaceStore((state) => state.addRecent);

  const setLoading = useDocumentStore((state) => state.setLoading);
  const setDocument = useDocumentStore((state) => state.setDocument);
  const setError = useDocumentStore((state) => state.setError);

  const openPath = useCallback(
    async (path: string) => {
      // 自动列出的目录用地址定位，直接读即可——这是接管页面里的常态
      const url = getWorkspaceUrl(path);
      if (url) {
        try {
          setLoading();
          const content = await readFileUrl(url);
          const name = path.split('/').pop() ?? path;
          setDocument({
            id: url,
            name,
            path,
            content,
            size: new Blob([content]).size,
            lastModified: Date.now(),
            source: 'url',
            baseUrl: url,
          });
          addRecent({ id: url, name, path, openedAt: Date.now() });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setError(`打开 ${path} 失败：${message}`);
        }
        return;
      }

      // 嵌入模式下句柄在宿主那边，读文件也得请它代劳
      if (isEmbedded()) {
        setLoading();
        requestHostFile(path);
        return;
      }

      const handle = getFileHandleByPath(path);
      if (!handle) {
        setError(`文件 ${path} 已不在工作区里，请重新打开文件夹。`);
        return;
      }

      try {
        setLoading();
        const file = await handle.getFile();
        // 登记为当前句柄，自动刷新才能接管
        setCurrentFileHandle(handle);
        const doc = await fileToDocument(file, 'fs-handle', path);
        setDocument(doc);
        addRecent({ id: doc.id, name: doc.name, path: doc.path, openedAt: Date.now() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('打开文件失败', error);
        setError(`打开 ${path} 失败：${message}`);
      }
    },
    [setLoading, setDocument, setError, addRecent],
  );

  /** 扫描一个目录句柄并填充工作区 */
  const scanInto = useCallback(
    async (root: FileSystemDirectoryHandle) => {
      try {
        setScanning(true);
        const result = await scanDirectory(root);
        setWorkspace({
          rootName: result.root.name,
          tree: result.root.children ?? [],
          fileCount: result.fileCount,
          truncated: result.truncated,
          paths: result.paths,
        });
        log.info(`已扫描 ${String(result.fileCount)} 个 Markdown 文件`);
        return true;
      } catch (error) {
        if (error instanceof FilePickerCancelled) return false;
        const message = error instanceof Error ? error.message : String(error);
        log.error('扫描文件夹失败', error);
        setScanning(false);
        setError(`扫描文件夹失败：${message}`);
        return false;
      }
    },
    [setScanning, setWorkspace, setError],
  );

  const openFolder = useCallback(
    async (startIn?: FileSystemHandle) => {
      if (!hasFileSystemAccess() || typeof showDirectoryPicker !== 'function') {
        setError('当前浏览器不支持打开文件夹，请改用「打开文件」。');
        return;
      }

      /**
       * 接管页面里的阅读器是嵌在 file:// 页面中的跨源 iframe，
       * 浏览器一律禁止这种 iframe 弹出文件选择器。改由宿主页面（顶层帧）
       * 代劳：它没有这条限制，而用户在 iframe 里的点击会把短暂用户激活
       * 一并传播给祖先帧，所以那边仍握着有效手势。详见 useHostWorkspace。
       */
      if (isEmbedded()) {
        setScanning(true);
        requestHostFolder();
        return;
      }

      if (!canUseFilePicker()) {
        setError('当前环境不允许弹出文件选择器，请在独立的阅读器标签页中打开文件夹。');
        return;
      }

      // 有当前文件的句柄就让选择器停在它旁边；没有句柄（拖拽打开的）就退而求其次，
      // 从路径认出所属的知名目录，至少落在正确的那一支上
      const fallbackStartIn = wellKnownStartIn(
        useDocumentStore.getState().document?.path ?? '',
      );
      const start = startIn ?? fallbackStartIn;

      let root: FileSystemDirectoryHandle;
      try {
        root = await showDirectoryPicker({
          id: 'md-reader-folder',
          mode: 'read',
          ...(start ? { startIn: start } : {}),
        });
      } catch (error) {
        // AbortError 是用户主动取消，不是故障
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : String(error);
        setError(`打开文件夹失败：${message}`);
        return;
      }

      // 记住它：下次（包括在别的 .md 页面里）就不必再选一遍
      await saveRootHandle(root);
      await scanInto(root);
      // 告诉其它扩展页面：工作区变了，去恢复一下
      await writeValue(STORAGE_AREAS.workspaceSignal, STORAGE_KEYS.workspaceSignal, Date.now());
    },
    [scanInto, setError, setScanning],
  );

  /**
   * 恢复上次打开的文件夹。
   *
   * 这是「自动加载目录」得以成立的关键：浏览器不允许页面在没有用户确认的
   * 情况下拿到一个目录，但**用户确认过的目录可以被记住**。于是代价只有
   * 第一次的一次点击，之后每次打开该目录下的任何 .md 都会自动带出文件树。
   */
  const restoreFolder = useCallback(
    async (interactive = false) => {
      if (!hasFileSystemAccess()) return false;

      const root = await loadRootHandle();
      if (!root) return false;

      const outcome = await ensureReadPermission(root, interactive);
      if (outcome !== 'granted') {
        // 权限被彻底拒绝就别再留着这个句柄，否则每次启动都白试一次
        if (outcome === 'denied') await clearRootHandle();
        return false;
      }

      return scanInto(root);
    },
    [scanInto],
  );

  const closeFolder = useCallback(() => {
    clearHandleRegistry();
    clearWorkspaceUrls();
    clearWorkspace();
    void clearRootHandle();
  }, [clearWorkspace]);

  return { openFolder, openPath, restoreFolder, closeFolder };
}
