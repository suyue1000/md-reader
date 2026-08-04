/**
 * 目录选择器的起始位置推断。
 *
 * 浏览器不接受任意路径作为起始位置——只认几个「知名目录」常量，或者一个
 * 已经拿到的句柄。而接管页面里我们手上只有一个 `file://` 地址，没有句柄。
 * 于是退而求其次：从路径里认出它属于哪个知名目录，让选择器至少落在
 * 正确的那一支上，用户少翻几层。
 */

/** 选择器接受的知名目录 */
export type WellKnownDirectory =
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos';

/** 路径片段（小写）到知名目录的映射，含 macOS 中文系统的显示名 */
const NAME_MAP: ReadonlyMap<string, WellKnownDirectory> = new Map([
  ['desktop', 'desktop'],
  ['桌面', 'desktop'],
  ['documents', 'documents'],
  ['文稿', 'documents'],
  ['文档', 'documents'],
  ['downloads', 'downloads'],
  ['下载', 'downloads'],
  ['music', 'music'],
  ['音乐', 'music'],
  ['pictures', 'pictures'],
  ['图片', 'pictures'],
  ['movies', 'videos'],
  ['videos', 'videos'],
  ['影片', 'videos'],
]);

/**
 * 知名目录最深能出现在第几段。
 *
 * `/Users/me/Downloads/...` 里 Downloads 是第 3 段（下标 2）；
 * Windows 的 `C:/Users/me/Downloads/...` 是第 4 段。放宽到 4 段以内即可，
 * 再深就不是系统目录，而是用户自己建的同名文件夹——那种不该当作起始位置。
 */
const MAX_DEPTH = 4;

/**
 * 从文件路径推断选择器该从哪个知名目录打开。
 *
 * @param path 文件的绝对路径或 `file://` 地址
 * @returns 匹配到的知名目录；认不出来时返回 undefined，交给浏览器用默认值
 */
export function wellKnownStartIn(path: string): WellKnownDirectory | undefined {
  if (path === '') return undefined;

  let text = path;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
      text = decodeURIComponent(new URL(text).pathname);
    }
  } catch {
    // 不是合法 URL 就按普通路径处理
  }

  const segments = text.split(/[/\\]/).filter((segment) => segment !== '');
  const limit = Math.min(segments.length, MAX_DEPTH);
  for (let i = 0; i < limit; i++) {
    const matched = NAME_MAP.get((segments[i] ?? '').toLowerCase());
    if (matched) return matched;
  }
  return undefined;
}
