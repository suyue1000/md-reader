import { describe, expect, it } from 'vitest';
import { wellKnownStartIn } from './start-in';

describe('wellKnownStartIn', () => {
  it('从 macOS 路径认出下载目录', () => {
    expect(wellKnownStartIn('/Users/me/Downloads/proj/docs/a.md')).toBe('downloads');
  });

  it('从 file:// 地址认出目录（含百分号转义）', () => {
    // 接管页面拿到的就是这种地址
    const url = 'file:///Users/me/Downloads/%E5%BD%92%E6%A1%A3/docs/a.md';
    expect(wellKnownStartIn(url)).toBe('downloads');
  });

  it('认识中文系统的显示名', () => {
    expect(wellKnownStartIn('/Users/me/文稿/a.md')).toBe('documents');
    expect(wellKnownStartIn('/Users/me/桌面/a.md')).toBe('desktop');
  });

  it('兼容 Windows 路径', () => {
    expect(wellKnownStartIn('C:\\Users\\me\\Downloads\\a.md')).toBe('downloads');
  });

  it('忽略大小写', () => {
    expect(wellKnownStartIn('/Users/me/DOWNLOADS/a.md')).toBe('downloads');
  });

  it('太深处的同名目录不算', () => {
    // 用户自己在项目里建的 documents 文件夹不是系统目录，
    // 拿它当起始位置只会把选择器带到一个毫不相干的地方
    expect(wellKnownStartIn('/Users/me/Downloads/proj/documents/a.md')).toBe('downloads');
    expect(wellKnownStartIn('/a/b/c/d/e/documents/f.md')).toBeUndefined();
  });

  it('认不出来时返回 undefined，交给浏览器默认值', () => {
    expect(wellKnownStartIn('/opt/data/a.md')).toBeUndefined();
    expect(wellKnownStartIn('')).toBeUndefined();
  });
});
