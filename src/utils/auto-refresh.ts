import type { MarkdownDocument } from '@/types';
import type { FileProbeResult } from './file-open';

/**
 * 一次探测之后应该做什么。
 *
 * 把决策从 hook 里抽出来，是因为这段分支逻辑才是自动刷新真正容易出错的地方：
 * 「时间戳变了但内容没变」「文件没了」「权限失效」各自的处理都不同，
 * 而它们在浏览器里都很难手工复现。抽成纯函数后可以逐个case 覆盖。
 */
export type RefreshAction =
  /** 无事发生，继续监听 */
  | { kind: 'continue' }
  /** 内容没变，只需同步修改时间，避免下一轮重复读取内容 */
  | { kind: 'touch-timestamp'; lastModified: number }
  /** 内容确实变了，应用新文档 */
  | { kind: 'apply'; document: MarkdownDocument }
  /** 出现不可恢复的情况，停止监听并告知用户 */
  | { kind: 'stop'; message: string }
  /** 当前文档不具备监听条件 */
  | { kind: 'deactivate' };

/**
 * 根据探测结果决定下一步动作。
 *
 * @param result 探测结果
 * @param currentContent 当前已渲染的内容，用于识别「时间戳变了但内容没变」
 */
export function decideRefreshAction(
  result: FileProbeResult,
  currentContent: string,
): RefreshAction {
  switch (result.kind) {
    case 'unchanged':
      return { kind: 'continue' };

    case 'changed':
      // 有些编辑器保存时会更新 mtime 但内容一字未改，重新渲染纯属抖动
      return result.document.content === currentContent
        ? { kind: 'touch-timestamp', lastModified: result.document.lastModified }
        : { kind: 'apply', document: result.document };

    case 'missing':
      return { kind: 'stop', message: '文件已被删除或移动，自动刷新已停止' };

    case 'permission-lost':
      // 重新申请权限需要用户手势，轮询里做不到，只能引导用户点刷新
      return { kind: 'stop', message: '文件访问权限已失效，点击工具栏的刷新按钮重新授权' };

    case 'no-handle':
      return { kind: 'deactivate' };

    case 'error':
      return { kind: 'stop', message: `读取失败：${result.message}` };
  }
}
