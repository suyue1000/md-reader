import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { indentUnit } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { useResolvedTheme } from '@/hooks/useTheme';
import type { MarkdownRenderer } from '@/markdown/contract';
import type { FlatHeading } from '@/markdown/toc';
import { ensureBuiltinPlugins } from '@/plugins';
import { useSettingsStore } from '@/stores/settings.store';
import type { EditorSettings } from '@/types/settings';
import { debounce } from '@/utils/fn';
import { createLogger } from '@/utils/logger';
import { settleWithTimeout } from '@/utils/settle-with-timeout';
import { createBlockCache, type BlockCache } from './block-cache';
import { renderBlocks } from './block-render';
import { enhanceBlock } from './enhance';
import { livePreview, setBlocks } from './live-preview';
import { editorTheme } from './theme';

const log = createLogger('markdown-editor');

/** 重新渲染块的防抖间隔。打字期间不必每个字符都重排整篇 */
const RENDER_DEBOUNCE_MS = 200;

/**
 * 一批块增强的超时保险丝，不是性能开关。
 *
 * `enhanceMounted` 等这批 `enhanceBlock` 全部落定才回调 `onEnhanced`——
 * 如果某个 `plugin.enhance` 异常挂起（既不 resolve 也不 reject，比如
 * Mermaid 碰到某些畸形输入卡死），没有这根保险丝的话 `onEnhanced` 就
 * 永远不会触发，依赖它的阅读位置校正也就永久失效。各内置插件目前都用
 * try/catch 包住了渲染逻辑，正常情况下走不到超时分支；万一走到，代价
 * 也只是校正晚触发几秒，好过永远不触发。不要为了「更快校正」调小它。
 */
const ENHANCE_SETTLE_TIMEOUT_MS = 5000;

/**
 * 由编辑设置驱动、可随设置变化重配的那部分扩展。
 *
 * 行号只在编辑态挂：设置项本身就叫「编辑态显示行号」，而阅读态下满屏
 * 都是块 widget，widget 内部的视觉行与源码行对不上，行号只会误导。
 *
 * `tabSize` 与 `indentUnit` 必须一起设：前者只决定已有 Tab 字符**显示**成
 * 几格，后者才是按 Tab 时**插入**什么（`@codemirror/language` 的 indentUnit
 * facet，取值是一串字符而不是数字）。只设前者的话「缩进宽度 4」仍然会插入
 * 2 个空格。
 */
function editingExtensions(editor: EditorSettings, readOnly: boolean): Extension[] {
  return [
    editor.showLineNumbers && !readOnly ? lineNumbers() : [],
    EditorState.tabSize.of(editor.tabSize),
    indentUnit.of(editor.indentWithTabs ? '\t' : ' '.repeat(editor.tabSize)),
    /*
     * Tab 键要显式绑。`defaultKeymap` 有意不绑它（CodeMirror 的默认里 Tab
     * 留给焦点切换），不绑的话「缩进宽度」「用 Tab 缩进」两项设置对按 Tab
     * 这个最直觉的动作毫无影响——设置名不副实。
     *
     * 只在编辑态绑：阅读态按 Tab 仍然是「跳到下一个可聚焦元素」，
     * 键盘用户不会被卡在正文里出不去。
     */
    readOnly ? [] : keymap.of([indentWithTab]),
  ];
}

export interface MarkdownEditorProps {
  /** 文档源文本 */
  value: string;
  /** 文档 id，变化表示换了文档，需要整体重建 */
  documentId: string;
  /**
   * 「第几次打开」的序号（`document.store` 的 `openEpoch`），变化同样要求重建。
   *
   * documentId **不足以标识一次打开**：同一篇文档可以被打开两次，两次的 id
   * 完全一样。而 `setDocument` 会把 store 里的目录清空，等着这个组件在下一轮
   * 块渲染里通过 `onHeadings` 重新填上——只看 documentId 的话，「用完全相同的
   * 内容重开同一篇文档」这一次不会触发任何重建：内容没变，下面那个灌内容的
   * effect 也不会 dispatch，于是 `onHeadings` 再也不被调用。后果是侧栏目录
   * 永久变空，而且 `usePendingAnchor` 的「目录非空」门槛会让锚点永远兑现不了
   * （`pendingAnchor` 滞留非 null，连这一次打开的阅读位置恢复也一并挡掉）。
   *
   * 自动刷新（`applyRefreshedDocument`）不自增这个序号，所以文件变化不会走到
   * 重建这条路上来——那是「同一次打开换了内容」，仍旧由下面的 effect 灌进去，
   * 撤销栈、滚动位置与块缓存都保住。
   *
   * 可选：不传就当作只打开过一次，供不关心重开语义的调用方（测试、将来的
   * 编辑态宿主）保持原样。
   */
  openEpoch?: number;
  /** 相对链接基准 */
  baseUrl?: string | undefined;
  /** 是否只读 */
  readOnly: boolean;
  /** 文本变化（编辑态才会触发） */
  onChange?: (value: string) => void;
  /** 每轮块渲染完成后回调，携带带行号的标题 */
  onHeadings?: (headings: readonly FlatHeading[]) => void;
  /**
   * 编辑器实例就绪 / 销毁时回调。
   *
   * 阅读位置恢复要拿到 `EditorView` 才能换算行号与调用 `scrollToLine`，
   * 而 view 是这个组件内部创建的，外部拿不到——用回调而不是把 view 存进
   * state，是因为 view 的生命周期完全由这里的 effect 管理，state 只会
   * 多一份要保持同步的副本。销毁前传 null，让外部及时丢掉失效的引用。
   *
   * **只在首轮块渲染完成之后才回调**，不是 `new EditorView()` 一造完就调。
   * 造完的那一刻编辑器里还是没有插件处理过的 Markdown 源码，标题、代码块
   * 都没有被撑开，此时算出来的任何「行号 -> 像素」的换算（阅读位置恢复、
   * 之后的目录跳转）都是错的。等首轮 `rerender` 跑完、widget 都已经挂上，
   * 外部拿到的才是一个内容已经渲染好的编辑器。
   */
  onViewReady?: (view: EditorView | null) => void;
  /**
   * 一轮 `enhanceMounted`（Shiki 上色、Mermaid 出图等异步增强）全部结束后
   * 回调。这些增强会再一次显著改变块的高度，晚于 `onViewReady` 发生——
   * 依赖精确像素位置的消费方（目前是阅读位置恢复）需要这个信号再校正一次。
   */
  onEnhanced?: () => void;
}

/**
 * 把视图滚动到指定的 0-based 行，供目录跳转与阅读位置恢复使用。
 *
 * `yMargin: 0` 不是可有可无的默认值重复——CodeMirror 的 `scrollIntoView`
 * 默认留 5px 余量，目标行会停在容器顶边**下方** 5px。这 5px 有两个可见后果：
 * 1. 目录高亮按「视口顶边落在哪一行」判定，5px 的偏差足以让它读到上一个
 *    块，于是点了「第 9 章」高亮却停在第 8 章；
 * 2. 阅读位置恢复在此基础上再叠加行内偏移，5px 会原样带进最终落点。
 * 两处都要求「行顶严格对齐容器顶边」，所以这里把余量显式清零。
 */
export function scrollToLine(view: EditorView, line: number): void {
  /*
   * 挡住 NaN / Infinity，而不是信任类型签名。
   *
   * CodeMirror 的 `doc.line(n)` 用 `n < 1 || n > this.lines` 做边界检查，
   * 而 NaN 与这两个比较都是 false —— 它**恰好穿过**这道检查，然后在文本树
   * 内部抛出一个 `Cannot read properties of undefined (reading 'length')`，
   * 堆栈里看不到任何与「行号是 NaN」有关的线索。
   *
   * 已经真实发生过一次：升级后读回上一个版本存的阅读位置，那种记录没有
   * `line` 字段，`undefined + 1` 得到 NaN，最终整个阅读器白屏。根因已在
   * `reading-position.ts` 修掉，这里是第二道防线——三个调用方（目录跳转、
   * 锚点跳转、阅读位置恢复）的行号来源各不相同，其中任何一处将来算出
   * 非有限值，都不该表现为一次不可理解的崩溃。
   */
  if (!Number.isFinite(line)) return;
  const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
  view.dispatch({
    effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 0 }),
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
  openEpoch = 0,
  baseUrl,
  readOnly,
  onChange,
  onHeadings,
  onViewReady,
  onEnhanced,
}: MarkdownEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cacheRef = useRef<BlockCache | null>(null);
  // useRef 的参数每次渲染都会求值，直接 useRef(createBlockCache()) 会在
  // 每次重渲染时白建一个缓存再丢掉
  cacheRef.current ??= createBlockCache();
  /** 懒加载完成的渲染器；null 表示 Markdown 管线还在下载 */
  const rendererRef = useRef<MarkdownRenderer | null>(null);
  /** 由挂载 effect 装填：强制把已挂载的块重新增强一遍 */
  const reenhanceRef = useRef<(() => void) | null>(null);
  /**
   * `editable` 与 `readOnly` 装在同一个 compartment 里一起切换。
   *
   * 两者必须成对设置，理由见 `live-preview.ts` 里 `buildDecorations` 上方的
   * 说明：只设 `EditorState.readOnly` 的话视图仍可聚焦、仍有选区，光标所在
   * 的那一块会当场变回源码，只读的阅读体验就破了。
   */
  const editModeRef = useRef(new Compartment());
  /** 编辑设置（行号 / 缩进）的重配开关，改设置不重建编辑器 */
  const editingSettingsRef = useRef(new Compartment());

  // 用 ref 持有回调，避免它们变化就重建整个编辑器
  const callbacksRef = useRef({ onChange, onHeadings, onViewReady, onEnhanced, baseUrl });
  /*
   * 同步写在 effect 里而不是渲染期间：渲染期间改 ref 是 React 明令禁止的。
   * 这个 effect 声明在下面重建编辑器的 effect 之前，因此同一轮提交里它总是
   * 先跑——重建时读到的回调一定是本轮的新值。
   */
  useEffect(() => {
    callbacksRef.current = { onChange, onHeadings, onViewReady, onEnhanced, baseUrl };
  });

  /**
   * 只订阅会影响输出的设置分组。
   *
   * `markdown` 决定 HTML 结构（插件开关），变了必须整篇重来；
   * `appearance` / `reading` 与**实际生效**的明暗主题只影响呈现——
   * Shiki 的配色、Mermaid 的图都按主题生成，重跑一遍增强即可。
   * 后者刻意不放进重建依赖：改个字号就把编辑器推倒重建太重了。
   */
  const settings = useSettingsStore((state) => state.settings);
  const { appearance, reading, markdown: markdownSettings, editor: editorSettings } = settings;
  const resolvedTheme = useResolvedTheme();

  // 换文档、重新打开同一篇文档（openEpoch 自增），或改动了影响 HTML 的
  // markdown 设置，才重建编辑器；只是内容变化走 dispatch，保住撤销栈与滚动位置
  useEffect(() => {
    const host = hostRef.current;
    const cache = cacheRef.current;
    if (!host || !cache) return;

    cache.clear();

    /**
     * 增强当前挂在 DOM 上的块。
     *
     * widget 是按需创建的，这里只能处理此刻存在的那些；滚动带出来的新块
     * 由下面 updateListener 里的视口分支补上。
     *
     * 收集每个块的增强 Promise 并等待整批落定后回调 `onEnhanced`——
     * Shiki 上色、Mermaid 出图都会显著改变块高度，依赖精确像素位置的
     * 消费方（阅读位置恢复）需要一个「这一轮真的做完了」的信号，而不是
     * 「已经发起了」。`enhanceBlock` 对已增强的块也会返回一个即时 resolve
     * 的 Promise，所以这里不需要单独判断是否有活要干。
     *
     * 用 `settleWithTimeout` 而不是裸 `Promise.all`：任何一个增强器挂起
     * 不 resolve，都不能让 `onEnhanced` 永久沉默，见上面
     * `ENHANCE_SETTLE_TIMEOUT_MS` 的说明。
     */
    const enhanceMounted = (view: EditorView, force = false): void => {
      const base = callbacksRef.current.baseUrl;
      const tasks: Promise<void>[] = [];
      for (const node of view.dom.querySelectorAll<HTMLElement>('.cm-md-block')) {
        const key = node.dataset.blockKey;
        if (key !== undefined) tasks.push(enhanceBlock(node, key, cache, base, force));
      }
      void settleWithTimeout(tasks, ENHANCE_SETTLE_TIMEOUT_MS).then(() => {
        callbacksRef.current.onEnhanced?.();
      });
    };

    const rerender = (view: EditorView): void => {
      const renderer = rendererRef.current;
      // 管线还在下载。此刻渲染出来的会是一个没有插件的裸 markdown-it——
      // 脚注、公式、代码高亮一个都不会出现。引导完成后会主动补一次
      if (!renderer) return;

      const source = view.state.doc.toString();
      const input = { source, settings: useSettingsStore.getState().settings, documentId };
      const { blocks, headings } = renderBlocks(input, renderer);
      view.dispatch({ effects: setBlocks.of(blocks) });
      callbacksRef.current.onHeadings?.(headings);
      enhanceMounted(view);
    };

    const scheduleRerender = debounce(rerender, RENDER_DEBOUNCE_MS);

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      editorTheme,
      livePreview(cache),
      EditorView.lineWrapping,
      editModeRef.current.of([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
      editingSettingsRef.current.of(editingExtensions(editorSettings, readOnly)),
      EditorView.updateListener.of((update) => {
        /*
         * 视口变化说明 CodeMirror 刚新建了一批 widget。它们的 DOM 要么是从
         * 块缓存里取回的（已增强，enhanceBlock 会立刻返回），要么是刚由
         * HTML 建出来的（还没上色、没出图）。不在这里补一刀，首屏之外的
         * 代码块与图表就永远不会被增强——而那恰恰是长文档的大多数。
         */
        if (update.viewportChanged) enhanceMounted(update.view);
        if (!update.docChanged) return;
        callbacksRef.current.onChange?.(update.state.doc.toString());
        scheduleRerender(update.view);
      }),
    ];

    const view = new EditorView({ doc: value, extensions, parent: host });
    viewRef.current = view;
    reenhanceRef.current = () => {
      enhanceMounted(view, true);
    };

    let cancelled = false;

    /**
     * 首轮块渲染完成后才把 view 交给外部。
     *
     * 不在 `new EditorView()` 之后立即回调——那时编辑器里还是没被插件
     * 处理过的裸源码，标题、代码块都没有被撑开，任何依赖行高的换算
     * （阅读位置恢复、目录跳转）在这个时间点做都是错的。
     */
    const notifyViewReady = (): void => {
      if (cancelled) return;
      callbacksRef.current.onViewReady?.(view);
    };

    if (rendererRef.current) {
      // 管线早就就绪（换文档、改设置），首轮渲染同步完成，不会闪一眼源码
      rerender(view);
      notifyViewReady();
    } else {
      /*
       * 首次挂载要先把整条 Markdown 管线引导起来。
       *
       * 管线（markdown-it + 全部插件，约 500KB）是动态 import 的，插件也是
       * 异步注册的。不等它们就绪就渲染，拿到的是一个没有插件的裸
       * markdown-it：脚注、公式、代码高亮全都不会出现。
       *
       * 代价是引导期间编辑器里显示的是 Markdown 源码。这是懒加载的已知
       * 代价，不为了消灭这一瞬而把 import 改成同步——那会把 500KB 拖进首屏。
       */
      void (async () => {
        try {
          const [{ createMarkdownRenderer }] = await Promise.all([
            import('@/markdown'),
            ensureBuiltinPlugins(),
          ]);
          if (cancelled) return;
          rendererRef.current = createMarkdownRenderer();
          rerender(view);
        } catch (error) {
          log.error('Markdown 管线加载失败，正文将保持源码形态', error);
        } finally {
          /*
           * 引导失败也要通知：view 本身依然可用（只是停在源码形态），
           * 外部消费方不该因为渲染管线的失败而永远等不到一个 view。
           *
           * 如实记录这不是「修好了」，而是把问题从主路径挪到了失败路径：
           * 管线加载失败时 rerender 从未执行过，view 停在未渲染的源码
           * 形态，此时把它交给阅读位置恢复，算出来的仍然是按源码行高
           * 换算的错误像素目标——(a) 要解决的 Critical 在这条降级路径上
           * 依然成立，只是概率低（管线加载失败本身就很少见）。能接受
           * 这个已知残留，是因为管线加载失败时脚注、公式、代码高亮
           * 全部一起失效，阅读位置差几行是这次整体降级里最不重要的
           * 一环，不值得为它单独加一套重试或阻塞逻辑。
           */
          notifyViewReady();
        }
      })();
    }

    return () => {
      cancelled = true;
      scheduleRerender.cancel();
      reenhanceRef.current = null;
      // 销毁前先通知外部——阅读位置 hook 靠这个信号丢掉即将失效的 view 引用
      callbacksRef.current.onViewReady?.(null);
      view.destroy();
      viewRef.current = null;
      cache.clear();
    };
    // value 只作为初始文档；后续内容变化由下面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, openEpoch, markdownSettings]);

  /*
   * 外部内容变化（自动刷新）需要灌进编辑器。
   *
   * 这里曾经有一道「编辑态一律拒绝外部覆盖」的临时护栏——本组件那时没有
   * 能力分辨一次外部变化是不是安全的。现在正式接管：安全与否已经在更上游
   * 判过了，判断者是 `decideRefresh`（`src/editor/conflict.ts`），而这个
   * `value` prop 的来源（`document.store` 的 `document.content`）只会在两种
   * 情况下于同一个 openEpoch 内发生变化——
   *
   * 1. `decideRefresh` 判定为 `adopt`：本地编辑器与上次落盘内容完全一致
   *    （没有未保存改动），外部改动直接采用是安全的；
   * 2. 用户在冲突提示里选了「用磁盘的」：那份未保存改动已经被
   *    `pushVersionBeforeOverwrite` 先推进了版本缓冲，才轮到这里覆盖。
   *
   * 冲突（本地有未保存改动 + 磁盘也变了）根本不会走到这个 prop 变化——
   * `useAutoRefresh` 在那种情形下只更新 `document.store` 的 `conflict`
   * 字段，交给 `ConflictBanner`，不会调用 `applyRefreshedDocument`。
   * 因此这里不再需要按 `readOnly` 分支拦截：会到达这里的变化，出现的
   * 那一刻本身就已经确认过安全。
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // 只读开关不重建编辑器，用 compartment 切
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editModeRef.current.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
    });
  }, [readOnly]);

  // 编辑设置同理：改缩进宽度或行号开关不该把编辑器推倒重来，
  // 否则撤销栈、滚动位置、块缓存全丢
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editingSettingsRef.current.reconfigure(editingExtensions(editorSettings, readOnly)),
    });
  }, [editorSettings, readOnly]);

  /*
   * 主题或展示设置变了，把已挂载的块重新增强一遍。
   *
   * 为什么这三项非重跑不可：Shiki 按代码主题上色、Mermaid 按明暗配色出图，
   * 产物里烙着当时的主题。不重跑就会看到深色界面里留着一张浅色的流程图。
   * 改造前那套整篇渲染的视图（已删除的 `components/markdown/MarkdownView.tsx`）
   * 同样把这几项列进依赖，只是它能整篇重来，这里只能按块补。
   *
   * 首次挂载时这一轮是空跑——那时管线还没引导完，页面上一个块都没有。
   *
   * 光靠 reenhanceRef 只够刷新**当前挂载**的块。块缓存里视口外的那些块
   * 仍标记着 `enhanced = true`（旧主题的产物），不先清掉这个标记的话，
   * 用户滚回去看到的还是旧主题下画的 Shiki 配色 / Mermaid 图——缓存以为
   * 它们已经增强过，直接跳过重跑。`invalidateEnhanced` 只清标记不丢节点，
   * 代价远低于 `clear()`。
   */
  useEffect(() => {
    cacheRef.current?.invalidateEnhanced();
    reenhanceRef.current?.();
  }, [appearance, reading, resolvedTheme]);

  return <div ref={hostRef} />;
}
