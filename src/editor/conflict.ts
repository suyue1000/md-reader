import type { MarkdownDocument } from '@/types';
import type { FileProbeResult } from '@/utils/file-open';

/**
 * 一次探测之后应该做什么。
 *
 * 取代了曾经的 `decideRefreshAction`（`src/utils/auto-refresh.ts`，已删除）——
 * 多两种结果，都是编辑能力带来的：
 * - `touch-timestamp` 现在还要覆盖「是我们自己写的」这一种；
 * - `conflict` 是全新的——磁盘变了而本地也有未保存的改动，
 *   这时候把磁盘内容灌回来就是在丢用户正在写的东西。
 *
 * 留两份决策逻辑（旧的 `decideRefreshAction` + 这个）必然分岔，所以旧的
 * 那份连同它的测试一起删掉了，这个是唯一的决策入口。
 */
export type RefreshDecision =
  /** 无事发生，继续监听 */
  | { kind: 'continue' }
  /** 内容实质未变（或就是我们自己写的），只需同步时间戳 */
  | { kind: 'touch-timestamp'; lastModified: number }
  /** 外部改动，本地无未保存内容，直接采用 */
  | { kind: 'adopt'; document: MarkdownDocument }
  /** 外部改动 + 本地有未保存改动，交给用户选 */
  | { kind: 'conflict'; document: MarkdownDocument }
  /** 出现不可恢复的情况，停止监听并告知用户 */
  | { kind: 'stop'; message: string }
  /** 当前文档不具备监听条件 */
  | { kind: 'deactivate' };

export interface RefreshContext {
  /** 编辑器里的当前文本 */
  editorText: string;
  /** 上次从磁盘读到或写回磁盘的内容 */
  savedContent: string;
  /**
   * 这份内容与时间戳是不是我们自己刚写的。
   *
   * 以依赖注入的方式传入而不是在这里直接 import 模块级的登记表
   * （`self-write.ts`）：`decideRefresh` 要保持纯函数，「自写回环」「外部改动
   * 无脏」「外部改动有脏」这三种情形才能在单测里精确构造，而不必依赖那张
   * 登记表的真实状态。
   */
  isSelfWrite: (content: string, lastModified: number) => boolean;
}

export function decideRefresh(result: FileProbeResult, context: RefreshContext): RefreshDecision {
  switch (result.kind) {
    case 'unchanged':
      return { kind: 'continue' };

    case 'changed': {
      const incoming = result.document;

      // 我们自己刚写的：内容与时间戳都对得上，只需把时间戳同步过来，
      // 免得下一轮又读一次内容
      if (context.isSelfWrite(incoming.content, incoming.lastModified)) {
        return { kind: 'touch-timestamp', lastModified: incoming.lastModified };
      }

      // 有些编辑器保存时会更新 mtime 但内容一字未改，重新渲染纯属抖动
      if (incoming.content === context.savedContent) {
        return { kind: 'touch-timestamp', lastModified: incoming.lastModified };
      }

      // 磁盘变了而本地也有未落盘的改动——两边都有值钱的东西，不能自作主张
      const dirty = context.editorText !== context.savedContent;
      return dirty
        ? { kind: 'conflict', document: incoming }
        : { kind: 'adopt', document: incoming };
    }

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
