import { useCallback } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider, useSetEditorView } from '@/editor/EditorContext';
import { MarkdownEditor } from '@/editor/MarkdownEditor';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { useAutoSave } from './useAutoSave';
import { useExport } from './useExport';

/**
 * 真编辑器 + 真渲染管线的就绪上限。
 *
 * 这里不用替身，因为本文件要验的恰恰是「导出与块 widget 的关系」：
 * 屏幕上**每个块各带一个 `.markdown-body`**，旧实现取第一个就只拿到开头一段。
 * 替身里没有块，这个缺陷复现不出来。
 */
const READY_TIMEOUT = 30_000;

/** 三段独立的段落 = 三个块 widget，各有一句可识别的正文 */
const SOURCE = ['第一段在开头。', '第二段在中间。', '第三段在结尾。'].join('\n\n');

const DOC: MarkdownDocument = {
  id: 'file:///tmp/export.md',
  name: 'export.md',
  path: '/tmp/export.md',
  content: SOURCE,
  size: SOURCE.length,
  lastModified: 0,
  source: 'url',
};

/** 走 `<a download>` 退路时被交给 URL.createObjectURL 的 Blob */
let savedBlobs: Blob[] = [];
/** 当前的编辑器实例，供用例直接改文本 */
let view: EditorView | null = null;

function Host(): React.JSX.Element {
  const setView = useSetEditorView();
  const handleReady = useCallback(
    (ready: EditorView | null) => {
      view = ready;
      setView(ready);
    },
    [setView],
  );
  return <MarkdownEditor value={SOURCE} documentId={DOC.id} readOnly onViewReady={handleReady} />;
}

function Probe(): React.JSX.Element {
  const { exportAs } = useExport();
  return (
    <div>
      <button type="button" data-testid="html" onClick={() => void exportAs('html')} />
      <button type="button" data-testid="markdown" onClick={() => void exportAs('markdown')} />
      <button type="button" data-testid="pdf" onClick={() => void exportAs('pdf')} />
    </div>
  );
}

function mount(): void {
  render(
    <EditorViewProvider>
      <Host />
      <Probe />
    </EditorViewProvider>,
  );
}

/** 等到三个块都渲染出来（首轮块渲染完成、view 已交给 provider） */
async function waitForBlocks(): Promise<void> {
  await waitFor(
    () => {
      expect(document.querySelectorAll('.cm-md-block').length).toBe(3);
    },
    { timeout: READY_TIMEOUT },
  );
}

/** 点一下某个导出按钮，并等产物落袋 */
async function clickExport(testId: string): Promise<void> {
  await act(async () => {
    screen.getByTestId(testId).click();
  });
  await waitFor(() => {
    expect(savedBlobs.length).toBeGreaterThan(0);
  }, { timeout: READY_TIMEOUT });
}

describe('导出', () => {
  beforeEach(() => {
    savedBlobs = [];
    view = null;
    useDocumentStore.getState().setDocument(DOC);
    URL.createObjectURL = vi.fn((blob: Blob) => {
      savedBlobs.push(blob);
      return 'blob:stub';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    useDocumentStore.getState().reset();
    vi.restoreAllMocks();
  });

  /**
   * 这一条守的是任务的核心。
   *
   * 撤销 `useExport` 里的离屏渲染（改回让 `exportHtml` 自己
   * `document.querySelector('.markdown-body')`），产物里只会剩第一段——
   * 因为编辑器里每个块 widget 都带这个类名，选择器只取得到第一个。
   */
  it('HTML 产物包含整篇文档，而不是屏幕上的第一块', async () => {
    mount();
    await waitForBlocks();
    // 前提：屏幕上确实有不止一个 `.markdown-body`，缺陷才成立
    expect(document.querySelectorAll('.markdown-body').length).toBeGreaterThan(1);

    await clickExport('html');

    const html = await (savedBlobs[0] as Blob).text();
    expect(html).toContain('第一段在开头');
    expect(html).toContain('第二段在中间');
    expect(html).toContain('第三段在结尾');
  });

  /**
   * 导出不再依赖「页面上已经有渲染好的正文」。
   *
   * 旧实现在编辑器还没挂上时会直接返回「正文尚未渲染完成」；大文档没滚到底
   * 就导出还会静默缺内容。离屏渲染把这个前提整个去掉了。
   */
  it('编辑器没有挂载时也能导出全文', async () => {
    render(
      <EditorViewProvider>
        <Probe />
      </EditorViewProvider>,
    );
    expect(document.querySelectorAll('.markdown-body')).toHaveLength(0);

    await clickExport('html');

    const html = await (savedBlobs[0] as Blob).text();
    expect(html).toContain('第一段在开头');
    expect(html).toContain('第三段在结尾');
  });

  /** store 里的 `document.content` 是「上次灌进编辑器的那份」，可能已经过期 */
  it('导出 Markdown 拿的是编辑器当前文本，不是 store 里的副本', async () => {
    mount();
    await waitForBlocks();

    act(() => {
      view?.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: '编辑器里改过的新文本' },
      });
    });
    // 前提：store 那份确实还是旧的
    expect(useDocumentStore.getState().document?.content).toBe(SOURCE);

    await clickExport('markdown');

    expect(await (savedBlobs[0] as Blob).text()).toBe('编辑器里改过的新文本\n');
  });

  it('打印把完整正文挂进 #print-root', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mount();
    await waitForBlocks();

    await act(async () => {
      screen.getByTestId('pdf').click();
    });
    await waitFor(
      () => {
        expect(print).toHaveBeenCalled();
      },
      { timeout: READY_TIMEOUT },
    );

    const root = document.getElementById('print-root');
    expect(root?.textContent).toContain('第一段在开头');
    expect(root?.textContent).toContain('第三段在结尾');
    window.dispatchEvent(new Event('afterprint'));
  });

  /**
   * 快捷键发起的导出/打印**拿不到编辑器实例**。
   *
   * `useExport` 经 `useToolbarActions` 有两份实例：工具栏那份在
   * `EditorViewProvider` 里（view 拿得到），而 `useGlobalHotkeys` 那份在
   * `App` 的组件体里、provider 之外（view 恒为 null）。少了模块级草稿这一级
   * 回退，从快捷键走的导出与打印会退到 `doc.content`——上次落盘的内容。
   *
   * 打印那一条是本轮**新放开** `mod+p` 的 `allowInInput` 之后才可达的：
   * 编辑态下焦点就在正文里，⌘P 会静默印出一份不含刚写内容的文档。
   */
  describe('拿不到编辑器实例时（快捷键那一路）', () => {
    /** 只负责把「编辑器里的活文本」登记进模块级草稿，不提供 view */
    function DraftHost({ text }: { text: string }): React.JSX.Element {
      useAutoSave(text);
      return <div />;
    }

    function mountWithoutView(text: string): void {
      render(
        <EditorViewProvider>
          <DraftHost text={text} />
          <Probe />
        </EditorViewProvider>,
      );
    }

    it('导出拿的是编辑器里的活文本，不是 store 里的旧副本', async () => {
      mountWithoutView('编辑器里正在写的内容');
      // 前提：store 那份确实还是旧的，且没有任何编辑器实例可用
      expect(useDocumentStore.getState().document?.content).toBe(SOURCE);
      expect(document.querySelectorAll('.cm-content')).toHaveLength(0);

      await clickExport('markdown');

      expect(await (savedBlobs[0] as Blob).text()).toBe('编辑器里正在写的内容\n');
    });

    it('打印也一样：纸上必须有刚写的内容（⌘P 在编辑态最常见的那条路）', async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      mountWithoutView('刚写下的这一句必须印在纸上');

      await act(() => {
        screen.getByTestId('pdf').click();
        return Promise.resolve();
      });
      await waitFor(
        () => {
          expect(print).toHaveBeenCalled();
        },
        { timeout: READY_TIMEOUT },
      );

      const root = document.getElementById('print-root');
      expect(root?.textContent).toContain('刚写下的这一句必须印在纸上');
      // 旧内容不该出现在纸上——它已经被用户改掉了
      expect(root?.textContent).not.toContain('第一段在开头');
      window.dispatchEvent(new Event('afterprint'));
    });
  });

  /** 离屏那棵树是用完即弃的，留在文档里会和屏幕上的正文抢锚点 id */
  it('导出结束后离屏节点不留在文档里', async () => {
    mount();
    await waitForBlocks();
    await clickExport('html');

    await waitFor(() => {
      expect(document.querySelectorAll('.markdown-body').length).toBe(3);
    });
  });
});
