import type { MarkdownPlugin, PluginContext } from '@/types';
import { highlightCode, resolveLanguage } from '@/markdown/highlighter';
import { yieldToMain } from '@/utils/scheduler';

/** 超过这个行数才允许折叠，太短的代码块折叠反而碍事 */
const COLLAPSE_THRESHOLD = 20;

/**
 * 一批处理多少个代码块。
 *
 * Shiki 上色虽然写成 async，实际是同步计算，`Promise.all` 全量并发
 * 只会让微任务链一口气跑完——实测 659 个代码块占住主线程 1.5 秒。
 * 分批之后每批之间让出一次主线程，滚动才不会卡。8 个约对应一帧。
 */
const HIGHLIGHT_BATCH = 8;

/**
 * 提前多少屏开始上色。
 *
 * 200% 意味着上下各留两屏的余量：正常速度滚动时代码块进入视野前
 * 就已经上好色，用户看不到「先黑白后变彩色」的跳变；
 * 而快速拖动滚动条时会短暂看到未上色的代码——这是刻意的取舍，
 * 总比为了消灭这一瞬而把整篇文档都算一遍要好。
 */
const PREHEAT_MARGIN = '200% 0px';

/** 与 PREHEAT_MARGIN 对应的倍数，用于直接测算时保持一致 */
const PREHEAT_RATIO = 2;

/** 标记「当前在视口附近」的 data 属性名（dataset 键） */
const NEAR_VIEWPORT = 'codeNear';

/** 最近一次的插件上下文，观察器回调据此读取设置 */
let currentContext: PluginContext | null = null;

/** 已注册观察的代码块 */
const observed = new WeakSet<HTMLElement>();

/** 待上色队列 */
const queue = new Set<HTMLElement>();

/** 队列是否正在推进 */
let draining = false;

/**
 * 视口观察器。
 *
 * 惰性创建：单元测试环境里没有 IntersectionObserver，而且没有观察器时
 * 也要能退化成「全部直接处理」，不能让插件在 jsdom 里直接抛错。
 */
let observer: IntersectionObserver | null | undefined;
/** 观察器绑定的滚动容器，容器变了要重建 */
let observerRoot: Element | null = null;

/**
 * 找到最近的滚动祖先。
 *
 * 必须把它作为观察器的 root，不能用默认的视口。正文装在一个
 * `overflow: auto` 的容器里，而 IntersectionObserver 是拿 root 矩形与
 * **沿途所有裁剪容器**求交的——`rootMargin` 只能撑大 root 自己，
 * 撑不开中间那层裁剪。用默认视口的结果是：折叠线以下的代码块
 * 一律被判为不相交，永远等不到上色。
 */
function findScrollParent(element: HTMLElement): Element | null {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** 取得（或创建）观察器；环境不支持时返回 null */
function getObserver(scrollRoot: Element | null): IntersectionObserver | null {
  if (observer !== undefined && observerRoot === scrollRoot) return observer;
  if (typeof IntersectionObserver !== 'function') {
    observer = null;
    return null;
  }

  // 容器换了（例如导出预览另起了一棵树）就重建，旧的观察目标一并作废
  observer?.disconnect();
  observerRoot = scrollRoot;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const block = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          block.dataset[NEAR_VIEWPORT] = '1';
          enqueue(block);
        } else {
          // 离开视野只清标记，不回退已经上好的色——重新滚回来时不该再算一遍
          delete block.dataset[NEAR_VIEWPORT];
        }
      }
      drainQueue();
    },
    { root: scrollRoot, rootMargin: PREHEAT_MARGIN },
  );
  return observer;
}

/** 把块登记到观察器；没有观察器就直接排队 */
function ensureObserved(block: HTMLElement, scrollRoot: Element | null): void {
  if (observed.has(block)) return;
  observed.add(block);
  const io = getObserver(scrollRoot);
  if (io) io.observe(block);
  else enqueue(block);
}

/** 入队待处理 */
function enqueue(block: HTMLElement): void {
  queue.add(block);
}

/**
 * 直接把当前落在预热区内的块排进队列。
 *
 * 为什么不能只靠观察器：IntersectionObserver 的首次回调时机由浏览器决定，
 * 在某些场景下（实测：阅读器作为 iframe 嵌进宿主页面时）迟迟不来，
 * 结果是首屏代码块一直是黑白的。观察器负责「滚动过程中的按需加载」，
 * 首屏则自己算一次——这段只看视口附近的几个块，遇到明显在下方的就收手。
 */
function enqueueVisible(blocks: ArrayLike<HTMLElement>, scrollRoot: Element | null): void {
  const rootRect = scrollRoot?.getBoundingClientRect();
  const top = rootRect?.top ?? 0;
  const bottom = rootRect?.bottom ?? window.innerHeight;
  const margin = (bottom - top) * PREHEAT_RATIO;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    const rect = block.getBoundingClientRect();
    // 块按文档顺序排列，一旦越过下边界，后面的只会更远
    if (rect.top > bottom + margin) break;
    if (rect.bottom >= top - margin) {
      block.dataset[NEAR_VIEWPORT] = '1';
      enqueue(block);
    }
  }
}

/** 创建一个代码块工具栏按钮 */
function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-block__action';
  button.textContent = label;
  button.title = label;
  button.addEventListener('click', onClick);
  return button;
}

/** 复制文本到剪贴板，并在按钮上给出短暂反馈 */
async function copyToClipboard(button: HTMLButtonElement, text: string): Promise<void> {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = '已复制';
  } catch {
    button.textContent = '复制失败';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

/** 把代码块内容下载为文件 */
function downloadCode(code: string, lang: string): void {
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `snippet.${lang === 'text' ? 'txt' : lang}`;
  anchor.click();
  // 立刻回收，避免 blob 长期驻留内存
  URL.revokeObjectURL(url);
}

/** 重建工具栏按钮组（折叠按钮的有无取决于当前折叠策略） */
function rebuildActions(
  actions: Element,
  block: HTMLElement,
  source: string,
  lang: string,
  collapsible: boolean,
): void {
  actions.replaceChildren();

  const copyButton = createActionButton('复制', () => {
    void copyToClipboard(copyButton, source);
  });
  actions.appendChild(copyButton);

  actions.appendChild(
    createActionButton('下载', () => {
      downloadCode(source, lang);
    }),
  );

  if (collapsible) {
    const toggle = createActionButton(block.classList.contains('is-collapsed') ? '展开' : '折叠', () => {
      const collapsed = block.classList.toggle('is-collapsed');
      toggle.textContent = collapsed ? '展开' : '折叠';
    });
    actions.appendChild(toggle);
  }
}

/**
 * 完成一个代码块的「昂贵部分」：工具栏与语法高亮。
 *
 * 之所以连工具栏也放在这里：每块要建三个按钮，10MB 文档有六千多个代码块，
 * 那是两万个只有滚到才可能被点的 DOM 节点。
 */
async function enhanceBlock(block: HTMLElement, ctx: PluginContext): Promise<void> {
  const codeEl = block.querySelector('code');
  const preEl = block.querySelector('pre');
  const actions = block.querySelector('.code-block__actions');
  if (!codeEl || !preEl || !actions) return;

  const { reading, appearance } = ctx.settings;
  const themeKey = `${appearance.codeTheme}|${appearance.codeThemeDark}`;
  const collapsePolicy = String(reading.codeCollapseLong);

  // 已高亮的代码块里，textContent 仍然是原始源码（Shiki 只是包了 span）
  const source = codeEl.textContent ?? '';
  const rawLang = block.dataset['lang'] ?? 'text';

  // 维度一：折叠策略。只在策略本身变化时才重设折叠态，
  // 否则用户手动展开的代码块会被任何一次设置改动打回去
  if (block.dataset['collapsePolicy'] !== collapsePolicy) {
    const collapsible = reading.codeCollapseLong && source.split('\n').length > COLLAPSE_THRESHOLD;
    block.classList.toggle('is-collapsed', collapsible);
    rebuildActions(actions, block, source, rawLang, collapsible);
    block.dataset['collapsePolicy'] = collapsePolicy;
  }

  // 维度二：配色。换主题时重新高亮，其余情况直接跳过
  if (block.dataset['codeTheme'] === themeKey) return;

  const language = await resolveLanguage(rawLang);
  const html = await highlightCode(source, language, {
    light: appearance.codeTheme,
    dark: appearance.codeThemeDark,
  });

  // 高亮失败时保留转义后的原始 DOM，代码依然可读可复制
  if (html) {
    // 用 DOMParser 解析后整体替换节点，而不是赋值 innerHTML：
    // DOMParser 不会执行脚本，也不需要把已转义的内容再拼一次字符串
    const parsed = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
    if (parsed) {
      parsed.classList.add('code-block__pre');
      preEl.replaceWith(parsed);
    }
  }
  block.dataset['codeTheme'] = themeKey;
}

/**
 * 推进待处理队列：批内并发，批间让出主线程。
 *
 * 同一时刻只允许一个推进循环。滚动会持续往队列里追加，若每次回调都
 * 开一个新循环，同一个块会被多个循环同时处理——而「已处理」标记要等
 * 异步完成后才写上，重复劳动拦不住。
 */
function drainQueue(): void {
  if (draining || queue.size === 0) return;
  draining = true;

  void (async () => {
    try {
      while (queue.size > 0) {
        const batch: HTMLElement[] = [];
        for (const block of queue) {
          batch.push(block);
          queue.delete(block);
          if (batch.length >= HIGHLIGHT_BATCH) break;
        }

        const ctx = currentContext;
        if (!ctx) return;
        await Promise.all(batch.map((block) => enhanceBlock(block, ctx)));
        if (queue.size > 0) await yieldToMain();
      }
    } finally {
      draining = false;
    }
  })();
}

/**
 * 代码块渲染与增强。
 *
 * 同样是「同步产结构、异步做增强」的两段式：
 * - markdown-it 阶段只产出转义后的骨架，保证首屏 HTML 立刻可见；
 * - 增强阶段再动态加载 Shiki 上色、挂工具栏。
 * 这样 Shiki（约 1MB）完全不进首屏关键路径，大文档也能先看到内容再逐步上色。
 *
 * 增强是**按维度幂等**的：每个维度（行号/换行、折叠策略、配色主题）各自
 * 记录已应用的值，只有真正变化的那个维度会重做。这既保证了设置「修改立即生效」，
 * 又不会因为调一下字号就把用户手动展开的代码块重新折叠回去。
 *
 * 昂贵的部分（工具栏 + Shiki 上色）**按需触发**：10MB 文档有六千多个代码块，
 * 全量上色是二十多秒的纯计算，而其中绝大多数用户永远不会滚到。
 * 这里改由 IntersectionObserver 驱动，只处理视口上下各两屏内的块。
 */
export const codeBlockPlugin: MarkdownPlugin = {
  id: 'codeBlock',
  name: '代码块',
  description: '语法高亮、行号、复制、折叠与下载',
  order: 25,

  setup: (md) => {
    md.renderer.rules.fence = (tokens, idx) => {
      const token = tokens[idx];
      if (!token) return '';

      const rawLang = token.info.trim().split(/\s+/)[0] ?? '';
      const lang = rawLang.toLowerCase();
      // fence 的 content 必定以换行结尾，不去掉会多出一个空行（带行号时尤其明显）
      const escaped = md.utils.escapeHtml(token.content.replace(/\n$/, ''));
      const label = md.utils.escapeHtml(lang || 'text');

      // 注意：<pre> 内不能有多余换行，否则会出现首行空行
      return (
        `<figure class="code-block" data-lang="${label}">` +
        `<figcaption class="code-block__bar"><span class="code-block__lang">${label}</span>` +
        `<span class="code-block__actions"></span></figcaption>` +
        `<pre class="code-block__pre"><code>${escaped}</code></pre>` +
        `</figure>`
      );
    };
  },

  enhance: (root: HTMLElement, ctx: PluginContext) => {
    const blocks = root.querySelectorAll<HTMLElement>('.code-block');
    if (blocks.length === 0) return;

    // 供观察器回调使用；设置变化后回调要按新设置办事
    currentContext = ctx;

    const scrollRoot = findScrollParent(root);
    const { reading } = ctx.settings;
    for (const block of blocks) {
      // 行号与换行是纯 CSS 行为，代价可忽略，所有块一律同步一次
      block.classList.toggle('is-numbered', reading.codeLineNumbers);
      block.classList.toggle('is-wrapped', reading.codeWordWrap);

      // 已经在视口附近的块要立刻按新设置重做（换主题时正在看的那几块）
      if (block.dataset[NEAR_VIEWPORT] === '1') enqueue(block);
      ensureObserved(block, scrollRoot);
    }

    enqueueVisible(blocks, scrollRoot);
    drainQueue();
  },
};
