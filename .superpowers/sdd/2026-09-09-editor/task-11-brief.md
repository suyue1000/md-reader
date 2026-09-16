### Task 11: 清理分块渲染的残留

阶段 A 的收尾。这些代码在 Task 6 之后已经没有调用方，留着会让下一个读代码的人以为还有第二条渲染路径。

**Files:**
- Delete: `src/markdown/chunker.ts`、`src/markdown/chunker.test.ts`
- Delete: `src/components/markdown/MarkdownView.tsx`
- Delete: `src/hooks/useMarkdownRender.ts`
- Modify: `src/markdown/contract.ts`、`src/markdown/renderer.ts`
- Modify: `src/stores/document.store.ts`
- Modify: `src/components/layout/StatusBar.tsx`
- Modify: `src/hooks/index.ts`、`src/components/index.ts`

- [ ] **Step 1: 确认无引用**

Run:
```bash
grep -rn "chunker\|splitSource\|createSession\|RenderSession\|ChunkResult\|ChunkOptions\|renderProgress\|MarkdownView\|useMarkdownRender\|renderDurationMs\|renderStages\|RenderStages" src/ --include=*.ts --include=*.tsx
```
Expected: 只剩下即将删除的文件自身，以及 `StatusBar.tsx` / `document.store.ts` 里待清理的引用。若有其他引用，先处理它们。

- [ ] **Step 2: 删文件**

```bash
git rm src/markdown/chunker.ts src/markdown/chunker.test.ts \
       src/components/markdown/MarkdownView.tsx \
       src/hooks/useMarkdownRender.ts
```

- [ ] **Step 3: 收缩渲染契约**

`src/markdown/contract.ts` 删除 `RenderSession`、`ChunkResult`、`ChunkOptions`、`RenderStages`，`RenderResult` 去掉 `stages` 与 `durationMs`，`MarkdownRenderer` 接口去掉 `createSession`。

`src/markdown/renderer.ts`：`createSession` 的逻辑内联进 `render()`（现在只有一块，直接 parse → collectHeadings → render → sanitize），删除 `CHUNK_THRESHOLD_CHARS` / `CHUNK_TARGET_CHARS` / `mark()` 与所有计时代码。

- [ ] **Step 4: 收缩 store**

`src/stores/document.store.ts` 删除 `renderProgress` / `setRenderProgress` / `renderDurationMs` / `renderStages` / `setRenderDuration` 及其在 `reset` 中的重置。

- [ ] **Step 5: 改状态栏**

`src/components/layout/StatusBar.tsx` 删除 `formatStages` 与渲染耗时展示，删掉 `RenderStages` 的 import。腾出来的位置留给 Task 17 的保存状态，本任务先只显示文件名、大小与监听状态。

- [ ] **Step 6: 清理桶文件**

`src/hooks/index.ts` 去掉 `useMarkdownRender` 导出；`src/components/index.ts` 去掉 `MarkdownView` 导出。

- [ ] **Step 7: 验证**

Run: `npm run verify && npm run build`
Expected: 全部通过

- [ ] **Step 8: 阶段 A 整体验收**

在浏览器里逐条核对：正文渲染 / 代码高亮 / Mermaid / 公式 / 目录高亮与跳转 / ⌘F 查找 / 导出 HTML / 打印 / 阅读位置恢复 / 自动刷新，全部与改动前一致。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "refactor: 删除分块渲染残留"
```

---

## 阶段 B：编辑与保存

