/**
 * 快捷键组合的解析、匹配与展示。
 *
 * 抽成纯函数是为了可单测——键盘处理是最容易出边界问题的地方
 * （大小写、Mac 与 Windows 的修饰键差异、输入框内是否拦截），
 * 而这些恰恰又最难靠手工点击验证。
 */

/** 解析后的组合键 */
export interface ParsedCombo {
  /** 主键，统一小写 */
  key: string;
  /** 平台主修饰键：Mac 上是 ⌘，其它平台是 Ctrl */
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

/** 当前是否为 macOS */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  // userAgentData 更可靠，但尚未全平台可用，回退到 userAgent
  const uaData: { platform?: string } | undefined = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = uaData?.platform ?? navigator.userAgent;
  return /mac/i.test(platform);
}

/**
 * 解析组合键描述，如 `mod+shift+o`、`mod+,`。
 *
 * 用 `mod` 而不是直接写 `ctrl`：同一份声明在 Mac 上映射到 ⌘、
 * 在 Windows/Linux 上映射到 Ctrl，调用方不需要各写一遍。
 */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const result: ParsedCombo = { key: '', mod: false, shift: false, alt: false };
  for (const part of parts) {
    if (part === 'mod') result.mod = true;
    else if (part === 'shift') result.shift = true;
    else if (part === 'alt' || part === 'option') result.alt = true;
    else result.key = part;
  }
  return result;
}

/**
 * 判断键盘事件是否匹配某个组合键。
 *
 * 严格匹配修饰键：`mod+o` 不会被 `Ctrl+Shift+O` 命中，
 * 否则一个快捷键会连带吃掉一批相近组合，行为不可预测。
 */
export function matchesCombo(event: KeyboardEvent, combo: ParsedCombo, isMac: boolean): boolean {
  if (event.key.toLowerCase() !== combo.key) return false;

  // Mac 上 mod=⌘，此时不允许 Ctrl 同时按下（反之亦然）
  const modPressed = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (modPressed !== combo.mod) return false;
  if (event.shiftKey !== combo.shift) return false;
  if (event.altKey !== combo.alt) return false;

  return true;
}

/** 组合键的展示文本，如 `⌘⇧O` / `Ctrl+Shift+O` */
export function formatCombo(combo: string, isMac: boolean): string {
  const parsed = parseCombo(combo);
  const keyLabel = parsed.key === ',' ? ',' : parsed.key.toUpperCase();

  if (isMac) {
    return `${parsed.mod ? '⌘' : ''}${parsed.shift ? '⇧' : ''}${parsed.alt ? '⌥' : ''}${keyLabel}`;
  }

  const parts: string[] = [];
  if (parsed.mod) parts.push('Ctrl');
  if (parsed.shift) parts.push('Shift');
  if (parsed.alt) parts.push('Alt');
  parts.push(keyLabel);
  return parts.join('+');
}

/**
 * 判断事件是否发生在可编辑区域。
 *
 * 在输入框里按 Ctrl+O 应该交给浏览器/输入法，而不是被阅读器截走；
 * 但 Ctrl+B 这类不产生文本的操作可以放行——所以是否拦截由调用方按键决定，
 * 这里只负责判断「现在是不是在打字」。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // 显式比较而不是直接返回：DOM 类型把它标成 boolean，
  // 但在部分实现（含 jsdom）里普通元素上取到的是 undefined
  return target.isContentEditable === true;
}
