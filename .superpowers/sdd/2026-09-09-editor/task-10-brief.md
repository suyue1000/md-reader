### Task 10: 离屏渲染，修复导出与打印

编辑器只渲染视口附近的块，页面上不再有完整的 `.markdown-body`，导出必须自己渲染一份。

**Files:**
- Create: `src/editor/offscreen-render.ts`
- Test: `src/editor/offscreen-render.test.ts`
- Modify: `src/export/index.ts`
- Modify: `src/hooks/useExport.ts`
- Modify: `src/styles/print.css`

**Interfaces:**
- Consumes: `markdownRenderer.render()`、`enhanceBlock`（Task 6）
- Produces:

```ts
/**
 * 离屏渲染整篇文档并跑完所有增强，返回可供快照的节点。
 * 调用方负责在用完后调用返回的 dispose()。
 */
export async function renderOffscreen(
  source: string,
  documentId: string,
  baseUrl: string | undefined,
): Promise<{ node: HTMLElement; dispose: () => void }>;
```

- [ ] **Step 1: 写失败的测试**

创建 `src/editor/offscreen-render.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { renderOffscreen } from './offscreen-render';

describe('renderOffscreen', () => {
  it('产出带 markdown-body 类的完整正文节点', async () => {
    const { node, dispose } = await renderOffscreen('# 标题\n\n正文', 'doc:a', undefined);
    expect(node.classList.contains('markdown-body')).toBe(true);
    expect(node.querySelector('h1')?.textContent).toBe('标题');
    expect(node.querySelector('p')?.textContent).toBe('正文');
    dispose();
  });

  it('dispose 之后节点从文档中移除', async () => {
    const { node, dispose } = await renderOffscreen('正文', 'doc:a', undefined);
    expect(node.isConnected).toBe(true);
    dispose();
    expect(node.isConnected).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/editor/offscreen-render.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

创建 `src/editor/offscreen-render.ts`：

```ts
import { markdownRenderer } from '@/markdown';
import { useSettingsStore } from '@/stores/settings.store';
import { createBlockCache } from './block-cache';
import { enhanceBlock } from './enhance';

/**
 * 离屏渲染整篇文档。
 *
 * 导出与打印过去是直接快照屏幕上的正文，理由是屏幕那份已经跑完了
 * Shiki / Mermaid / KaTeX。编辑器只渲染视口附近的块之后这个前提不成立了，
 * 只能自己渲一份完整的。
 *
 * 顺带修掉了旧实现的一个毛病：过去导出隐含要求「文档已经渲染完」，
 * 大文档没滚到底就导出会缺内容。现在不再有这个前提。
 *
 * 节点必须真的挂进文档（而不是留在 DocumentFragment 里）：Shiki 与
 * Mermaid 都要读计算样式与尺寸，游离节点上这些值全是 0。用绝对定位挪到
 * 视口外，而不是 `display: none`——后者同样让尺寸归零。
 */
export async function renderOffscreen(
  source: string,
  documentId: string,
  baseUrl: string | undefined,
): Promise<{ node: HTMLElement; dispose: () => void }> {
  const settings = useSettingsStore.getState().settings;
  const result = await markdownRenderer.render({ source, settings, documentId });

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:var(--content-max-width,980px);';

  const node = document.createElement('div');
  node.className = 'markdown-body';
  // HTML 已在渲染器出口经过 DOMPurify 净化
  node.innerHTML = result.html;
  host.appendChild(node);
  document.body.appendChild(host);

  // 离屏节点用一次性缓存，不污染编辑器的块缓存
  await enhanceBlock(node, `offscreen:${documentId}`, createBlockCache(1), baseUrl);

  return {
    node,
    dispose: () => {
      host.remove();
    },
  };
}
```

- [ ] **Step 4: 改导出**

`src/export/index.ts` 的 `exportHtml` 不再 `document.querySelector('.markdown-body')`，改为接受调用方传入的节点：

```ts
export interface ExportContext {
  doc: MarkdownDocument;
  theme: ResolvedTheme;
  /** 已渲染好的正文节点，由调用方通过 renderOffscreen 准备 */
  content: HTMLElement;
}
```

`exportHtml` 内 `const content = context.content;`，其余不变。删除模块顶部的 `CONTENT_SELECTOR` 常量。

`exportPdf` 改为接受节点，把它挂进一个 `print-only` 容器再调 `window.print()`：

```ts
/**
 * 导出 PDF（走浏览器打印）。
 *
 * 过去直接打印页面本身，因为页面上就是完整正文。编辑器只渲染视口附近的
 * 块之后，直接打印会得到一份残缺文档，因此改为把离屏渲染的完整正文塞进
 * 一个只在打印时可见的容器，并用 print.css 把编辑器本身隐藏掉。
 */
export function exportPdf(content: HTMLElement): void {
  const container = document.createElement('div');
  container.id = 'print-root';
  container.appendChild(content);
  document.body.appendChild(container);
  const cleanup = (): void => {
    container.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
```

- [ ] **Step 5: 改 useExport**

`src/hooks/useExport.ts` 的 `exportAs` 在调用导出前先离屏渲染：

```ts
      const { renderOffscreen } = await import('@/editor/offscreen-render');
      const { node, dispose } = await renderOffscreen(
        // 编辑器里的文本才是最新的；store 里的 content 可能落后一次未保存的改动
        currentText(),
        doc.id,
        doc.baseUrl,
      );
      try {
        // ... 原有的 exportHtml / exportPdf 调用，传入 node
      } finally {
        dispose();
      }
```

`currentText()` 从 `useEditorView()` 取 `view.state.doc.toString()`，取不到时退回 `doc.content`。

> **手势约束**：`saveFile` 必须在用户手势的调用栈内调用，而离屏渲染是异步的。Chrome 的手势有效期能覆盖 `await`，但链路变长了。实现后必须实测：点击「导出 HTML」能正常弹出保存对话框。若被拒，改为两段式——先渲染、再在一个新的用户确认里弹对话框。这一点在 Step 7 验收。

- [ ] **Step 6: 改 print.css**

`src/styles/print.css` 追加：

```css
/*
 * 打印时隐藏编辑器，只留离屏渲染塞进来的完整正文。
 * 编辑器只渲染视口附近的块，直接打印它会得到一份残缺文档。
 */
@media print {
  .cm-editor { display: none !important; }
  #print-root { display: block; }
}
#print-root { display: none; }
```

- [ ] **Step 7: 运行测试与人工验收**

Run: `npm run verify`
Expected: 全部通过

人工：打开一份含 Mermaid 与公式的长文档，**不滚动**直接导出 HTML。
Expected: 保存对话框正常弹出；产物包含全文，图与公式都在。再打印一次，预览是完整文档而不是空白或半截。

- [ ] **Step 8: 提交**

```bash
git add src/editor/offscreen-render.ts src/editor/offscreen-render.test.ts src/export/index.ts src/hooks/useExport.ts src/styles/print.css
git commit -m "refactor: 导出与打印改用离屏渲染"
```

---

