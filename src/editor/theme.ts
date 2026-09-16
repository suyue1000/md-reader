import { EditorView } from '@codemirror/view';

/**
 * 编辑器外观。
 *
 * 一条自己的颜色都不写，全部指向应用已有的 CSS 变量。CodeMirror 自带的
 * 默认主题假设自己是个代码编辑器（等宽字体、深色底、行高紧凑），套在
 * 阅读器上会和四套阅读主题全部打架。
 *
 * 关于高度与滚动：编辑器**不自己滚动**，而是随内容自然增高，由 AppShell 的
 * `<main>` 统一滚动。这不是风格偏好——目录高亮、阅读进度条、返回顶部三个
 * 功能都挂在 `ScrollContainerContext` 提供的那个 `<main>` 上。若让
 * `.cm-scroller` 自己 `overflow: auto`，`<main>` 就永远不会滚动，这三个功能会
 * **静默失效**：不报错，只是进度条永远停在 0%、返回顶部永不出现。
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: 'auto',
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
    overflow: 'visible',
  },
  '&.cm-focused': { outline: 'none' },
  // 源码态的行：让 Markdown 标记比正文淡一档，视觉上退到背景里
  '.cm-line': { padding: '0' },
  // 块 widget 自己带 .markdown-body，间距由 markdown.css 负责
  '.cm-md-block': { margin: '0' },
});
