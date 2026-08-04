import { useEffect } from 'react';
import { useDocumentStore } from '@/stores/document.store';

/**
 * 消费待跳转的标题锚点。
 *
 * 打开 `xxx.md#某标题` 时，锚点在地址里就位，而目标元素要等渲染完才存在——
 * 浏览器原生的锚点跳转在文档还是一片空白时就已经执行过了，什么也找不到。
 * 这个 hook 等到内容真正就绪再跳，并且只跳一次。
 *
 * 跳转优先于阅读位置恢复：用户带着锚点打开一篇文档，意图是明确的，
 * 不该被上次读到哪儿覆盖掉。
 *
 * @param ready 内容是否已渲染完毕
 */
export function usePendingAnchor(ready: boolean): void {
  const pendingAnchor = useDocumentStore((state) => state.pendingAnchor);
  const setPendingAnchor = useDocumentStore((state) => state.setPendingAnchor);

  useEffect(() => {
    if (!ready || pendingAnchor === null) return;

    const target = document.getElementById(pendingAnchor);
    if (target) {
      target.scrollIntoView({ block: 'start' });
    }
    // 找不到也要清掉：锚点可能指向一个已经不存在的标题，
    // 留着会让后续每次渲染完成都白试一遍
    setPendingAnchor(null);
  }, [ready, pendingAnchor, setPendingAnchor]);
}
