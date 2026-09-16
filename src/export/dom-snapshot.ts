/**
 * 正文 DOM 快照。
 *
 * ## 快照的对象已经不是屏幕上那棵树了
 *
 * 这个模块原本的设计是「不重跑渲染管线，直接快照屏幕上的 DOM」——理由是屏幕上
 * 那份才是完整成品（Shiki 上完色、Mermaid 出完图、KaTeX 展开完）。
 * 编辑器改成按块渲染之后这条前提塌了：屏幕上**每个块 widget 各带一个
 * `.markdown-body`**，而且滚出视口的块 DOM 会被销毁，页面上根本没有完整正文。
 * 现在传进来的是 `editor/offscreen-render.ts` 离屏渲一份、跑完增强的完整正文。
 *
 * ## 当年反对重跑管线的那条理由，现在真的应验了一处
 *
 * 当年写的是「任何一处实现漂移都会让导出的样子和看到的样子对不上」。
 * 实测下来确实有一处：**块 widget 呈现与连续正文呈现的纵向留白不同**。
 * 标题上下的实际间距，屏幕上是 33.6 / 60.8px，产物上是 37.1 / 13.9px
 * （其余排版逐项相同——字体、字号、行高、颜色、字距、版心宽度、代码内联色、
 * 公式字号，见 task-10 报告判据 4 的对账表）。
 *
 * 差额里原本有 **27.2px 与「块 vs 连续」无关**：那是 `.cm-content` 的
 * `white-space: break-spaces` 继承进块 widget 之后，每个块尾部多出来的一个
 * 空行盒。当时的判断是「**走偏的是屏幕，不是产物**」——产物是正常的排版节奏
 * （标题上宽下窄），屏幕反而下比上还宽。
 *
 * 这一项**已经修掉**：`markdown.css` 给 `.cm-md-block` 补了 `white-space: normal`，
 * `block-height.ts` 那套常量随之重新标定。屏幕与产物的纵向留白因此靠拢，
 * 剩下的差别才是「块 widget vs 连续正文」本身固有的。
 *
 * ## 本模块的职责
 *
 * 把一棵渲染好的正文树整理成可导出的静态片段：剔掉只在屏幕上成立的东西
 * （交互按钮、折叠态、懒加载、增强器的内部标记）。
 * 导出 HTML 与打印（`#print-root`）共用它，两个出口因此不会走偏。
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
 * 传入的节点不会被修改——内部先深拷贝。离屏那棵树的所有权在调用方手上
 * （`renderOffscreen` 的 `dispose` 还要靠它），而打印那条路要把整理结果挂进
 * `#print-root`：不克隆的话等于把节点从离屏宿主里搬走。
 *
 * @param source 一棵渲染好、增强跑完的 `.markdown-body` 节点
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
