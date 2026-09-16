### Task 9: 查找改用 CodeMirror 搜索

**Files:**
- Modify: `src/hooks/useSearch.ts`
- Modify: `src/components/search/SearchBar.tsx`
- Delete: `src/search/highlight.ts`
- Modify: `src/search/matcher.ts` / `src/search/search.test.ts`（只保留仍被使用的部分）

**Interfaces:**
- Consumes: `useEditorView()`（Task 8）
- Produces: `useSearch()` 的对外形状不变（`query` / `setQuery` / `count` / `current` / `next` / `previous` / `close`），SearchBar 无需改结构

- [ ] **Step 1: 确认现有对外形状**

Run: `sed -n '1,60p' src/hooks/useSearch.ts`
把 `useSearch` 返回的字段名抄下来，新实现必须逐字保持一致——SearchBar 不改。

- [ ] **Step 2: 写失败的测试**

创建 `src/hooks/useSearch.test.ts`（若已存在则追加）：

```ts
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { countMatches } from '@/search/matcher';

describe('countMatches', () => {
  it('统计源文本中的命中数', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '甲乙甲丙甲' }) });
    expect(countMatches(view, '甲')).toBe(3);
    view.destroy();
  });

  it('空查询返回 0', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '甲' }) });
    expect(countMatches(view, '')).toBe(0);
    view.destroy();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/hooks/useSearch.test.ts`
Expected: FAIL，`countMatches` 不存在

- [ ] **Step 4: 实现**

`src/search/matcher.ts` 改为基于 `@codemirror/search` 的 `SearchQuery`：

```ts
import { SearchQuery } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';

/**
 * 统计命中数。
 *
 * 查的是**源文本**而非渲染结果。差别在于：搜「粗体」能命中 `**粗体**`
 * （这是好事），但一段被行内标记切断的连续文字可能落空。这是所有源码型
 * 编辑器的一致行为，且随着实时预览，用户看到的和搜到的本就是同一份文本。
 */
export function countMatches(view: EditorView, query: string): number {
  if (query === '') return 0;
  const cursor = new SearchQuery({ search: query }).getCursor(view.state);
  let count = 0;
  while (!cursor.next().done) count++;
  return count;
}
```

`src/hooks/useSearch.ts` 改为用 `@codemirror/search` 的 `findNext` / `findPrevious` / `setSearchQuery` / `highlightSelectionMatches`，对外字段名保持不变。`src/search/highlight.ts`（手写的 DOM 高亮）整体删除——`@codemirror/search` 自带命中高亮。

`MarkdownEditor` 的 extensions 里加入 `search({ top: true })` 与 `highlightSelectionMatches()`，但**不注册 CodeMirror 自己的搜索面板快捷键**，`mod+f` 继续由现有的 `useGlobalHotkeys` 打开自研 SearchBar。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run verify`
Expected: 全部通过。`src/search/search.test.ts` 中针对 `highlight.ts` 的用例一并删除。

- [ ] **Step 6: 人工验收**

⌘F 打开查找框，输入关键词，上一条 / 下一条能跳转，计数正确。

- [ ] **Step 7: 提交**

```bash
git add src/hooks/useSearch.ts src/hooks/useSearch.test.ts src/search/ src/components/search/SearchBar.tsx src/editor/MarkdownEditor.tsx
git rm src/search/highlight.ts
git commit -m "refactor: 查找改用 CodeMirror 搜索"
```

---

