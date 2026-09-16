import { useCallback, useEffect, useMemo, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { useEditorView } from '@/editor/EditorContext';
import { useDocumentStore } from '@/stores/document.store';
import {
  activeMatchRange,
  clearHighlights,
  locateActive,
  paintBlockHighlights,
} from '@/search/block-highlight';
import {
  DEFAULT_MATCH_LIMIT,
  findSourceMatches,
  stepIndex,
  type SourceMatch,
} from '@/search/matcher';
import { yieldToMain } from '@/utils/scheduler';

/** 输入防抖：边打字边搜大文档会把主线程占满 */
const DEBOUNCE_MS = 180;

/** 空结果的共享实例，避免每次「没有命中」都产生一个新数组、白白触发下游 effect */
const EMPTY_MATCHES: readonly SourceMatch[] = [];

/** 搜索状态与操作 */
export interface SearchApi {
  query: string;
  setQuery: (value: string) => void;
  /** 命中总数 */
  total: number;
  /** 当前命中序号（从 0 开始），无命中为 -1 */
  current: number;
  /** 是否因为数量太多而被截断 */
  truncated: boolean;
  /** 跳到下一处 / 上一处，到头绕回 */
  go: (delta: number) => void;
  /** 清空查询并撤掉高亮 */
  reset: () => void;
}

/**
 * 编辑器所在滚动容器的可视区（视口坐标）。
 *
 * **不能用 `view.scrollDOM`**。本项目的 `.cm-scroller` 被显式设成
 * `overflow: visible`（见 `editor/theme.ts`：编辑器随内容自然增高，真正滚动的是
 * AppShell 的 `<main>`，目录高亮 / 进度条 / 返回顶部都挂在那上面）。CodeMirror 的
 * `scrollDOM` 仍旧指着 `.cm-scroller`，拿它量可视区会得到「整篇文档都在视口里」，
 * 于是「命中在不在屏幕上」永远判成「在」，跳转一次也不会发生。
 *
 * 沿着祖先找第一个真正会滚的元素，而不是写死 `.app-main`：这个 hook 也可能被
 * 挂在别的宿主里（测试、将来的编辑态外壳），按 `overflow` 找是自解释的。
 */
function viewportBounds(view: EditorView): { top: number; bottom: number } {
  let node = view.dom.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

/**
 * 正文查找。
 *
 * ## 查的是源文本
 *
 * 编辑器只渲染视口附近的块，滚出视口的正文**根本不在 DOM 里**，按 DOM 搜等于
 * 只搜了一屏。所以命中数与跳转落点全部由 `@codemirror/search` 在源文本上算出
 * （`matcher.ts`），行为上的变化在 `countMatches` 的注释里如实写明了。
 *
 * 旧实现用 `document.querySelector('.markdown-body')` 取正文——而每个块 widget
 * 都带这个类名，`querySelector` 只会取到第一块，查找因此只在文档开头那一块里
 * 生效。这不是精度问题，是功能坏了。
 *
 * ## 高亮由谁负责
 *
 * 自己画（`block-highlight.ts`）。`@codemirror/search` 的高亮都是
 * `Decoration.mark`，而实时预览把源码整段替换成了块 widget，被替换掉的文本不
 * 参与渲染——那套高亮挂上去一个像素都看不见。这一点在那个文件里有完整说明。
 */
export function useSearch(): SearchApi {
  /**
   * 编辑器实例。为 null 时整个查找是停用的（还没打开文档、编辑器正在重建）。
   *
   * 因此 `SearchBar` 必须挂在 `EditorViewProvider` 之内——它原先是 AppShell 的
   * 兄弟、在 provider 之外，那样这里永远拿到 null，查找会**静默**什么都不做。
   */
  const view = useEditorView();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [matches, setMatches] = useState<readonly SourceMatch[]>(EMPTY_MATCHES);
  /** 当前命中序号，-1 表示没有 */
  const [current, setCurrent] = useState(-1);

  /**
   * 文档内容。只作为「要重搜一遍」的触发器：documentId 认不出「同一次打开换了
   * 内容」（文件监听自动刷新走的正是这条路），而刷新之后旧的偏移量全部作废。
   */
  const content = useDocumentStore((state) => state.document?.content ?? '');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      /*
       * 先把这一帧让出去，再开始搜。
       *
       * 两个理由，一个是体验、一个是结构：
       * 1. 输入框的回显、计数的清零应该立刻画出来，不必等整篇文档扫完；
       * 2. 同步在 effect 体里 setState 会让这次提交当场级联出下一次渲染
       *    （`react-hooks/set-state-in-effect` 拦的正是这个）。搜索属于
       *    「向外部系统问一个答案，拿到了再写回 React」，让一次步之后写回
       *    才是这条 effect 的真实形状。
       *
       * 与旧实现不同的是，这里让步不是**必须**的性能手段：`SearchCursor` 在
       * CodeMirror 的文本树上按块迭代，一次线性字符串扫描而已，不像旧实现
       * 要遍历几十万个文本节点、再为每一处命中建 Range。
       */
      await yieldToMain();
      if (cancelled) return;

      const found =
        view && debounced !== '' && content !== '' ? findSourceMatches(view, debounced) : [];
      setMatches(found.length > 0 ? found : EMPTY_MATCHES);
      setCurrent(found.length > 0 ? 0 : -1);
    })();

    return () => {
      cancelled = true;
    };
  }, [view, debounced, content]);

  /** 当前命中在渲染侧的坐标（哪一块的第几处），高亮与「在不在屏幕上」都要用 */
  const active = useMemo(
    () => (view ? locateActive(view, matches, current) : null),
    [view, matches, current],
  );

  // 跳转：换了查询词（落到第一处）或按了上一处/下一处
  useEffect(() => {
    if (!view) return;
    const match = matches[current];
    if (!match) return;

    /*
     * 目标已经完整落在可视区里就不动——「没真的滚就不撤防」，见下面的说明。
     *
     * 判据用**渲染出来的那一处命中**的矩形，而不是 CodeMirror 的高度图：高度图对
     * 视口外的块用的是估算值，而估算值恰恰是这个项目栽过跟头的地方。找不到对应的
     * Range 有两种情形，都按「不在屏幕上」处理：块没挂载（那就确实在视口外），
     * 或者命中只存在于源码标记里（`**`、`](`）——那种命中屏幕上没有对应字符，
     * 把它所在的块带到视口里是此时能给出的最好落点。
     */
    const range = activeMatchRange(view, debounced, active);
    if (range) {
      const rect = range.getBoundingClientRect();
      const bounds = viewportBounds(view);
      if (rect.top >= bounds.top && rect.bottom <= bounds.bottom) return;
    }

    /*
     * 跳到命中处是一次显式导航（判定标准见 store 的 `navigationEpoch`）：
     * 起因是用户输入或按上一处/下一处，落点由我们算，视口真的被带走了。
     * 不记的话，刚恢复过阅读位置的文档里搜第一个词，增强完成后的校正会把
     * 用户从命中处拽回上次读到的地方。
     *
     * 必须在**这个同步流程里**记，紧挨着滚动那一行：`scrollIntoView` 派发的
     * dispatch 会同步触发视口变化，`MarkdownEditor` 随即 `enhanceMounted`，
     * 那批 Promise 一个微任务后就回调 `onEnhanced`——指望滚动落定后的 `scroll`
     * 事件来撤防一定来不及，这正是目录点击栽过的那个坑。
     *
     * 写在「已经在视口里就返回」之后：没真的滚就不该撤防，白撤一次会吃掉一次
     * 本该发生的阅读位置恢复。
     */
    useDocumentStore.getState().markNavigation();
    view.dispatch({ effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
  }, [view, matches, current, active, debounced]);

  /*
   * 画高亮，并且在块变化之后重画。
   *
   * 重画不是优化，是正确性：块 widget 只在视口附近存在，滚动会不断地挂上新块、
   * 销毁旧块，而 Shiki 上色 / Mermaid 出图会把块内的 DOM 整段换掉——两种情况都
   * 让上一批 Range 指向已经不在文档里的文本节点。只画一次的话，用户滚到哪里
   * 高亮就断在哪里。
   *
   * 用 MutationObserver 而不是监听滚动：真正决定「有没有新块可画」的是 DOM 变化
   * 本身，而块的挂载既可能由滚动引起，也可能由增强、重渲染引起。rAF 合并是必需的
   * ——Mermaid 出一张图会产生成百上千次变更记录。画高亮走 `CSS.highlights`，
   * 不碰 DOM，因此不会把自己再触发一遍。
   */
  useEffect(() => {
    if (!view || debounced === '' || matches.length === 0) {
      clearHighlights();
      return;
    }

    let frame = 0;
    const repaint = (): void => {
      frame = 0;
      paintBlockHighlights(view, debounced, active);
    };
    repaint();

    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(repaint);
    });
    observer.observe(view.contentDOM, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      // CSS.highlights 是全局注册表，留着会一直画
      clearHighlights();
    };
  }, [view, debounced, matches, active]);

  const total = matches.length;

  const go = useCallback(
    (delta: number) => {
      setCurrent((previous) => stepIndex(previous, total, delta));
    },
    [total],
  );

  const reset = useCallback(() => {
    setQuery('');
    setDebounced('');
    setMatches(EMPTY_MATCHES);
    setCurrent(-1);
    clearHighlights();
  }, []);

  return {
    query,
    setQuery,
    total,
    current,
    truncated: total >= DEFAULT_MATCH_LIMIT,
    go,
    reset,
  };
}
