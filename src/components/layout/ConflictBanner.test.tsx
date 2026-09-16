import { useEffect } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider, useSetEditorView } from '@/editor/EditorContext';
import * as saveModule from '@/editor/save';
import { popPreviousVersion } from '@/editor/save';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { ConflictBanner } from './ConflictBanner';

/**
 * `ConflictBanner` 是「先把编辑器文本推进版本缓冲、再应用磁盘内容」这条
 * 顺序要求（简报里点名「不能弄错的顺序」）唯一的落地处：反了或漏了，
 * 用户还没保存的改动会在应用磁盘内容那一刻无声消失，且没有任何找回的
 * 途径。这里不 mock `save.ts`，用真实的版本缓冲验证「推进去的是什么」，
 * 比 mock 掉再断言「被调用过」更接近会不会真的救回内容。
 *
 * 下面「顺序红线」那条用例是补充：内容断言（上面几条）测不出「两行顺序颠倒」
 * 这一种回归——`applyRefreshedDocument` 只改 Zustand store，不会同步触碰
 * `EditorView`，`view.state.doc.toString()` 在同一个同步的点击处理函数执行期间
 * 不会因为 store 变了而跟着变，所以颠倒顺序不影响这几条用例的断言结果（这一点
 * 经代码评审用 `vi.spyOn` 实验独立验证过）。真正能钉住「谁先谁后」的是调用
 * 顺序本身，不是调用之后产生的内容——`invocationCallOrder` 记录的是 mock 被
 * 调用的先后序号，跟 React 有没有 flush、EditorView 有没有被重新灌入无关。
 */

const CONFLICT_DOC: MarkdownDocument = {
  id: 'doc:a.md',
  name: 'a.md',
  path: 'a.md',
  content: '磁盘上的新内容',
  size: 8,
  lastModified: 2000,
  source: 'fs-handle',
};

/**
 * 把一个真实的 EditorView 塞进 EditorViewProvider。
 *
 * 必须把它的 DOM 挂到 document.body 上：`useEditorView()` 按
 * `dom.isConnected` 判活（见 `EditorContext.tsx` 的说明），不挂的话它
 * 永远读到 null，`ConflictBanner` 就测不出「有活的编辑器实例」这条分支。
 */
function WithView({
  doc,
  children,
}: {
  doc: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const setView = useSetEditorView();
  useEffect(() => {
    if (doc === null) return;
    const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
    setView(view);
    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  return <>{children}</>;
}

function mount(editorText: string | null): void {
  render(
    <EditorViewProvider>
      <WithView doc={editorText}>
        <ConflictBanner />
      </WithView>
    </EditorViewProvider>,
  );
}

afterEach(() => {
  act(() => {
    useDocumentStore.getState().reset();
  });
  // 排空版本缓冲，避免用例互相污染（同 save.test.ts 的做法）
  while (popPreviousVersion() !== null) {
    /* drain */
  }
});

describe('ConflictBanner', () => {
  it('没有冲突时不渲染', () => {
    mount('无关内容');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('「保留我的改动」只清掉冲突记录，不碰文档内容也不占用版本缓冲', () => {
    act(() => {
      useDocumentStore.getState().setDocument({ ...CONFLICT_DOC, content: '我改的，还没保存' });
      useDocumentStore.getState().setConflict(CONFLICT_DOC);
    });
    mount('我改的，还没保存');

    fireEvent.click(screen.getByRole('button', { name: '保留我的改动' }));

    expect(useDocumentStore.getState().conflict).toBeNull();
    expect(useDocumentStore.getState().document?.content).toBe('我改的，还没保存');
    // 没有丢东西，自然也不需要占用后悔药
    expect(popPreviousVersion()).toBeNull();
  });

  it('「改用磁盘上的版本」——删掉版本缓冲入栈这一行，这条断言会先变红', () => {
    act(() => {
      useDocumentStore.getState().setDocument({ ...CONFLICT_DOC, content: '我改的，还没保存' });
      useDocumentStore.getState().setConflict(CONFLICT_DOC);
    });
    mount('我改的，还没保存');

    fireEvent.click(screen.getByRole('button', { name: '改用磁盘上的版本' }));

    // 磁盘内容已经应用
    expect(useDocumentStore.getState().document?.content).toBe('磁盘上的新内容');
    expect(useDocumentStore.getState().conflict).toBeNull();
    // 用户那份没保存的改动被推进了版本缓冲——这是它唯一的后悔药
    expect(popPreviousVersion()).toBe('我改的，还没保存');
  });

  it('顺序红线：push 版本缓冲必须先于 applyRefreshedDocument 被调用', () => {
    /*
     * 只断言内容测不出顺序颠倒（见文件头注释）。这里改用调用顺序本身：
     * `invocationCallOrder` 是 vitest 给每一次 mock 调用打的全局递增序号，
     * 与调用的副作用是否被别处观察到无关，因此能在顺序颠倒时准确变红——
     * 已用撤销验证（把 `ConflictBanner.tsx` 里两行调换后跑这条用例，确认
     * 变红，再改回来），见任务报告。
     */
    act(() => {
      useDocumentStore.getState().setDocument({ ...CONFLICT_DOC, content: '我改的，还没保存' });
      useDocumentStore.getState().setConflict(CONFLICT_DOC);
    });
    mount('我改的，还没保存');

    const pushSpy = vi.spyOn(saveModule, 'pushVersionBeforeOverwrite');
    const applySpy = vi.spyOn(useDocumentStore.getState(), 'applyRefreshedDocument');

    fireEvent.click(screen.getByRole('button', { name: '改用磁盘上的版本' }));

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
    // 上面两条 toHaveBeenCalledTimes(1) 已经保证了下标 0 存在；
    // noUncheckedIndexedAccess 开着，取出来单独判一次非 undefined 让类型收窄
    const pushOrder = pushSpy.mock.invocationCallOrder[0];
    const applyOrder = applySpy.mock.invocationCallOrder[0];
    expect(pushOrder).toBeDefined();
    expect(applyOrder).toBeDefined();
    expect(pushOrder).toBeLessThan(applyOrder as number);

    pushSpy.mockRestore();
    applySpy.mockRestore();
  });

  it('没有编辑器实例时不崩溃，也不会把 undefined 推进版本缓冲', () => {
    act(() => {
      useDocumentStore.getState().setDocument({ ...CONFLICT_DOC, content: '我改的，还没保存' });
      useDocumentStore.getState().setConflict(CONFLICT_DOC);
    });
    mount(null);

    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: '改用磁盘上的版本' }));
    }).not.toThrow();

    expect(useDocumentStore.getState().document?.content).toBe('磁盘上的新内容');
    expect(popPreviousVersion()).toBeNull();
  });
});
