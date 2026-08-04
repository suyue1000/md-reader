import type { FileTreeNode } from '@/types';
import { MARKDOWN_EXTENSIONS } from './file-open';
import { createLogger } from './logger';

/**
 * 直接读取本地目录，不经过文件选择器。
 *
 * 为什么需要这条路：接管页面里想列出文档所在的目录，靠 File System Access API
 * 是走不通的——`startIn` 只接受几个知名目录常量或一个已有句柄，给不了任意路径，
 * 所以第一次永远落不到目标目录；而句柄又无法在 `file://` 页面里持久化，
 * 每次刷新都要重选。两条都是规范层面的限制，不是实现问题。
 *
 * 换个思路：扩展在拥有 `file:///*` 主机权限（并由用户在扩展详情页勾选
 * 「允许访问文件网址」）时，可以直接读取 `file://` 地址。浏览器为目录地址
 * 返回一个自动生成的列表页，解析它就能枚举条目——不需要句柄，不需要授权框，
 * 每次打开都自动可用。
 *
 * 用 XMLHttpRequest 而不是 fetch：Chrome 的 fetch 不支持 file 协议，
 * 只有 XHR 这条老路能读本地文件。
 */

const log = createLogger('file-listing');

/** 扫描上限，与目录句柄扫描保持一致的量级 */
export const LISTING_LIMITS = { maxEntries: 5000, maxDepth: 8 } as const;

/** 不进入的目录：体量大且几乎不含要读的文档 */
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target']);

/** 目录列表里的一个条目 */
export interface ListedEntry {
  name: string;
  /** 绝对的 file:// 地址；目录以 / 结尾 */
  url: string;
  isDirectory: boolean;
}

/**
 * 解析浏览器生成的目录列表页。
 *
 * 列表页里每个条目对应一次 `addRow(名称, 地址, 是否目录, …)` 调用。
 * 这是浏览器的内部实现，格式可能变——所以解析失败时返回空数组，
 * 由调用方回退到手动选择目录，而不是抛错让整个功能崩掉。
 */
export function parseDirectoryListing(html: string, baseUrl: string): ListedEntry[] {
  const entries: ListedEntry[] = [];
  // 前两个参数是带引号的字符串，第三个是 0/1 的目录标志
  const pattern = /addRow\("((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)",\s*(\d)/g;

  let match = pattern.exec(html);
  while (match !== null) {
    const name = decodeEscapes(match[1] ?? '');
    const href = decodeEscapes(match[2] ?? '');
    const isDirectory = match[3] === '1';
    match = pattern.exec(html);

    // 第一行永远是「上级目录」，不是本目录的内容
    if (name === '..' || href === '') continue;

    try {
      entries.push({ name, url: new URL(href, baseUrl).href, isDirectory });
    } catch {
      // 单条地址解析不了就跳过，不影响其余条目
    }
  }

  return entries;
}

/** 还原列表页里 JS 字符串字面量的转义 */
function decodeEscapes(text: string): string {
  return text.replace(/\\(["'\\/])/g, '$1').replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
    String.fromCharCode(Number.parseInt(code, 16)),
  );
}

/**
 * 读取一个 `file://` 地址的文本内容。
 *
 * @throws 读取失败（无权限、文件不存在）时抛错
 */
export function readFileUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url);
    request.responseType = 'text';
    request.onload = () => {
      // 本地文件读取成功时 status 是 0（没有 HTTP 状态码），不能按 200 判断
      resolve(request.responseText);
    };
    request.onerror = () => {
      reject(new Error(`无法读取 ${url}，请确认已在扩展详情页开启「允许访问文件网址」`));
    };
    request.send();
  });
}

/** 取地址所在的目录（以 / 结尾） */
export function parentDirUrl(fileUrl: string): string {
  const index = fileUrl.lastIndexOf('/');
  return index === -1 ? fileUrl : fileUrl.slice(0, index + 1);
}

/** 是否是要收录的 Markdown 文件 */
function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * 当前工作区里「相对路径 -> file:// 地址」的登记表。
 *
 * 与句柄登记表（file-open.ts）是同一个思路：可序列化的路径进 store，
 * 打开文件所需的定位信息留在模块里。这里存的是地址而非句柄，
 * 因为这条路径根本不需要句柄。
 */
let workspaceUrls = new Map<string, string>();

/** 登记一次扫描结果 */
export function setWorkspaceUrls(urls: ReadonlyMap<string, string>): void {
  workspaceUrls = new Map(urls);
}

/** 按相对路径取回地址 */
export function getWorkspaceUrl(path: string): string | undefined {
  return workspaceUrls.get(path);
}

/** 清空登记表 */
export function clearWorkspaceUrls(): void {
  workspaceUrls = new Map();
}

/** 目录扫描结果 */
export interface UrlScanResult {
  rootName: string;
  tree: FileTreeNode[];
  fileCount: number;
  truncated: boolean;
  /** 相对路径 -> 绝对 file:// 地址 */
  urls: Map<string, string>;
}

/**
 * 递归扫描一个 `file://` 目录，产出与文件树一致的结构。
 *
 * 与句柄扫描（utils/directory.ts）刻意保持相同的产出形状，
 * 这样文件树组件不需要知道数据是从哪条路径来的。
 */
export async function scanFileUrlDirectory(dirUrl: string): Promise<UrlScanResult> {
  const urls = new Map<string, string>();
  let entryCount = 0;
  let fileCount = 0;
  let truncated = false;

  const walk = async (url: string, prefix: string, depth: number): Promise<FileTreeNode[]> => {
    if (depth > LISTING_LIMITS.maxDepth) {
      truncated = true;
      return [];
    }

    let listing: ListedEntry[];
    try {
      listing = parseDirectoryListing(await readFileUrl(url), url);
    } catch (error) {
      log.warn(`读取目录失败：${url}`, error);
      return [];
    }

    const children: FileTreeNode[] = [];
    for (const entry of listing) {
      if (entryCount >= LISTING_LIMITS.maxEntries) {
        truncated = true;
        break;
      }
      entryCount += 1;

      // 隐藏目录与依赖目录一律跳过
      if (entry.name.startsWith('.')) continue;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;

      if (entry.isDirectory) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const sub = await walk(entry.url, path, depth + 1);
        // 不含任何 Markdown 的目录不进树，否则侧栏全是空壳
        if (sub.length > 0) {
          children.push({ id: path, name: entry.name, kind: 'directory', children: sub, depth });
        }
      } else if (isMarkdown(entry.name)) {
        urls.set(path, entry.url);
        fileCount += 1;
        children.push({ id: path, name: entry.name, kind: 'file', depth });
      }
    }

    return children;
  };

  const tree = await walk(dirUrl, '', 0);
  const segments = dirUrl.replace(/\/$/, '').split('/');
  const rootName = decodeURIComponent(segments[segments.length - 1] ?? '') || '/';

  return { rootName, tree, fileCount, truncated, urls };
}
