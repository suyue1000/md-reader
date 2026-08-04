import { describe, expect, it } from 'vitest';
import { parentDirName } from './parent-dir';

describe('parentDirName', () => {
  it('取普通路径的上一级目录名', () => {
    expect(parentDirName('a/b/c.md')).toBe('b');
  });

  it('解码 file:// URL 里的百分号转义', () => {
    // 接管模式下拿到的就是这种地址，不解码会得到 %E6%80%A7 这种东西
    expect(parentDirName('file:///Users/me/%E6%96%87%E6%A1%A3/a.md')).toBe('文档');
  });

  it('兼容反斜杠分隔', () => {
    expect(parentDirName('C:\\docs\\a.md')).toBe('docs');
  });

  it('顶层文件没有上一级', () => {
    expect(parentDirName('a.md')).toBeNull();
    expect(parentDirName('/a.md')).toBeNull();
    expect(parentDirName('')).toBeNull();
  });

  it('忽略重复的分隔符', () => {
    expect(parentDirName('a//b///c.md')).toBe('b');
  });
});
