import { useEffect, useRef } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import {
  parentDirUrl,
  scanFileUrlDirectory,
  setWorkspaceUrls,
} from '@/utils/file-listing';
import { createLogger } from '@/utils/logger';

const log = createLogger('local-directory');

/**
 * 自动列出当前文档所在的目录。
 *
 * 只对从 `file://` 打开的文档生效——也就是「在浏览器里直接打开 .md」
 * 被接管的那条路径。此时扩展凭 `file:///*` 主机权限就能直接读取目录，
 * 不需要文件选择器、不需要句柄、不需要用户点任何东西，刷新页面也照样可用。
 *
 * 这解决了文件选择器那条路上两个绕不过去的限制：
 * `startIn` 不接受任意路径（第一次永远落不到目标目录），
 * 以及句柄无法在 `file://` 页面里持久化（每次刷新都要重选）。
 *
 * 读不到（用户没开「允许访问文件网址」，或浏览器不给目录列表）时安静放弃，
 * 界面回到「打开文件夹」的引导，仍可手动选择。
 */
export function useLocalDirectory(): void {
  const baseUrl = useDocumentStore((state) => state.document?.baseUrl ?? '');
  const setScanning = useWorkspaceStore((state) => state.setScanning);
  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);

  /** 已经扫过的目录，避免同一目录下换文档时重复扫描 */
  const scannedRef = useRef('');

  useEffect(() => {
    if (!baseUrl.startsWith('file://')) return;

    const dirUrl = parentDirUrl(baseUrl);
    if (scannedRef.current === dirUrl) return;
    scannedRef.current = dirUrl;

    let cancelled = false;
    void (async () => {
      setScanning(true);
      try {
        const result = await scanFileUrlDirectory(dirUrl);
        if (cancelled) return;

        if (result.fileCount === 0) {
          // 一个 Markdown 都没扫到，多半是没有读取权限，别摆一棵空树
          setScanning(false);
          log.info('目录里没有可显示的 Markdown 文件，或没有读取权限');
          return;
        }

        setWorkspaceUrls(result.urls);
        setWorkspace({
          rootName: result.rootName,
          tree: result.tree,
          fileCount: result.fileCount,
          truncated: result.truncated,
          // 这条路径靠地址而不是句柄定位，路径集合仍要进 store 供 UI 判断可用性
          paths: [...result.urls.keys()],
        });
        log.info(`已自动列出 ${result.rootName}（${String(result.fileCount)} 个文档）`);
      } catch (error) {
        if (cancelled) return;
        setScanning(false);
        // 失败是预期内的（没开文件访问权限），不打扰用户，界面回到手动引导
        log.warn('自动列出目录失败，回退到手动选择', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseUrl, setScanning, setWorkspace]);
}
