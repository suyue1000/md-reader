import { act, render, screen, waitFor } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorViewProvider, useSetEditorView } from '@/editor/EditorContext';
import { MarkdownEditor } from '@/editor/MarkdownEditor';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { useSearch } from './useSearch';

/**
 * 等待渲染管线就绪的上限。
 *
 * 这里用的是**真的编辑器**，挂载后要动态 import 整条 Markdown 管线并注册全部
 * 内置插件。不换成替身，是因为本文件要验的恰恰是「查找与块 widget 的关系」：
 * 命中数要跨越视口外的块，高亮要落在**每一个**挂载的块上，而替身里根本没有块。
 */
const READY_TIMEOUT = 15_000;

/** 三段独立的段落 = 三个块，每段各含一处「命中」 */
const SOURCE = ['第一段有一处命中。', '第二段也有一处命中。', '第三段同样有一处命中。'].join(
  '\n\n',
);

const DOC: MarkdownDocument = {
  id: 'file:///tmp/search.md',
  name: 'search.md',
  path: '/tmp/search.md',
  content: SOURCE,
  size: SOURCE.length,
  lastModified: 0,
  source: 'url',
};

/** Highlight API 的替身：jsdom 没有它，而「有没有画上高亮」正是本文件的重点 */
class HighlightStub {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

/** 当前画在屏幕上的全部 Range（全部命中层 + 当前命中层） */
function paintedRanges(): Range[] {
  const registry = CSS.highlights as unknown as Map<string, HighlightStub>;
  return [
    ...(registry.get('md-search')?.ranges ?? []),
    ...(registry.get('md-search-current')?.ranges ?? []),
  ];
}

/** 当前画在屏幕上的高亮数 */
function paintedCount(): number {
  return paintedRanges().length;
}

/** 高亮里有几条还指着仍然挂在文档上的节点——「死 Range」画了也看不见 */
function liveCount(): number {
  return paintedRanges().filter((range) => range.startContainer.isConnected).length;
}

function Probe(): React.JSX.Element {
  const { setQuery, total, current, go } = useSearch();
  return (
    <div>
      <button type="button" data-testid="search" onClick={() => setQuery('命中')} />
      <button
        type="button"
        data-testid="next"
        onClick={() => {
          go(1);
        }}
      />
      <button
        type="button"
        data-testid="prev"
        onClick={() => {
          go(-1);
        }}
      />
      <span data-testid="total">{total}</span>
      <span data-testid="current">{current}</span>
    </div>
  );
}

/** 用例要直接往文档里派发改动，因此除了交给 provider 还自己留一份实例 */
let view: EditorView | null = null;

/** 把真编辑器造出的 view 交给 provider，与 `ReaderPage` 的接法一致 */
function Host(): React.JSX.Element {
  const setView = useSetEditorView();
  return (
    <MarkdownEditor
      value={SOURCE}
      documentId={DOC.id}
      readOnly
      onViewReady={(instance) => {
        view = instance;
        setView(instance);
      }}
    />
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

beforeEach(() => {
  useDocumentStore.getState().reset();
  useDocumentStore.getState().setDocument(DOC);

  (CSS as unknown as { highlights: Map<string, HighlightStub> }).highlights = new Map();
  (globalThis as unknown as { Highlight: typeof HighlightStub }).Highlight = HighlightStub;

  /*
   * jsdom 没有布局，所有 rect 都是 0，「命中在不在视口里」这个判断因此永远
   * 落在「在视口里」那一边，跳转分支一次也进不去。这里把 Range 的量测顶掉，
   * 让它报告「命中在视口上方」——这正是需要滚过去的那种情形。
   */
  Range.prototype.getBoundingClientRect = () =>
    ({ top: -400, bottom: -380 }) as unknown as DOMRect;
});

afterEach(() => {
  view = null;
  useDocumentStore.getState().reset();
  delete (CSS as unknown as { highlights?: unknown }).highlights;
  delete (globalThis as unknown as { Highlight?: unknown }).Highlight;
});

describe('正文查找', () => {
  it('命中数按整篇源文本算，不止第一块', async () => {
    /*
     * 回归：旧实现用 `document.querySelector('.markdown-body')` 取正文，而**每个
     * 块 widget 都带这个类名**，于是只搜到了第一块。这条用例在那种实现下只会数到 1。
     */
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('3'), {
      timeout: READY_TIMEOUT,
    });
  });

  it('每一处命中都被画上高亮，而不是只有第一块', async () => {
    /*
     * 硬要求：删掉自研的 DOM 高亮之后，高亮得有人负责。`@codemirror/search` 的
     * 高亮全是 `Decoration.mark`，而实时预览把源码整段换成了块 widget，那套装饰
     * 一个像素都看不见——所以由 `block-highlight.ts` 自己画。这条用例锁住
     * 「画了、而且每一块都画了」。
     */
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    await waitFor(() => expect(paintedCount()).toBe(3), { timeout: READY_TIMEOUT });
  });

  it('块内容被换掉之后重画：旧 Range 不留，新命中补上', async () => {
    /*
     * 锁住**重画机制**本身（`useSearch` 里那个 MutationObserver）。
     *
     * 这是 `block-highlight.ts` 存在的全部理由：块 widget 只在视口附近存在，滚动
     * 会不断挂上新块、销毁旧块，而 Shiki 上色 / Mermaid 出图会把块内的 DOM **整段
     * 换掉**——两种情况都让上一批 Range 指向已经脱离文档的文本节点。只画一次的
     * 实现在这里不会报任何错：高亮对象还在、数量还对，只是全部画在死节点上，
     * 屏幕上一片空白。「滚一屏高亮就断了」正是这个形状。
     *
     * 这里模拟的是增强那一路（直接换掉一块的 innerHTML），因为它与滚动挂载走的是
     * 同一条代码路径——DOM 变了 -> observer -> rAF -> 重画——而且不会和 CodeMirror
     * 自己的 DOMObserver 打架：Shiki / Mermaid 在生产里做的就是这件事。
     */
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    await waitFor(() => expect(paintedCount()).toBe(3), { timeout: READY_TIMEOUT });

    const blocks = document.querySelectorAll<HTMLElement>('.cm-md-block');
    const target = blocks[blocks.length - 1];
    expect(target).toBeDefined();

    // 换掉这一块的内容，并让它比原先多出一处命中
    target!.innerHTML = '<p>第三段同样有一处命中，这里再补一处命中。</p>';

    // 重画之后：多出来的那一处被补上
    await waitFor(() => expect(paintedCount()).toBe(4), { timeout: 5000 });

    /*
     * 光看数量还不够——停掉重画时数量会**停在 3**，但更要命的是那 3 条里有一条
     * 已经废了：被换掉的文本节点一旦离开文档，DOM Range 会自动塌缩到它的父元素上，
     * `isConnected` 仍然为真、`size` 仍然算数，只有 `toString()` 会变成空串。
     * 所以判据落在「每一条 Range 圈住的确实还是那个关键词」上。
     */
    expect(liveCount()).toBe(4);
    expect(paintedRanges().map((range) => range.toString())).toEqual([
      '命中',
      '命中',
      '命中',
      '命中',
    ]);
  });

  it('新长出来的块也会被补画', async () => {
    /*
     * 滚动那一路：CodeMirror 为视口里新出现的块建 widget，节点是**新**加进
     * `contentDOM` 的。停掉重画的话它永远不会被画上——用户往下滚，高亮就停在
     * 打开查找时的那一屏。
     *
     * 这里让 CodeMirror **自己**长出那个块（往文档末尾插一段，编辑器防抖后重渲染
     * 并挂上新 widget），而不是手工往 `.cm-content` 里塞一个 div：塞进去的外来节点
     * 会被 CodeMirror 自己的 DOMObserver 当成意外改动而触发一次重排，在 jsdom 里
     * 直接撞上没实现的 `Range.getClientRects`。
     */
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    await waitFor(() => expect(paintedCount()).toBe(3), { timeout: READY_TIMEOUT });

    expect(view).not.toBeNull();
    act(() => {
      view!.dispatch({
        changes: { from: view!.state.doc.length, insert: '\n\n第四段新长出来，也有一处命中。' },
      });
    });

    await waitFor(() => expect(document.querySelectorAll('.cm-md-block').length).toBe(4), {
      timeout: READY_TIMEOUT,
    });
    await waitFor(() => expect(paintedCount()).toBe(4), { timeout: 5000 });
  });

  it('跳到命中处时记一次显式导航', async () => {
    /*
     * 跳到搜索命中满足显式导航的三条判定（见 store 的 `navigationEpoch`）：
     * 起因是用户输入或按上一处/下一处，落点由我们算，视口真的被带走。
     * 不记的话，刚恢复过阅读位置的文档里搜第一个词，增强完成后的校正会把
     * 用户从命中处拽回上次读到的地方。`scrollIntoView` 最终会派发真实的
     * `scroll` 事件，但那事件排在 `onEnhanced` 后面，指望它撤防来不及——
     * 与目录点击栽过的是同一个坑。
     */
    const before = useDocumentStore.getState().navigationEpoch;
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    await waitFor(
      () => expect(useDocumentStore.getState().navigationEpoch).toBe(before + 1),
      { timeout: READY_TIMEOUT },
    );
  });

  it('按下一处再记一次导航', async () => {
    // 每一次真的跳转都要撤防一次，不是只有第一次
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('3'), {
      timeout: READY_TIMEOUT,
    });

    const before = useDocumentStore.getState().navigationEpoch;
    screen.getByTestId('next').click();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('1'), {
      timeout: READY_TIMEOUT,
    });
    expect(useDocumentStore.getState().navigationEpoch).toBe(before + 1);
  });

  it('命中已经在视口里时不记导航', async () => {
    // 没真的滚就不该撤防，否则会白白吃掉一次本该发生的阅读位置恢复
    Range.prototype.getBoundingClientRect = () => ({ top: 10, bottom: 30 }) as unknown as DOMRect;
    const before = useDocumentStore.getState().navigationEpoch;
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    // 等搜索真的跑完（命中数出来了），否则「没记导航」可能只是还没开始搜
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('3'), {
      timeout: READY_TIMEOUT,
    });
    expect(useDocumentStore.getState().navigationEpoch).toBe(before);
  });

  it('上一处 / 下一处到头绕回', async () => {
    mount();
    await waitForBlocks();

    screen.getByTestId('search').click();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('0'), {
      timeout: READY_TIMEOUT,
    });

    screen.getByTestId('prev').click();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('2'));
    screen.getByTestId('next').click();
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('0'));
  });
});
