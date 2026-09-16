import { act, render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { EditorViewProvider, useEditorView, useSetEditorView } from './EditorContext';

/**
 * 造一个只有 `dom` 的替身。
 *
 * `useEditorView` 只看 `dom.isConnected`，不碰 CodeMirror 的其它任何东西；
 * 起一个真实的 `EditorView` 需要完整布局，在 jsdom 里既慢又测不到重点。
 */
function fakeView(id: string): { view: EditorView; dom: HTMLElement } {
  const dom = document.createElement('div');
  dom.id = id;
  document.body.append(dom);
  return { view: { dom } as unknown as EditorView, dom };
}

/**
 * 把 context 里读到的 view 渲染成文本。
 *
 * 不用 ref 把值捎出去：渲染期写 ref 会被 lint 拦下，而且那正是它要防的
 * 东西。把结果画进 DOM，断言也更接近「消费方实际看到什么」。
 */
function Probe({ onReady }: { onReady: (set: (view: EditorView | null) => void) => void }) {
  onReady(useSetEditorView());
  const view = useEditorView();
  return <span data-testid="seen">{view ? view.dom.id : 'null'}</span>;
}

/** 渲染探针，返回写入口与重渲染入口 */
function mount(): { setView: (view: EditorView | null) => void; rerender: () => void } {
  let setView!: (view: EditorView | null) => void;
  // 每次都造新元素：传同一个引用回去，React 会判定无变化而整棵跳过重渲染
  const tree = (): React.JSX.Element => (
    <EditorViewProvider>
      <Probe
        onReady={(fn) => {
          setView = fn;
        }}
      />
    </EditorViewProvider>
  );
  const { rerender } = render(tree());
  return { setView: (view) => setView(view), rerender: () => rerender(tree()) };
}

const seen = (): string => screen.getByTestId('seen').textContent ?? '';

describe('useEditorView', () => {
  it('交出仍挂在文档上的实例', () => {
    const { view, dom } = fakeView('live-view');
    const { setView } = mount();

    act(() => setView(view));

    expect(seen()).toBe('live-view');
    dom.remove();
  });

  it('实例的 DOM 已经从文档上摘掉时当作 null', () => {
    /*
     * 这是对实测缺陷的回归：换文档时 Zustand 的 `setToc` 会同步冲刷一次
     * 渲染，那一帧里 context 还拿着上一篇文档**已经销毁**的编辑器。目录
     * 跳转若在此时动手，会对着死掉的视图 dispatch——滚动不发生，而待跳转
     * 锚点已经被当成「跳过了」清掉。表现是带锚点换文档永远停在文档顶部。
     */
    const { view, dom } = fakeView('dead-view');
    const { setView, rerender } = mount();

    act(() => setView(view));
    expect(seen()).toBe('dead-view');

    // 模拟 EditorView.destroy()：它会把根节点从文档里摘掉
    dom.remove();
    act(() => rerender());

    expect(seen()).toBe('null');
  });
});
