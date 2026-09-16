import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { openMarkdownFile } from '@/utils/file-open';
// 命名空间形式的类型导入，供下面的 `importOriginal` 标注原模块的形状
// （项目禁止行内的 `import()` 类型标注，见 eslint 的 consistent-type-imports）
import type * as FileOpenModule from '@/utils/file-open';
import { useOpenFile } from './useOpenFile';
import { useWorkspace } from './useWorkspace';

/**
 * 「有未保存改动时切换文档要先问一句」这条规则有两个调用点：工具栏的
 * 「打开文件」（`useOpenFile.open`）与文件树里点另一篇（`useWorkspace.openPath`）。
 *
 * 这个文件按**规则**而不是按模块组织，是刻意的：规则只有一条，而漏接的方式
 * 有两种，分成两个文件写反而容易只测到自己记得的那一个调用点。切换一旦发生
 * 就是不可逆的——旧文档连同它没保存的改动一起被顶掉，版本缓冲里也不会留下
 * 任何东西（那只在写盘前入栈）。
 */

vi.mock('@/utils/file-open', async (importOriginal) => {
  const actual = await importOriginal<typeof FileOpenModule>();
  return { ...actual, openMarkdownFile: vi.fn() };
});

const openMock = vi.mocked(openMarkdownFile);

const DOC: MarkdownDocument = {
  id: 'doc:a.md',
  name: 'a.md',
  path: 'a.md',
  content: '原文',
  size: 6,
  lastModified: 1000,
  source: 'fs-handle',
};

const OTHER: MarkdownDocument = { ...DOC, id: 'doc:b.md', name: 'b.md', path: 'b.md' };

const actions: {
  open: (() => Promise<void>) | null;
  openPath: ((path: string) => Promise<void>) | null;
} = { open: null, openPath: null };

function Probe(): React.JSX.Element {
  const { open } = useOpenFile();
  const { openPath } = useWorkspace();
  useEffect(() => {
    actions.open = open;
    actions.openPath = openPath;
  });
  return <div />;
}

/** 打开一份文档并把它标成「有未保存改动」 */
function openDirtyDoc(): void {
  act(() => {
    useDocumentStore.getState().setDocument(DOC);
    useDocumentStore.getState().setMode('edit');
    useDocumentStore.getState().setDirty(true);
  });
}

beforeEach(() => {
  openMock.mockReset();
  openMock.mockResolvedValue(OTHER);
  render(<Probe />);
});

afterEach(() => {
  act(() => {
    useDocumentStore.getState().reset();
  });
  vi.restoreAllMocks();
});

describe('切换文档前的未保存确认', () => {
  it('「打开文件」：用户选择留下时不打开新文件，连选择器都不弹', async () => {
    openDirtyDoc();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await act(async () => {
      await actions.open?.();
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    // 选择器都没弹：问在打开之前，而不是打开之后才补一句
    expect(openMock).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().document?.path).toBe('a.md');
  });

  it('「打开文件」：确认丢弃后照常打开', async () => {
    openDirtyDoc();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await act(async () => {
      await actions.open?.();
    });

    expect(useDocumentStore.getState().document?.path).toBe('b.md');
  });

  it('「打开文件」：没有未保存改动时不打扰用户', async () => {
    act(() => {
      useDocumentStore.getState().setDocument(DOC);
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await act(async () => {
      await actions.open?.();
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().document?.path).toBe('b.md');
  });

  it('文件树切换：用户选择留下时原地不动，也不报错', async () => {
    openDirtyDoc();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await act(async () => {
      await actions.openPath?.('别的文档.md');
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().document?.path).toBe('a.md');
    expect(useDocumentStore.getState().status).toBe('ready');
    expect(useDocumentStore.getState().error).toBeNull();
  });

  it('文件树切换：确认丢弃后继续往下走（这里因为没有句柄而以报错收场）', async () => {
    openDirtyDoc();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await act(async () => {
      await actions.openPath?.('别的文档.md');
    });

    // 走到了真正的打开逻辑：工作区里没有这个路径的句柄，如实报错
    expect(useDocumentStore.getState().error).toContain('别的文档.md');
  });
});
