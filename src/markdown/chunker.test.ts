import { describe, expect, it } from 'vitest';
import { splitSource } from './chunker';

/** 把分块结果重新拼回去，应与原文逐字相同 */
function rejoin(source: string, targetChars: number): string {
  return splitSource(source, targetChars)
    .map((chunk) => chunk.text)
    .join('\n');
}

describe('splitSource', () => {
  it('小文档不切分', () => {
    const source = '# 标题\n\n正文\n';
    expect(splitSource(source, 1024)).toEqual([{ text: source, start: 0 }]);
  });

  it('分块拼回后与原文完全一致', () => {
    // 这是最重要的一条：切分绝不能丢字或多字
    const source = Array.from({ length: 40 }, (_, i) => `## 第 ${i} 节\n\n段落内容。\n`).join('\n');
    expect(rejoin(source, 100)).toBe(source);
  });

  it('start 偏移能对上原文', () => {
    const source = Array.from({ length: 20 }, (_, i) => `## 第 ${i} 节\n\n正文。\n`).join('\n');
    for (const chunk of splitSource(source, 60)) {
      expect(source.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
    }
  });

  it('优先在标题处切开', () => {
    const source = Array.from({ length: 10 }, (_, i) => `## 第 ${i} 节\n\n${'字'.repeat(50)}\n`).join(
      '\n',
    );
    const chunks = splitSource(source, 80);
    expect(chunks.length).toBeGreaterThan(1);
    // 除第一块外，每块都应当以标题开头
    for (const chunk of chunks.slice(1)) {
      expect(chunk.text.startsWith('## ')).toBe(true);
    }
  });

  it('绝不在围栏代码块内部切开', () => {
    // 切开围栏 = 前半块少一个收尾、后半块凭空多出一个开头，两边都会崩
    const code = Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const source = `段落\n\n\`\`\`ts\n${code}\n\`\`\`\n\n段落二\n`;
    for (const chunk of splitSource(source, 50)) {
      const fences = (chunk.text.match(/^```/gm) ?? []).length;
      expect(fences % 2, `块内围栏数应成对：\n${chunk.text.slice(0, 80)}`).toBe(0);
    }
  });

  it('不在列表中间切开', () => {
    // 跨切点的列表会被解析成两个 <ul>，序号和缩进都会重置
    const source = `开头\n\n${Array.from({ length: 60 }, (_, i) => `- 第 ${i} 项`).join('\n')}\n\n结尾\n`;
    for (const chunk of splitSource(source, 40)) {
      expect(chunk.text.startsWith('- ')).toBe(false);
    }
  });

  it('不在引用块中间切开', () => {
    const source = `开头\n\n${Array.from({ length: 60 }, (_, i) => `> 第 ${i} 行`).join('\n')}\n\n结尾\n`;
    for (const chunk of splitSource(source, 40)) {
      expect(chunk.text.startsWith('> ')).toBe(false);
    }
  });

  it('找不到安全切点时退化为单块', () => {
    // 整篇是一个巨大的代码块：慢，但必须正确
    const source = `\`\`\`\n${'x\n'.repeat(500)}\`\`\`\n`;
    expect(splitSource(source, 50)).toHaveLength(1);
  });

  it('空文档与非法参数不会炸', () => {
    expect(splitSource('', 100)).toEqual([{ text: '', start: 0 }]);
    expect(splitSource('abc', 0)).toEqual([{ text: 'abc', start: 0 }]);
  });
});
