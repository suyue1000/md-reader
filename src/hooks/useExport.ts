import { useCallback, useState } from 'react';
import { useEditorView } from '@/editor/EditorContext';
import { useDocumentStore } from '@/stores/document.store';
import { useUiStore } from '@/stores/ui.store';
import { createLogger } from '@/utils/logger';
import type { ExportFormat, ExportResult, MarkdownDocument } from '@/types';
import { getDraftText } from './useAutoSave';
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
 * ## 手势约束与它的预算
 *
 * `exportAs` **必须在用户手势的调用栈内被调用**，否则保存对话框会被浏览器拒绝。
 * Chrome 的瞬时用户激活有效期是 **5 秒**，能覆盖这中间的若干个 await——
 * 包括动态 import 和一整篇文档的离屏渲染。实测（Chrome 152，数字与方法见
 * `.superpowers/sdd/2026-09-09-editor/task-10-report.md` 第三节）：
 * 38KB / 852 行的文档点击到 `showSaveFilePicker` 之间 230~240ms，
 * 192KB / 4228 行（100 个代码块 + 20 张 Mermaid）1.17~1.26s。
 *
 * **这个余量不是无限的，下面三类场景会把它吃掉**，都有本仓库自己的数字佐证：
 *
 * 1. **超大文档**。按本次实测的 192KB → 1.2s 线性外推，约 800KB 就会顶到 5 秒。
 *    Task 2 时曾实测 10MB 文档一次渲染 7.5s（其中 `md.parse()` 独占 6.4s，
 *    数字原记在已删除的 `markdown/chunker.ts` 模块注释里），量级上与这条外推
 *    一致。`renderOffscreen` 是把整篇一次渲染完，这段时间一秒都躲不掉。
 * 2. **慢机器**。上面的数字是在一台 Apple Silicon 机器上量的，Shiki 上色是纯
 *    CPU 计算，低端机上翻几倍是常态。
 * 3. **Mermaid 密集的文档**。`plugins/builtin/mermaid.ts` 对整篇的图是
 *    `await Promise.all(...)` 全量并发出图，没有按视口裁剪，图多就是线性增长。
 *
 * 一旦越界，表现是**保存对话框弹不出来**（Chrome 抛
 * `SecurityError: Must be handling a user gesture to show a file picker`，
 * 而 `saveFile` 会静默降级成浏览器下载）。那时就必须改成两段式：
 * 先渲染，再用一次新的用户确认去弹对话框。
 */
export function useExport(): ExportApi {
  const [busy, setBusy] = useState(false);
  const theme = useResolvedTheme();
  const showNotice = useUiStore((state) => state.showNotice);
  /*
   * 编辑器实例。
   *
   * 导出的必须是**编辑器里的当前文本**：store 里的 `document.content` 是
   * 「上次灌进编辑器的那一份」，用户改过而尚未回写时它就是过期的。
   *
   * 本 hook 经 `useToolbarActions` 用在工具栏上，而工具栏在 `AppShell` 里、
   * `AppShell` 在 `EditorViewProvider` 里（见 `viewer/App.tsx`），所以这里
   * 拿得到实例。Task 9 的查找条就栽在这条上——挂在 provider 之外，
   * `useEditorView()` 永远是 null，功能静默失效。
   */
  const view = useEditorView();

  /**
   * 当前要导出的源文本。
   *
   * 三级回退，中间那一级不是可有可无的：本 hook 经 `useToolbarActions` 有
   * **两份实例**，工具栏那份在 `EditorViewProvider` 里（view 拿得到），而
   * `useGlobalHotkeys` 那份在 `App` 的组件体里、provider 之外（view 恒为
   * null）。少了这一级，从**快捷键**发起的导出与打印会退到
   * `doc.content`——上次落盘的内容——于是编辑态下按 ⌘P 打印出来的是一份
   * 不含刚写内容的文档，全程没有任何提示。⌘S 早先踩的是同一个坑，
   * 用的也是同一份模块级草稿（见 `useAutoSave` 的 `draftText`）。
   */
  const currentText = useCallback(
    (doc: MarkdownDocument): string => view?.state.doc.toString() ?? getDraftText() ?? doc.content,
    [view],
  );

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      const doc = useDocumentStore.getState().document;
      if (!doc) return;

      /**
       * 把导出结果翻译成提示；cancelled 是用户自己点的取消，不提示。
       *
       * 「存到了哪」必须说清楚：走降级路径时文件落在浏览器的下载目录，
       * 而不是用户刚在对话框里挑的位置——统一报「已导出」的话，用户只会觉得
       * 「怎么不让我选位置了」，完全猜不到发生过什么（见 `SaveChannel`）。
       */
      const report = (result: ExportResult): void => {
        if (result.status === 'done') {
          const size = formatSize(result.bytes);
          showNotice(
            result.via === 'picker'
              ? `已导出 ${result.filename}（${size}）`
              : `已下载 ${result.filename}（${size}）到浏览器下载目录——这次没能弹出保存对话框`,
          );
        } else if (result.status === 'error') {
          showNotice(`导出失败：${result.message}`, 'error');
        }
      };

      setBusy(true);
      try {
        const api = await import('@/export');
        const context = { doc, theme, source: currentText(doc) };

        // Markdown 导出的是源文本，不需要渲染——别让它白等一遍 Shiki 和 Mermaid
        if (format === 'markdown') {
          const result = await api.exportMarkdown(context);
          report(result);
          return;
        }

        /*
         * HTML 与打印都要一份完整正文，而页面上没有——编辑器只渲染视口附近的块。
         * 自己渲一份，用完即弃。
         */
        const { renderOffscreen } = await import('@/editor/offscreen-render');
        const { node, dispose } = await renderOffscreen(context.source, doc.id, doc.baseUrl);
        try {
          if (format === 'pdf') {
            // 打印对话框由浏览器接管，没有可上报的结果。
            // 要 await：`exportPdf` 在调 print() 之前还要等图片解码完
            await api.exportPdf(node);
            return;
          }
          report(await api.exportHtml({ ...context, content: node }));
        } finally {
          dispose();
        }
      } catch (error) {
        log.error('导出失败', error);
        showNotice('导出失败，详情见控制台', 'error');
      } finally {
        setBusy(false);
      }
    },
    [theme, showNotice, currentText],
  );

  return { exportAs, busy };
}
