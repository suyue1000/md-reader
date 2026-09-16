import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '@/stores/document.store';
import type { MarkdownDocument } from '@/types';
import { StatusBar } from './StatusBar';

/**
 * 状态栏是「写不回原文件」这个事实唯一的**常驻**出口。
 *
 * 进入编辑态拿不到写权限时会弹一条提示条，但它 2.6 秒后自动消失
 * （`Toast` 的 info 时长），消失之后界面上原本再没有任何地方能看出这份文档
 * 存不回去——工具栏按钮与已授权时长得一模一样，而用户会一直编辑下去。
 * 这组用例锁的就是这条出口，以及保存状态的几种显示。
 */

const DOC: MarkdownDocument = {
  id: 'doc:a.md',
  name: 'a.md',
  path: '/tmp/a.md',
  content: '原文',
  size: 6,
  lastModified: 1000,
  source: 'fs-handle',
};

function openDoc(): void {
  act(() => {
    useDocumentStore.getState().setDocument(DOC);
  });
}

afterEach(() => {
  act(() => {
    useDocumentStore.getState().reset();
  });
});

describe('StatusBar：写不回原文件的常驻提示', () => {
  it('编辑态且没有写权限时一直显示', () => {
    openDoc();
    act(() => {
      useDocumentStore.getState().setMode('edit');
    });
    render(<StatusBar />);

    expect(screen.getByText(/无法写回原文件/)).toBeDefined();
  });

  it('拿到写权限后不再显示', () => {
    openDoc();
    act(() => {
      useDocumentStore.getState().setMode('edit');
      useDocumentStore.getState().setWritable(true);
    });
    render(<StatusBar />);

    expect(screen.queryByText(/无法写回原文件/)).toBeNull();
  });

  it('阅读态不显示——那时还没向浏览器申请过写权限，报「无法写回」是不准确的', () => {
    openDoc();
    render(<StatusBar />);

    expect(useDocumentStore.getState().writable).toBe(false);
    expect(screen.queryByText(/无法写回原文件/)).toBeNull();
  });
});

describe('StatusBar：保存状态', () => {
  it('有未保存改动时显示未保存', () => {
    openDoc();
    act(() => {
      useDocumentStore.getState().setDirty(true);
    });
    render(<StatusBar />);

    expect(screen.getByText(/未保存/)).toBeDefined();
  });

  it('正在写盘时让位给「保存中」，不报未保存', () => {
    openDoc();
    act(() => {
      useDocumentStore.getState().setDirty(true);
      useDocumentStore.getState().setSaveStatus('saving');
    });
    render(<StatusBar />);

    expect(screen.getByText('保存中…')).toBeDefined();
    expect(screen.queryByText(/未保存/)).toBeNull();
  });

  it('保存成功显示已保存', () => {
    openDoc();
    act(() => {
      useDocumentStore.getState().markSaved('新内容', 2000);
    });
    render(<StatusBar />);

    expect(screen.getByText('已保存')).toBeDefined();
  });

  it('保存失败显示失败，并把原因放进 title', () => {
    openDoc();
    act(() => {
      useDocumentStore.getState().setSaveStatus('error', '磁盘已满');
    });
    render(<StatusBar />);

    expect(screen.getByText('保存失败').getAttribute('title')).toBe('磁盘已满');
  });
});
