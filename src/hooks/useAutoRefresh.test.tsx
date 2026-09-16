import { useEffect } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider, useSetEditorView } from '@/editor/EditorContext';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { probeCurrentFile, type FileProbeResult } from '@/utils/file-open';
import { useAutoRefresh } from './useAutoRefresh';

/**
 * `useAutoRefresh` 本身此前完全没有 hook 级测试（历史遗留），但本任务给它
 * 加了新逻辑——改接 `decideRefresh`、新增 `conflict` 分支与暂停/恢复轮询、
 * 以及 `viewRef` 这道防陈旧闭包的补丁。这几处如果只靠 `decideRefresh` 与
 * `ConflictBanner` 两端的单测间接兜底，测不出「真的接对了」——`decideRefresh`
 * 的用例证明不了 `useAutoRefresh` 真的把它的返回值分发到了正确的 store 调用，
 * 这与 `ReaderPage.test.tsx` 文件头注释里「接线断了没有任何用例会红」是同一类
 * 风险，因此补上，而不是继续留白。
 *
 * `probeCurrentFile` 背后是真实的 File System Access API 调用，jsdom 里造不
 * 出真实句柄，这里整体 mock 掉——测的是「拿到探测结果之后 useAutoRefresh 做
 * 对了什么」，不是探测本身（探测逻辑已经在 `file-open.test.ts` 里覆盖）。
 */
vi.mock('@/utils/file-open', () => ({
  probeCurrentFile: vi.fn(),
}));

const probeMock = vi.mocked(probeCurrentFile);

const DOC: MarkdownDocument = {
  id: 'doc:a.md',
  name: 'a.md',
  path: 'a.md',
  content: '原文',
  size: 4,
  lastModified: 1000,
  source: 'fs-handle',
};

/** 轮询间隔就是设置里的默认值，直接写死避免测试跟设置默认值脱节时不报警 */
const INTERVAL_MS = 1500;

/**
 * 给 `EditorViewProvider` 塞一个真实的、内容为 `doc` 的 `EditorView`。
 *
 * 与 `ConflictBanner.test.tsx` 用的是同一个模式：必须挂到 `document.body`，
 * 因为 `useEditorView()` 按 `dom.isConnected` 判活。
 */
function ViewSetter({ doc, children }: { doc: string; children: React.ReactNode }): React.JSX.Element {
  const setView = useSetEditorView();
  useEffect(() => {
    const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body });
    setView(view);
    return () => {
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  return <>{children}</>;
}

/** 不挂编辑器实例：`useAutoRefresh` 会退回 store 里的内容作为 editorText，dirty 恒为 false */
function bareWrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <EditorViewProvider>{children}</EditorViewProvider>;
}

/** 挂一个内容与 `document.content` 不同的编辑器实例，模拟「本地有未保存改动」 */
function dirtyWrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <EditorViewProvider>
      <ViewSetter doc="我改的，还没保存">{children}</ViewSetter>
    </EditorViewProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  probeMock.mockReset();
  act(() => {
    useDocumentStore.getState().setDocument(DOC);
  });
});

afterEach(() => {
  act(() => {
    useDocumentStore.getState().reset();
  });
  vi.useRealTimers();
});

/** 推进一个完整的轮询周期并让内部的 await 落定 */
async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
  });
}

describe('useAutoRefresh', () => {
  it('外部改动 + 本地无未保存改动：直接采用（adopt），不产生冲突', async () => {
    const changed: FileProbeResult = {
      kind: 'changed',
      document: { ...DOC, content: '外部改的', lastModified: 2000 },
    };
    probeMock.mockResolvedValue(changed);

    renderHook(() => useAutoRefresh(), { wrapper: bareWrapper });
    await tick();

    expect(useDocumentStore.getState().document?.content).toBe('外部改的');
    expect(useDocumentStore.getState().conflict).toBeNull();
  });

  it('外部改动 + 本地有未保存改动：写进 conflict，且不覆盖 document.content', async () => {
    const changed: FileProbeResult = {
      kind: 'changed',
      document: { ...DOC, content: '磁盘上的新内容', lastModified: 2000 },
    };
    probeMock.mockResolvedValue(changed);

    renderHook(() => useAutoRefresh(), { wrapper: dirtyWrapper });
    await tick();

    expect(useDocumentStore.getState().conflict?.content).toBe('磁盘上的新内容');
    // 冲突没有决断之前，原文不该被冲掉——这正是本任务要修的那个缺陷
    expect(useDocumentStore.getState().document?.content).toBe('原文');
  });

  it('冲突决断之前暂停轮询，决断后（conflict 被清空）自动恢复', async () => {
    const changed: FileProbeResult = {
      kind: 'changed',
      document: { ...DOC, content: '磁盘上的新内容', lastModified: 2000 },
    };
    probeMock.mockResolvedValue(changed);

    renderHook(() => useAutoRefresh(), { wrapper: dirtyWrapper });
    await tick();
    expect(useDocumentStore.getState().conflict).not.toBeNull();
    const callsAtConflict = probeMock.mock.calls.length;

    // 冲突挂起期间连续推进好几个轮询周期，不该再探测一次
    await tick();
    await tick();
    expect(probeMock.mock.calls.length).toBe(callsAtConflict);

    // 用户决断（这里用「保留我的」，即只清掉 conflict）之后轮询应当恢复
    act(() => {
      useDocumentStore.getState().clearConflict();
    });
    probeMock.mockResolvedValue({ kind: 'unchanged' });
    await tick();

    expect(probeMock.mock.calls.length).toBeGreaterThan(callsAtConflict);
  });

  it('文件消失时停止监听并给出可读的原因', async () => {
    probeMock.mockResolvedValue({ kind: 'missing' });

    renderHook(() => useAutoRefresh(), { wrapper: bareWrapper });
    await tick();

    expect(useDocumentStore.getState().watchStatus).toBe('stopped');
    expect(useDocumentStore.getState().watchMessage).toContain('删除');
  });
});
