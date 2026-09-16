import { beforeAll, describe, expect, it } from 'vitest';
import type { MarkdownRenderer } from '@/markdown/contract';
import { createMarkdownRenderer } from '@/markdown/renderer';
import { ensureBuiltinPlugins } from '@/plugins';
import { DEFAULT_SETTINGS } from '@/types';
import { renderBlocks, type BlockRenderResult } from './block-render';

let renderer: MarkdownRenderer;

beforeAll(async () => {
  // 插件是动态 import 的，不等它注册完，脚注/锚点这些用例拿到的是裸 markdown-it
  await ensureBuiltinPlugins();
  renderer = createMarkdownRenderer();
});

function render(source: string): BlockRenderResult {
  return renderBlocks({ source, settings: DEFAULT_SETTINGS, documentId: 'doc:test' }, renderer);
}

describe('renderBlocks', () => {
  it('每块产出自己的 HTML', () => {
    const { blocks } = render('# 标题\n\n正文');
    expect(blocks[0]?.html).toContain('<h1');
    expect(blocks[1]?.html).toContain('正文');
  });

  it('缓存键是块的源码文本，内容相同的两块键也相同', () => {
    const { blocks } = render('正文\n\n正文');
    expect(blocks[0]?.key).toBe('正文');
    expect(blocks[1]?.key).toBe('正文');
  });

  it('跨块上下文保留：脚注引用能渲染成链接', () => {
    const { blocks } = render('正文[^1]\n\n[^1]: 注释');
    const body = blocks.find((b) => !b.trailing && b.html.includes('正文'));
    expect(body?.html).toContain('footnote-ref');
  });

  it('跨块上下文保留：引用式链接定义在别处也能解析', () => {
    const { blocks } = render('看[这里][ref]\n\n[ref]: https://example.com');
    expect(blocks[0]?.html).toContain('https://example.com');
  });

  it('标题带上 0-based 行号，供目录跳转使用', () => {
    const { headings } = render('# 一\n\n正文\n\n## 二');
    expect(headings.map((h) => [h.text, h.line])).toEqual([
      ['一', 0],
      ['二', 4],
    ]);
  });

  it('HTML 经过净化：script 被移除', () => {
    const { blocks } = render('<script>alert(1)</script>');
    expect(blocks.map((b) => b.html).join('')).not.toContain('<script');
  });
});
