/**
 * 从文档路径推断它所在的目录名。
 *
 * 只是为了把按钮文案写得具体一点——「打开「docs」文件夹」比
 * 「打开文件夹」更让人知道点下去会发生什么。**推断出的名字不能用来
 * 访问文件系统**：浏览器不会因为页面知道一个路径就把目录交出来。
 */

/**
 * 取路径的上一级目录名。
 *
 * 同时接受 `file:///a/b/c.md` 这样的 URL 和 `a/b/c.md` 这样的相对路径。
 *
 * @returns 目录名；顶层文件或解析失败时返回 null
 */
export function parentDirName(path: string): string | null {
  if (path === '') return null;

  let text = path;
  // 从 URL 里取出路径部分并解码，否则会得到 %E6%80%A7 这种东西
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
      text = decodeURIComponent(new URL(text).pathname);
    }
  } catch {
    // 不是合法 URL 就按普通路径处理
  }

  const segments = text.split(/[/\\]/).filter((segment) => segment !== '');
  // 至少要有「目录 + 文件」两段，否则谈不上上一级
  if (segments.length < 2) return null;
  return segments[segments.length - 2] ?? null;
}
