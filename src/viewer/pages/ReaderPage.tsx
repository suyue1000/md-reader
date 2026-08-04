import { useCallback, useState } from 'react';
import { AlertCircle, FileText } from 'lucide-react';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { useDocumentStore } from '@/stores/document.store';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useMarkdownRender } from '@/hooks/useMarkdownRender';
import { useOpenFile } from '@/hooks/useOpenFile';
import { usePendingAnchor } from '@/hooks/usePendingAnchor';
import { useReadingPosition } from '@/hooks/useReadingPosition';
import { useRelativeLinks } from '@/hooks/useRelativeLinks';
import { useScrollSpy } from '@/hooks/useScrollSpy';
import { hasFileSystemAccess } from '@/utils/env';

/** 空状态：引导用户打开文件 */
function EmptyState(): React.JSX.Element {
  const { open } = useOpenFile();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <FileText size={40} strokeWidth={1.25} style={{ color: 'var(--app-text-subtle)' }} />
      <div className="space-y-1.5">
        <p className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
          还没有打开文档
        </p>
        <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {hasFileSystemAccess()
            ? '打开一个 Markdown 文件开始阅读，改动会被自动检测并刷新。也可以直接把文件拖进窗口。'
            : '当前环境不支持文件系统访问，将使用文件选择框打开（无法自动刷新）。'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void open()}
        className="rounded-md px-3 py-1.5 text-sm transition-colors duration-[var(--app-duration)]"
        style={{ background: 'var(--app-accent)', color: 'var(--app-accent-contrast)' }}
      >
        打开文件
      </button>
    </div>
  );
}

/** 错误态 */
function ErrorState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <AlertCircle size={32} strokeWidth={1.5} style={{ color: 'var(--app-danger)' }} />
      <p className="max-w-md text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {message}
      </p>
    </div>
  );
}

/**
 * 阅读页。
 *
 * 正文容器的宽度与排版全部由 CSS 变量驱动，改设置不会触发 React 重渲染。
 */
export function ReaderPage(): React.JSX.Element {
  const doc = useDocumentStore((state) => state.document);
  const documentId = useDocumentStore((state) => state.document?.id ?? '');
  const status = useDocumentStore((state) => state.status);
  const storeError = useDocumentStore((state) => state.error);
  const { chunks, sessionKey, complete, error: renderError } = useMarkdownRender();

  /**
   * 内容变化标识。
   *
   * 滚动监听与阅读位置恢复都要在「正文进了 DOM 之后」重新绑定。
   * 用会话号 + 已插入块数，而不是像以前那样直接传整串 HTML——
   * 大文档下那是一个几十 MB 的字符串，作为依赖项传来传去纯属浪费。
   */
  const contentKey = `${sessionKey}:${String(chunks.length)}`;

  /**
   * 阅读位置用的标识，刻意比 contentKey 「迟钝」。
   *
   * 分块渲染期间正文是自上而下长出来的，若每来一块就恢复一次位置，
   * 目标锚点所在的块还没到，就会退化成按比例定位，于是用户眼睁睁看着
   * 页面跳好几次。这里在渲染完成前保持标识不变（只在首块后恢复一次，
   * 作为粗定位），完成时再变一次做精确恢复。
   */
  const readingKey = complete ? `${sessionKey}:complete` : sessionKey;

  /**
   * DOM 增强完成的计数。
   *
   * 阅读位置恢复必须等到 Shiki 上色、Mermaid 出图之后——这些操作会大幅
   * 改变正文高度，在那之前算出来的 offsetTop 都是过期的。
   */
  const [enhancedToken, setEnhancedToken] = useState(0);
  const handleEnhanced = useCallback(() => {
    setEnhancedToken((value) => value + 1);
  }, []);

  // 目录高亮跟随滚动；放在这里是因为它需要 AppShell 提供的滚动容器上下文。
  // 传入 html 是为了让绑定发生在标题真正进入 DOM 之后，详见 useScrollSpy 注释
  useScrollSpy(contentKey);
  useAutoRefresh();
  useReadingPosition({ documentId, contentKey: readingKey, enhancedToken });
  // 放在阅读位置恢复之后：带锚点打开时，锚点说了算
  usePendingAnchor(complete && enhancedToken > 0);
  useRelativeLinks();

  if (status === 'error' && storeError) return <ErrorState message={storeError} />;
  if (!doc) return <EmptyState />;
  if (renderError) return <ErrorState message={`渲染失败：${renderError}`} />;

  return (
    <article
      className="app-article mx-auto px-8 py-10"
      style={{ maxWidth: 'var(--content-max-width)' }}
    >
      <MarkdownView
        chunks={chunks}
        sessionKey={sessionKey}
        baseUrl={doc.baseUrl}
        onEnhanced={handleEnhanced}
      />
    </article>
  );
}
