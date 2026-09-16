### Task 7: 阅读位置改为行号定位

**Files:**
- Modify: `src/types/document.ts`（`ReadingPosition`）
- Modify: `src/utils/reading-position.ts`
- Modify: `src/utils/reading-position.test.ts`
- Modify: `src/hooks/useReadingPosition.ts`

**Interfaces:**
- Consumes: `scrollToLine(view, line)`（Task 6）
- Produces:

```ts
export interface ReadingPosition {
  documentId: string;
  /** 0-based 行号 */
  line: number;
  /** 该行在视口中的像素偏移，用于长行的精确还原 */
  offset: number;
  updatedAt: number;
}
```

- [ ] **Step 1: 改类型**

`src/types/document.ts` 中 `ReadingPosition` 替换为上面的定义，注释改为：

```ts
/**
 * 单个文档的阅读状态。
 *
 * 记录行号而不是锚点 + 比例：编辑器的文档模型本身就是按行寻址的，行号
 * 是天然稳定的坐标。旧方案要靠「锚点 + 像素偏移 + 比例」三重兜底，是因为
 * 渲染后的 DOM 没有一个稳定的坐标系——标题会被改、高度会随字号变。
 * 行号没有这些问题：改了第 100 行之后的内容，第 50 行还是第 50 行。
 */
```

- [ ] **Step 2: 改测试**

`src/utils/reading-position.test.ts` 里所有构造 `ReadingPosition` 的地方，把 `ratio` / `anchorId` / `anchorOffset` 换成 `line` / `offset`。新增一个用例：

```ts
it('记录与读回行号', () => {
  recordPosition({ documentId: 'doc:a', line: 42, offset: 8, updatedAt: Date.now() }, false);
  expect(getPosition('doc:a')?.line).toBe(42);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/utils/reading-position.test.ts`
Expected: FAIL，类型不匹配

- [ ] **Step 4: 改实现**

`src/utils/reading-position.ts` 的函数签名不变（`recordPosition` / `getPosition` / `hydrateReadingPositions` / `clearPositions`），只是承载的字段变了，主体逻辑无需改动——它对 `ReadingPosition` 的内部结构没有假设。确认 `npm run typecheck` 通过即可。

- [ ] **Step 5: 改 hook**

`src/hooks/useReadingPosition.ts` 改为基于编辑器：滚动时取视口顶部的行号（`view.lineBlockAtHeight` 或 `view.visualLineAtHeight`），恢复时调 `scrollToLine`。参数从 `{ documentId, contentKey, enhancedToken }` 简化为 `{ documentId, view }`：

```ts
/**
 * 阅读位置的记录与恢复。
 *
 * 相比旧实现少了 `contentKey` 与 `enhancedToken` 两个参数——它们存在的
 * 唯一理由是「等分块渲染插完、等 Shiki 与 Mermaid 改完高度」，而行号定位
 * 根本不依赖高度，等待也就没有意义了。
 */
export function useReadingPosition(options: {
  documentId: string;
  view: EditorView | null;
}): void;
```

`ReaderPage.tsx` 相应更新调用；`MarkdownEditor` 需要通过 `onViewReady?: (view: EditorView | null) => void` 把实例暴露出来，在 Step 5 的 effect 里创建后调用、销毁前传 null。

- [ ] **Step 6: 运行测试确认通过**

Run: `npm run verify`
Expected: 全部通过

- [ ] **Step 7: 人工验收**

打开一份长文档，滚到中部，关闭标签页再打开同一文档。
Expected: 回到原处（允许几行误差）。

- [ ] **Step 8: 提交**

```bash
git add src/types/document.ts src/utils/reading-position.ts src/utils/reading-position.test.ts src/hooks/useReadingPosition.ts src/editor/MarkdownEditor.tsx src/viewer/pages/ReaderPage.tsx
git commit -m "refactor: 阅读位置改为行号定位"
```

---

