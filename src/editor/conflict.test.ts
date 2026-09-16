import { describe, expect, it } from 'vitest';
import type { MarkdownDocument } from '@/types';
import { decideRefresh, type RefreshContext } from './conflict';

const doc = (content: string, lastModified = 1000): MarkdownDocument => ({
  id: 'doc:a',
  name: 'a.md',
  path: 'a.md',
  content,
  size: content.length,
  lastModified,
  source: 'fs-handle',
});

const ctx = (overrides: Partial<RefreshContext> = {}): RefreshContext => ({
  editorText: '原文',
  savedContent: '原文',
  isSelfWrite: () => false,
  ...overrides,
});

describe('decideRefresh', () => {
  it('文件没变时继续监听', () => {
    expect(decideRefresh({ kind: 'unchanged' }, ctx())).toEqual({ kind: 'continue' });
  });

  it('时间戳变了但内容没变，只对时', () => {
    const result = decideRefresh({ kind: 'changed', document: doc('原文', 2000) }, ctx());
    expect(result).toEqual({ kind: 'touch-timestamp', lastModified: 2000 });
  });

  it('是我们自己刚写的，只对时而不回灌', () => {
    const result = decideRefresh(
      { kind: 'changed', document: doc('新内容', 2000) },
      ctx({ editorText: '新内容', isSelfWrite: () => true }),
    );
    expect(result).toEqual({ kind: 'touch-timestamp', lastModified: 2000 });
  });

  it('外部改动且本地没有未保存改动，直接采用', () => {
    const result = decideRefresh({ kind: 'changed', document: doc('外部改的') }, ctx());
    expect(result).toEqual({ kind: 'adopt', document: doc('外部改的') });
  });

  it('外部改动且本地有未保存改动，报冲突而不是静默覆盖', () => {
    const result = decideRefresh(
      { kind: 'changed', document: doc('外部改的') },
      ctx({ editorText: '我改的', savedContent: '原文' }),
    );
    expect(result.kind).toBe('conflict');
  });

  it('冲突结果携带磁盘上的文档，供 UI 展示与「用磁盘的」选项使用', () => {
    const incoming = doc('外部改的');
    const result = decideRefresh(
      { kind: 'changed', document: incoming },
      ctx({ editorText: '我改的', savedContent: '原文' }),
    );
    expect(result).toEqual({ kind: 'conflict', document: incoming });
  });

  it('文件消失时停止监听，并说明原因', () => {
    const result = decideRefresh({ kind: 'missing' }, ctx());
    expect(result.kind).toBe('stop');
    if (result.kind !== 'stop') return;
    expect(result.message).toContain('删除');
  });

  it('权限失效时停止监听，并引导用户走手动刷新', () => {
    const result = decideRefresh({ kind: 'permission-lost' }, ctx());
    expect(result.kind).toBe('stop');
    if (result.kind !== 'stop') return;
    // 轮询里无法申请权限，必须告诉用户走手动刷新这条路
    expect(result.message).toContain('刷新');
  });

  it('意外错误停止监听并带上原因', () => {
    const result = decideRefresh({ kind: 'error', message: '磁盘 IO 失败' }, ctx());
    expect(result.kind).toBe('stop');
    if (result.kind !== 'stop') return;
    expect(result.message).toContain('磁盘 IO 失败');
  });

  it('没有句柄时停用', () => {
    expect(decideRefresh({ kind: 'no-handle' }, ctx())).toEqual({ kind: 'deactivate' });
  });
});
