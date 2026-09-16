### Task 5: 实时预览装饰

**Files:**
- Create: `src/editor/live-preview.ts`
- Test: `src/editor/live-preview.test.ts`

**Interfaces:**
- Consumes: `RenderedBlock`（Task 3）、`BlockCache`（Task 4）
- Produces:

```ts
export const setBlocks: StateEffectType<readonly RenderedBlock[]>;
export const blocksField: StateField<readonly RenderedBlock[]>;
/** 给定块与选区，算出哪些块应该被 widget 替换 */
export function visibleBlocks(
  blocks: readonly RenderedBlock[],
  selection: { fromLine: number; toLine: number } | null,
): readonly RenderedBlock[];
export function livePreview(cache: BlockCache): Extension;
```

- [ ] **Step 1: 写失败的测试**

装饰本身依赖真实布局，不做 DOM 级断言；把「哪些块该渲染」这个决策抽成纯函数 `visibleBlocks` 单测。创建 `src/editor/live-preview.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { visibleBlocks } from './live-preview';
import type { RenderedBlock } from './block-render';

const block = (startLine: number, endLine: number): RenderedBlock => ({
  startLine,
  endLine,
  trailing: false,
  html: '<p></p>',
  key: `${String(startLine)}-${String(endLine)}`,
});

describe('visibleBlocks', () => {
  const blocks = [block(0, 1), block(2, 3), block(4, 6)];

  it('没有选区时所有块都渲染（阅读态）', () => {
    expect(visibleBlocks(blocks, null)).toHaveLength(3);
  });

  it('光标所在的块不渲染，其余照常', () => {
    const result = visibleBlocks(blocks, { fromLine: 2, toLine: 2 });
    expect(result.map((b) => b.startLine)).toEqual([0, 4]);
  });

  it('跨多块的选区把涉及的块全部让出为源码', () => {
    const result = visibleBlocks(blocks, { fromLine: 1, toLine: 4 });
    expect(result.map((b) => b.startLine)).toEqual([0]);
  });

  it('选区落在块之间的空行上，不影响任何块', () => {
    const result = visibleBlocks(blocks, { fromLine: 3, toLine: 3 });
    expect(result).toHaveLength(3);
  });

  it('trailing 块永远渲染——它没有源码可让', () => {
    const withTrailing = [...blocks, { ...block(6, 6), trailing: true, key: 't' }];
    const result = visibleBlocks(withTrailing, { fromLine: 6, toLine: 6 });
    expect(result.some((b) => b.trailing)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/editor/live-preview.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

创建 `src/editor/live-preview.ts`：

```ts
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { BlockCache } from './block-cache';
import type { RenderedBlock } from './block-render';

/** 把新一轮渲染结果送进编辑器状态 */
export const setBlocks = StateEffect.define<readonly RenderedBlock[]>();

/**
 * 当前的块列表。
 *
 * 放在 state 里而不是组件的 ref 里：装饰的重算必须与状态更新在同一个事务
 * 里发生，否则会出现「文本已经变了、装饰还指着旧行号」的一帧，
 * CodeMirror 会因为装饰越界直接抛错。
 */
export const blocksField = StateField.define<readonly RenderedBlock[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBlocks)) return effect.value;
    }
    return value;
  },
});

/**
 * 挑出应该被渲染结果替换的块。
 *
 * 规则只有一条：**选区碰到的块让出源码，其余渲染**。抽成纯函数是因为这是
 * 整个实时预览里唯一有分支的决策，而它在真实编辑器里很难构造用例——
 * 得先有文档、有布局、再模拟选区。
 *
 * @param selection 选区覆盖的 0-based 行区间（闭区间）；阅读态传 null
 */
export function visibleBlocks(
  blocks: readonly RenderedBlock[],
  selection: { fromLine: number; toLine: number } | null,
): readonly RenderedBlock[] {
  if (selection === null) return blocks;
  return blocks.filter((block) => {
    // trailing 块没有源码行可以让出，永远保持渲染
    if (block.trailing) return true;
    return block.endLine <= selection.fromLine || block.startLine > selection.toLine;
  });
}

/** 承载一块渲染结果的 widget */
class BlockWidget extends WidgetType {
  constructor(
    private readonly block: RenderedBlock,
    private readonly cache: BlockCache,
  ) {
    super();
  }

  /**
   * 内容相同就认为是同一个 widget，CodeMirror 因此不会重建它的 DOM。
   *
   * 这是块缓存生效的前提：`key` 是块的源码文本，改动一个段落只会让那一个
   * widget 失配，其余整篇复用。
   */
  eq(other: BlockWidget): boolean {
    return other.block.key === this.block.key;
  }

  toDOM(): HTMLElement {
    return this.cache.acquire(this.block.key, this.block.html);
  }

  /**
   * 不把 widget 内部的事件当作编辑器事件。
   *
   * 否则点击块里的链接、展开代码块的折叠按钮都会被编辑器当成「把光标移到
   * 这里」，于是块当场变回源码——正文里所有可点的东西全部失效。
   */
  ignoreEvent(): boolean {
    return true;
  }
}

/** 由块列表与选区算出装饰集 */
function buildDecorations(view: EditorView): DecorationSet {
  const blocks = view.state.field(blocksField);
  if (blocks.length === 0) return Decoration.none;

  const editable = view.state.facet(EditorView.editable);
  const selection = editable
    ? {
        fromLine: view.state.doc.lineAt(view.state.selection.main.from).number - 1,
        toLine: view.state.doc.lineAt(view.state.selection.main.to).number - 1,
      }
    : null;

  const lineCount = view.state.doc.lines;
  const decorations = [];

  for (const block of visibleBlocks(blocks, selection)) {
    if (block.trailing) {
      // 挂在文末：零宽度的插入点，widget 显示在最后一行之后
      const end = view.state.doc.line(lineCount).to;
      decorations.push(
        Decoration.widget({ widget: new BlockWidget(block, cacheOf(view)), block: true, side: 1 }).range(end),
      );
      continue;
    }
    // 行号越界说明块列表比文档旧了一拍，跳过而不是让 CodeMirror 抛错
    if (block.startLine + 1 > lineCount || block.endLine > lineCount) continue;

    const from = view.state.doc.line(block.startLine + 1).from;
    const to = view.state.doc.line(block.endLine).to;
    decorations.push(
      Decoration.replace({ widget: new BlockWidget(block, cacheOf(view)), block: true }).range(from, to),
    );
  }

  return Decoration.set(decorations, true);
}

/** 当前视图使用的缓存，由 livePreview() 闭包注入 */
let activeCache: BlockCache | null = null;
function cacheOf(_view: EditorView): BlockCache {
  if (!activeCache) throw new Error('块缓存尚未初始化');
  return activeCache;
}

/**
 * 实时预览扩展。
 *
 * 用 ViewPlugin 而不是 StateField 产出装饰：装饰依赖 `EditorView.editable`
 * 这个 facet 与视图本身，而 StateField 拿不到 view。
 */
export function livePreview(cache: BlockCache): Extension {
  activeCache = cache;
  return [
    blocksField,
    EditorView.decorations.compute([blocksField, 'selection', EditorView.editable], () =>
      Decoration.none,
    ),
    ViewPluginDecorations,
  ];
}
```

> 注意：`ViewPluginDecorations` 与上面的 `activeCache` 是本步骤要收尾的部分。实现时把它写成一个标准的 `ViewPlugin`，并把 cache 通过 `ViewPlugin.define` 的闭包传入，去掉模块级的 `activeCache`（模块级单例在同时存在两个编辑器实例时会串味）。收尾后的 `livePreview` 形如：

```ts
export function livePreview(cache: BlockCache): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, cache);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, cache);
        } else if (update.transactions.some((tr) => tr.effects.some((e) => e.is(setBlocks)))) {
          this.decorations = buildDecorations(update.view, cache);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [blocksField, plugin];
}
```

`buildDecorations` 相应改签名为 `(view: EditorView, cache: BlockCache)`，内部所有 `cacheOf(view)` 换成 `cache`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/editor/live-preview.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 跑全量验证**

Run: `npm run verify`
Expected: 全部通过（注意 lint 会抓出未使用的 import，收尾时一并清掉）

- [ ] **Step 6: 提交**

```bash
git add src/editor/live-preview.ts src/editor/live-preview.test.ts
git commit -m "feat: 块级实时预览装饰"
```

---

