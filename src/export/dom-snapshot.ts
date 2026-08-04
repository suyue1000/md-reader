/**
 * 正文 DOM 快照。
 *
 * 导出 HTML 时不重跑一遍渲染管线，而是直接**快照屏幕上的 DOM**。
 * 理由是屏幕上的那份才是完整成品：Shiki 已经把 token 包成了带内联色的
 * span、Mermaid 已经出了 SVG、KaTeX 已经把公式展开成了 HTML。
 * 重跑管线不但慢，还得把这三段异步增强再等一遍，而且任何一处实现漂移
 * 都会让「导出的样子」和「看到的样子」对不上——那正是导出功能最不该有的毛病。
 *
 * 代价是快照里混着一些只在屏幕上成立的东西（交互按钮、折叠态），
 * 这个模块负责把它们清理掉。
 */

/** 快照时需要剔除的元素：它们全都依赖 JS，落到静态文件里只会是死按钮 */
const INTERACTIVE_SELECTORS = [
  /** 代码块的复制 / 下载 / 折叠按钮 */
  '.code-block__actions',
  /** 标题旁的 # 锚点，悬停才出现，纸面与静态页上都是噪音 */
  '.heading-anchor',
].join(', ');

/** 增强器留下的内部标记，对导出产物没有意义 */
const INTERNAL_ATTRIBUTES = [
  'data-collapse-policy',
  'data-code-theme',
  'data-img-enhanced',
  'data-mermaid-theme',
  'data-mermaid-id',
];

/**
 * 把实时正文节点整理成可导出的静态片段。
 *
 * 传入的节点不会被修改——内部先深拷贝，因为这个函数是在用户正看着的
 * 页面上调用的，任何就地修改都会让屏幕内容跳一下。
 *
 * @param source 屏幕上的 `.markdown-body` 节点
 * @returns 清理后的克隆节点
 */
export function prepareExportFragment(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;

  for (const element of clone.querySelectorAll(INTERACTIVE_SELECTORS)) {
    element.remove();
  }

  // 折叠是阅读时的临时状态。静态文件里没有「展开」按钮，
  // 保留折叠等于永久藏起半段代码
  for (const block of clone.querySelectorAll('.code-block.is-collapsed')) {
    block.classList.remove('is-collapsed');
  }

  // 懒加载在静态文件里没有收益（没有滚动容器约束），反而可能让
  // 打印时图片来不及加载而印成空白
  for (const image of clone.querySelectorAll('img')) {
    image.removeAttribute('loading');
  }

  for (const element of clone.querySelectorAll<HTMLElement>('*')) {
    for (const name of INTERNAL_ATTRIBUTES) element.removeAttribute(name);
  }

  return clone;
}
