### Task 6: 编辑器宿主组件，替换 MarkdownView

阶段 A 的核心一步：页面上的正文由 CodeMirror 呈现。本任务结束时**只读态应与改动前观感一致**。

**Files:**
- Create: `src/editor/MarkdownEditor.tsx`（不叫 `EditorView.tsx`——会与 CodeMirror 自己的 `EditorView` 类撞名）
- Create: `src/editor/theme.ts`
- Create: `src/editor/enhance.ts`
- Test: `src/editor/MarkdownEditor.test.tsx`
- Modify: `src/viewer/pages/ReaderPage.tsx`
- Modify: `src/styles/markdown.css`（补 `.cm-md-block` 的间距归位）

**Interfaces:**
- Consumes: `renderBlocks`（Task 3）、`createBlockCache`（Task 4）、`livePreview` / `setBlocks`（Task 5）
- Produces:

```ts
export interface MarkdownEditorProps {
  /** 文档源文本 */
  value: string;
  /** 文档 id，变化表示换了文档，需要整体重建 */
  documentId: string;
  /** 相对链接基准 */
  baseUrl?: string | undefined;
  /** 是否只读 */
  readOnly: boolean;
  /** 文本变化（编辑态才会触发） */
  onChange?: (value: string) => void;
  /** 每轮块渲染完成后回调，携带带行号的标题 */
  onHeadings?: (headings: readonly LineHeading[]) => void;
}
export function MarkdownEditor(props: MarkdownEditorProps): React.JSX.Element;
/** 供 TOC 跳转与阅读位置恢复使用 */
export function scrollToLine(view: EditorView, line: number): void;
```

- [ ] **Step 1: 写失败的冒烟测试**

创建 `src/editor/MarkdownEditor.test.tsx`：

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownEditor } from './MarkdownEditor';

describe('MarkdownEditor', () => {
  it('只读态下把标题渲染成 h1 而不是源码', async () => {
    render(<MarkdownEditor value="# 你好" documentId="doc:a" readOnly />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('你好');
    });
  });

  it('换文档时重建内容', async () => {
    const { rerender } = render(<MarkdownEditor value="# 甲" documentId="doc:a" readOnly />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('甲');
    });
    rerender(<MarkdownEditor value="# 乙" documentId="doc:b" readOnly />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('乙');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/editor/MarkdownEditor.test.tsx`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现块增强器**

创建 `src/editor/enhance.ts`。这段逻辑从 `MarkdownView.tsx` 的第二个 effect 搬过来，但作用域从「整个正文」缩小到「一个块」：

```ts
import { ensureBuiltinPlugins, pluginRegistry } from '@/plugins';
import { useSettingsStore } from '@/stores/settings.store';
import { createLogger } from '@/utils/logger';
import { rebaseRelativeUrls } from '@/utils/rebase';
import type { BlockCache } from './block-cache';

const log = createLogger('editor-enhance');

/**
 * 对一个块 DOM 跑插件的增强钩子。
 *
 * 与旧的整篇增强的区别只有作用域：块 widget 是按需创建的，只有真正进入
 * 视口的块才值得跑 Shiki 与 Mermaid。增强结果由块缓存持有，滚出去再滚
 * 回来不会重跑。
 *
 * 增强器本身是幂等的（Phase 5 起的约定），因此重复调用是安全的；
 * `cache.isEnhanced` 只是省掉一次无谓的遍历。
 */
export async function enhanceBlock(
  node: HTMLElement,
  key: string,
  cache: BlockCache,
  baseUrl: string | undefined,
): Promise<void> {
  if (cache.isEnhanced(key)) return;

  // 相对链接必须在增强之前换算：图片增强会读 src 决定懒加载策略
  if (baseUrl) rebaseRelativeUrls(node, baseUrl);

  const ctx = {
    settings: useSettingsStore.getState().settings,
    requestRerender: () => undefined,
  };

  const [{ syncPluginStyles }] = await Promise.all([
    import('@/markdown/plugin-styles'),
    ensureBuiltinPlugins(),
  ]);

  await Promise.all([
    syncPluginStyles(pluginRegistry.all(), ctx.settings, node),
    ...pluginRegistry.enabled(ctx.settings).map(async (plugin) => {
      if (!plugin.enhance) return;
      try {
        await plugin.enhance(node, ctx);
      } catch (error) {
        // 某个增强器失败只影响它自己的那部分内容
        log.warn(`插件 ${String(plugin.id)} 的 DOM 增强失败`, error);
      }
    }),
  ]);

  cache.markEnhanced(key);
}
```

- [ ] **Step 4: 实现编辑器主题**

创建 `src/editor/theme.ts`。目标是让 CodeMirror 不带来任何自己的视觉主张——版心、字体、颜色全部沿用现有 CSS 变量：

```ts
import { EditorView } from '@codemirror/view';

/**
 * 编辑器外观。
 *
 * 一条自己的颜色都不写，全部指向应用已有的 CSS 变量。CodeMirror 自带的
 * 默认主题假设自己是个代码编辑器（等宽字体、深色底、行高紧凑），套在
 * 阅读器上会和四套阅读主题全部打架。
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--app-text)',
    fontFamily: 'var(--content-font-family)',
    fontSize: 'var(--content-font-size)',
  },
  '.cm-content': {
    padding: '2.5rem 2rem 4rem',
    maxWidth: 'var(--content-max-width)',
    margin: '0 auto',
    caretColor: 'var(--app-accent)',
    lineHeight: 'var(--content-line-height)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'auto',
  },
  '&.cm-focused': { outline: 'none' },
  // 源码态的行：让 Markdown 标记比正文淡一档，视觉上退到背景里
  '.cm-line': { padding: '0' },
  // 块 widget 自己带 .markdown-body，间距由 markdown.css 负责
  '.cm-md-block': { margin: '0' },
});
```

- [ ] **Step 5: 实现宿主组件**

创建 `src/editor/MarkdownEditor.tsx`：

```tsx
import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { useSettingsStore } from '@/stores/settings.store';
import { debounce } from '@/utils/fn';
import { createBlockCache } from './block-cache';
import { renderBlocks, type LineHeading } from './block-render';
import { enhanceBlock } from './enhance';
import { livePreview, setBlocks } from './live-preview';
import { editorTheme } from './theme';

/** 重新渲染块的防抖间隔。打字期间不必每个字符都重排整篇 */
const RENDER_DEBOUNCE_MS = 200;

export interface MarkdownEditorProps {
  value: string;
  documentId: string;
  baseUrl?: string | undefined;
  readOnly: boolean;
  onChange?: (value: string) => void;
  onHeadings?: (headings: readonly LineHeading[]) => void;
}

/** 把视图滚动到指定的 0-based 行，供目录跳转与阅读位置恢复使用 */
export function scrollToLine(view: EditorView, line: number): void {
  const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
  view.dispatch({
    effects: EditorView.scrollIntoView(target.from, { y: 'start' }),
  });
}

/**
 * Markdown 编辑器视图。
 *
 * 这是页面上**唯一**的文档呈现方式：阅读态是它的只读状态，编辑态是它的
 * 可写状态。不存在第二条渲染路径，因此也不存在「阅读时看到的」和
 * 「编辑时看到的」不一致的可能。
 */
export function MarkdownEditor({
  value,
  documentId,
  baseUrl,
  readOnly,
  onChange,
  onHeadings,
}: MarkdownEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cacheRef = useRef(createBlockCache());
  // 用 ref 持有回调，避免它们变化就重建整个编辑器
  const callbacksRef = useRef({ onChange, onHeadings, baseUrl });
  callbacksRef.current = { onChange, onHeadings, baseUrl };

  // 换文档才重建编辑器；只是内容变化走 dispatch，保住撤销栈与滚动位置
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const cache = cacheRef.current;
    cache.clear();

    const rerender = (source: string, view: EditorView): void => {
      const settings = useSettingsStore.getState().settings;
      const { blocks, headings } = renderBlocks({ source, settings, documentId });
      view.dispatch({ effects: setBlocks.of(blocks) });
      callbacksRef.current.onHeadings?.(headings);

      // 增强已经挂进 DOM 的块。widget 是按需创建的，这里只处理当前存在的
      for (const node of view.dom.querySelectorAll<HTMLElement>('.cm-md-block')) {
        const key = node.dataset.blockKey;
        if (key !== undefined) void enhanceBlock(node, key, cache, callbacksRef.current.baseUrl);
      }
    };

    const scheduleRerender = debounce(rerender, RENDER_DEBOUNCE_MS);

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      editorTheme,
      livePreview(cache),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(readOnly),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const text = update.state.doc.toString();
        callbacksRef.current.onChange?.(text);
        scheduleRerender(text, update.view);
      }),
    ];

    const view = new EditorView({ doc: value, extensions, parent: host });
    viewRef.current = view;
    // 首轮渲染同步进行：等一个防抖周期会让打开文档时先闪一眼源码
    rerender(value, view);

    return () => {
      view.destroy();
      viewRef.current = null;
      cache.clear();
    };
    // value 只作为初始文档；后续内容变化由下面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // 只读态下外部内容变化（自动刷新）需要灌进编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // 只读开关不重建编辑器，用 reconfigure 切
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: EditorView.editable.reconfigure(EditorView.editable.of(!readOnly)),
    });
  }, [readOnly]);

  return <div ref={hostRef} className="h-full" />;
}
```

> `data-blockKey` 需要在 `block-cache.ts` 的 `acquire` 里写上：`node.dataset.blockKey = key;`。补上这一行并在 `block-cache.test.ts` 里加一个断言 `expect(cache.acquire('a', '<p/>').dataset.blockKey).toBe('a')`。

- [ ] **Step 6: 接进 ReaderPage**

`src/viewer/pages/ReaderPage.tsx`：把 `MarkdownView` 换成 `MarkdownEditor`，删掉 `useMarkdownRender`、`chunks` / `sessionKey` / `complete` / `contentKey` / `readingKey` / `enhancedToken` 这一整套分块渲染的脚手架。正文部分改为：

```tsx
  return (
    <MarkdownEditor
      value={doc.content}
      documentId={doc.id}
      baseUrl={doc.baseUrl}
      readOnly
      onHeadings={handleHeadings}
    />
  );
```

`handleHeadings` 把带行号的标题折叠成树写进 store：

```tsx
  const setToc = useDocumentStore((state) => state.setToc);
  const handleHeadings = useCallback(
    (headings: readonly LineHeading[]) => {
      setToc(buildTocTree(headings));
    },
    [setToc],
  );
```

`buildTocTree` 的入参类型 `FlatHeading` 需要接受多出来的 `line` 字段——它是结构化子类型，`LineHeading` 天然可赋值给 `FlatHeading`，但产出的 `TocNode` 会丢掉行号。Task 8 会处理这一点，本任务先让目录能出来即可。

外层 `<article>` 的 `px-8 py-10` 与 `max-width` 移除——这些现在由 `editorTheme` 的 `.cm-content` 负责，留着会叠加两层版心。

- [ ] **Step 7: 补 CSS**

`src/styles/markdown.css` 末尾追加：

```css
/* --- 编辑器块 widget --- */
/*
 * 块 widget 各自是一个 .markdown-body，而 markdown.css 里的块间距写在
 * 「相邻兄弟」选择器上（p + p 之类）。widget 之间隔着 CodeMirror 的
 * 结构节点，兄弟选择器一律落空，于是所有块紧贴在一起。
 * 这里把间距改挂到 widget 自身的首尾元素上，还原原本的呼吸感。
 */
.cm-md-block > :first-child { margin-top: 0; }
.cm-md-block > :last-child { margin-bottom: 0; }
.cm-md-block { padding-block: 0.4em; }
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npx vitest run src/editor/MarkdownEditor.test.tsx`
Expected: PASS（2 个用例）

- [ ] **Step 9: 人工验收**

Run: `npm run build`，在 `chrome://extensions` 重新加载 `dist/`，打开 `fixtures/` 里的示例文档。
Expected: 正文渲染、代码高亮、Mermaid 图、公式全部正常；上下滚动一遍无重复闪烁。

- [ ] **Step 10: 提交**

```bash
git add src/editor/ src/viewer/pages/ReaderPage.tsx src/styles/markdown.css
git commit -m "feat: 用 CodeMirror 视图替换分块渲染的正文"
```

---

