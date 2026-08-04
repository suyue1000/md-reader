import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import {
  buildTextIndex,
  clearHighlights,
  paintHighlights,
  rangeForMatch,
  type TextIndex,
} from '@/search/highlight';
import { DEFAULT_MATCH_LIMIT, findMatches, stepIndex } from '@/search/matcher';
import { yieldToMain } from '@/utils/scheduler';

/** 输入防抖：边打字边搜大文档会把主线程占满 */
const DEBOUNCE_MS = 180;

/** 一次搜索的结果 */
interface SearchResult {
  ranges: readonly Range[];
  /** 当前命中序号，-1 表示没有 */
  current: number;
}

const EMPTY_RESULT: SearchResult = { ranges: [], current: -1 };

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
 * 正文全文搜索。
 *
 * 搜索的是**已渲染的正文 DOM** 而不是 Markdown 源文本。源文本里掺着
 * 语法标记（`**粗体**`、表格竖线、链接地址），按源文本搜会搜到用户
 * 根本看不见的东西，也无法定位到屏幕上的位置。
 *
 * 实际的查找放在 effect 里异步进行：几十万个文本节点的遍历不该发生在
 * 渲染过程中，否则每敲一个字输入框都要等它算完才回显。
 */
export function useSearch(): SearchApi {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [result, setResult] = useState<SearchResult>(EMPTY_RESULT);

  // 正文变化（换文档、分块渲染又长出一块）后索引要重建
  const renderProgress = useDocumentStore((state) => state.renderProgress);
  const documentId = useDocumentStore((state) => state.document?.id ?? '');
  const contentKey = `${documentId}:${String(renderProgress.done)}`;

  const indexRef = useRef<TextIndex | null>(null);
  /** 索引对应的内容标识，与当前不符就重建 */
  const indexKeyRef = useRef('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.markdown-body');
    if (!root) return;

    let cancelled = false;
    void (async () => {
      // 先让这一帧画完（输入框回显、加载提示），再开始遍历正文
      await yieldToMain();
      if (cancelled) return;

      if (debounced === '') {
        setResult(EMPTY_RESULT);
        return;
      }

      // 索引按内容标识缓存：连续修改查询词不该反复遍历几十万个文本节点
      if (indexKeyRef.current !== contentKey || !indexRef.current) {
        indexRef.current = buildTextIndex(root);
        indexKeyRef.current = contentKey;
      }

      const index = indexRef.current;
      const ranges = findMatches(index.text, debounced)
        .map((match) => rangeForMatch(index, match))
        .filter((range): range is Range => range !== null);

      if (cancelled) return;
      setResult({ ranges, current: ranges.length > 0 ? 0 : -1 });
    })();

    return () => {
      cancelled = true;
    };
  }, [debounced, contentKey]);

  useEffect(() => {
    paintHighlights(result.ranges, result.current);

    const active = result.ranges[result.current];
    if (!active) return;
    // Highlight API 不改 DOM，没有可以 scrollIntoView 的元素，
    // 只能先看 Range 自身的位置，再借它所在的元素滚动
    const rect = active.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      active.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    }
  }, [result]);

  // 卸载时务必撤掉高亮：CSS.highlights 是全局注册表，留着会一直画
  useEffect(() => clearHighlights, []);

  const go = useCallback((delta: number) => {
    setResult((previous) => ({
      ...previous,
      current: stepIndex(previous.current, previous.ranges.length, delta),
    }));
  }, []);

  const reset = useCallback(() => {
    setQuery('');
    setDebounced('');
    setResult(EMPTY_RESULT);
    clearHighlights();
  }, []);

  return {
    query,
    setQuery,
    total: result.ranges.length,
    current: result.current,
    truncated: result.ranges.length >= DEFAULT_MATCH_LIMIT,
    go,
    reset,
  };
}
