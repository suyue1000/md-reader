### Task 8: 目录跳转与滚动同步

**Files:**
- Modify: `src/types/document.ts`（`TocNode` 加 `line`）
- Modify: `src/markdown/toc.ts`（`buildTocTree` 透传 `line`）
- Modify: `src/markdown/toc.test.ts`
- Modify: `src/hooks/useScrollSpy.ts`
- Modify: `src/components/toc/TocItem.tsx`（点击改为跳行）

**Interfaces:**
- Consumes: `LineHeading`（Task 3）、`scrollToLine`（Task 6）
- Produces: `TocNode` 增加 `line: number`

- [ ] **Step 1: 写失败的测试**

`src/markdown/toc.test.ts` 新增：

```ts
it('折叠成树时保留行号', () => {
  const tree = buildTocTree([
    { id: 'a', text: '一', level: 1, line: 0 },
    { id: 'b', text: '二', level: 2, line: 4 },
  ]);
  expect(tree[0]?.line).toBe(0);
  expect(tree[0]?.children[0]?.line).toBe(4);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/markdown/toc.test.ts`
Expected: FAIL，`line` 不存在于 `TocNode`

- [ ] **Step 3: 改类型与实现**

`src/types/document.ts` 的 `TocNode` 加：

```ts
  /** 标题所在的 0-based 行号，目录跳转据此定位 */
  line: number;
```

`src/markdown/toc.ts` 的 `FlatHeading` 加 `line: number`，`collectHeadings` 从 `token.map?.[0] ?? 0` 取行号，`buildTocTree` 构造节点时带上 `line: heading.line`。

`src/editor/block-render.ts` 里的 `LineHeading` 与 `collectLineHeadings` 因此与 `FlatHeading`/`collectHeadings` 完全重合，删掉 `block-render.ts` 中的这两处，改为 `import { collectHeadings, type FlatHeading } from '@/markdown/toc'`，`BlockRenderResult.headings` 类型改为 `readonly FlatHeading[]`，并同步更新 `block-render.test.ts` 与 `MarkdownEditor.tsx` 的 `onHeadings` 签名。

> 这是有意的收敛：Task 3 时两者差一个字段所以分开写，现在字段对齐了，留两份就是等着分岔。

- [ ] **Step 4: 改滚动同步**

`src/hooks/useScrollSpy.ts` 重写为基于编辑器视口：

```ts
/**
 * 目录高亮跟随滚动。
 *
 * 从 IntersectionObserver 换成「视口顶行 vs 标题行号」：观察器要求标题
 * 元素真实存在于 DOM 里，而编辑器只渲染视口附近的块——滚到文档中部时，
 * 上方所有标题的 DOM 都已经被销毁，观察器无从判断「当前在哪一节」。
 * 行号比对不依赖 DOM 是否存在，反而更准。
 */
export function useScrollSpy(view: EditorView | null): void;
```

实现要点：监听 `EditorView.updateListener` 的 `geometryChanged`/滚动事件，取 `view.lineBlockAtHeight(view.scrollDOM.scrollTop).from` 对应的行号，在 store 的 TOC 里找**行号不大于它的最后一个**标题，写入 `setActiveHeadingId`。用 `requestAnimationFrame` 节流。

- [ ] **Step 5: 改目录点击**

`src/components/toc/TocItem.tsx` 的点击处理从「设置 hash / scrollIntoView」改为调用 `scrollToLine(view, node.line)`。编辑器实例通过一个新的 context 传递——创建 `src/editor/EditorContext.tsx`：

```tsx
import { createContext, useContext } from 'react';
import type { EditorView } from '@codemirror/view';

/**
 * 当前的编辑器实例。
 *
 * 目录、查找、阅读位置都要对同一个视图下指令。用 context 而不是把 view
 * 塞进 Zustand：它是个不可序列化的宿主对象，放进 store 会污染状态快照，
 * 这与 `file-open.ts` 不把文件句柄放进 store 是同一个理由。
 */
const EditorContext = createContext<EditorView | null>(null);
export const EditorProvider = EditorContext.Provider;
export function useEditorView(): EditorView | null {
  return useContext(EditorContext);
}
```

`AppShell` 或 `ReaderPage` 用 `EditorProvider` 包住侧栏与正文。

- [ ] **Step 6: 运行测试确认通过**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 7: 人工验收**

打开带多级标题的文档，滚动时侧栏高亮跟随；点击目录项跳到对应位置。

- [ ] **Step 8: 提交**

```bash
git add src/types/document.ts src/markdown/toc.ts src/markdown/toc.test.ts src/hooks/useScrollSpy.ts src/components/toc/TocItem.tsx src/editor/
git commit -m "refactor: 目录跳转与滚动同步改为行号定位"
```

---

