import { useCallback, useState } from 'react';
import { AlertCircle, FileText } from 'lucide-react';
import { useEditorView, useSetEditorView } from '@/editor/EditorContext';
import { MarkdownEditor } from '@/editor/MarkdownEditor';
import { buildTocTree, type FlatHeading } from '@/markdown/toc';
import { useDocumentStore } from '@/stores/document.store';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useApplyDefaultMode } from '@/hooks/useEditMode';
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
  /*
   * 「第几次打开」。documentId 认不出「同一篇文档又打开了一次」，而
   * `setDocument` 每次都会把目录清空、等编辑器重新送一份上来——只传
   * documentId 的话，用完全相同的内容重开同一篇文档时编辑器不会重建、
   * 也不会重渲染，目录就永久空着了。理由详见 `MarkdownEditor` 的 openEpoch。
   */
  const openEpoch = useDocumentStore((state) => state.openEpoch);
  /** 自动刷新每采用一次外部内容就会更新它，见下面 `externalMark` */
  const lastRefreshedAt = useDocumentStore((state) => state.lastRefreshedAt);
  const status = useDocumentStore((state) => state.status);
  /** 阅读态 = 编辑器的只读状态，两者共用同一个实例，见 `MarkdownEditor` */
  const mode = useDocumentStore((state) => state.mode);
  const storeError = useDocumentStore((state) => state.error);
  const setToc = useDocumentStore((state) => state.setToc);

  /**
   * 正文编辑器实例。
   *
   * 存在 `EditorViewProvider` 里而不是本组件的 state：侧栏的目录面板也要
   * 对同一个 view 下跳转指令，而侧栏是 AppShell 里的兄弟子树，从这里传不
   * 过去。本组件是它的生产者（`onViewReady`）兼消费者之一。
   */
  const view = useEditorView();
  const setView = useSetEditorView();

  /**
   * 编辑器里的最新正文。
   *
   * 用 state 而不是 ref：它现在有了真实的消费方（`useAutoSave` 要按它排自动
   * 保存、算脏状态），而 hook 只能吃到渲染出来的值。代价是每敲一个字符多一次
   * 本组件的重渲染——`MarkdownEditor` 收到的 `value` 此刻与编辑器内部文档
   * 完全相同，它那个灌内容的 effect 会当场短路返回，不会产生任何 dispatch，
   * 光标与选区因此不受影响。
   */
  const [text, setText] = useState(doc?.content ?? '');

  /**
   * 「这份内容是外部给的」的标记：换了一次打开（openEpoch），或自动刷新采用
   * 了一份新的磁盘内容（lastRefreshedAt）。只有它变化时才把 store 里的内容
   * 灌回编辑器。
   *
   * 关键是**不能**直接拿 `doc.content` 当同步依据：保存成功后 `markSaved`
   * 也会改它（改成刚写下去的那份文本）。用户在写盘那几十毫秒里又敲了几个
   * 字的话，按内容同步会把编辑器倒回写盘那一刻的文本——刚敲的字当场消失、
   * 光标跳走。这两个标记都不会被 `markSaved` 碰到，正好把「外部来的内容」
   * 与「我们自己刚存的内容」分开。
   *
   * 在渲染期调整 state 而不是放进 effect：放 effect 里的话，`setDocument`
   * 之后的那一次提交里，子组件 `MarkdownEditor` 会先拿着**上一篇文档**的
   * 文本重建一遍编辑器（子组件的 effect 跑在父组件之前），闪一眼旧内容，
   * 撤销栈里还会留下一次莫名其妙的整篇替换。这是 React 官方推荐的「随
   * props 变化重置 state」写法，仓库里 `FileTreePanel` 用的是同一招。
   */
  const externalMark = `${String(openEpoch)}:${String(lastRefreshedAt)}`;
  const [syncedMark, setSyncedMark] = useState(externalMark);
  if (syncedMark !== externalMark) {
    setSyncedMark(externalMark);
    setText(doc?.content ?? '');
  }

  // 自动保存、脏状态与关页拦截。挂在这里是因为本组件只有一份实例——
  // 多一份就会多一个防抖定时器对同一份文本再存一次盘（见 useAutoSave）
  useAutoSave(text);

  /** 编辑器每渲染完一轮块就把带行号的标题送过来，折叠成树写进 store */
  const handleHeadings = useCallback(
    (headings: readonly FlatHeading[]) => {
      setToc(buildTocTree(headings));
    },
    [setToc],
  );

  // 目录高亮跟随滚动；放在这里是因为它需要 AppShell 提供的滚动容器上下文
  useScrollSpy(view);
  useAutoRefresh();
  // 按设置进入编辑态；挂在这里是因为本组件只有一份实例（理由见 useApplyDefaultMode）
  useApplyDefaultMode();
  const { onEnhanced: restoreAfterEnhance } = useReadingPosition({ documentId, view });
  // 放在阅读位置恢复之后：带锚点打开时，锚点说了算
  const { onEnhanced: reanchorAfterEnhance } = usePendingAnchor(view);
  useRelativeLinks(view);

  /**
   * 「一轮增强做完了」这个信号有两个消费方，在这里合并。
   *
   * 两者在同一篇文档上是互斥的：带锚点打开时阅读位置恢复被
   * `useReadingPosition` 的闩锁整个挡住（不恢复，也不校正），没有锚点时
   * `usePendingAnchor` 手里没有行号，什么都不做。
   *
   * 顺序仍然按「锚点在后」排，与上面 hook 的调用顺序保持一致：万一将来哪次
   * 改动让闩锁漏了一次，后跑的锚点校正还能把落点纠回来，而不是反过来。
   */
  const handleEnhanced = useCallback(() => {
    restoreAfterEnhance();
    reanchorAfterEnhance();
  }, [restoreAfterEnhance, reanchorAfterEnhance]);

  if (status === 'error' && storeError) return <ErrorState message={storeError} />;
  if (!doc) return <EmptyState />;

  return (
    // 版心与内边距由 editorTheme 的 .cm-content 负责，这里再套一层会叠加两层版心
    <article className="app-article">
      <MarkdownEditor
        value={text}
        documentId={doc.id}
        openEpoch={openEpoch}
        baseUrl={doc.baseUrl}
        readOnly={mode === 'read'}
        onChange={setText}
        onHeadings={handleHeadings}
        onViewReady={setView}
        onEnhanced={handleEnhanced}
      />
    </article>
  );
}
