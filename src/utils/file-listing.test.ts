import { describe, expect, it } from 'vitest';
import { parentDirUrl, parseDirectoryListing } from './file-listing';

/** 浏览器为目录生成的列表页片段（真实格式） */
const LISTING = `<script>start("/Users/me/docs/");</script>
<script>addRow("..","..",1,"","",0,"");</script>
<script>addRow("子目录","%E5%AD%90%E7%9B%AE%E5%BD%95/",1,"","","4/1/25","10:00");</script>
<script>addRow("a.md","a.md",0,"1.2 kB","1234","4/1/25","10:01");</script>
<script>addRow("图 片.png","%E5%9B%BE%20%E7%89%87.png",0,"3 kB","3000","4/1/25","10:02");</script>`;

describe('parseDirectoryListing', () => {
  const base = 'file:///Users/me/docs/';

  it('解析出条目并区分目录与文件', () => {
    const entries = parseDirectoryListing(LISTING, base);
    expect(entries.map((e) => e.name)).toEqual(['子目录', 'a.md', '图 片.png']);
    expect(entries[0]?.isDirectory).toBe(true);
    expect(entries[1]?.isDirectory).toBe(false);
  });

  it('丢掉「上级目录」那一行', () => {
    // 它不是本目录的内容，混进树里会造成无限向上递归
    expect(parseDirectoryListing(LISTING, base).some((e) => e.name === '..')).toBe(false);
  });

  it('把相对地址解析成绝对地址', () => {
    const entries = parseDirectoryListing(LISTING, base);
    expect(entries[1]?.url).toBe('file:///Users/me/docs/a.md');
    expect(entries[0]?.url).toBe('file:///Users/me/docs/%E5%AD%90%E7%9B%AE%E5%BD%95/');
  });

  it('格式不认识时返回空数组而不是抛错', () => {
    // 列表页是浏览器的内部实现，格式可能变；解析不了要能回退到手动选目录
    expect(parseDirectoryListing('<html>whatever</html>', base)).toEqual([]);
    expect(parseDirectoryListing('', base)).toEqual([]);
  });
});

describe('parentDirUrl', () => {
  it('取出文件所在目录', () => {
    expect(parentDirUrl('file:///a/b/c.md')).toBe('file:///a/b/');
  });

  it('已经是目录时原样返回', () => {
    expect(parentDirUrl('file:///a/b/')).toBe('file:///a/b/');
  });
});
