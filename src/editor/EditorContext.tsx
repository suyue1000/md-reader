import { createContext, useContext, useState, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';

/**
 * 当前的编辑器实例。
 *
 * 目录跳转、锚点跳转、阅读位置都要对同一个视图下指令，而它们分散在侧栏
 * （`TocPanel`）与正文（`ReaderPage`）两棵子树里，只能靠 Context 汇合。
 *
 * 用 Context 而不是把 view 塞进 Zustand：`EditorView` 是个不可序列化的
 * 宿主对象（持有 DOM 节点、事件监听、内部可变状态），放进 store 会污染
 * 状态快照——调试面板打印不出来、任何持久化都会炸。这与 `file-open.ts`
 * 不把文件句柄放进 store 是同一个理由。
 */
const EditorViewContext = createContext<EditorView | null>(null);

/**
 * 写入编辑器实例的入口。
 *
 * 单独开一个 context 而不是把 setter 和 view 打包成一个对象：正文只写、
 * 侧栏只读，打包会让「只写方」也订阅上 view 的变化，每次编辑器重建都白白
 * 重渲染一遍正文子树。
 *
 * 默认值是个空函数而不是 null，省掉每个消费点的判空——provider 之外调用
 * 它本来就没有意义，静默丢弃是合理行为。
 */
const SetEditorViewContext = createContext<(view: EditorView | null) => void>(() => undefined);

/**
 * 持有编辑器实例的 provider。
 *
 * 必须挂在 `AppShell` **之上**：侧栏和正文是 AppShell 的两个兄弟子树，
 * 状态放在任何一边都传不到另一边。这也是为什么这里要自己拿 `useState`
 * 而不是让调用方传值进来——真正创建 view 的 `MarkdownEditor` 在正文一侧，
 * 它只能通过 `useSetEditorView` 把实例交上来。
 */
export function EditorViewProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [view, setView] = useState<EditorView | null>(null);

  return (
    <SetEditorViewContext.Provider value={setView}>
      <EditorViewContext.Provider value={view}>{children}</EditorViewContext.Provider>
    </SetEditorViewContext.Provider>
  );
}

/**
 * 读取当前编辑器实例；已经失效的实例一律当作 null。
 *
 * 为 null 的四种情况：还没打开文档、编辑器正在重建、首轮块渲染尚未完成、
 * 以及下面这一种——第三种是刻意的，见 `MarkdownEditor` 的 `onViewReady`
 * 说明，过早拿到 view 会让「行号 -> 像素」的换算算在没被撑开的源码高度上。
 *
 * 为什么要额外做一次存活判断：换文档时，Zustand 的 `setToc` 会**同步冲刷
 * 一次渲染**（它走 `useSyncExternalStore`，为了避免撕裂必须立即渲染），
 * 而 view 是普通的 React state，那次冲刷里它还停在上一篇文档那个**已经
 * 销毁**的实例上。于是短暂存在一个「目录已经是新文档的、view 还是旧文档
 * 的」组合——目录跳转在这一帧动手，会对着一个死掉的视图 dispatch，滚动
 * 悄无声息地不发生，而锚点已经被当成「跳过了」清掉。这个坑实测踩过：
 * 带锚点从一篇文档切到另一篇，永远停在文档顶部。
 *
 * 判据用 `dom.isConnected`：CodeMirror 的 `destroy()` 会把根节点从文档里
 * 摘掉，所以「节点还挂在文档上」等价于「这个实例还活着」。放在这里而不是
 * 各个消费方各判一次，是因为所有消费方面对的是同一个陷阱。
 */
export function useEditorView(): EditorView | null {
  const view = useContext(EditorViewContext);
  return view?.dom.isConnected === true ? view : null;
}

/** 取得写入编辑器实例的回调；引用稳定，可以直接交给 `onViewReady` */
export function useSetEditorView(): (view: EditorView | null) => void {
  return useContext(SetEditorViewContext);
}
