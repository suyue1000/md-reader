/**
 * 导出相关类型。
 *
 * 三种格式走的是三条完全不同的路径，不要被「导出」这个统一说法误导：
 * - HTML   ：离屏渲一份完整正文再快照（见 editor/offscreen-render.ts），
 *            自带样式，产出一个能独立打开的文件
 * - Markdown：回到源文本，只做保守的空白规整，不需要渲染
 * - PDF    ：交给浏览器打印管线（见 export/index.ts 的说明）
 */

/** 支持的导出格式 */
export type ExportFormat = 'html' | 'markdown' | 'pdf';

/**
 * 文件最终是怎么落盘的。
 *
 * 两者对用户是**两种不同的结果**：`picker` 存到了他自己挑的位置，
 * `download` 落在浏览器的下载目录里、他没得选。后者是降级路径
 * （环境不支持选择器、跨源 iframe 被拒、或者手势过期），
 * 一律报「已导出」会让用户以为文件在他刚选的地方，而其实不在。
 */
export type SaveChannel = 'picker' | 'download';

/** 导出结果；失败与取消是两回事，UI 对它们的反应也不同 */
export type ExportResult =
  /**
   * 已写出文件。
   *
   * `handle` 只在走 `showSaveFilePicker` 时才有——保存编辑中的文档时，
   * 拿到它就能把「另存」升格成「往后可以静默写回」（写权限随选择器授予
   * 一并拿到，不用再单独申请）。降级到 `<a download>` 的那条路没有句柄，
   * 该字段就是 undefined。
   *
   * 别与 `via` 混：`via` 是给用户提示用的「存到哪了」，`handle` 是给
   * 保存链路用的「以后还能不能接着写」，两者当前恰好在同一条分支上
   * 同时成立，但不是一回事——`via: 'picker'` 不保证一定带 `handle`
   * （调用方也可能不需要它，比如导出场景）。
   */
  | {
      status: 'done';
      filename: string;
      bytes: number;
      via: SaveChannel;
      handle?: FileSystemFileHandle;
    }
  /** 用户在保存对话框里取消了，不是错误，不该弹提示 */
  | { status: 'cancelled' }
  /** 真的出错了 */
  | { status: 'error'; message: string };
