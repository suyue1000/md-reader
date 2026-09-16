import type { MarkdownPlugin, PluginContext } from '@/types';
import { highlightCode, resolveLanguage } from '@/markdown/highlighter';
import { createLogger } from '@/utils/logger';
import { yieldToMain } from '@/utils/scheduler';

const log = createLogger('plugin:code-block');

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

/**
 * 正在推进的那一轮队列；没在推进时为 null。
 *
 * 存 Promise 而不是布尔量，是为了让「一次做完」的调用方（导出的离屏渲染）
 * 能等到队列真的排空。屏幕上的调用方照旧忽略返回值。
 */
let draining: Promise<void> | null = null;

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
      // 滚动触发的推进没有人等它
      void drainQueue();
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
    const toggle = createActionButton(
      block.classList.contains('is-collapsed') ? '展开' : '折叠',
      () => {
        const collapsed = block.classList.toggle('is-collapsed');
        toggle.textContent = collapsed ? '展开' : '折叠';
      },
    );
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
 * 队列推进循环：批内并发，批间让出主线程。
 *
 * 不自己复位 `draining`——那件事交给 `drainQueue`，理由见那里。
 */
async function drainLoop(): Promise<void> {
  while (queue.size > 0) {
    const batch: HTMLElement[] = [];
    for (const block of queue) {
      batch.push(block);
      queue.delete(block);
      if (batch.length >= HIGHLIGHT_BATCH) break;
    }

    const ctx = currentContext;
    if (!ctx) return;
    /*
     * allSettled 而不是 all：批里的块在上面已经从队列里摘掉了，没有人会再捡它们。
     * 用 `Promise.all` 的话，一块失败就会让这一批剩下的结果**无人查看**——它们仍然
     * 在跑，但成功与否没人知道，失败的那些从此消失得无声无息。逐条报出来，
     * 至少「哪一块没上色」是可查的。
     */
    for (const [index, result] of (
      await Promise.allSettled(batch.map((block) => enhanceBlock(block, ctx)))
    ).entries()) {
      if (result.status === 'rejected') {
        log.warn(
          `代码块上色失败（语言 ${batch[index]?.dataset['lang'] ?? '未知'}）`,
          result.reason,
        );
      }
    }
    if (queue.size > 0) await yieldToMain();
  }
}

/**
 * 启动一轮推进；已经有一轮在跑就把它的 Promise 交出去。
 *
 * 同一时刻只允许一个推进循环。滚动会持续往队列里追加，若每次回调都
 * 开一个新循环，同一个块会被多个循环同时处理——而「已处理」标记要等
 * 异步完成后才写上，重复劳动拦不住。
 *
 * 复位 `draining` 与落定 `task` 排在同一条链上，次序是「先置 null、后落定」：
 * 等在 task 上的人醒来时看到的一定是「没人在推进」。
 *
 * 复位必须走 `finally` 而不是 `then`：`then` 只在兑现时跑，一旦 `drainLoop`
 * 以任何方式抛出（现在它自己兜住了每一批，但循环骨架本身仍可能出事），
 * `draining` 就会**永久**停在一个已拒绝的 Promise 上，此后每一次
 * `startDrain` 都直接把它交出去，整条队列再也推不动，而且不报错。
 */
function startDrain(): Promise<void> {
  if (draining) return draining;
  if (queue.size === 0) return Promise.resolve();

  const task = drainLoop()
    .catch((error: unknown) => {
      log.warn('代码块上色队列意外终止', error);
    })
    .finally(() => {
      draining = null;
    });
  draining = task;
  return task;
}

/**
 * 推进待处理队列，返回的 Promise 在（调用时刻队列里的）块全部处理完后落定。
 *
 * 为什么在途时不能直接把那一轮的 Promise 交出去：上一轮可能**刚好**跑完了
 * 最后一次 `queue.size > 0` 检查、正等着自己的复位回调，而我们的块是在那之后
 * 才排进队列的。此时把它交出去，调用方会立刻醒来，而那批块一个都没处理——
 * 导出拿到的就是一份没上色的代码。所以要先等它结束，再补启一轮。
 * 只补一轮，不做无限重试：第二轮开始时 `draining` 必定已复位。
 */
function drainQueue(): Promise<void> {
  if (draining) return draining.then(() => startDrain());
  return startDrain();
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

  enhance: async (root: HTMLElement, ctx: PluginContext) => {
    const blocks = root.querySelectorAll<HTMLElement>('.code-block');
    if (blocks.length === 0) return;

    // 供观察器回调使用；设置变化后回调要按新设置办事
    currentContext = ctx;

    const { reading } = ctx.settings;
    for (const block of blocks) {
      // 行号与换行是纯 CSS 行为，代价可忽略，所有块一律同步一次
      block.classList.toggle('is-numbered', reading.codeLineNumbers);
      block.classList.toggle('is-wrapped', reading.codeWordWrap);
    }

    /*
     * 一次做完：整篇全排队、等排空，观察器一概不碰。
     *
     * 1. 离屏那棵树用完就丢，登记观察没有下一次回调可等，只会往一个全局
     *    观察器上挂一批马上就要脱离文档的节点；
     * 2. 更要紧的是它会白白扰动那个**全局**观察器：`getObserver` 在 root
     *    变化时 `disconnect()` 重建（见上面那个函数），而离屏节点挂在 body 下，
     *    `findScrollParent` 给出的 root 与屏幕上那棵树（滚动的是 AppShell 的
     *    `<main>`）不是同一个。重建之后，已经进过 `observed` 这个 WeakSet 的
     *    块不会再被登记一次，等于被永久摘掉了观察。
     *
     * 第 2 条的后果**实测下来是看不见的**，别把这条当成修了什么缺陷：
     * 让 eager 也走一遍 `ensureObserved` 重新构建产物，导出后再往下滚，
     * 四个位置的「挂载中的代码块 / 已上色」逐格等于不碰观察器时的结果
     * （3/3、3/3、2/2、2/2）——因为每一轮 `enhance` 末尾的 `enqueueVisible`
     * 本来就会把视口附近的块直接排进队列，新挂上来的块也会在重建后的观察器上
     * 重新登记。这里躲开它只是不想在一个共享的全局对象上做无谓的拆建。
     */
    if (ctx.eager) {
      for (const block of blocks) enqueue(block);
      await drainQueue();
      return;
    }

    const scrollRoot = findScrollParent(root);
    for (const block of blocks) {
      // 已经在视口附近的块要立刻按新设置重做（换主题时正在看的那几块）
      if (block.dataset[NEAR_VIEWPORT] === '1') enqueue(block);
      ensureObserved(block, scrollRoot);
    }

    enqueueVisible(blocks, scrollRoot);
    // 屏幕上的增强不等队列排空：首屏结构已经在了，上色随后补上即可
    void drainQueue();
  },
};
