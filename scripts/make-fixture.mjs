/**
 * 生成指定体积的 Markdown 压力测试文档。
 *
 *   node scripts/make-fixture.mjs 10 > fixtures/large-10mb.md
 *
 * 内容刻意混合了标题、段落、列表、表格与代码块——只堆段落测不出真实
 * 开销，因为代码块的高亮和表格的布局才是渲染成本的大头。
 */

const targetMb = Number(process.argv[2] ?? 1);
const targetBytes = targetMb * 1024 * 1024;

const WORDS = [
  '渲染', '管线', '增量', '滚动', '锚点', '目录', '缓存', '主线程',
  'token', 'chunk', 'idle', 'observer', 'viewport', 'anchor',
];

/** 取一个伪随机但可复现的词 */
let seed = 42;
function word() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return WORDS[seed % WORDS.length];
}

/** 生成一段有 n 个词的句子 */
function sentence(n) {
  return Array.from({ length: n }, word).join('');
}

const parts = [];
let bytes = 0;
let section = 0;

parts.push('# 大文档压力测试\n\n');

while (bytes < targetBytes) {
  section += 1;
  const block = [
    `## 第 ${section} 节 ${sentence(3)}`,
    '',
    sentence(60) + '。',
    '',
    `### ${section}.1 列表`,
    '',
    ...Array.from({ length: 6 }, (_, i) => `- 第 ${i + 1} 项：${sentence(12)}`),
    '',
    `### ${section}.2 代码`,
    '',
    '```ts',
    `export function step${section}(input: string): number {`,
    '  const parts = input.split("|");',
    '  return parts.reduce((sum, part) => sum + part.length, 0);',
    '}',
    '```',
    '',
    `### ${section}.3 表格`,
    '',
    '| 字段 | 说明 | 默认值 |',
    '| --- | --- | --- |',
    ...Array.from({ length: 5 }, (_, i) => `| f${i} | ${sentence(8)} | ${i * 3} |`),
    '',
    `> ${sentence(20)}`,
    '',
  ].join('\n');

  parts.push(block);
  bytes += Buffer.byteLength(block, 'utf8');
}

process.stdout.write(parts.join(''));
