import { useEffect } from 'react';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { resolveRelativePath } from '@/utils/directory';
import { getFileHandleByPath } from '@/utils/file-open';
import { useWorkspace } from './useWorkspace';

/**
 * 文档内相对链接的跳转。
 *
 * 打开文件夹后，`[安装](./install.md)` 这类链接应该在阅读器里直接打开，
 * 而不是让浏览器去请求一个不存在的 `chrome-extension://...install.md`。
 *
 * 实现要点：
 * 1. **事件委托**：监听正文容器而不是给每个 `<a>` 挂监听——正文是
 *    innerHTML 渲染的，每次刷新都会换一批节点，逐个绑定既慢又容易泄漏；
 * 2. **只拦截能处理的**：外链、锚点、以及不在工作区里的相对链接一律放行，
 *    保持浏览器的默认行为（新窗口打开 / 滚动到锚点）；
 * 3. **尊重修饰键**：按住 Ctrl/Cmd 或中键点击时不拦截，让用户仍能
 *    「在新标签页打开」。
 */
export function useRelativeLinks(): void {
  const container = useScrollContainer();
  const currentPath = useDocumentStore((state) => state.document?.path ?? '');
  const rootName = useWorkspaceStore((state) => state.rootName);
  const { openPath } = useWorkspace();

  useEffect(() => {
    // 没打开文件夹时没有可跳转的目标，直接不拦截
    if (!container || rootName === null || currentPath === '') return;

    const handleClick = (event: MouseEvent): void => {
      if (event.defaultPrevented) return;
      // 修饰键点击 = 用户想在新标签页打开，别抢
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;

      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;
      // 站内锚点与绝对链接交给浏览器
      if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;

      const resolved = resolveRelativePath(currentPath, href);
      // 解析不出来或不在工作区里，保持默认行为
      if (!resolved || !getFileHandleByPath(resolved)) return;

      event.preventDefault();
      void openPath(resolved);
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [container, currentPath, rootName, openPath]);
}
