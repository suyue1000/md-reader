### Task 3: 块渲染（保留跨块上下文）

**Files:**
- Create: `src/editor/block-render.ts`
- Test: `src/editor/block-render.test.ts`
- Modify: `src/markdown/contract.ts`（`MarkdownRenderer` 接口加 `instance`）
- Modify: `src/markdown/renderer.ts`（实现 `instance`）
- Modify: `src/markdown/toc.ts`（导出 `extractText`）

**Interfaces:**
- Consumes: `sliceTopLevelBlocks(tokens): BlockSlice[]`（Task 2）
- Produces:

```ts
export interface RenderedBlock {
  startLine: number;
  endLine: number;
  trailing: boolean;
  html: string;
  key: string;      // 缓存键 = 本块源码文本
}
export interface LineHeading { id: string; text: string; level: number; line: number }
export interface BlockRenderResult {
  blocks: readonly RenderedBlock[];
  headings: readonly LineHeading[];
}
export function renderBlocks(input: RenderInput): BlockRenderResult;
```

- [ ] **Step 1: 写失败的测试**

创建 `src/editor/block-render.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types';
import { renderBlocks, type BlockRenderResult } from './block-render';

function render(source: string): BlockRenderResult {
  return renderBlocks({ source, settings: DEFAULT_SETTINGS, documentId: 'doc:test' });
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/editor/block-render.test.ts`
Expected: FAIL，`Failed to resolve import "./block-render"`

- [ ] **Step 3: 在渲染器上暴露实例入口**

编辑器要按块渲染，必须自己掌控 parse 与 render 的时机（同一个 `env` 贯穿全篇、逐块 render），这是 `render()` 这个一次成型的接口给不了的。

`src/markdown/contract.ts`：顶部加 `import type MarkdownIt from 'markdown-it';`，并在 `MarkdownRenderer` 接口内新增：

```ts
  /**
   * 取出配置好插件的 markdown-it 实例。
   *
   * 编辑器按块渲染时需要自己掌控 parse 与 render 的时机——同一个 env 贯穿
   * 全篇、逐块 render，这是一次成型的 `render()` 给不了的。
   */
  instance(settings: Settings): MarkdownIt;
```

`src/markdown/renderer.ts`：在 `MarkdownItRenderer` 类内新增：

```ts
  instance(settings: Settings): MarkdownIt {
    return this.ensureInstance(settings);
  }
```

- [ ] **Step 4: 把 toc.ts 的 extractText 改为导出**

`src/markdown/toc.ts` 中 `function extractText` 改为 `export function extractText`。它现在有第二个消费者，注释补一句：

```ts
/**
 * 从 inline token 中提取纯文本（去掉行内标记与图片）。
 *
 * 导出给编辑器的带行号标题收集器复用——同一份「标题文本该长什么样」的
 * 规则出现两份，迟早会在某个语法上分岔。
 */
```

- [ ] **Step 5: 实现 block-render.ts**

```ts
import type Token from 'markdown-it/lib/token.mjs';
import type { RenderInput } from '@/markdown/contract';
import { markdownRenderer } from '@/markdown';
import { sanitizeHtml } from '@/markdown/sanitize';
import { extractText } from '@/markdown/toc';
import { sliceTopLevelBlocks } from './block-slice';

/** 一个已渲染的块 */
export interface RenderedBlock {
  /** 0-based 起始行，含 */
  startLine: number;
  /** 0-based 结束行，不含 */
  endLine: number;
  /** 无源码行区间，以 widget 形式挂在文末（脚注汇总块） */
  trailing: boolean;
  /** 已净化的 HTML */
  html: string;
  /**
   * 缓存键，取本块的源码文本。
   *
   * 不做 hash：源码文本本身就是完美的键，做 hash 反而引入碰撞风险，
   * 而这里的内存开销不过是把文档再存一遍。
   */
  key: string;
}

/** 带行号的标题，供目录跳转 */
export interface LineHeading {
  id: string;
  text: string;
  level: number;
  /** 0-based 行号 */
  line: number;
}

export interface BlockRenderResult {
  blocks: readonly RenderedBlock[];
  headings: readonly LineHeading[];
}

/**
 * 把整篇文档渲染成块。
 *
 * 关键在于**整篇解析一次、共享同一个 `env`**：脚注定义、引用式链接定义、
 * 有序列表的起始编号都是跨块的上下文。逐块独立解析会让 `[^1]` 渲染不出
 * 链接、定义在别处的 `[ref]` 退化成纯文本——而这些内容在导出时是正确的，
 * 于是屏幕与导出对不上，正是本设计要避免的。
 */
export function renderBlocks(input: RenderInput): BlockRenderResult {
  const md = markdownRenderer.instance(input.settings);
  const env: Record<string, unknown> = {};
  const tokens = md.parse(input.source, env);
  const lines = input.source.split('\n');

  const blocks = sliceTopLevelBlocks(tokens).map<RenderedBlock>((slice) => ({
    startLine: slice.startLine,
    endLine: slice.endLine,
    trailing: slice.trailing,
    html: sanitizeHtml(md.renderer.render(slice.tokens, md.options, env), input.settings),
    // trailing 块没有源码，用位置当键。前缀两个换行是为了不与真实的块源码
    // 相撞——块的行区间从内容行开始，源码永远不会以空行起头
    key: slice.trailing
      ? `\n\ntrailing:${String(slice.startLine)}`
      : lines.slice(slice.startLine, slice.endLine).join('\n'),
  }));

  const headings = input.settings.markdown.toc ? collectLineHeadings(tokens) : [];
  return { blocks, headings };
}

/**
 * 收集带行号的标题。
 *
 * 与 `markdown/toc.ts` 的 `collectHeadings` 只差一个 `line` 字段。没有直接
 * 复用那个函数，是因为它的返回类型 `FlatHeading` 被导出管线依赖，给它加
 * 字段会让只需要 id/text/level 的调用方也被迫处理行号。
 */
function collectLineHeadings(tokens: readonly Token[]): LineHeading[] {
  const headings: LineHeading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.type !== 'heading_open') continue;
    const id = token.attrGet('id');
    if (!id || !token.map) continue;
    headings.push({
      id,
      level: Number.parseInt(token.tag.slice(1), 10),
      text: extractText(tokens[i + 1]),
      line: token.map[0],
    });
  }
  return headings;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run src/editor/block-render.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 7: 跑全量验证**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 8: 提交**

```bash
git add src/editor/block-render.ts src/editor/block-render.test.ts src/markdown/renderer.ts src/markdown/contract.ts src/markdown/toc.ts
git commit -m "feat: 按块渲染并保留跨块上下文"
```

---

