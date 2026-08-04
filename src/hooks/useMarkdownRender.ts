import { useEffect, useRef, useState } from 'react';
import type { MarkdownRenderer, RenderStages } from '@/markdown/contract';
import type { FlatHeading } from '@/markdown/toc';
import { ensureBuiltinPlugins } from '@/plugins';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { createLogger } from '@/utils/logger';
import { yieldToMain } from '@/utils/scheduler';

const log = createLogger('use-markdown-render');

/**
 * 目录增量刷新的最小间隔。
 *
 * 大文档会切成上百块，每块都刷一次目录意味着把一棵几千节点的树重渲染上百次，
 * 省下来的解析时间全赔在这里。150ms 既让侧栏看起来在实时生长，
 * 又把重渲染次数压到个位数。
 */
const TOC_REFRESH_INTERVAL_MS = 150;

/** 渲染结果 */
export interface MarkdownRenderState {
  /**
   * 已渲染的 HTML 分块，按文档顺序排列。
   *
   * 用数组而不是拼好的整串：大文档每到一块就重新拼接是 O(n²)，
   * 10MB 文档拼到最后一块要复制近 30MB 字符串。
   */
  chunks: readonly string[];
  /** 本次渲染会话的标识，变化即表示要从头重来而不是追加 */
  sessionKey: string;
  /** 是否所有分块都已渲染完毕 */
  complete: boolean;
  /** 累计渲染耗时（毫秒） */
  durationMs: number;
  /** 渲染失败信息 */
  error: string | null;
}

/** 无文档时的状态，作为常量避免每次渲染都新建对象 */
const EMPTY_STATE: MarkdownRenderState = {
  chunks: [],
  sessionKey: '',
  complete: true,
  durationMs: 0,
  error: null,
};

/** 累加各阶段耗时 */
function addStages(total: RenderStages, next: RenderStages): RenderStages {
  return {
    parseMs: total.parseMs + next.parseMs,
    tocMs: total.tocMs + next.tocMs,
    renderMs: total.renderMs + next.renderMs,
    sanitizeMs: total.sanitizeMs + next.sanitizeMs,
  };
}

/**
 * 把当前文档渲染成 HTML 分块，并把目录写回 document store。
 *
 * 四个刻意的设计：
 * 1. 目录写 store（侧栏要用），HTML 走返回值（只有正文组件要用）——
 *    把 HTML 塞进全局 store 会让每次渲染都惊动整棵组件树；
 * 2. 只订阅 `settings.markdown` 分组。改字号、换主题不影响 HTML 结构，
 *    不应该触发一次完整的重新解析；
 * 3. 「没有文档」是推导出来的，不是 effect 里 setState 设出来的——
 *    effect 里同步 setState 会多触发一轮渲染；
 * 4. **首块同步产出，其余逐块让步**。第一块决定用户多久能看到内容，
 *    没有理由让它排队等调度；后面的块每渲染一块就把主线程还回去，
 *    这样 10MB 文档在渲染期间依然能滚动和交互。
 */
export function useMarkdownRender(): MarkdownRenderState {
  const source = useDocumentStore((state) => state.document?.content ?? '');
  const documentId = useDocumentStore((state) => state.document?.id ?? '');
  const setToc = useDocumentStore((state) => state.setToc);
  const setRenderDuration = useDocumentStore((state) => state.setRenderDuration);
  const setRenderProgress = useDocumentStore((state) => state.setRenderProgress);
  const markdownSettings = useSettingsStore((state) => state.settings.markdown);

  const [state, setState] = useState<MarkdownRenderState>(EMPTY_STATE);

  // 插件异步产出内容（如 Mermaid 出图）后触发的重渲染计数
  const [rerenderToken, setRerenderToken] = useState(0);

  /** 标记最新一次渲染，用于丢弃过期结果 */
  const latestRun = useRef(0);
  /** 惰性创建的渲染器，整条管线在这里才真正被下载 */
  const rendererRef = useRef<Promise<MarkdownRenderer> | null>(null);

  useEffect(() => {
    if (source === '') {
      // 只同步外部 store，不碰组件自身的 state
      setToc([]);
      latestRun.current += 1;
      return;
    }

    const runId = latestRun.current + 1;
    latestRun.current = runId;

    // 直接取最新快照，而不是把整个 settings 放进依赖数组
    const settings = useSettingsStore.getState().settings;

    // 首次渲染时才下载渲染管线；之后复用同一个实例（其内部还有实例缓存）
    rendererRef.current ??= (async () => {
      const [{ createMarkdownRenderer }] = await Promise.all([
        import('@/markdown/renderer'),
        ensureBuiltinPlugins(),
      ]);
      return createMarkdownRenderer({
        onRerenderRequest: () => setRerenderToken((value) => value + 1),
      });
    })();

    const run = async (): Promise<void> => {
      const renderer = await rendererRef.current;
      if (!renderer || latestRun.current !== runId) return;

      const { buildTocTree } = await import('@/markdown/toc');
      if (latestRun.current !== runId) return;

      const session = renderer.createSession({ source, settings, documentId });
      const sessionKey = `${documentId}:${String(runId)}`;

      const chunks: string[] = [];
      const headings: FlatHeading[] = [];
      let stages: RenderStages = { parseMs: 0, tocMs: 0, renderMs: 0, sanitizeMs: 0 };
      let lastTocAt = 0;

      for (let i = 0; i < session.chunkCount; i++) {
        // 每块开头都重新确认：用户可能在渲染途中换了文档
        if (latestRun.current !== runId) return;

        const chunk = session.renderChunk(i);
        chunks.push(chunk.html);
        headings.push(...chunk.headings);
        stages = addStages(stages, chunk.stages);

        const complete = i === session.chunkCount - 1;
        const total = stages.parseMs + stages.tocMs + stages.renderMs + stages.sanitizeMs;

        setState({
          chunks: [...chunks],
          sessionKey,
          complete,
          durationMs: total,
          error: null,
        });
        setRenderDuration(total, stages);
        setRenderProgress(i + 1, session.chunkCount);

        const now = performance.now();
        if (complete || now - lastTocAt > TOC_REFRESH_INTERVAL_MS) {
          lastTocAt = now;
          setToc(buildTocTree(headings));
        }

        if (!complete) await yieldToMain();
      }
    };

    void run().catch((error: unknown) => {
      if (latestRun.current !== runId) return;
      const message = error instanceof Error ? error.message : String(error);
      log.error('渲染失败', error);
      setState({ ...EMPTY_STATE, error: message });
    });
  }, [
    source,
    documentId,
    markdownSettings,
    setToc,
    setRenderDuration,
    setRenderProgress,
    rerenderToken,
  ]);

  return source === '' ? EMPTY_STATE : state;
}
