import { ensureBuiltinPlugins } from '@/plugins';
import { useSettingsStore } from '@/stores/settings.store';
import { createBlockCache } from './block-cache';
import { enhanceBlock } from './enhance';

/** 离屏渲染的产物；用完必须 dispose */
export interface OffscreenRender {
  /** 完整正文节点，带 `.markdown-body` 类，增强已全部跑完 */
  node: HTMLElement;
  /** 把宿主节点从文档里摘掉并回收观察器 */
  dispose: () => void;
}

/**
 * 离屏渲染整篇文档，跑完全部增强，返回可供快照的节点。
 *
 * ## 为什么需要它
 *
 * 导出与打印过去是直接快照屏幕上的正文（`document.querySelector('.markdown-body')`），
 * 理由是屏幕那份已经跑完了 Shiki / Mermaid / KaTeX。编辑器改成「按块渲染、
 * 只保留视口附近的 widget」之后这个前提塌了两层：
 *
 * 1. 屏幕上**每一个块 widget 都带 `.markdown-body`**，`querySelector` 只取到第一块，
 *    导出得到的是开头一小段；
 * 2. 就算改成取全部块，滚出视口的块 DOM 已经被销毁，页面上根本没有完整正文。
 *
 * 顺带修掉了旧实现的一个毛病：过去导出隐含要求「文档已经渲染完」，
 * 大文档没滚到底就导出会缺内容。自己渲一份之后不再有这个前提。
 *
 * ## 为什么要真的挂进文档
 *
 * 增强钩子（`DomEnhancer`）是对插件开放的公共契约，「拿到的是一棵挂在文档里的树」
 * 是它一直以来的前提——游离节点上计算样式与尺寸全是 0，任何要量一量的增强器
 * 都会静默算错。挪到视口外而不是 `display: none`，是因为后者同样让尺寸归零。
 *
 * 如实记录**当前**这三个内置增强器其实都不依赖这一点，所以这是给契约留的余量，
 * 不是眼下的硬需求：`mermaid.render(id, source)` 不传容器时自己 `select("body")`
 * 并把临时容器挂到 `document.body` 上出图（`node_modules/mermaid/dist/mermaid.core.mjs:1280`），
 * Shiki 走的是「字符串进、字符串出」，图片增强只改属性和挂监听。
 * 代码块增强里唯一要量尺寸的 `enqueueVisible` 在 eager 路径上根本不执行。
 *
 * 宿主节点带 `no-print`：打印时它必须消失，否则一棵定位在 `left:-99999px`、
 * 高度等于整篇文档的绝对定位子树会把纸张撑出大片空白页。
 *
 * @param source 文档源文本。调用方应当传**编辑器里的当前文本**而不是 store 里的副本
 * @param documentId 文档 id，交给渲染器生成稳定锚点
 * @param baseUrl 相对链接基准；没有就不换算
 */
export async function renderOffscreen(
  source: string,
  documentId: string,
  baseUrl: string | undefined,
): Promise<OffscreenRender> {
  /*
   * 整条 Markdown 管线是懒加载的（见 `plugins/index.ts`），这里自己引导一次。
   * 不等 `ensureBuiltinPlugins()` 就渲染，拿到的是一个没注册任何插件的裸
   * markdown-it：脚注、公式、代码块结构、Mermaid 占位全都不会出现，而且不报错。
   */
  const [{ createMarkdownRenderer }] = await Promise.all([
    import('@/markdown'),
    ensureBuiltinPlugins(),
  ]);

  const settings = useSettingsStore.getState().settings;
  const result = await createMarkdownRenderer().render({ source, settings, documentId });

  const host = document.createElement('div');
  host.className = 'no-print';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:absolute;left:-99999px;top:0;width:var(--content-max-width,980px);';

  const node = document.createElement('div');
  node.className = 'markdown-body';
  // HTML 已在渲染器出口经过 DOMPurify 净化
  node.innerHTML = result.html;
  host.appendChild(node);
  document.body.appendChild(host);

  /*
   * 一次性缓存，不碰编辑器那份：缓存的键是「文档里的一个位置」，
   * 把离屏这棵树塞进去会和屏幕上的块抢同一个节点（见 block-cache 的说明）。
   * force / eager 都开着——这棵树是全新的，没有「已增强」可言，
   * 而且必须等增强真的做完才轮到快照。
   */
  const cache = createBlockCache(1);
  await enhanceBlock(node, `offscreen:${documentId}`, cache, baseUrl, true, true);

  return {
    node,
    dispose: () => {
      host.remove();
      // 缓存自带一个 ResizeObserver，不 clear 就留在那里
      cache.clear();
    },
  };
}
