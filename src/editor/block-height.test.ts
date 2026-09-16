import { describe, expect, it } from 'vitest';
import { estimateBlockHeight } from './block-height';
import type { RenderedBlock } from './block-render';

/** 造一个块。行区间与 html 分开给，正是因为二者的关系才是估算的全部难点 */
function block(html: string, startLine = 0, endLine = 1): RenderedBlock {
  return { startLine, endLine, trailing: false, html, key: html };
}

/** 一个源码行在高度图里的默认代价，用作「估得够不够」的参照 */
const ONE_LINE = 27;

describe('estimateBlockHeight', () => {
  it('代码块按行数增长，而不是按块算一行', () => {
    // 这是缺陷本身：CodeMirror 拿不到估值时，整块只算一个行高
    const short = estimateBlockHeight(block('<figure class="code-block"></figure>', 0, 3));
    const long = estimateBlockHeight(block('<figure class="code-block"></figure>', 0, 42));
    expect(long).toBeGreaterThan(short * 5);
    expect(long).toBeGreaterThan(800);
  });

  it('代码块扣掉两条围栏行', () => {
    // ```/``` 两行不产生渲染行，算进去会让每个代码块都多估两行
    const three = estimateBlockHeight(block('<figure class="code-block"></figure>', 0, 5));
    const four = estimateBlockHeight(block('<figure class="code-block"></figure>', 0, 6));
    expect(four - three).toBeLessThan(30);
    expect(four).toBeGreaterThan(three);
  });

  it('单行的图片估成几百像素，而不是一行', () => {
    const height = estimateBlockHeight(block('<p><img src="a.png"></p>', 0, 1));
    expect(height).toBeGreaterThan(ONE_LINE * 8);
  });

  it('一段里的多张图片逐张累加', () => {
    const one = estimateBlockHeight(block('<p><img src="a.png"></p>', 0, 1));
    const three = estimateBlockHeight(
      block('<p><img src="a.png"><img src="b.png"><img src="c.png"></p>', 0, 1),
    );
    expect(three).toBeGreaterThan(one * 2.5);
  });

  it('Mermaid 块的高度与源码行数无关', () => {
    // 图还没画出来时源码有多少行完全不说明问题，短图与长图应当估成同一量级
    const short = estimateBlockHeight(block('<div class="mermaid-block">x</div>', 0, 3));
    const long = estimateBlockHeight(block('<div class="mermaid-block">x</div>', 0, 30));
    expect(short).toBe(long);
    expect(short).toBeGreaterThan(ONE_LINE * 8);
  });

  it('表格按行数估，表头也算一行', () => {
    const html = '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>';
    const height = estimateBlockHeight(block(html, 0, 3));
    // 两行 × 每行 60 + 外壳，允许常量微调，只锁量级
    expect(height).toBeGreaterThan(90);
    expect(height).toBeLessThan(220);
  });

  it('块级标签后面的换行各占一个空行盒，要算进高度', () => {
    /*
     * `.cm-content` 的 `white-space: break-spaces` 会继承进块 widget，净化后的
     * HTML 里每个块级标签后面的换行都被保留成一次真实换行。三项列表因此比
     * 「三行文字」高出整整 5 个行盒——不算这一项，列表块会被低估将近一半，
     * 而低估是沿文档累积的，累到一定程度跳转就收敛不了。
     */
    const items = '<li>甲</li>\n<li>乙</li>\n<li>丙</li>\n';
    const withBreaks = estimateBlockHeight(block(`<ul>\n${items}</ul>\n`, 0, 3));
    const withoutBreaks = estimateBlockHeight(
      block('<ul><li>甲</li><li>乙</li><li>丙</li></ul>', 0, 3),
    );
    expect(withBreaks - withoutBreaks).toBeGreaterThan(ONE_LINE * 4);
  });

  it('段落内部的软换行不算空行盒，否则两行的段落会被估成四行', () => {
    // 软换行不在标签后面，本来就已经被源码行数算过一次了
    const soft = estimateBlockHeight(block('<p>第一行\n第二行</p>\n', 0, 2));
    expect(soft).toBeLessThan(ONE_LINE * 4);
    expect(soft).toBeGreaterThan(ONE_LINE * 2);
  });

  it('行内标签后面的软换行也不算空行盒', () => {
    /*
     * `</strong>\n` 与裸的 `\n` 是同一回事——都只是段落里的一次软换行。
     * 判据只看「后面跟着换行」而不看标签名的话，凡是软换行前面恰好收了个
     * 行内标签（加粗、行内代码、链接）的段落都会被多估一行。
     * 实测两种写法的块一样高（都是 94.3px）。
     */
    const inline = estimateBlockHeight(block('<p><strong>第一行</strong>\n第二行</p>\n', 0, 2));
    const bare = estimateBlockHeight(block('<p>第一行\n第二行</p>\n', 0, 2));
    expect(inline).toBe(bare);
  });

  it('硬换行的 <br> 后面那个换行要算：两行文字实际占三个行盒', () => {
    // `甲<br>\n乙`：<br> 断一次，后面的换行在 break-spaces 下再断一次。
    // 实测这样一个块 121.5px，比同样两行文字的软换行段落（94.3px）高一整行
    const hard = estimateBlockHeight(block('<p>第一行<br>\n第二行</p>\n', 0, 2));
    const soft = estimateBlockHeight(block('<p>第一行\n第二行</p>\n', 0, 2));
    expect(hard - soft).toBe(ONE_LINE);
  });

  it('源码写成一行的长段落按折行后的行数估', () => {
    // Markdown 里段落常常不硬换行，一段几百字在源码里只有一行——
    // 不折算的话会被估成 27px，而它实际有好几百
    const long = `<p>${'word '.repeat(200)}</p>`;
    expect(estimateBlockHeight(block(long, 0, 1))).toBeGreaterThan(ONE_LINE * 8);
  });

  it('中文段落按双倍字宽折行，不会被低估一半', () => {
    const chinese = `<p>${'中'.repeat(300)}</p>`;
    const western = `<p>${'a'.repeat(300)}</p>`;
    expect(estimateBlockHeight(block(chinese, 0, 1))).toBeGreaterThan(
      estimateBlockHeight(block(western, 0, 1)),
    );
  });

  it('标签不算进文字量', () => {
    const bare = '<p>短句</p>';
    const wrapped = '<p><strong><em><a href="很长很长很长的一个地址">短句</a></em></strong></p>';
    expect(estimateBlockHeight(block(wrapped, 0, 1))).toBe(estimateBlockHeight(block(bare, 0, 1)));
  });

  it('多行列表至少占源码那么多行', () => {
    // 每项只有两个字，按文字量算不到一行，但屏幕上实打实是 8 行
    const html = `<ul>${'<li>甲</li>'.repeat(8)}</ul>`;
    expect(estimateBlockHeight(block(html, 0, 8))).toBeGreaterThan(ONE_LINE * 8);
  });

  it('标题按级别给高度，级别越高越高', () => {
    const h1 = estimateBlockHeight(block('<h1 id="a">甲</h1>', 0, 1));
    const h3 = estimateBlockHeight(block('<h3 id="a">甲</h3>', 0, 1));
    expect(h1).toBeGreaterThan(h3);
    expect(h3).toBeGreaterThanOrEqual(ONE_LINE);
  });

  it('空块也给一行，不给 0', () => {
    // 0 会让高度图认为这里没有可滚动的内容，落点整体前移一块
    expect(estimateBlockHeight(block('', 0, 1))).toBeGreaterThan(0);
  });

  it('任何块的估值都是有限正数', () => {
    // 估算结果直接进 CodeMirror 的高度图，NaN / 负数会让整段布局崩掉
    const samples = [
      block('<p>甲</p>'),
      block('<figure class="code-block"></figure>', 5, 5),
      block('<table></table>'),
      block('<h7>不存在的级别</h7>'),
      block('<p><img src="a.png"></p>', 3, 3),
    ];
    for (const sample of samples) {
      const height = estimateBlockHeight(sample);
      expect(Number.isFinite(height)).toBe(true);
      expect(height).toBeGreaterThan(0);
    }
  });
});
