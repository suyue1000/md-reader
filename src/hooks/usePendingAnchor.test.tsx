import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollContainerProvider } from '@/components/layout/ScrollContainerContext';
import { buildTocTree } from '@/markdown/toc';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { usePendingAnchor } from './usePendingAnchor';

/** 只替换 scrollToLine：跳没跳、跳到第几行，是这个 hook 的全部可观察行为 */
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

function doc(id: string): MarkdownDocument {
  return {
    id,
    name: `${id}.md`,
    path: `/${id}.md`,
    content: '',
    size: 0,
    lastModified: 0,
    source: 'url',
  };
}

let container: HTMLElement;
let view: EditorView | null;

/** hook 返回的增强回调：用例靠它模拟「一轮增强结束」 */
let onEnhanced: (() => void) | null = null;

function Probe(): null {
  const value = usePendingAnchor(view).onEnhanced;
  // 渲染期给外部变量赋值是副作用（react-hooks/globals），挪进 effect 里捎给用例
  useEffect(() => {
    onEnhanced = value;
  });
  return null;
}

/** 挂载被测 hook；`ScrollContainerProvider` 提供它撤防时要量的滚动容器 */
function mount(): { rerender: () => void } {
  const tree = (): React.JSX.Element => (
    <ScrollContainerProvider value={container}>
      <Probe />
    </ScrollContainerProvider>
  );
  const { rerender } = render(tree());
  return { rerender: () => rerender(tree()) };
}

/** 触发一轮「增强完成」——对应 `MarkdownEditor` 的 onEnhanced 调用点 */
function enhance(): void {
  act(() => {
    onEnhanced?.();
  });
}

/**
 * 把落点测量推到落定。
 *
 * hook 用 `afterScrollSettles` 逐帧观察 `scrollTop` 才记下
 * `expectedScrollTop`，而这里的 `scrollToLine` 是替身、根本不会真的滚动，
 * 值一次都不变，于是要跑满上限 8 帧才收尾。只推一帧的话 `expectedScrollTop`
 * 还是 null，撤防的值比对判据会被整条跳过——用户滚走了也照样把他拽回锚点。
 */
const SETTLE_FRAMES = 10;

async function nextFrame(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < SETTLE_FRAMES; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  });
}

beforeEach(() => {
  scrollToLine.mockClear();

  container = document.createElement('div');
  document.body.append(container);
  // hook 只把 view 当作 scrollToLine 的实参传出去，这里不需要真的编辑器
  view = { dom: container } as unknown as EditorView;
  useDocumentStore.getState().reset();
  useDocumentStore.getState().setPendingAnchor(null);
});

afterEach(() => {
  container.remove();
  useDocumentStore.getState().setPendingAnchor(null);
});

describe('usePendingAnchor', () => {
  it('目录到齐后按行号跳转，并把锚点清掉', () => {
    useDocumentStore.getState().setToc(TOC);
    useDocumentStore.getState().setPendingAnchor('第二节');

    mount();

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
    expect(useDocumentStore.getState().pendingAnchor).toBeNull();
  });

  it('目录还没到齐时什么都不做，尤其不能把锚点清掉', () => {
    /*
     * 缺陷 C 的守卫。换文档那一轮提交里目录已被清空、而 view 还指着上一篇
     * 文档的实例；此时若按「查不到就算跳过了」处理，锚点会在新文档还没渲染
     * 出来之前就被吃掉，表现是带锚点换文档永远停在顶部。
     */
    useDocumentStore.getState().setPendingAnchor('第二节');

    mount();

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().pendingAnchor).toBe('第二节');
  });

  it('目录随后到齐时补上这次跳转', () => {
    // 承接上一条：不清掉，是为了留到目录到齐后还能兑现
    useDocumentStore.getState().setPendingAnchor('第二节');
    mount();
    expect(scrollToLine).not.toHaveBeenCalled();

    act(() => {
      useDocumentStore.getState().setToc(TOC);
    });

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
    expect(useDocumentStore.getState().pendingAnchor).toBeNull();
  });

  it('编辑器未就绪时不动手', () => {
    view = null;
    useDocumentStore.getState().setToc(TOC);
    useDocumentStore.getState().setPendingAnchor('第二节');

    mount();

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().pendingAnchor).toBe('第二节');
  });

  it('锚点指向不存在的标题时清掉，不滚动', () => {
    // 留着会让之后每一轮块渲染都白试一遍
    useDocumentStore.getState().setToc(TOC);
    useDocumentStore.getState().setPendingAnchor('这个标题不存在');

    mount();

    expect(scrollToLine).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().pendingAnchor).toBeNull();
  });
});

describe('setDocument 与待跳转锚点', () => {
  it('换文档时清掉上一篇没能消费的锚点', () => {
    /*
     * 「目录为空就不消费」留下的唯一残留：一篇没有任何标题的文档，锚点会
     * 一直挂着。不在换文档时清掉的话，它会在下一篇文档上被莫名其妙地兑现。
     */
    useDocumentStore.getState().setPendingAnchor('上一篇的锚点');
    useDocumentStore.getState().setDocument(doc('下一篇'));

    expect(useDocumentStore.getState().pendingAnchor).toBeNull();
  });

  it('带锚点打开的正常时序（先 setDocument 再 setPendingAnchor）不受影响', () => {
    // useEmbeddedDocument 就是这个顺序，本次的锚点必须活下来
    useDocumentStore.getState().setDocument(doc('某篇'));
    useDocumentStore.getState().setPendingAnchor('某个标题');

    expect(useDocumentStore.getState().pendingAnchor).toBe('某个标题');
  });
});

describe('增强完成后的落点校正', () => {
  /** 带锚点打开一篇文档，并把首次跳转的落点量下来 */
  async function openWithAnchor(): Promise<void> {
    useDocumentStore.getState().setDocument(doc('带锚点的文档'));
    useDocumentStore.getState().setToc(TOC);
    useDocumentStore.getState().setPendingAnchor('第二节');
    mount();
    await nextFrame();
    scrollToLine.mockClear();
  }

  it('增强完成后重新按锚点行号滚一次', async () => {
    /*
     * 缺口二。锚点跳转发生在 Shiki 上色 / Mermaid 出图**之前**，上方内容
     * 随后被撑高，落点因此偏浅——实测同一目标，带锚点打开停在 scrollTop 5191
     * （标题距容器顶 10.4px、侧栏高亮错一节），内容全部增强后走目录点击是
     * 5199 / 6.8px。补这一次校正就是为了让两条路径落到同一处。
     *
     * 注意断言的是「又按同一个行号滚了一次」，不是「恢复了阅读位置」——
     * 后者正是 useReadingPosition 的闩锁要挡住的事。
     */
    await openWithAnchor();

    enhance();

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
  });

  it('增强分好几轮结束时，每一轮都校正', async () => {
    // Shiki 与 Mermaid 不在同一轮落定，视口变化还会再引发几轮
    await openWithAnchor();

    enhance();
    await nextFrame();
    enhance();

    expect(scrollToLine).toHaveBeenCalledTimes(2);
    expect(scrollToLine).toHaveBeenLastCalledWith(view, 37);
  });

  it('没有锚点打开的文档，增强完成后一动不动', async () => {
    /*
     * 反向对照。这条不成立的话，校正就变成了「所有文档都会在增强结束时被
     * 拽到某一行」——比缺口二本身严重得多。
     */
    useDocumentStore.getState().setDocument(doc('普通文档'));
    useDocumentStore.getState().setToc(TOC);
    mount();
    await nextFrame();

    enhance();

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('用户已经自己滚走之后，不再把他拽回锚点', async () => {
    /*
     * `onEnhanced` 在每次视口变化之后都会触发，而用户滚动本身就会改变视口。
     * 不撤防的话，用户每滚一下都被弹回锚点，文档等于滚不动了。
     */
    await openWithAnchor();

    container.scrollTop = 1200;
    enhance();

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('撤防之后不再恢复：滚回原处也不会又被校正一次', async () => {
    await openWithAnchor();

    container.scrollTop = 1200;
    enhance();
    container.scrollTop = 0;
    enhance();

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('锚点指向不存在的标题时，增强完成后也不跳', async () => {
    // 没跳成就没有落点，校正无处可校——尤其不能退回文档顶部
    useDocumentStore.getState().setDocument(doc('锚点写错的文档'));
    useDocumentStore.getState().setToc(TOC);
    useDocumentStore.getState().setPendingAnchor('这个标题不存在');
    mount();
    await nextFrame();

    enhance();

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('用户点了目录之后，不再把他拽回锚点', async () => {
    /*
     * 「用户已经自己滚走」那条判据**认不出**目录点击：它派发的滚动要等
     * CodeMirror 的测量周期才落定，而 `onEnhanced` 只隔一个微任务就到，
     * 此刻 `scrollTop` 还是我们自己写的那个值，值比对当场判定「没走」，
     * 于是这一次重跳把刚点了目录的用户拽回锚点。
     *
     * 这里刻意**不动** `container.scrollTop`，复刻的正是那个「还没滚起来」
     * 的瞬间——动了就退化成上面那条用户滚动的用例，测不到这个缺口。
     */
    await openWithAnchor();

    act(() => {
      useDocumentStore.getState().markNavigation();
    });
    enhance();
    enhance();

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('上一次打开里点过目录，不影响这一次打开的锚点', async () => {
    // 撤防必须按打开序号复位，否则用户点过一次目录之后，带锚点打开就永久失效
    act(() => {
      useDocumentStore.getState().markNavigation();
    });

    await openWithAnchor();
    enhance();

    expect(scrollToLine).toHaveBeenCalledWith(view, 37);
  });

  it('换文档之后，上一篇的锚点不会在新文档上被兑现', async () => {
    /*
     * 校正记的是行号，而行号只在它所属的那篇文档里有意义。不撤防的话，
     * 切到一篇不带锚点的文档，它的第一次增强完成就会把用户拽到上一篇的
     * 锚点行号上去。
     */
    await openWithAnchor();

    act(() => {
      useDocumentStore.getState().setDocument(doc('另一篇'));
    });
    enhance();

    expect(scrollToLine).not.toHaveBeenCalled();
  });
});
