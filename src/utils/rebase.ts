/**
 * 相对地址换算。
 *
 * 从 URL 打开的文档（浏览器里直接打开 `.md`）会在扩展页面里渲染，
 * 而正文里的 `![](./img/a.png)`、`[见另一篇](../b.md)` 都是相对于**原始地址**的。
 * 不换算的话，它们会被解析成 `chrome-extension://…/img/a.png`，全是坏链。
 */

/** 已换算过的标记，避免重复处理 */
const REBASED_FLAG = 'data-rebased';

/** 这些协议已经是绝对地址，或本来就不该改动 */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * 把一个可能是相对的地址换算到 base 之下。
 *
 * @returns 换算后的绝对地址；无需换算或换算失败时返回 null
 */
export function rebaseUrl(value: string, base: string): string | null {
  // 空串、纯锚点、以及已经带协议的地址都原样保留
  if (value === '' || value.startsWith('#') || ABSOLUTE.test(value)) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/**
 * 把容器内所有相对的 `img[src]` 与 `a[href]` 换算到 base 之下。
 *
 * 幂等：处理过的元素带标记，分块渲染反复调用只会处理新插入的那些。
 */
export function rebaseRelativeUrls(root: HTMLElement, base: string): void {
  for (const image of root.querySelectorAll<HTMLImageElement>(`img:not([${REBASED_FLAG}])`)) {
    // 读 attribute 而不是 property：property 已经被浏览器解析成绝对地址了
    const raw = image.getAttribute('src') ?? '';
    const next = rebaseUrl(raw, base);
    if (next) image.setAttribute('src', next);
    image.setAttribute(REBASED_FLAG, 'true');
  }

  for (const link of root.querySelectorAll<HTMLAnchorElement>(`a:not([${REBASED_FLAG}])`)) {
    const raw = link.getAttribute('href') ?? '';
    const next = rebaseUrl(raw, base);
    if (next) link.setAttribute('href', next);
    link.setAttribute(REBASED_FLAG, 'true');
  }
}
