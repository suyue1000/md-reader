import { createContext, useContext } from 'react';

/**
 * 正文滚动容器。
 *
 * 目录高亮（Scroll Spy）、阅读进度条、返回顶部三个功能都要拿到同一个滚动元素，
 * 而它们分散在侧栏与正文两棵子树里。用 Context 传递比让每个组件自己
 * `document.querySelector` 更可靠——后者在组件挂载顺序变化时会拿到 null。
 *
 * 存的是元素本身而不是 ref：元素通过 callback ref 赋值时会触发一次重渲染，
 * 消费方能立刻拿到非空值，不需要额外的「等待 ref 就绪」逻辑。
 */
const ScrollContainerContext = createContext<HTMLElement | null>(null);

export const ScrollContainerProvider = ScrollContainerContext.Provider;

/** 获取正文滚动容器；尚未挂载时为 null */
export function useScrollContainer(): HTMLElement | null {
  return useContext(ScrollContainerContext);
}
