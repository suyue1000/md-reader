import type { ExportResult } from '@/types';
import { canUseFilePicker } from '@/utils/env';

/** 保存对话框的文件类型描述 */
export interface SaveFileType {
  description: string;
  /** MIME -> 扩展名列表 */
  accept: Record<string, string[]>;
}

/** 用户主动取消保存时浏览器抛出的错误名 */
const ABORT_ERROR = 'AbortError';

/** 判断一个错误是不是「用户点了取消」 */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === ABORT_ERROR;
}

/**
 * 退路：用 `<a download>` 触发下载。
 *
 * 没有保存对话框，文件直接落到浏览器的下载目录，用户选不了位置。
 * 只在不支持 File System Access API 时使用。
 */
function downloadViaAnchor(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 点击是同步派发的，此刻下载已经接管了这个 URL，可以立即回收
  URL.revokeObjectURL(url);
}

/**
 * 保存文件。
 *
 * 优先走 `showSaveFilePicker`，让用户自己挑位置和文件名——导出的产物
 * 通常要放到文档旁边（尤其是带相对路径图片的 HTML），丢进下载目录反而麻烦。
 *
 * **必须在用户手势的调用栈内调用**，否则保存对话框会被浏览器拒绝。
 *
 * @returns 写入结果；用户取消返回 `cancelled` 而不是错误
 */
export async function saveFile(
  filename: string,
  blob: Blob,
  type: SaveFileType,
): Promise<ExportResult> {
  // 取出来再判断，而不是调用时才 `window.showSaveFilePicker?.()`：
  // 后者在不支持时会静默地什么都不做，用户点了导出却毫无反应。
  // canUseFilePicker 还挡掉了「API 存在但不让调」的情况——接管页面里的
  // 阅读器是跨源 iframe，浏览器一律拒绝弹选择器
  const picker = window.showSaveFilePicker;
  if (typeof picker !== 'function' || !canUseFilePicker()) {
    downloadViaAnchor(filename, blob);
    return { status: 'done', filename, bytes: blob.size };
  }

  try {
    const handle = await picker({
      suggestedName: filename,
      types: [type],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { status: 'done', filename: handle.name, bytes: blob.size };
  } catch (error) {
    if (isAbort(error)) return { status: 'cancelled' };
    // 选择器被环境拒绝时不该让导出整个失败——退回浏览器下载依然能拿到文件
    if (error instanceof DOMException && error.name === 'SecurityError') {
      downloadViaAnchor(filename, blob);
      return { status: 'done', filename, bytes: blob.size };
    }
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 把文件名换成另一个扩展名。
 *
 * 只替换最后一段扩展名，`notes.zh-CN.md` -> `notes.zh-CN.html`，
 * 不会把中间的 `.zh-CN` 当成扩展名切掉。
 */
export function replaceExtension(filename: string, extension: string): string {
  const base = filename.replace(/\.[^./\\]+$/, '');
  return `${base === '' ? filename : base}.${extension}`;
}
