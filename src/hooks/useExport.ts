import { useCallback, useState } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useUiStore } from '@/stores/ui.store';
import { createLogger } from '@/utils/logger';
import type { ExportFormat, ExportResult } from '@/types';
import { useResolvedTheme } from './useTheme';

const log = createLogger('export');

/** 把字节数格式化为人类可读的大小 */
function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 导出动作 */
export interface ExportApi {
  /** 按格式导出当前文档 */
  exportAs: (format: ExportFormat) => Promise<void>;
  /** 是否正在导出（HTML 大文档可能要几百毫秒） */
  busy: boolean;
}

/**
 * 导出能力。
 *
 * 整个导出模块（含 CSS 收集与 DOM 快照）走动态 import：不导出的用户
 * 不该为它付出首屏体积，这与渲染管线、Shiki 的处理是同一套原则。
 *
 * 注意 `exportAs` **必须在用户手势的调用栈内被调用**，否则保存对话框
 * 会被浏览器拒绝。动态 import 的 await 不会破坏这一点——Chrome 的手势
 * 有效期能覆盖它——但如果将来在前面插入了别的耗时步骤就要重新确认。
 */
export function useExport(): ExportApi {
  const [busy, setBusy] = useState(false);
  const theme = useResolvedTheme();
  const showNotice = useUiStore((state) => state.showNotice);

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      const doc = useDocumentStore.getState().document;
      if (!doc) return;

      const api = await import('@/export');

      if (format === 'pdf') {
        // 打印对话框由浏览器接管，没有可上报的结果
        api.exportPdf();
        return;
      }

      setBusy(true);
      try {
        const context = { doc, theme };
        const result: ExportResult =
          format === 'html' ? await api.exportHtml(context) : await api.exportMarkdown(context);

        if (result.status === 'done') {
          showNotice(`已导出 ${result.filename}（${formatSize(result.bytes)}）`);
        } else if (result.status === 'error') {
          showNotice(`导出失败：${result.message}`, 'error');
        }
        // cancelled 是用户自己点的取消，不需要任何提示
      } catch (error) {
        log.error('导出失败', error);
        showNotice('导出失败，详情见控制台', 'error');
      } finally {
        setBusy(false);
      }
    },
    [theme, showNotice],
  );

  return { exportAs, busy };
}
