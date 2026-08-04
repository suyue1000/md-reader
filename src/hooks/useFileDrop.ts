import { useCallback, useEffect, useState } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { MARKDOWN_EXTENSIONS, fileToDocument, setCurrentFileHandle } from '@/utils/file-open';
import { createLogger } from '@/utils/logger';

const log = createLogger('use-file-drop');

/** 判断拖拽内容里是否包含文件 */
function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/** 文件名是否是我们支持的 Markdown 扩展名 */
function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * 把文件拖进窗口即可打开。
 *
 * 监听挂在 window 而不是某个容器上：用户不该被要求精确拖到正文区域，
 * 拖到工具栏、侧栏上同样应该生效。
 *
 * 局限：拖拽拿到的是 `File` 快照而不是句柄，因此这样打开的文档
 * 无法参与自动刷新——状态栏与刷新按钮会如实反映这一点。
 *
 * @returns 当前是否正在拖拽（用于显示落点提示）
 */
export function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false);
  const setDocument = useDocumentStore((state) => state.setDocument);
  const setError = useDocumentStore((state) => state.setError);

  const handleDrop = useCallback(
    async (file: File): Promise<void> => {
      if (!isMarkdownFile(file.name)) {
        setError(`不支持的文件类型：${file.name}`);
        return;
      }
      try {
        // 拖拽没有句柄，清掉上一份，避免刷新按钮误以为还能重新读取
        setCurrentFileHandle(null);
        setDocument(await fileToDocument(file, 'drop'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('读取拖入的文件失败', error);
        setError(`读取失败：${message}`);
      }
    },
    [setDocument, setError],
  );

  useEffect(() => {
    /** 拖拽计数，用于区分「离开子元素」和「离开窗口」 */
    let depth = 0;

    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };

    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      // 不阻止默认行为的话，浏览器会直接用文件替换掉当前页面
      event.preventDefault();
    };

    const onDragLeave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) void handleDrop(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleDrop]);

  return dragging;
}
