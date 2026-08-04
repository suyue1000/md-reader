import { useEffect } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { EMBED_FLAG, isLoadMessage, type ViewerMessage } from '@/content/protocol';
import { createLogger } from '@/utils/logger';
import type { MarkdownDocument } from '@/types';

const log = createLogger('embed');

/** 当前页面是否作为宿主页面的嵌入阅读器运行 */
export function isEmbedded(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.parent !== window &&
    new URLSearchParams(window.location.search).get(EMBED_FLAG) === '1'
  );
}

/** 向宿主页面发一条消息 */
function postToHost(message: ViewerMessage): void {
  // 宿主可能是 file:// 页面，其 origin 是 "null"，无法用具体源做校验，
  // 只能用 '*'。这里发出去的内容只有「已就绪」和当前锚点，不含用户数据
  window.parent.postMessage(message, '*');
}

/**
 * 嵌入模式：从宿主页面接收 Markdown 正文。
 *
 * 用户在浏览器里直接打开 `.md` 时，内容脚本会把整页换成一个指向本页的
 * iframe，并把已经渲染成纯文本的源码递过来（见 content/index.ts）。
 * 这样地址栏保持为原始的 `file:///…/xxx.md`，而渲染、设置、目录、导出
 * 全部复用同一套阅读器，没有第二条代码路径。
 *
 * 握手方向是「阅读器先说话」：iframe 何时加载完只有它自己知道，
 * 宿主盲发消息可能发在监听器注册之前。
 */
export function useEmbeddedDocument(): void {
  const setDocument = useDocumentStore((state) => state.setDocument);
  const setPendingAnchor = useDocumentStore((state) => state.setPendingAnchor);

  useEffect(() => {
    if (!isEmbedded()) return;

    const onMessage = (event: MessageEvent): void => {
      // 只接受宿主页面（父窗口）发来的消息
      if (event.source !== window.parent) return;
      if (!isLoadMessage(event.data)) return;

      const message = event.data;
      const doc: MarkdownDocument = {
        // 用地址本身做 id：同一个文件重新打开时，阅读位置才能对上
        id: message.url,
        name: message.name,
        path: decodeURIComponent(message.url),
        content: message.content,
        size: new Blob([message.content]).size,
        // 页面里拿不到文件的 mtime，用当前时刻；这类文档也不参与自动刷新
        lastModified: Date.now(),
        source: 'url',
        baseUrl: message.url,
      };

      log.info('接收到宿主页面的文档', message.name);
      setDocument(doc);

      // 锚点不能立刻跳：目标元素要等渲染完才存在。存下来，
      // 由阅读页在内容就绪后消费（见 stores/document.store.ts 的 pendingAnchor）
      const anchor = message.hash.replace(/^#/, '');
      if (anchor !== '' && !anchor.startsWith('/')) {
        setPendingAnchor(decodeURIComponent(anchor));
      }
    };

    window.addEventListener('message', onMessage);
    postToHost({ type: 'md-reader:ready' });

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [setDocument, setPendingAnchor]);

  // 阅读器内跳转标题后，把锚点回传给宿主，让地址栏与页面保持一致
  useEffect(() => {
    if (!isEmbedded()) return;

    const onHashChange = (): void => {
      const hash = window.location.hash;
      // 路由 hash（以 #/ 开头）是阅读器内部状态，不该出现在宿主地址栏
      if (hash.startsWith('#/')) return;
      postToHost({ type: 'md-reader:hash', hash });
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
}
