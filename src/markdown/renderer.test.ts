import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/types';
import { ensureBuiltinPlugins } from '@/plugins';
import { createMarkdownRenderer } from './renderer';

/** 用默认设置渲染一段 Markdown */
async function render(source: string, overrides: Partial<Settings['markdown']> = {}) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    markdown: { ...DEFAULT_SETTINGS.markdown, ...overrides },
  };
  const renderer = createMarkdownRenderer();
  return renderer.render({ source, settings, documentId: 'test' });
}

describe('markdown renderer', () => {
  beforeAll(async () => {
    await ensureBuiltinPlugins();
  });

  it('渲染 GFM 表格', async () => {
    const { html } = await render('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('渲染删除线与高亮', async () => {
    const { html } = await render('~~删除~~ 与 ==高亮==');
    expect(html).toContain('<s>删除</s>');
    expect(html).toContain('<mark>高亮</mark>');
  });

  it('渲染任务列表', async () => {
    const { html } = await render('- [x] 完成\n- [ ] 待办');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('task-list-item');
  });

  it('渲染上标与下标', async () => {
    const { html } = await render('H~2~O 与 x^2^');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
  });

  it('渲染脚注', async () => {
    const { html } = await render('正文[^1]\n\n[^1]: 注解');
    expect(html).toContain('footnote');
  });

  it('把 emoji 短代码转成字符', async () => {
    const { html } = await render('hello :smile:');
    expect(html).toContain('😄');
  });

  it('代码块产出带语言标记的结构', async () => {
    const { html } = await render('```ts\nconst a = 1;\n```');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('data-lang="ts"');
    // 源码必须转义后输出，等待增强阶段再上色
    expect(html).toContain('const a = 1;');
  });

  it('代码块不残留末尾空行', async () => {
    // fence 的 content 永远以换行结尾，直接输出会在带行号时多出一个空行号
    const { html } = await render('```ts\nconst a = 1;\n```');
    expect(html).toContain('<code>const a = 1;</code>');
  });

  it('mermaid 代码块转成占位节点而不是普通代码块', async () => {
    const { html } = await render('```mermaid\ngraph TD;\nA-->B;\n```');
    expect(html).toContain('data-diagram="mermaid"');
    expect(html).not.toContain('class="code-block"');
  });

  it('关闭 mermaid 后按普通代码块渲染', async () => {
    const { html } = await render('```mermaid\ngraph TD;\n```', { mermaid: false });
    expect(html).not.toContain('data-diagram="mermaid"');
    expect(html).toContain('class="code-block"');
  });

  it('抽取标题生成目录树', async () => {
    const { toc } = await render('# 一级\n\n## 二级 A\n\n## 二级 B');
    expect(toc).toHaveLength(1);
    expect(toc[0]?.text).toBe('一级');
    expect(toc[0]?.children.map((n) => n.text)).toEqual(['二级 A', '二级 B']);
  });

  it('目录节点 id 与正文标题 id 一致', async () => {
    const { html, toc } = await render('## 性能报告');
    const id = toc[0]?.id ?? '';
    expect(id).not.toBe('');
    expect(html).toContain(`id="${id}"`);
  });

  it('关闭 TOC 开关后不产出目录', async () => {
    const { toc } = await render('# 标题', { toc: false });
    expect(toc).toEqual([]);
  });

  it('剥离脚本标签', async () => {
    const { html } = await render('<script>alert(1)</script>\n\n正文');
    expect(html).not.toContain('<script');
    expect(html).toContain('正文');
  });

  it('剥离事件处理属性', async () => {
    const { html } = await render('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('阻断 javascript: 链接', async () => {
    const { html } = await render('[点我](javascript:alert(1))');
    // markdown-it 的 validateLink 会直接拒绝生成 <a>，退化成纯文本；
    // 断言的是「不存在指向 javascript: 的链接」这个安全属性本身
    expect(html).not.toMatch(/<a[^>]+href="\s*javascript:/i);
  });

  it('外链自动加上 noopener', async () => {
    const { html } = await render('[外链](https://example.com)');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('站内锚点不加 target', async () => {
    // href 会被 markdown-it 百分号编码，因此按「以 # 开头」匹配而不是原文
    const { html } = await render('# 标题\n\n[跳转](#标题)');
    const internalAnchors = html.match(/<a[^>]+href="#[^"]*"[^>]*>/g) ?? [];
    expect(internalAnchors.length).toBeGreaterThan(0);
    for (const anchor of internalAnchors) {
      expect(anchor).not.toContain('target=');
    }
  });

  it('关闭 HTML 开关后原始标签被转义', async () => {
    const { html } = await render('<b>粗体</b>', { html: false });
    expect(html).toContain('&lt;b&gt;');
  });

  it('同名标题依次获得递增的锚点', async () => {
    const { toc } = await render('## 重复\n\n## 重复\n\n## 重复');
    expect(toc.map((node) => node.id)).toEqual(['重复', '重复-1', '重复-2']);
  });
});
