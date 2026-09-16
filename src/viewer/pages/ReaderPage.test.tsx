import { act, render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollContainerProvider } from '@/components/layout/ScrollContainerContext';
import { EditorViewProvider } from '@/editor/EditorContext';
import type { MarkdownEditorProps } from '@/editor/MarkdownEditor';
import { buildTocTree } from '@/markdown/toc';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { rememberPosition } from '@/utils/reading-position';
import { ReaderPage } from './ReaderPage';

/**
 * 记下 `MarkdownEditor` 每一次拿到的 props。
 *
 * 换掉整个编辑器而不是只看渲染结果：这里要验的是**接线**——ReaderPage 有没有把
 * store 里的 `openEpoch` 交给编辑器。真编辑器要拉起整条 Markdown 管线，跟这个
 * 问题毫无关系，还会把用例拖慢十几秒。
 *
 * `scrollToLine` 也要一并提供：ReaderPage 里那几个定位 hook 从同一个模块 import
 * 它，只 mock 组件会让它们拿到 undefined。
 */
const props: MarkdownEditorProps[] = [];
const scrollToLine = vi.fn();
vi.mock('@/editor/MarkdownEditor', () => ({
  MarkdownEditor: (received: MarkdownEditorProps) => {
    props.push(received);
    return <div data-testid="editor" />;
  },
  scrollToLine: (view: EditorView, line: number): void => {
    scrollToLine(view, line);
  },
}));

const DOC: MarkdownDocument = {
  id: 'file:///tmp/doc.md',
  name: 'doc.md',
  path: '/tmp/doc.md',
  content: '# 甲\n\n正文',
  size: 12,
  lastModified: 0,
  source: 'url',
};

function mount(): void {
  render(
    <EditorViewProvider>
      <ReaderPage />
    </EditorViewProvider>,
  );
}

beforeEach(() => {
  props.length = 0;
  scrollToLine.mockClear();
  useDocumentStore.getState().reset();
});

afterEach(() => {
  useDocumentStore.getState().reset();
});

describe('ReaderPage 与编辑器的接线', () => {
  it('把 store 的 openEpoch 交给编辑器，重开同一篇文档时它必须变', () => {
    /*
     * 回归：这条接线断掉时**没有任何用例会红**，而缺陷「同一会话内用相同内容
     * 重开同一文档、目录永久变空」当场复活——`setDocument` 清空了目录，编辑器
     * 却因为 documentId 和内容都没变而不重建、不重渲染，`onHeadings` 再也不
     * 被调用。`MarkdownEditor` 那边的用例只能证明「给了 openEpoch 就会重建」，
     * 证明不了「ReaderPage 真的给了」。
     */
    mount();

    act(() => {
      useDocumentStore.getState().setDocument(DOC);
    });
    const first = props.at(-1)?.openEpoch;

    // 完全相同的一份文档再打开一次：id 与内容一个字都没变
    act(() => {
      useDocumentStore.getState().setDocument({ ...DOC });
    });
    const second = props.at(-1)?.openEpoch;

    expect(screen.getByTestId('editor')).toBeDefined();
    // 不锁绝对值：`reset()` 同样会自增，序号从第几起算取决于前面发生过什么
    expect(second).toBe(useDocumentStore.getState().openEpoch);
    expect(typeof first).toBe('number');
    expect(Number(second) - Number(first)).toBe(1);
  });

  it('自动刷新换内容不算重新打开，openEpoch 不变', () => {
    // 另一半不变量：文件变化必须走 dispatch 而不是重建，否则撤销栈、滚动位置
    // 与整个块缓存都会被丢掉
    mount();
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
    });
    const before = props.at(-1)?.openEpoch;

    act(() => {
      useDocumentStore.getState().applyRefreshedDocument({ ...DOC, content: '# 甲\n\n改过的正文' });
    });

    expect(props.at(-1)?.openEpoch).toBe(before);
    expect(props.at(-1)?.value).toContain('改过的正文');
  });
});

/**
 * 保存链路的入口在这里：编辑器的每一次 `onChange` 都要变成「最新正文」，
 * 而它同时是自动保存的排期依据、脏状态的判据、以及关页拦截的判据。
 *
 * 这几行同样是零覆盖的重灾区——`useAutoSave` 自己的用例只能证明「给了它
 * 文本它会做对事」，证明不了 `ReaderPage` 真的把编辑器的文本交了上去。
 */
describe('ReaderPage 与保存链路的接线', () => {
  it('编辑器的文本变化会带起脏状态', () => {
    mount();
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
    });
    expect(useDocumentStore.getState().dirty).toBe(false);

    act(() => {
      props.at(-1)?.onChange?.('# 甲\n\n改过的正文');
    });

    // 断掉 onChange 这条线（或不把 text 交给 useAutoSave），这两条一起变红
    expect(useDocumentStore.getState().dirty).toBe(true);
    expect(props.at(-1)?.value).toBe('# 甲\n\n改过的正文');
  });

  it('保存回写 document.content 时，不会把写盘之后新敲的字吞掉', () => {
    /*
     * 保存是异步的：`markSaved` 落地时，用户完全可能已经又敲了几个字。
     * 此时 `document.content` 是**写盘那一刻**的文本，比编辑器里的旧。
     * 若把 `doc.content` 直接当作同步依据灌回编辑器（简报草稿里的写法），
     * 这几个字会当场消失、光标跳走——这正是 `ReaderPage` 里改用
     * openEpoch + lastRefreshedAt 作为「外部内容」标记的理由。
     */
    mount();
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
    });
    act(() => {
      props.at(-1)?.onChange?.('甲乙');
    });
    act(() => {
      useDocumentStore.getState().markSaved('甲', 2000);
    });

    expect(props.at(-1)?.value).toBe('甲乙');
    // 写下去的只是「甲」，编辑器里还多一个「乙」，所以仍然是脏的
    expect(useDocumentStore.getState().dirty).toBe(true);
  });
});

/**
 * 「一轮增强做完了」这个信号有两个消费方，合并发生在 `ReaderPage` 里。
 *
 * 这几行是零覆盖的重灾区：删掉其中任何一行，别处的用例全都照绿——两个 hook
 * 各自的用例只能证明「回调被调用时它做对了事」，证明不了「ReaderPage 真的调了」。
 * 而下面第三条锁的那个危险组合，**只在这段合并代码里成立**：两个消费方同时活着
 * 时才可能出现「一个放弃了、另一个把用户拽走」。
 */
describe('ReaderPage 合并两个 onEnhanced', () => {
  const SAVED_LINE = 42;
  const ANCHOR_LINE = 37;
  const TOC = buildTocTree([
    { id: '开篇', text: '开篇', level: 1, line: 0 },
    { id: '第二节', text: '第二节', level: 2, line: ANCHOR_LINE },
  ]);

  let container: HTMLElement;
  let view: EditorView;

  /** 挂上滚动容器——`useReadingPosition` 拿不到它就整个不动手，用例会假绿 */
  function mountWired(): void {
    container = document.createElement('div');
    document.body.append(container);
    /*
     * 两个被测的 hook 都只把 view 当作 `scrollToLine` 的实参传出去，本来一个
     * `{ dom }` 就够；多出来的那几个成员是给同住一屋的 `useScrollSpy` 的——
     * 目录非空时它会立刻按当前位置算一次高亮，缺了会直接抛。
     * `useEditorView` 按 `dom.isConnected` 判活，所以 dom 必须真的挂在文档上。
     */
    view = {
      dom: container,
      documentTop: 0,
      lineBlockAtHeight: () => ({ from: 0, top: 0 }),
      state: { doc: { lineAt: () => ({ number: 1 }) } },
    } as unknown as EditorView;
    render(
      <ScrollContainerProvider value={container}>
        <EditorViewProvider>
          <ReaderPage />
        </EditorViewProvider>
      </ScrollContainerProvider>,
    );
  }

  /** 走真实路径把编辑器实例交上去：`onViewReady` 就是 ReaderPage 的 setView */
  function handOverView(): void {
    act(() => {
      props.at(-1)?.onViewReady?.(view);
    });
  }

  /** 触发一轮「增强完成」 */
  function enhance(): void {
    act(() => {
      props.at(-1)?.onEnhanced?.();
    });
  }

  afterEach(() => {
    container.remove();
    useDocumentStore.getState().setPendingAnchor(null);
    history.replaceState(null, '', '/viewer.html');
  });

  it('接上了阅读位置那一路：增强完成后校正落点', () => {
    // 删掉 `restoreAfterEnhance()` 这一行，增强改高度带来的偏移就再也不会被纠正，
    // 而不会有任何用例变红
    rememberPosition(
      { documentId: DOC.id, line: SAVED_LINE, offset: 0, updatedAt: Date.now() },
      false,
    );
    mountWired();
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
    });
    handOverView();
    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
    scrollToLine.mockClear();

    enhance();

    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
  });

  it('接上了锚点那一路：增强完成后重新按锚点行号滚一次', () => {
    // 删掉 `reanchorAfterEnhance()`，带锚点打开的落点会永久停在偏浅的位置
    mountWired();
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
      useDocumentStore.getState().setToc(TOC);
      useDocumentStore.getState().setPendingAnchor('第二节');
    });
    handOverView();
    expect(scrollToLine).toHaveBeenCalledWith(view, ANCHOR_LINE);
    scrollToLine.mockClear();

    enhance();

    expect(scrollToLine).toHaveBeenCalledWith(view, ANCHOR_LINE);
  });

  it('带锚点打开之后点目录，增强完成的重跳不能把用户拽回锚点', () => {
    /*
     * 两个消费方同时活着时才会出现的组合，也是「两套撤防判据」留下的最后一处
     * 缺口：`usePendingAnchor` 原本靠「校正前现量一次 scrollTop」判断用户走没走，
     * 而目录点击派发的滚动要等 CodeMirror 的测量周期才落定——校正跑在滚动之前，
     * 量到的还是我们自己写的那个值，于是判定「没走」，把刚点了目录的用户拽回锚点。
     *
     * 上一轮把这个组合放过了，因为实测时是「带锚点打开后**立刻**点目录」，
     * 延迟≈0 落在缺陷窗口（700~1500ms）之外，等于没测到。
     */
    mountWired();
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
      useDocumentStore.getState().setToc(TOC);
      useDocumentStore.getState().setPendingAnchor('第二节');
    });
    handOverView();
    scrollToLine.mockClear();

    // 用户点了目录（这里只关心它记下的那次显式导航，跳到哪儿由 TocPanel 负责）
    act(() => {
      useDocumentStore.getState().markNavigation();
    });
    enhance();
    enhance();

    expect(scrollToLine).not.toHaveBeenCalled();
  });
});
