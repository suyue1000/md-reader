/**
 * 运行环境探测。
 *
 * 扩展页面、单元测试、`vite preview` 三种环境下 `chrome.*` 的可用性不同，
 * 所有依赖扩展 API 的代码都必须先过这一层，避免在测试里炸掉。
 */

/** 是否处于 Chrome 扩展运行时（能访问 chrome.runtime.id） */
export function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string'
  );
}

/** chrome.storage 是否可用 */
export function hasChromeStorage(): boolean {
  return isExtensionContext() && typeof chrome.storage !== 'undefined';
}

/** 当前浏览器是否支持 File System Access API */
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

/**
 * 当前上下文是否处于跨源 iframe 中。
 *
 * 判定方式是「访问 top.location 是否被拒」——同源可读，跨源抛错。
 */
function inCrossOriginFrame(): boolean {
  if (typeof window === 'undefined' || window.top === window.self) return false;
  try {
    // 跨源时读 origin 会抛 SecurityError
    void window.top?.location.origin;
    return false;
  } catch {
    return true;
  }
}

/**
 * 能否弹出文件选择器。
 *
 * 浏览器**禁止第三方（跨源）iframe 打开文件选择器**，无论是打开、
 * 选目录还是另存为，一律抛
 * `Third party iframes are not allowed to show a file picker`。
 * 这直接影响「接管浏览器打开的 .md」这条路径：那里的阅读器是
 * 嵌在 `file://` 页面里的 `chrome-extension://` iframe，正是第三方 iframe。
 *
 * 所以凡是要弹选择器的动作，都必须先问这一句，而不是只看
 * `hasFileSystemAccess()`——API 存在，只是不让调。
 */
export function canUseFilePicker(): boolean {
  return hasFileSystemAccess() && !inCrossOriginFrame();
}

/** 是否为开发构建 */
export const IS_DEV = import.meta.env.DEV;
