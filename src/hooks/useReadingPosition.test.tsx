import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollContainerProvider } from '@/components/layout/ScrollContainerContext';
import { useDocumentStore } from '@/stores/document.store';
import { rememberPosition } from '@/utils/reading-position';
import { useReadingPosition, type UseReadingPositionResult } from './useReadingPosition';

/*
 * 只替换 `scrollToLine`：恢复位置这条路径上，「有没有把用户拽走」完全等价于
 * 「有没有调它」。起一个真实的 EditorView 需要完整布局，在 jsdom 里量不出
 * 任何东西，反而会把断言埋进一堆与本用例无关的测量代码里。
 */
const scrollToLine = vi.fn();
vi.mock('@/editor/MarkdownEditor', () => ({
  scrollToLine: (view: EditorView, line: number): void => {
    scrollToLine(view, line);
  },
}));

const DOC_ID = 'doc:已经读过的文档';
/** 上次读到的行，用来和锚点行区分开 */
const SAVED_LINE = 42;

let container: HTMLElement;
let view: EditorView;
let result: UseReadingPositionResult;

/** `view` 可由用例覆盖：有一组用例要先给已销毁的实例、再换成活的 */
function Probe({ view: override }: { view?: EditorView }): React.JSX.Element {
  const value = useReadingPosition({ documentId: DOC_ID, view: override ?? view });
  // 渲染期给外部变量赋值是副作用（react-hooks/globals），挪进 effect 里捎给用例
  useEffect(() => {
    result = value;
  });
  // 增强完成的信号只有 MarkdownEditor 知道，用例靠点这个按钮来模拟它
  return (
    <button
      type="button"
      data-testid="enhanced"
      onClick={() => {
        value.onEnhanced();
      }}
    />
  );
}

/** 挂载被测 hook；`ScrollContainerProvider` 提供它需要的滚动容器 */
function mount(): { rerender: () => void } {
  const tree = (): React.JSX.Element => (
    <ScrollContainerProvider value={container}>
      <Probe />
    </ScrollContainerProvider>
  );
  const { rerender } = render(tree());
  return { rerender: () => rerender(tree()) };
}

beforeEach(() => {
  scrollToLine.mockClear();

  container = document.createElement('div');
  document.body.append(container);
  // hook 只把 view 当作 scrollToLine 的实参传出去，这里不需要真的编辑器
  view = { dom: container } as unknown as EditorView;

  // 这篇文档「上次读到第 42 行」。offset 非 0，用来暴露「行内偏移被叠到
  // 锚点落点上」那一种更隐蔽的干扰
  rememberPosition({ documentId: DOC_ID, line: SAVED_LINE, offset: 7, updatedAt: Date.now() }, false);
  useDocumentStore.getState().setPendingAnchor(null);
});

afterEach(() => {
  container.remove();
  useDocumentStore.getState().setPendingAnchor(null);
});

describe('useReadingPosition 与待跳转锚点的优先级', () => {
  it('没有锚点时，照常恢复上次阅读位置', () => {
    // 正向对照：证明下面几个「没有恢复」不是因为恢复这条路本来就不通
    mount();
    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
  });

  it('带锚点打开时不恢复阅读位置，把落点让给锚点', () => {
    useDocumentStore.getState().setPendingAnchor('某个标题');
    mount();
    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('锚点被消费清空之后，也不能补一次恢复', () => {
    /*
     * 这是闩锁存在的理由。`pendingAnchor` 消费一次即清空，而清空本身会让
     * 恢复那条 effect 的依赖发生变化、于是**立刻重跑一遍**——只看当下的
     * `pendingAnchor` 是拦不住的，那一刻它已经是 null 了。
     */
    useDocumentStore.getState().setPendingAnchor('某个标题');
    mount();
    expect(scrollToLine).not.toHaveBeenCalled();

    // 模拟 usePendingAnchor 跳完之后把锚点清掉
    act(() => {
      useDocumentStore.getState().setPendingAnchor(null);
    });

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('增强完成后的校正也不能把用户从锚点拽回上次位置', () => {
    /*
     * 最要命的一种：Shiki 上色 / Mermaid 出图结束在锚点跳转之后好几秒，
     * `onEnhanced` 那次校正会把已经停在锚点上的用户拽走。
     * `userScrolledRef` 拦不住——锚点跳转本身就是程序化滚动。
     */
    useDocumentStore.getState().setPendingAnchor('某个标题');
    mount();
    act(() => {
      useDocumentStore.getState().setPendingAnchor(null);
    });

    act(() => {
      result.onEnhanced();
    });

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('无关的重渲染不会让恢复重新生效', () => {
    useDocumentStore.getState().setPendingAnchor('某个标题');
    const { rerender } = mount();
    act(() => {
      useDocumentStore.getState().setPendingAnchor(null);
    });

    act(() => rerender());

    expect(scrollToLine).not.toHaveBeenCalled();
  });
});

describe('闩锁不粘在文档上', () => {
  /** 造一份和 DOC_ID 同一个 id 的文档，用来模拟「重新打开同一篇」 */
  function reopen(): void {
    useDocumentStore.getState().setDocument({
      id: DOC_ID,
      name: '同一篇.md',
      path: '/同一篇.md',
      content: '# 甲',
      size: 4,
      lastModified: 0,
      source: 'url',
    });
  }

  it('同一篇文档先带锚点打开、再不带锚点重开，阅读位置照常恢复', () => {
    /*
     * 缺陷三本身。闩锁原来存的是 documentId，而 documentId 认不出
     * 「同一篇文档又打开了一次」——第二次打开时它与闩锁里存的完全一样，
     * 于是恢复被继续挡着，用户永远回不到上次读到的地方。
     */
    useDocumentStore.getState().setPendingAnchor('某个标题');
    const { rerender } = mount();
    act(() => {
      useDocumentStore.getState().setPendingAnchor(null);
    });
    expect(scrollToLine).not.toHaveBeenCalled();

    // 不带锚点重新打开同一篇：setDocument 自身会清掉 pendingAnchor
    act(() => {
      reopen();
    });
    act(() => rerender());

    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
  });

  it('重开之后增强完成的校正也恢复了，不是只跳一次', () => {
    useDocumentStore.getState().setPendingAnchor('某个标题');
    mount();
    act(() => {
      useDocumentStore.getState().setPendingAnchor(null);
    });
    act(() => {
      reopen();
    });
    scrollToLine.mockClear();

    fireEvent.click(screen.getByTestId('enhanced'));

    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
  });

  it('同一次打开里，锚点消费之后闩锁仍然咬合', () => {
    /*
     * 反向对照，也是缺陷三修复的边界：松开必须发生在**下一次打开**，
     * 而不是「锚点消费完就松」。后者会把闩锁要挡的那个缺陷原样放回来——
     * 增强完成后的校正把用户从他显式指定的锚点拽回上次读到的位置。
     */
    reopen();
    act(() => {
      useDocumentStore.getState().setPendingAnchor('某个标题');
    });
    const { rerender } = mount();
    act(() => {
      useDocumentStore.getState().setPendingAnchor(null);
    });
    act(() => rerender());
    fireEvent.click(screen.getByTestId('enhanced'));

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('自动刷新不算重新打开，闩锁不松', () => {
    /*
     * 自动刷新是「同一次打开换了内容」，用户仍停在打开时指定的锚点上。
     * 若把它也当成一次新的打开，文件一存盘就会被拽回上次读到的位置。
     */
    reopen();
    act(() => {
      useDocumentStore.getState().setPendingAnchor('某个标题');
    });
    mount();
    act(() => {
      useDocumentStore.getState().setPendingAnchor(null);
    });
    act(() => {
      useDocumentStore.getState().applyRefreshedDocument({
        id: DOC_ID,
        name: '同一篇.md',
        path: '/同一篇.md',
        content: '# 甲\n\n新增一段',
        size: 12,
        lastModified: 1,
        source: 'url',
      });
    });
    fireEvent.click(screen.getByTestId('enhanced'));

    expect(scrollToLine).not.toHaveBeenCalled();
  });
});

describe('显式导航使位置恢复撤防', () => {
  /** 造一次「同一篇文档重新打开」，用来验证撤防不会粘到下一次打开 */
  function reopen(): void {
    useDocumentStore.getState().setDocument({
      id: DOC_ID,
      name: '同一篇.md',
      path: '/同一篇.md',
      content: '# 甲',
      size: 4,
      lastModified: 0,
      source: 'url',
    });
  }

  it('没有导航时，增强完成后的校正照常生效', () => {
    /*
     * 正向对照，必须排在最前面：下面几条「没有被拽回」的断言，只有在
     * 「校正这条路本来是通的」的前提下才说明问题。校正本身是有理由存在的
     * ——Shiki 上色、Mermaid 出图会显著改变块高度，不校正落点就偏了。
     */
    mount();
    scrollToLine.mockClear();

    fireEvent.click(screen.getByTestId('enhanced'));

    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
  });

  it('恢复之后点过目录，增强完成后的校正不再把用户拽回记录位置', () => {
    /*
     * 缺陷本身。目录点击是**程序化滚动**，`checkUserScrolled` 比对的是
     * 我们自己写入的 scrollTop，而这次滚动由 CodeMirror 的测量周期异步落定、
     * `scroll` 事件晚于同一批块渲染派发的增强完成信号——校正抢在撤防之前
     * 跑完，用一次 `scrollToLine` 把刚跳过去的用户拽回来，两次滚动互相抵消。
     * 实测表现是恢复到 768 之后点第 18 章，4.8 秒内 scrollTop 恒为 768。
     */
    mount();
    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
    scrollToLine.mockClear();

    act(() => {
      useDocumentStore.getState().markNavigation();
    });
    fireEvent.click(screen.getByTestId('enhanced'));

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('增强反复完成也不会有一次漏网', () => {
    // 撤防是持久的，不是「挡掉紧接着的那一次」：块每滚进视口一批就增强一轮，
    // 只挡一次的话用户往下读几屏就会被拽回去
    mount();
    scrollToLine.mockClear();
    act(() => {
      useDocumentStore.getState().markNavigation();
    });

    fireEvent.click(screen.getByTestId('enhanced'));
    fireEvent.click(screen.getByTestId('enhanced'));
    fireEvent.click(screen.getByTestId('enhanced'));

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('首次恢复还没落地就点了目录，那一次恢复整个作废', () => {
    /*
     * 恢复要等首轮块渲染完成（`view` 非空）才动手，用户完全可能赶在这之前
     * 点目录。此时把他拽回上次读到的地方，与缺陷本身是同一种冒犯。
     * 用「先给一个已销毁的 view、再换成活的」来复刻这个时间差——它同时是
     * 下面那组用例的反面：不导航时，那一次补上的恢复必须发生。
     */
    const detached = { dom: document.createElement('div') } as unknown as EditorView;
    const tree = (live: EditorView): React.JSX.Element => (
      <ScrollContainerProvider value={container}>
        <Probe view={live} />
      </ScrollContainerProvider>
    );
    const { rerender } = render(tree(detached));
    expect(scrollToLine).not.toHaveBeenCalled();

    act(() => {
      useDocumentStore.getState().markNavigation();
    });
    rerender(tree(view));

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it('上一次打开里点过目录，不影响这一次打开的恢复', () => {
    /*
     * 撤防必须按「第几次打开」复位，否则它会像闩锁当年那样粘在文档上——
     * 用户点过一次目录，之后每次重开这篇文档都再也回不到上次读到的地方。
     * 这也是 store 里存单调序号、消费方各存一份基线的理由：复位就是重新
     * 取一次基线，不需要任何人按顺序去抹某个标志位。
     */
    const { rerender } = mount();
    act(() => {
      useDocumentStore.getState().markNavigation();
    });
    scrollToLine.mockClear();

    act(() => {
      reopen();
    });
    act(() => rerender());

    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
  });
});

describe('不对已经销毁的编辑器实例恢复', () => {
  it('view 的 DOM 已经脱离文档时不恢复，也不把「已恢复」标记掉', () => {
    /*
     * 换文档那一轮提交里，闭包捕获的 view 还是上一篇文档那个已经 destroy 的
     * 实例（存活过滤发生在渲染期，销毁发生在本轮 effect 里）。对着它 dispatch
     * 是静默无效的，而「已恢复」一旦被置位，新视图就绪后就不会再恢复一次——
     * 表现是换文档回来永远停在开头，且没有任何报错。
     */
    const detached = { dom: document.createElement('div') } as unknown as EditorView;
    const tree = (live: EditorView): React.JSX.Element => (
      <ScrollContainerProvider value={container}>
        <Probe view={live} />
      </ScrollContainerProvider>
    );
    const { rerender } = render(tree(detached));
    expect(scrollToLine).not.toHaveBeenCalled();

    // 新实例就绪（DOM 已挂上）之后，这一次恢复必须补上
    rerender(tree(view));
    expect(scrollToLine).toHaveBeenCalledWith(view, SAVED_LINE);
  });
});
