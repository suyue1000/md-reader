import { describe, expect, it } from 'vitest';
import { decideRefreshAction } from './auto-refresh';
import type { MarkdownDocument } from '@/types';

/** 构造一份文档 */
function makeDocument(content: string, lastModified = 2000): MarkdownDocument {
  return {
    id: 'doc:a.md',
    name: 'a.md',
    path: 'a.md',
    content,
    size: content.length,
    lastModified,
    source: 'fs-handle',
  };
}

describe('decideRefreshAction', () => {
  it('文件未变化时继续监听', () => {
    expect(decideRefreshAction({ kind: 'unchanged' }, '# 原文')).toEqual({ kind: 'continue' });
  });

  it('内容确实变化时应用新文档', () => {
    const document = makeDocument('# 新内容');
    const action = decideRefreshAction({ kind: 'changed', document }, '# 原文');

    expect(action.kind).toBe('apply');
    if (action.kind !== 'apply') return;
    expect(action.document.content).toBe('# 新内容');
  });

  it('时间戳变了但内容相同时只同步时间戳，不重渲染', () => {
    // 有些编辑器保存时会更新 mtime 却一字未改，重新渲染是纯粹的抖动
    const document = makeDocument('# 原文', 5000);
    const action = decideRefreshAction({ kind: 'changed', document }, '# 原文');

    expect(action).toEqual({ kind: 'touch-timestamp', lastModified: 5000 });
  });

  it('文件被删除时停止并说明原因', () => {
    const action = decideRefreshAction({ kind: 'missing' }, '');
    expect(action.kind).toBe('stop');
    if (action.kind !== 'stop') return;
    expect(action.message).toContain('删除');
  });

  it('权限失效时提示用户如何恢复', () => {
    const action = decideRefreshAction({ kind: 'permission-lost' }, '');
    expect(action.kind).toBe('stop');
    if (action.kind !== 'stop') return;
    // 轮询里无法申请权限，必须告诉用户走手动刷新这条路
    expect(action.message).toContain('刷新');
  });

  it('没有句柄时转为未激活而不是报错', () => {
    expect(decideRefreshAction({ kind: 'no-handle' }, '')).toEqual({ kind: 'deactivate' });
  });

  it('意外错误停止监听并带上原因', () => {
    const action = decideRefreshAction({ kind: 'error', message: '磁盘 IO 失败' }, '');
    expect(action.kind).toBe('stop');
    if (action.kind !== 'stop') return;
    expect(action.message).toContain('磁盘 IO 失败');
  });
});
