import { describe, expect, it } from 'vitest';
import {
  collectAncestorIds,
  compareNodes,
  filterTree,
  findNodeByPath,
  isMarkdownFileName,
  resolveRelativePath,
  shouldIgnoreDirectory,
} from './directory';
import type { FileTreeNode } from '@/types';

/** 构造一个文件节点 */
function file(path: string, depth = 0): FileTreeNode {
  return { id: path, name: path.split('/').pop() ?? path, kind: 'file', depth };
}

/** 构造一个目录节点 */
function dir(path: string, children: FileTreeNode[], depth = 0): FileTreeNode {
  return { id: path, name: path.split('/').pop() ?? path, kind: 'directory', children, depth };
}

describe('isMarkdownFileName', () => {
  it('识别常见 Markdown 扩展名', () => {
    expect(isMarkdownFileName('README.md')).toBe(true);
    expect(isMarkdownFileName('guide.markdown')).toBe(true);
    expect(isMarkdownFileName('notes.MD')).toBe(true);
  });

  it('排除非 Markdown 文件', () => {
    expect(isMarkdownFileName('script.ts')).toBe(false);
    expect(isMarkdownFileName('image.png')).toBe(false);
  });
});

describe('shouldIgnoreDirectory', () => {
  it('跳过会拖死扫描的重目录', () => {
    expect(shouldIgnoreDirectory('node_modules')).toBe(true);
    expect(shouldIgnoreDirectory('dist')).toBe(true);
  });

  it('跳过所有点开头的目录', () => {
    expect(shouldIgnoreDirectory('.git')).toBe(true);
    expect(shouldIgnoreDirectory('.github')).toBe(true);
  });

  it('保留普通目录', () => {
    expect(shouldIgnoreDirectory('docs')).toBe(false);
    expect(shouldIgnoreDirectory('guide')).toBe(false);
  });
});

describe('compareNodes', () => {
  it('目录排在文件前面', () => {
    expect(compareNodes(dir('b', []), file('a'))).toBeLessThan(0);
  });

  it('同类按自然序排列', () => {
    // 文档目录里按数字编号命名很常见，字典序会把 10 排到 2 前面
    const sorted = [file('10.md'), file('2.md'), file('1.md')].sort(compareNodes);
    expect(sorted.map((node) => node.name)).toEqual(['1.md', '2.md', '10.md']);
  });
});

describe('resolveRelativePath', () => {
  it('解析同级链接', () => {
    expect(resolveRelativePath('guide/intro.md', './install.md')).toBe('guide/install.md');
    expect(resolveRelativePath('guide/intro.md', 'install.md')).toBe('guide/install.md');
  });

  it('解析上级链接', () => {
    expect(resolveRelativePath('guide/intro.md', '../api/index.md')).toBe('api/index.md');
  });

  it('解析多级上跳', () => {
    expect(resolveRelativePath('a/b/c/d.md', '../../x.md')).toBe('a/x.md');
  });

  it('解析根路径链接', () => {
    expect(resolveRelativePath('guide/intro.md', '/README.md')).toBe('README.md');
  });

  it('剥离锚点与查询串', () => {
    expect(resolveRelativePath('guide/intro.md', './install.md#安装')).toBe('guide/install.md');
    expect(resolveRelativePath('guide/intro.md', './install.md?v=1')).toBe('guide/install.md');
  });

  it('越过根目录时返回 null', () => {
    // 指向工作区之外的链接无法在文件树里定位，应保持浏览器默认行为
    expect(resolveRelativePath('intro.md', '../outside.md')).toBeNull();
  });

  it('空链接返回 null', () => {
    expect(resolveRelativePath('intro.md', '')).toBeNull();
    expect(resolveRelativePath('intro.md', '#anchor')).toBeNull();
  });

  it('折叠多余的 . 与斜杠', () => {
    expect(resolveRelativePath('guide/intro.md', './/.././api//index.md')).toBe('api/index.md');
  });
});

describe('filterTree', () => {
  const tree = [
    dir('guide', [file('guide/intro.md'), file('guide/install.md')]),
    dir('api', [dir('api/v2', [file('api/v2/index.md')])]),
    file('README.md'),
  ];

  it('空关键词返回完整树', () => {
    expect(filterTree(tree, '')).toHaveLength(3);
  });

  it('命中文件时保留其祖先目录', () => {
    const result = filterTree(tree, 'install');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('guide');
    expect(result[0]?.children?.map((n) => n.id)).toEqual(['guide/install.md']);
  });

  it('命中目录时保留整棵子树', () => {
    const result = filterTree(tree, 'guide');
    expect(result[0]?.children).toHaveLength(2);
  });

  it('跨层级命中仍保持层级完整', () => {
    const result = filterTree(tree, 'index');
    expect(result[0]?.id).toBe('api');
    expect(result[0]?.children?.[0]?.id).toBe('api/v2');
  });

  it('无匹配时返回空数组', () => {
    expect(filterTree(tree, '不存在')).toEqual([]);
  });

  it('不修改原始树', () => {
    const snapshot = JSON.stringify(tree);
    filterTree(tree, 'install');
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});

describe('findNodeByPath', () => {
  const tree = [dir('guide', [file('guide/intro.md')]), file('README.md')];

  it('找到深层节点', () => {
    expect(findNodeByPath(tree, 'guide/intro.md')?.name).toBe('intro.md');
  });

  it('找不到时返回 undefined', () => {
    expect(findNodeByPath(tree, 'missing.md')).toBeUndefined();
  });
});

describe('collectAncestorIds', () => {
  it('列出路径上的全部祖先目录', () => {
    expect(collectAncestorIds('a/b/c/d.md')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('根级文件没有祖先', () => {
    expect(collectAncestorIds('README.md')).toEqual([]);
  });
});
