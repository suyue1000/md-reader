import { useEffect } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { EMBED_FLAG, isLoadMessage, type ViewerMessage } from '@/content/protocol';
import { createLogger } from '@/utils/logger';
import type { MarkdownDocument } from '@/types';

const log = createLogger('embed');

/** 当前页面是否作为宿主页面的嵌入阅读器运行 */
export function isEmbedded(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.parent !== window &&
    new URLSearchParams(window.location.search).get(EMBED_FLAG) === '1'
  );
}

/** 向宿主页面发一条消息 */
function postToHost(message: ViewerMessage): void {
  // 宿主可能是 file:// 页面，其 origin 是 "null"，无法用具体源做校验，
  // 只能用 '*'。这里发出去的内容只有「已就绪」和当前锚点，不含用户数据
  window.parent.postMessage(message, '*');
}

/**
 * 去掉地址里的 hash 片段。
 *
 * 文档的**身份**不该受锚点影响。宿主传过来的 `url` 就是它的 `location.href`，
 * 而阅读器跳转时会用 `replaceState` 把当前章节写进宿主地址栏（见
 * `syncAnchorHash`）——不剥掉这一段的话，「点一下目录、再刷新页面」拿到的
 * documentId 与刚才那次就不一样了，于是换成另一条阅读位置记录：同一个文件
 * 按章节碎成好几条，用户回来时恢复的粒度从「上次的精确像素」退化成
 * 「上次点过的那一节」，`MAX_ENTRIES` 的淘汰也被无谓地加速。
 *
 * 剥掉的只是 hash 对**身份**的影响。hash 本身照常被 `setPendingAnchor` 消费，
 * 跳转功能一点没少。
 *
 * 用字符串截断而不是 `new URL`：`file://` 这类地址在个别环境下构造 URL 会抛，
 * 而 hash 一定从第一个 `#` 开始、查询串里也不可能出现 `#`，截断是精确的。
 */
export function stripHash(url: string): string {
  const index = url.indexOf('#');
  return index === -1 ? url : url.slice(0, index);
}

/**
 * 跳转之后把当前章节写进地址栏。
 *
 * ## 为什么必须做
 *
 * 用浏览器直接打开 `.md` 时，阅读器跑在 `file://` 页面的 iframe 里，
 * **地址栏保持为原始的 `file:///…/xxx.md#锚点`**（见 `content/index.ts` 顶部
 * 「为什么不重定向到 viewer.html」那段）。这条设计的全部价值就在于地址栏
 * 可以被收藏、被分享。跳到某一节之后地址栏不动，等于分享出去的链接永远
 * 落在文档开头——承诺与实际直接矛盾。
 *
 * 三条跳转路径（侧栏目录点击、地址栏锚点、正文 `#锚点` 链接）都调这里，
 * 落点机制统一，地址栏也就统一。
 *
 * ## 为什么不是 `location.hash = id`
 *
 * 赋值 `location.hash` 会触发浏览器的原生片段导航：目标元素在 DOM 里时
 * 浏览器会自己滚一次，对齐的是标题元素顶边，而我们刚用 `scrollToLine`
 * 把块顶边对齐到了容器顶边——两次滚动打架，好不容易调准的落点又歪了。
 * `history.replaceState` 只改地址栏，不滚动、不派发 `hashchange`、也不新增
 * 历史记录（宿主侧一直就是 `replaceState`，读一篇长文点十次目录不该让返回键
 * 按十次）。
 *
 * 代价是 `replaceState` 不派发 `hashchange`，下面那个把 hash 转发给宿主的
 * 监听器收不到，所以这里**直接**发一次 `md-reader:hash`。那个监听器仍然
 * 留着：脚注引用之类我们有意放行给浏览器原生处理的锚点，走的还是它。
 *
 * @param id 标题锚点 id（未编码的原文，如 `一、简介`）
 */
export function syncAnchorHash(id: string): void {
  if (id === '') return;
  /*
   * 编码而不是原样写入：地址栏里的 hash 必须是合法 URL 片段，
   * `useEmbeddedDocument` 与 `useRelativeLinks` 读回来时都会解码一次。
   * 顺带还挡住了一类冲突——`encodeURIComponent` 会把 `/` 变成 `%2F`，
   * 于是一个叫 `/foo` 的标题不会被极简路由（见 viewer/router.tsx）
   * 误当成一次路由跳转。
   */
  const hash = `#${encodeURIComponent(id)}`;
  if (window.location.hash !== hash) {
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }
  if (isEmbedded()) postToHost({ type: 'md-reader:hash', hash });
}

/**
 * 嵌入模式：从宿主页面接收 Markdown 正文。
 *
 * 用户在浏览器里直接打开 `.md` 时，内容脚本会把整页换成一个指向本页的
 * iframe，并把已经渲染成纯文本的源码递过来（见 content/index.ts）。
 * 这样地址栏保持为原始的 `file:///…/xxx.md`，而渲染、设置、目录、导出
 * 全部复用同一套阅读器，没有第二条代码路径。
 *
 * 握手方向是「阅读器先说话」：iframe 何时加载完只有它自己知道，
 * 宿主盲发消息可能发在监听器注册之前。
 */
export function useEmbeddedDocument(): void {
  const setDocument = useDocumentStore((state) => state.setDocument);
  const setPendingAnchor = useDocumentStore((state) => state.setPendingAnchor);

  useEffect(() => {
    if (!isEmbedded()) return;

    const onMessage = (event: MessageEvent): void => {
      // 只接受宿主页面（父窗口）发来的消息
      if (event.source !== window.parent) return;
      if (!isLoadMessage(event.data)) return;

      const message = event.data;
      /*
       * 地址本身就是这篇文档的 id：同一个文件重新打开时，阅读位置才能对上。
       * 但必须先剥掉 hash——理由见 `stripHash`。`path`（状态栏显示）与
       * `baseUrl`（相对链接基准）一并用剥过的地址：前者带个 `#章节` 只是噪音，
       * 后者在解析相对地址时本来就会忽略 base 的片段，剥掉不改变任何结果。
       */
      const url = stripHash(message.url);
      const doc: MarkdownDocument = {
        id: url,
        name: message.name,
        path: decodeURIComponent(url),
        content: message.content,
        size: new Blob([message.content]).size,
        // 页面里拿不到文件的 mtime，用当前时刻；这类文档也不参与自动刷新
        lastModified: Date.now(),
        source: 'url',
        baseUrl: url,
      };

      log.info('接收到宿主页面的文档', message.name);
      setDocument(doc);

      // 锚点不能立刻跳：目标元素要等渲染完才存在。存下来，
      // 由阅读页在内容就绪后消费（见 stores/document.store.ts 的 pendingAnchor）
      const anchor = message.hash.replace(/^#/, '');
      if (anchor !== '' && !anchor.startsWith('/')) {
        setPendingAnchor(decodeURIComponent(anchor));
      }
    };

    window.addEventListener('message', onMessage);
    postToHost({ type: 'md-reader:ready' });

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [setDocument, setPendingAnchor]);

  /*
   * 浏览器**原生**的片段导航之后，把锚点回传给宿主，让地址栏与页面保持一致。
   *
   * 阅读器自己的三条跳转路径不走这里——它们用 `replaceState`，不派发
   * `hashchange`，改由 `syncAnchorHash` 直接发消息（理由见那个函数的注释）。
   * 留下这个监听器是为了剩下那些我们**有意放行**给浏览器的锚点：脚注引用
   * `#fn1`、正文里手写的 `<a id>`，见 `useRelativeLinks`。
   */
  useEffect(() => {
    if (!isEmbedded()) return;

    const onHashChange = (): void => {
      const hash = window.location.hash;
      // 路由 hash（以 #/ 开头）是阅读器内部状态，不该出现在宿主地址栏
      if (hash.startsWith('#/')) return;
      postToHost({ type: 'md-reader:hash', hash });
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
}
