import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider, useSetEditorView } from '@/editor/EditorContext';
import { buildTocTree } from '@/markdown/toc';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { TocPanel } from './TocPanel';

/** 只替换 scrollToLine：跳没跳、跳到第几行，是目录点击的全部可观察行为 */
const scrollToLine = vi.fn();
vi.mock('@/editor/MarkdownEditor', () => ({
  scrollToLine: (view: EditorView, line: number): void => {
    scrollToLine(view, line);
  },
}));

const TOC = buildTocTree([
  { id: '开篇', text: '开篇', level: 1, line: 0 },
  { id: '第二节', text: '第二节', level: 2, line: 37 },
]);

let host: HTMLElement;
let view: EditorView;

/**
 * 把编辑器实例交给 provider。
 *
 * `EditorViewProvider` 自己拿 state，外部只能经 `useSetEditorView` 写入——
 * 这正是真实的 `ReaderPage` 走的路，测试跟着走同一条。
 */
function Harness(): React.JSX.Element {
  const setView = useSetEditorView();
  useEffect(() => {
    setView(view);
  }, [setView]);
  return <TocPanel />;
}

function mount(): void {
  render(
    <EditorViewProvider>
      <Harness />
    </EditorViewProvider>,
  );
}

beforeEach(() => {
  scrollToLine.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  /*
   * `useEditorView` 用 `dom.isConnected` 判活，所以这个替身的 dom 必须真的
   * 挂在文档上，否则 view 会被当成已销毁的实例过滤掉。
   */
  view = { dom: host } as unknown as EditorView;

  // 目录跟随高亮那个 effect 会调 scrollIntoView，jsdom 没有实现
  Element.prototype.scrollIntoView = vi.fn();

  const doc: MarkdownDocument = {
    id: 'doc',
    name: 'doc.md',
    path: '/doc.md',
    content: '',
    size: 0,
    lastModified: 0,
    source: 'url',
  };
  useDocumentStore.getState().reset();
  useDocumentStore.getState().setDocument(doc);
  useDocumentStore.getState().setToc(TOC);
  history.replaceState(null, '', '/viewer.html');
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/viewer.html');
});

describe('目录点击跳转', () => {
  it('按行号滚过去并立刻点亮该项', () => {
    mount();

    screen.getByText('第二节').click();

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
    expect(useDocumentStore.getState().activeHeadingId).toBe('第二节');
  });

  it('跳完之后地址栏 hash 反映当前位置', () => {
    /*
     * 目录点击改成 `scrollToLine` 之后就不再经过浏览器的原生片段导航，
     * 地址栏因此停在原处——用户跳到某一节再把地址分享出去，对方会落在
     * 文档开头，与「地址栏保持 file:// 且可分享」这条设计直接冲突。
     */
    mount();

    screen.getByText('第二节').click();

    expect(decodeURIComponent(window.location.hash)).toBe('#第二节');
  });

  it('编辑器还没就绪时不写地址栏', () => {
    // 没滚动就写 hash，等于给出一个跳不到的链接
    view = { dom: document.createElement('div') } as unknown as EditorView;
    mount();

    screen.getByText('第二节').click();

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('跳转同时记一次显式导航', () => {
    /*
     * 目录点击是程序化滚动，`useReadingPosition` 的「用户滚过了吗」判据认不出
     * 它，于是恢复过阅读位置之后的第一次点击会被增强后的校正拽回去、纹丝不动。
     * 撤防的信号只能由这里发出——面板挂在侧栏，与阅读页是兄弟子树，传不了回调。
     */
    const before = useDocumentStore.getState().navigationEpoch;
    mount();

    screen.getByText('第二节').click();

    expect(useDocumentStore.getState().navigationEpoch).toBe(before + 1);
  });

  it('编辑器还没就绪时不记导航', () => {
    // 这一次点击什么都没跳，撤防会白白吃掉一次本该发生的阅读位置恢复
    view = { dom: document.createElement('div') } as unknown as EditorView;
    const before = useDocumentStore.getState().navigationEpoch;
    mount();

    screen.getByText('第二节').click();

    expect(useDocumentStore.getState().navigationEpoch).toBe(before);
  });
});
