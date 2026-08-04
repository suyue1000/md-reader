import { afterEach, describe, expect, it } from 'vitest';
import { probeCurrentFile, setCurrentFileHandle } from './file-open';

/** 伪造一个文件句柄，只实现探测路径用到的方法 */
function fakeHandle(options: {
  name?: string;
  lastModified?: number;
  content?: string;
  permission?: PermissionState;
  getFileError?: Error;
}): FileSystemFileHandle {
  const handle = {
    kind: 'file' as const,
    name: options.name ?? 'doc.md',
    queryPermission: () => Promise.resolve(options.permission ?? 'granted'),
    getFile: () => {
      if (options.getFileError) return Promise.reject(options.getFileError);
      const file = new File([options.content ?? '# hello'], options.name ?? 'doc.md', {
        type: 'text/markdown',
        lastModified: options.lastModified ?? 1000,
      });
      return Promise.resolve(file);
    },
  };
  return handle as unknown as FileSystemFileHandle;
}

describe('probeCurrentFile', () => {
  afterEach(() => {
    setCurrentFileHandle(null);
  });

  it('没有句柄时报告 no-handle', async () => {
    setCurrentFileHandle(null);
    expect(await probeCurrentFile(0)).toEqual({ kind: 'no-handle' });
  });

  it('修改时间未变时报告 unchanged 且不读内容', async () => {
    setCurrentFileHandle(fakeHandle({ lastModified: 1000 }));
    expect(await probeCurrentFile(1000)).toEqual({ kind: 'unchanged' });
  });

  it('修改时间变化时返回最新内容', async () => {
    setCurrentFileHandle(fakeHandle({ lastModified: 2000, content: '# 新内容' }));
    const result = await probeCurrentFile(1000);

    expect(result.kind).toBe('changed');
    if (result.kind !== 'changed') return;
    expect(result.document.content).toBe('# 新内容');
    expect(result.document.lastModified).toBe(2000);
    expect(result.document.source).toBe('fs-handle');
  });

  it('同一路径的文档 id 保持稳定', async () => {
    // 阅读位置、收藏都靠 id 关联，重新读取后必须还是同一个 id
    setCurrentFileHandle(fakeHandle({ name: 'guide.md', lastModified: 2000 }));
    const first = await probeCurrentFile(1000);
    setCurrentFileHandle(fakeHandle({ name: 'guide.md', lastModified: 3000 }));
    const second = await probeCurrentFile(2000);

    if (first.kind !== 'changed' || second.kind !== 'changed') throw new Error('应为 changed');
    expect(first.document.id).toBe(second.document.id);
  });

  it('权限被撤销时报告 permission-lost', async () => {
    setCurrentFileHandle(fakeHandle({ permission: 'prompt' }));
    expect(await probeCurrentFile(0)).toEqual({ kind: 'permission-lost' });
  });

  it('文件被删除时报告 missing', async () => {
    const notFound = new DOMException('gone', 'NotFoundError');
    setCurrentFileHandle(fakeHandle({ getFileError: notFound }));
    expect(await probeCurrentFile(0)).toEqual({ kind: 'missing' });
  });

  it('其它异常归类为 error 并带上原因', async () => {
    setCurrentFileHandle(fakeHandle({ getFileError: new Error('磁盘 IO 失败') }));
    const result = await probeCurrentFile(0);

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toBe('磁盘 IO 失败');
  });
});
