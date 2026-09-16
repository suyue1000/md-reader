import { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { scrollToLine } from '@/editor/MarkdownEditor';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { findHeadingLine } from '@/markdown/toc';
import { syncAnchorHash } from './useEmbeddedDocument';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { TocNode } from '@/types';
import { resolveRelativePath } from '@/utils/directory';
import { getFileHandleByPath } from '@/utils/file-open';
import { createLogger } from '@/utils/logger';
import { useWorkspace } from './useWorkspace';

const log = createLogger('relative-links');

/**
 * 把 `href` 里的片段还原成锚点 id。
 *
 * markdown-it 渲染链接时会对 URL 做百分号编码，`[见下文](#一、简介)` 到了 DOM
 * 属性上是 `#%E4%B8%80%E3%80%81%E7%AE%80%E4%BB%8B`，而目录里存的 id 是解码后
 * 的原文——不解码就永远对不上，中文标题的锚点会全部失效。`useEmbeddedDocument`
 * 处理地址栏锚点时做的是同一步。
 *
 * 解码失败（半截的百分号转义）时退回原文而不是让异常冒出去：一个坏链接不该
 * 把整个点击处理连同后面的相对链接一起打掉。
 */
function decodeFragment(href: string): string {
  const raw = href.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 文档内链接的跳转：站内锚点与工作区相对路径。
 *
 * 两类链接合在一个监听器里，是因为它们的入口是同一个——正文里的一次点击，
 * 拆成两个 hook 就要在同一个容器上装两个监听器，还得各自重复一遍
 * 「修饰键 / 中键 / defaultPrevented」这套放行判断。
 *
 * ## 站内锚点 `[文字](#某标题)`
 *
 * 手写目录、「见下文的 xxx 一节」这类交叉引用在 Markdown 里极常见。虚拟化
 * 之前这类链接交给浏览器原生处理就行——所有标题都在 DOM 里，浏览器自己能跳。
 * 现在编辑器只渲染视口附近的块，视口外的标题根本不在 DOM 里，浏览器找不到
 * 目标，点击**毫无反应**。所以要拦下来，走与地址栏锚点完全相同的机制：
 * 按 id 在目录里查行号（`findHeadingLine`），再 `scrollToLine`。
 *
 * ## 工作区相对链接 `[安装](./install.md)`
 *
 * 打开文件夹后这类链接应该在阅读器里直接打开，而不是让浏览器去请求一个
 * 不存在的 `chrome-extension://...install.md`。
 *
 * 实现要点：
 * 1. **事件委托**：监听正文容器而不是给每个 `<a>` 挂监听——正文块是按视口
 *    动态挂载/销毁的，逐个绑定既慢又必然泄漏；
 * 2. **只拦截能处理的**：外链、以及不在工作区里的相对链接一律放行，
 *    保持浏览器的默认行为（新窗口打开）；
 * 3. **尊重修饰键**：按住 Ctrl/Cmd 或中键点击时不拦截，让用户仍能
 *    「在新标签页打开」。
 *
 * @param view 编辑器实例；未就绪时为 null，此时锚点跳转不介入
 */
export function useRelativeLinks(view: EditorView | null): void {
  const container = useScrollContainer();
  const currentPath = useDocumentStore((state) => state.document?.path ?? '');
  const toc = useDocumentStore((state) => state.toc);
  const rootName = useWorkspaceStore((state) => state.rootName);
  const { openPath } = useWorkspace();

  /**
   * 目录与编辑器实例走 ref 而不是 effect 依赖。
   *
   * 两者都会频繁换新——每渲染一轮块就是一棵新的目录树，编辑期每 200ms 一次。
   * 放进依赖数组会让这个点击监听器被反复拆装，而它是纯粹的事件委托，
   * 拆装一次不带来任何正确性，只是白干活。点击发生时现读 ref 拿到的必然是
   * 最新值。
   */
  const latestRef = useRef<{ toc: readonly TocNode[]; view: EditorView | null }>({ toc, view });
  // 同步写在 effect 里而不是渲染期：渲染期改 ref 是 React 明令禁止的副作用
  // （lint 也会拦）。点击一定发生在提交之后，读到的必然是最新值
  useEffect(() => {
    latestRef.current = { toc, view };
  }, [toc, view]);

  useEffect(() => {
    if (!container) return;

    /** 站内锚点 `#xxx` 的处理 */
    const handleAnchor = (event: MouseEvent, href: string): void => {
      const id = decodeFragment(href);
      const { toc: currentToc, view: currentView } = latestRef.current;

      const line = findHeadingLine(currentToc, id);
      if (line !== null) {
        // 编辑器还没就绪时放行：此刻正文也还没渲染出来，没有可跳的落点，
        // 交给浏览器至少不会比我们做得更差
        if (!currentView) return;
        event.preventDefault();
        /*
         * 与目录点击同属「显式导航」，撤防的理由与时机完全一致（见
         * `TocPanel.handleSelect` 与 store 的 `navigationEpoch`）：不撤的话，
         * 刚恢复过阅读位置的文档里点一个 `[见下文](#某节)` 同样会被增强后的
         * 校正拽回去。现读 action 而不是订阅，避免这个纯事件委托的监听器
         * 被反复拆装。
         */
        useDocumentStore.getState().markNavigation();
        scrollToLine(currentView, line);
        /*
         * 地址栏要跟上。原本这条路径靠浏览器的原生片段导航顺手改 hash，
         * `preventDefault` 之后那条路没了，得自己补——否则「点正文里的目录
         * 再把地址分享出去」会落回文档开头。
         */
        syncAnchorHash(id);
        return;
      }

      /*
       * 不是标题——脚注引用（`#fn1`）、正文里手写的 `<a id>` 都属于这一类。
       * 目标就在 DOM 里的话浏览器自己能跳，别抢：这条路径在虚拟化之前就是
       * 好的，抢过来反而要重新实现一遍「元素滚动到视口」。
       */
      if (document.getElementById(id)) return;

      /*
       * 既不是标题、目标也不在 DOM 里：**保持原地不动**，这是有意选择。
       *
       * 另外两种可能的行为都更差：放行会让浏览器把地址栏 hash 改成一个跳不到
       * 的片段（页面不动，但后退键的行为变得莫名其妙），而「兜底跳文档顶部」
       * 会把用户从正在读的地方一把甩走——一次误跳比没跳难恢复得多。
       *
       * 但不静默：打一条 warn。锚点失效通常是文档自己写错了（标题改过、
       * 手写的锚点和 slug 规则对不上），用户和文档作者都需要知道。
       */
      event.preventDefault();
      log.warn('锚点在目录与页面里都不存在，已保持原位', id);
    };

    const handleClick = (event: MouseEvent): void => {
      if (event.defaultPrevented) return;
      // 修饰键点击 = 用户想在新标签页打开，别抢
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;

      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#')) {
        handleAnchor(event, href);
        return;
      }
      // 绝对链接交给浏览器
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;

      /*
       * 以下是相对路径分支，它需要「打开过文件夹」这个前提；锚点分支不需要，
       * 所以这道门槛留在这里而不是提到 effect 顶上——提上去会让没打开文件夹时
       * 连锚点都跳不了，而单独打开一个 .md 文件是最常见的用法。
       */
      if (rootName === null || currentPath === '') return;

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
