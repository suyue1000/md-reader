/**
 * 样式插槽管理。
 *
 * 阅读器里有三层会互相竞争的样式，必须有明确且**稳定**的胜负规则：
 *
 *   1. 打包的样式表（theme.css / markdown.css / print.css）—— 基础层
 *   2. `<style id="app-theme">` —— 阅读主题令牌与排版变量
 *   3. `<style id="user-style">` —— 用户自定义 CSS，永远在最后，永远能覆盖
 *
 * 这三层的令牌选择器被刻意拉平到同一特异度 (0,0,1)——模式选择器一律写成
 * `:root:where([data-theme='…'])`，见 styles/theme.css 与 themes/css.ts。
 * 特异度持平之后，胜负完全由**文档顺序**决定，于是插入顺序就是优先级本身，
 * 不能再靠「先调用哪个 hook」这种隐式约定——那会随着 hook 顺序调整而悄悄失效。
 * 这个模块把顺序固化下来：主题插槽永远在用户插槽之前。
 *
 * 用户若想只改深色，可以写更高特异度的 `:root[data-theme='dark'] { … }`，
 * 它 (0,1,1) 高于所有令牌层，同样能生效。
 */

/** 样式插槽的元素 id */
export const STYLE_SLOT_IDS = {
  /** 阅读主题令牌 + 排版变量 */
  theme: 'app-theme',
  /** 用户自定义 CSS */
  user: 'user-style',
} as const;

/** 创建一个空的 style 元素 */
function createStyleElement(id: string): HTMLStyleElement {
  const element = document.createElement('style');
  element.id = id;
  return element;
}

/**
 * 取得主题样式插槽。
 *
 * 如果用户插槽已经存在，主题插槽会被插到它**之前**，保证用户 CSS 始终在后。
 */
export function getThemeStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_SLOT_IDS.theme);
  if (existing instanceof HTMLStyleElement) return existing;

  const element = createStyleElement(STYLE_SLOT_IDS.theme);
  const userStyle = document.getElementById(STYLE_SLOT_IDS.user);
  if (userStyle) {
    document.head.insertBefore(element, userStyle);
  } else {
    document.head.appendChild(element);
  }
  return element;
}

/** 取得用户样式插槽；它总是被追加到 head 末尾，因此永远拥有最高优先级 */
export function getUserStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_SLOT_IDS.user);
  if (existing instanceof HTMLStyleElement) return existing;

  const element = createStyleElement(STYLE_SLOT_IDS.user);
  document.head.appendChild(element);
  return element;
}

/** 移除用户样式插槽（自定义 CSS 被清空时） */
export function removeUserStyleElement(): void {
  document.getElementById(STYLE_SLOT_IDS.user)?.remove();
}
