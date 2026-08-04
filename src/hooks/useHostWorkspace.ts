import { useEffect } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useUiStore } from '@/stores/ui.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { isHostMessage, type ViewerMessage } from '@/content/protocol';
import { createLogger } from '@/utils/logger';
import type { FileTreeNode, MarkdownDocument } from '@/types';
import { isEmbedded } from './useEmbeddedDocument';

const log = createLogger('host-workspace');

/**
 * 由宿主页面代持的工作区。
 *
 * 接管页面里的阅读器是嵌在 `file://` 页面中的跨源 iframe，浏览器禁止它
 * 弹出任何文件选择器。宿主页面是顶层帧，没有这条限制——于是选目录、
 * 扫描、读文件全部交给宿主的内容脚本，这边只收纯数据。
 *
 * 为什么不把目录句柄传过来：文件系统权限按源授予，句柄跨到
 * `chrome-extension://` 就成了一个没有权限的对象，需要重新授权，
 * 而这一侧恰恰弹不出授权框。让数据过界、句柄留在原地，才是走得通的那条路。
 */
export function useHostWorkspace(): void {
  const setScanning = useWorkspaceStore((state) => state.setScanning);
  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);
  const addRecent = useWorkspaceStore((state) => state.addRecent);
  const setDocument = useDocumentStore((state) => state.setDocument);
  const setError = useDocumentStore((state) => state.setError);
  const showNotice = useUiStore((state) => state.showNotice);

  useEffect(() => {
    if (!isEmbedded()) return;

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent) return;
      if (!isHostMessage(event.data)) return;
      const message = event.data;

      switch (message.type) {
        case 'md-reader:folder': {
          setWorkspace({
            rootName: message.rootName,
            tree: message.tree as FileTreeNode[],
            fileCount: message.fileCount,
            truncated: message.truncated,
            paths: message.paths,
          });
          log.info(`宿主返回工作区：${message.rootName}（${String(message.fileCount)} 个文档）`);
          return;
        }

        case 'md-reader:folder-error': {
          setScanning(false);
          // 用户自己点的取消不是错误，不弹提示
          if (!message.cancelled) showNotice(`打开文件夹失败：${message.message}`, 'error');
          return;
        }

        case 'md-reader:file': {
          const doc: MarkdownDocument = {
            id: message.path,
            name: message.name,
            path: message.path,
            content: message.content,
            size: message.size,
            lastModified: message.lastModified,
            // 句柄在宿主那边，这一侧拿不到，因此不参与自动刷新
            source: 'url',
          };
          setDocument(doc);
          addRecent({ id: doc.id, name: doc.name, path: doc.path, openedAt: Date.now() });
          return;
        }

        case 'md-reader:file-error': {
          setError(`打开 ${message.path} 失败：${message.message}`);
          return;
        }

        default:
          return;
      }
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [setWorkspace, setScanning, setDocument, setError, addRecent, showNotice]);

}

/**
 * 请宿主弹出目录选择器。
 *
 * 必须在用户点击的调用栈里同步发出：短暂用户激活会传播给祖先帧，
 * 但它只维持数秒，中间插入 await 就可能错过。
 */
export function requestHostFolder(): void {
  const message: ViewerMessage = { type: 'md-reader:pick-folder' };
  // 宿主可能是 file:// 页面（origin 为 "null"），无法用具体源校验
  window.parent.postMessage(message, '*');
}

/** 请宿主读取工作区里的某个文件 */
export function requestHostFile(path: string): void {
  const message: ViewerMessage = { type: 'md-reader:read-file', path };
  window.parent.postMessage(message, '*');
}
