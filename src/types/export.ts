/**
 * 导出相关类型。
 *
 * 三种格式走的是三条完全不同的路径，不要被「导出」这个统一说法误导：
 * - HTML   ：快照当前 DOM，自带样式，产出一个能独立打开的文件
 * - Markdown：回到源文本，只做保守的空白规整
 * - PDF    ：交给浏览器打印管线（见 export/pdf.ts 的说明）
 */

/** 支持的导出格式 */
export type ExportFormat = 'html' | 'markdown' | 'pdf';

/** 导出结果；失败与取消是两回事，UI 对它们的反应也不同 */
export type ExportResult =
  /** 已写出文件 */
  | { status: 'done'; filename: string; bytes: number }
  /** 用户在保存对话框里取消了，不是错误，不该弹提示 */
  | { status: 'cancelled' }
  /** 真的出错了 */
  | { status: 'error'; message: string };
