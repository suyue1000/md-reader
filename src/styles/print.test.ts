import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 打印样式的结构性用例。
 *
 * 只验三条**改错了不会有任何别的东西变红**的规则。打印是这个项目里唯一
 * 没法在单测里「看见」的输出——jsdom 不模拟 print 媒体，能验的只有规则本身
 * 存不存在、顺序对不对。把 CSS 真的解析成 CSSOM 而不是正则匹配文本，
 * 是为了让「规则写在了 @media print 里面还是外面」这件事成为可断言的事实。
 */

/** 把 print.css 解析成 CSSOM */
function parsePrintCss(): CSSStyleSheet {
  const path = fileURLToPath(new URL('./print.css', import.meta.url));
  const style = document.createElement('style');
  style.textContent = readFileSync(path, 'utf8');
  document.head.appendChild(style);
  const sheet = style.sheet;
  if (!sheet) throw new Error('print.css 解析失败');
  style.remove();
  return sheet;
}

/** 展开成 `{ 选择器, 声明, 是否在 @media print 内, 在表里的序号 }` 的扁平表 */
interface FlatRule {
  selector: string;
  declarations: CSSStyleDeclaration;
  inPrintMedia: boolean;
  index: number;
}

function flatten(sheet: CSSStyleSheet): FlatRule[] {
  const flat: FlatRule[] = [];
  let index = 0;
  const visit = (rules: CSSRuleList, inPrintMedia: boolean): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule) {
        visit(rule.cssRules, inPrintMedia || rule.conditionText.includes('print'));
      } else if (rule instanceof CSSStyleRule) {
        for (const selector of rule.selectorText.split(',')) {
          flat.push({ selector: selector.trim(), declarations: rule.style, inPrintMedia, index });
        }
        index++;
      }
    }
  };
  visit(sheet.cssRules, false);
  return flat;
}

describe('print.css', () => {
  const rules = flatten(parsePrintCss());
  const find = (selector: string, inPrintMedia: boolean): FlatRule | undefined =>
    rules.find((rule) => rule.selector === selector && rule.inPrintMedia === inPrintMedia);

  /**
   * 编辑器只渲染视口附近的块，直接打印它得到的是一份**看起来正常的**残缺文档。
   * 删掉这条规则，纸上会同时出现残缺的编辑器和完整的 #print-root。
   */
  it('打印时隐藏编辑器', () => {
    expect(find('.cm-editor', true)?.declarations.getPropertyValue('display')).toBe('none');
  });

  it('#print-root 平时不可见、打印时显示', () => {
    expect(find('#print-root', false)?.declarations.getPropertyValue('display')).toBe('none');
    expect(find('#print-root', true)?.declarations.getPropertyValue('display')).toBe('block');
  });

  /**
   * 顺序是这两条规则的**全部**：媒体查询不增加特异性，两条都是 (1,0,0)，
   * 谁在后面谁赢。写反了的话打印时 #print-root 依然是 display:none——
   * 纸上一片空白，而屏幕上一切正常、控制台一声不吭。
   */
  it('隐藏 #print-root 的规则必须排在 @media print 的覆盖之前', () => {
    const base = find('#print-root', false);
    const override = find('#print-root', true);
    expect(base).toBeDefined();
    expect(override).toBeDefined();
    expect(base?.index).toBeLessThan(override?.index ?? -1);
  });

  /** 离屏渲染的宿主节点靠这条消失，否则它会把纸张撑出大片空白页 */
  it('.no-print 在打印时被隐藏', () => {
    expect(find('.no-print', true)?.declarations.getPropertyValue('display')).toBe('none');
  });
});
