import { describe, expect, it, vi } from 'vitest';
import DOMPurify from 'dompurify';
import { DEFAULT_SETTINGS, type Settings } from '@/types';
import { sanitizeHtml, sanitizeSvg } from './sanitize';

/** 构造一份带指定 markdown 开关的设置 */
function settingsWith(markdown: Partial<Settings['markdown']>): Settings {
  return { ...DEFAULT_SETTINGS, markdown: { ...DEFAULT_SETTINGS.markdown, ...markdown } };
}

describe('净化配置的复用', () => {
  /**
   * 这条守的是一个性能陷阱，而不是功能。
   *
   * DOMPurify 的 `_parseConfig` 会先比较**对象引用**，引用相同就整段跳过；
   * 每次现构造一个配置字面量则意味着 html + svg + svgFilters + mathMl
   * 四张允许表要重建一遍。单次渲染时这笔开销淹没在总耗时里，分块渲染
   * 要调用上百次，它会一跃成为最大的一项——实测 1MB 文档的净化耗时
   * 因此从 90ms 涨到 628ms。改动 sanitize.ts 时很容易无意间恢复原状。
   */
  it('同一设置下多次调用传入同一个配置对象', () => {
    const spy = vi.spyOn(DOMPurify, 'sanitize');
    try {
      sanitizeHtml('<p>a</p>', DEFAULT_SETTINGS);
      sanitizeHtml('<p>b</p>', DEFAULT_SETTINGS);

      expect(spy).toHaveBeenCalledTimes(2);
      const [, firstConfig] = spy.mock.calls[0] ?? [];
      const [, secondConfig] = spy.mock.calls[1] ?? [];
      expect(firstConfig).toBe(secondConfig);
    } finally {
      spy.mockRestore();
    }
  });

  it('不同的 HTML 开关用不同的配置对象', () => {
    const spy = vi.spyOn(DOMPurify, 'sanitize');
    try {
      sanitizeHtml('<p>a</p>', settingsWith({ html: true }));
      sanitizeHtml('<p>b</p>', settingsWith({ html: false }));

      const [, onConfig] = spy.mock.calls[0] ?? [];
      const [, offConfig] = spy.mock.calls[1] ?? [];
      expect(onConfig).not.toBe(offConfig);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('sanitizeHtml', () => {
  it('剥离 script 与事件属性', () => {
    const html = sanitizeHtml(
      '<p onclick="steal()">正文</p><script>evil()</script>',
      DEFAULT_SETTINGS,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('正文');
  });

  it('保留 KaTeX 需要的 MathML 标签', () => {
    const html = sanitizeHtml('<math><mrow><mi>x</mi></mrow></math>', DEFAULT_SETTINGS);
    expect(html).toContain('<mi>x</mi>');
  });

  it('保留代码块占位需要的 data 属性', () => {
    const html = sanitizeHtml('<figure data-lang="ts"></figure>', DEFAULT_SETTINGS);
    expect(html).toContain('data-lang="ts"');
  });

  it('关闭 HTML 开关时连 iframe 一并移除', () => {
    const html = sanitizeHtml('<iframe src="evil"></iframe>', settingsWith({ html: false }));
    expect(html).not.toContain('iframe');
  });
});

describe('sanitizeSvg', () => {
  it('保留原生 SVG 文本节点', () => {
    const svg = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>节点文字</text></svg>');
    expect(svg).toContain('节点文字');
  });

  it('保留 Mermaid 主题所需的内联 style', () => {
    const svg = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style></svg>');
    expect(svg).toContain('fill:red');
  });

  it('剥离 SVG 内的脚本', () => {
    const svg = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script></svg>');
    expect(svg).not.toContain('evil');
  });

  /**
   * 这条断言记录的是一个设计约束而不是期望行为：
   * DOMPurify 会把 foreignObject（已知 mXSS 向量）连同内部 HTML 一起剥掉，
   * 所以 Mermaid 必须配置 `htmlLabels: false` 改用原生 <text>，
   * 否则图表会变成一堆没有文字的空方框。
   */
  it('会剥离 foreignObject —— 因此 Mermaid 必须关闭 htmlLabels', () => {
    const svg = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">标签</div></foreignObject></svg>',
    );
    expect(svg).not.toContain('标签');
  });
});
