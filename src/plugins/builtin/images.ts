import type { MarkdownPlugin, PluginContext } from '@/types';

/** 已处理标记 */
const ENHANCED_FLAG = 'data-img-enhanced';

/** 放大浮层的元素 id */
const LIGHTBOX_ID = 'image-lightbox';

/**
 * 取得（或创建）图片放大浮层。
 *
 * 全局只保留一个节点并复用：一篇文档里可能有几百张图，
 * 为每张图各建一个浮层是纯浪费，而它们同一时刻只可能开一个。
 */
function getLightbox(): HTMLElement {
  const existing = document.getElementById(LIGHTBOX_ID);
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.id = LIGHTBOX_ID;
  // no-print：浮层是交互态，不该出现在纸上
  overlay.className = 'image-lightbox no-print';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '图片预览');

  const image = document.createElement('img');
  image.className = 'image-lightbox__img';
  image.alt = '';
  overlay.appendChild(image);

  const close = (): void => {
    overlay.hidden = true;
    image.removeAttribute('src');
  };

  overlay.addEventListener('click', close);
  // Esc 关闭：浮层没有可聚焦元素，键盘事件只能挂在 document 上
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });

  document.body.appendChild(overlay);
  return overlay;
}

/** 打开浮层展示指定图片 */
function openLightbox(source: HTMLImageElement): void {
  const overlay = getLightbox();
  const image = overlay.querySelector('img');
  if (!image) return;
  // 用 currentSrc：响应式图片下它才是浏览器真正选中的那一张
  image.src = source.currentSrc || source.src;
  image.alt = source.alt;
  overlay.hidden = false;
}

/**
 * 图片增强。
 *
 * 三件事：原生懒加载、异步解码、点击放大。
 * 长文档里几十张图如果全部同步解码，首屏会被硬生生拖慢几百毫秒；
 * 交给浏览器原生实现比自己写 IntersectionObserver 更省、更稳。
 */
export const imagesPlugin: MarkdownPlugin = {
  id: 'images',
  name: '图片',
  description: '懒加载、异步解码与点击放大',
  order: 40,
  isEnabled: (settings) => settings.markdown.images,

  enhance: (root: HTMLElement, _ctx: PluginContext) => {
    const images = root.querySelectorAll<HTMLImageElement>(`img:not([${ENHANCED_FLAG}])`);
    for (const img of images) {
      img.loading = 'lazy';
      img.decoding = 'async';
      // 没有 alt 的图片对读屏用户是噪音，标为装饰性
      if (!img.hasAttribute('alt')) img.setAttribute('alt', '');

      img.classList.add('is-zoomable');
      img.addEventListener('click', () => {
        openLightbox(img);
      });

      img.setAttribute(ENHANCED_FLAG, 'true');
    }
  },
};
