import type { FileTreeNode } from '@/types';
import { MARKDOWN_EXTENSIONS, clearHandleRegistry, registerFileHandle } from './file-open';
import { createLogger } from './logger';

const log = createLogger('directory');

/**
 * 扫描时直接跳过的目录名。
 *
 * 不是为了「好看」，而是为了不被拖死：在前端项目里打开 docs 的父目录时，
 * node_modules 动辄十万个文件，递归进去等于把浏览器挂起。
 */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  '.idea',
  '.vscode',
  'coverage',
  '__pycache__',
  '.DS_Store',
]);

/** 扫描上限，超出后停止并如实告知用户 */
export const SCAN_LIMITS = { maxEntries: 5000, maxDepth: 8 } as const;

/** 扫描结果 */
export interface ScanResult {
  /** 根节点 */
  root: FileTreeNode;
  /** 收录的 Markdown 文件数 */
  fileCount: number;
  /** 是否因触达上限而截断 */
  truncated: boolean;
  /** 已登记句柄的文件路径，供 UI 判断哪些记录还能打开 */
  paths: string[];
}

/** 判断文件名是否是我们支持的 Markdown 扩展名 */
export function isMarkdownFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 目录名是否应被跳过 */
export function shouldIgnoreDirectory(name: string): boolean {
  // 以点开头的目录一律跳过（.github、.husky 之类对读文档没有意义）
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

/**
 * 排序规则：目录在前、文件在后，同类按名称的自然序。
 *
 * 用 `localeCompare` 并开启 numeric，让 `2.md` 排在 `10.md` 前面——
 * 文档目录里按数字编号命名太常见了，字典序会把顺序打乱。
 */
export function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

/**
 * 递归扫描目录，构建文件树。
 *
 * 只收录 Markdown 文件；不含任何 Markdown 的空目录会被剪掉——
 * 在文件树里看到一串点开全是空的目录，纯属噪音。
 */
export async function scanDirectory(root: FileSystemDirectoryHandle): Promise<ScanResult> {
  clearHandleRegistry();

  let entryCount = 0;
  let truncated = false;
  const paths: string[] = [];

  /** 扫描一层目录 */
  const walk = async (
    handle: FileSystemDirectoryHandle,
    path: string,
    depth: number,
  ): Promise<FileTreeNode[]> => {
    if (depth > SCAN_LIMITS.maxDepth) {
      truncated = true;
      return [];
    }

    const children: FileTreeNode[] = [];

    try {
      for await (const [name, entry] of handle.entries()) {
        if (entryCount >= SCAN_LIMITS.maxEntries) {
          truncated = true;
          break;
        }
        entryCount += 1;

        const childPath = path === '' ? name : `${path}/${name}`;

        if (entry.kind === 'directory') {
          if (shouldIgnoreDirectory(name)) continue;
          const grandChildren = await walk(entry as FileSystemDirectoryHandle, childPath, depth + 1);
          // 剪掉不含任何 Markdown 的空目录
          if (grandChildren.length === 0) continue;
          children.push({
            id: childPath,
            name,
            kind: 'directory',
            children: grandChildren,
            depth,
          });
        } else if (isMarkdownFileName(name)) {
          registerFileHandle(childPath, entry as FileSystemFileHandle);
          paths.push(childPath);
          children.push({ id: childPath, name, kind: 'file', depth });
        }
      }
    } catch (error) {
      // 某个子目录读不了（权限、符号链接指向别处）不应该让整次扫描失败
      log.warn(`读取目录 ${path} 失败，已跳过`, error);
    }

    return children.sort(compareNodes);
  };

  const children = await walk(root, '', 0);

  return {
    root: { id: '', name: root.name, kind: 'directory', children, depth: -1 },
    fileCount: paths.length,
    truncated,
    paths,
  };
}

/**
 * 按关键词过滤文件树。
 *
 * 与目录搜索同一套规则：命中的节点保留整棵子树，同时保留祖先以维持层级。
 * 只对文件名匹配——按内容搜索是全文搜索的事（Phase 10）。
 */
export function filterTree(nodes: readonly FileTreeNode[], query: string): FileTreeNode[] {
  const keyword = query.trim().toLowerCase();
  if (keyword === '') return [...nodes];

  const walk = (list: readonly FileTreeNode[]): FileTreeNode[] => {
    const kept: FileTreeNode[] = [];
    for (const node of list) {
      const selfMatched = node.name.toLowerCase().includes(keyword);
      const children = selfMatched ? (node.children ?? []) : walk(node.children ?? []);
      if (selfMatched || children.length > 0) {
        kept.push(node.kind === 'directory' ? { ...node, children } : { ...node });
      }
    }
    return kept;
  };

  return walk(nodes);
}

/**
 * 把文档内的相对链接解析成文件树里的路径。
 *
 * 例如当前文件是 `guide/intro.md`，链接写 `../api/index.md`，
 * 应解析为 `api/index.md`。手写而不是用 `new URL()`：后者需要一个 base
 * origin，而我们处理的是文件树内部的逻辑路径，套 URL 反而要绕一圈。
 *
 * @returns 规范化后的路径；越过根目录时返回 null
 */
export function resolveRelativePath(currentPath: string, href: string): string | null {
  // 去掉锚点与查询串
  const cleanHref = href.split('#')[0]?.split('?')[0] ?? '';
  if (cleanHref === '') return null;

  const segments = cleanHref.startsWith('/')
    ? cleanHref.slice(1).split('/')
    : [...currentPath.split('/').slice(0, -1), ...cleanHref.split('/')];

  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // 越过根目录说明链接指向工作区之外，无法在文件树里定位
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return stack.length > 0 ? stack.join('/') : null;
}

/** 在文件树里按路径查找节点 */
export function findNodeByPath(
  nodes: readonly FileTreeNode[],
  path: string,
): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === path) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

/** 收集从根到目标路径上所有祖先目录的 id，用于自动展开 */
export function collectAncestorIds(path: string): string[] {
  const segments = path.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('/'));
  }
  return ancestors;
}
