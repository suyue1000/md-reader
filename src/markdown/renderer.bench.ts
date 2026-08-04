import { bench, describe } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types';
import { ensureBuiltinPlugins } from '@/plugins';
import { createMarkdownRenderer } from './renderer';
import { splitSource } from './chunker';

/**
 * 渲染管线基准。
 *
 * 用 `npm run bench` 跑。它测的是 CPU 部分（解析 / 生成 / 净化），
 * **测不到**布局与绘制——那两项只有真实浏览器里才有意义，
 * 而它们恰恰是大文档的另一半成本。所以这里的数字用来发现
 * 「解析突然慢了三倍」这类回归，不能拿来宣称首屏时间。
 *
 * jsdom 比 Chrome 慢得多，绝对值没有可比性，看的是**同一环境下的相对变化**。
 */

await ensureBuiltinPlugins();

/** 造一篇混合内容的文档：只堆段落测不出真实开销 */
function makeSource(sections: number): string {
  return Array.from({ length: sections }, (_, i) =>
    [
      `## 第 ${String(i)} 节`,
      '',
      '正文'.repeat(60),
      '',
      '- 列表项一',
      '- 列表项二',
      '',
      '```ts',
      `export const value${String(i)} = ${String(i)};`,
      '```',
      '',
      '| 字段 | 说明 |',
      '| --- | --- |',
      '| a | b |',
      '',
    ].join('\n'),
  ).join('\n');
}

const SMALL = makeSource(20);
const MEDIUM = makeSource(400);

describe('切分', () => {
  bench('splitSource 400 节', () => {
    splitSource(MEDIUM, 128 * 1024);
  });
});

describe('一次性渲染', () => {
  const renderer = createMarkdownRenderer();

  bench('小文档（20 节）', async () => {
    await renderer.render({ source: SMALL, settings: DEFAULT_SETTINGS, documentId: 'bench' });
  });

  bench('中等文档（400 节）', async () => {
    await renderer.render({ source: MEDIUM, settings: DEFAULT_SETTINGS, documentId: 'bench' });
  });
});

describe('分块渲染', () => {
  const renderer = createMarkdownRenderer();

  /**
   * 与「一次性渲染 / 中等文档」对照。
   *
   * 分块的每次调用都有固定开销（markdown-it 的 parse、DOMPurify 的初始化），
   * 这一项明显慢于对照组就说明块被切得太碎了——历史上 64KB 就踩过这个坑，
   * 净化总耗时从 105ms 涨到近 700ms。
   */
  bench('中等文档（400 节，逐块）', () => {
    const session = renderer.createSession(
      { source: MEDIUM, settings: DEFAULT_SETTINGS, documentId: 'bench' },
      { thresholdChars: 1, targetChars: 128 * 1024 },
    );
    for (let i = 0; i < session.chunkCount; i++) session.renderChunk(i);
  });
});
