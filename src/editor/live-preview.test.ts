import { EditorState } from '@codemirror/state';
import { EditorView, type MouseSelectionStyle } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createBlockCache, type BlockCache } from './block-cache';
import {
  blockStartMouseSelection,
  fenceContentLineStart,
  livePreview,
  setBlocks,
  visibleBlocks,
  widgetIgnoresEvent,
} from './live-preview';
import type { RenderedBlock } from './block-render';

const block = (startLine: number, endLine: number): RenderedBlock => ({
  startLine,
  endLine,
  trailing: false,
  html: '<p></p>',
  key: `${String(startLine)}-${String(endLine)}`,
});

describe('visibleBlocks', () => {
  const blocks = [block(0, 1), block(2, 3), block(4, 6)];

  it('没有选区时所有块都渲染（阅读态）', () => {
    expect(visibleBlocks(blocks, null)).toHaveLength(3);
  });

  it('光标所在的块不渲染，其余照常', () => {
    const result = visibleBlocks(blocks, { fromLine: 2, toLine: 2 });
    expect(result.map((b) => b.startLine)).toEqual([0, 4]);
  });

  it('跨多块的选区把涉及的块全部让出为源码', () => {
    const result = visibleBlocks(blocks, { fromLine: 1, toLine: 4 });
    expect(result.map((b) => b.startLine)).toEqual([0]);
  });

  it('选区落在块之间的空行上，不影响任何块', () => {
    const result = visibleBlocks(blocks, { fromLine: 3, toLine: 3 });
    expect(result).toHaveLength(3);
  });

  it('trailing 块永远渲染——它没有源码可让', () => {
    const withTrailing = [...blocks, { ...block(6, 6), trailing: true, key: 't' }];
    const result = visibleBlocks(withTrailing, { fromLine: 6, toLine: 6 });
    expect(result.some((b) => b.trailing)).toBe(true);
  });
});

/**
 * 取出装饰集里每个块 widget 报给 CodeMirror 的估算高度。
 *
 * 走真实的 `EditorView.decorations` facet 而不是直接 new 一个 widget：
 * 要锁的正是「CodeMirror 真的能问到这个值」这条接线——`estimatedHeight`
 * 是 `WidgetType` 上的可选属性，漏实现时没有任何报错，只是默默退回 -1。
 */
function widgetHeights(blocks: readonly RenderedBlock[], cache: BlockCache): number[] {
  const doc = Array.from({ length: 40 }, (_, index) => `行 ${String(index)}`).join('\n');
  const base = EditorState.create({
    doc,
    // 阅读态：没有「光标所在的块」，所有块都渲染，见 buildDecorations
    extensions: [livePreview(cache), EditorView.editable.of(false)],
  });
  const { state } = base.update({ effects: setBlocks.of(blocks) });

  const decorations = state.facet(EditorView.decorations)[0];
  if (!decorations || typeof decorations === 'function') return [];

  const heights: number[] = [];
  for (const iter = decorations.iter(); iter.value !== null; iter.next()) {
    const spec = iter.value.spec as { widget?: { estimatedHeight: number } };
    if (spec.widget) heights.push(spec.widget.estimatedHeight);
  }
  return heights;
}

describe('BlockWidget 的高度估算接线', () => {
  const codeBlock: RenderedBlock = {
    startLine: 2,
    endLine: 22,
    trailing: false,
    html: '<figure class="code-block"><pre class="code-block__pre"><code>x</code></pre></figure>',
    key: 'code',
  };

  it('每个块 widget 都报出一个正的估算高度', () => {
    /*
     * 缺陷一的直接判据。`WidgetType.estimatedHeight` 默认返回 -1，而
     * CodeMirror 对 -1 的兜底是**整块只算一个行高**——一个 20 行的代码块
     * 因此被低估几百像素，`scrollIntoView` 收敛不了，滚动定位整个失效。
     */
    const heights = widgetHeights([codeBlock], createBlockCache());
    expect(heights).toHaveLength(1);
    expect(heights[0]).toBeGreaterThan(0);
  });

  it('20 行的代码块估出来远高于一个行高', () => {
    const heights = widgetHeights([codeBlock], createBlockCache());
    // 一个行高约 27px；这里要的是「量级正确」，不是某个精确值
    expect(heights[0]).toBeGreaterThan(300);
  });

  it('块缓存里量到过真实高度时，用真实高度而不是经验估值', () => {
    const cache = createBlockCache();
    const measured = 12345;
    const stub: BlockCache = {
      ...cache,
      acquire: (key, html) => cache.acquire(key, html),
      measuredHeight: (key) => (key === 'code' ? measured : null),
    };
    expect(widgetHeights([codeBlock], stub)[0]).toBe(measured);
  });
});

/**
 * 块 widget 对事件的取舍。
 *
 * 这组用例锁的是一个**会静默写坏用户文件**的缺陷：`ignoreEvent` 一律返回
 * true 时，点中渲染好的段落会让焦点进入正文、而选区一步不动——用户以为
 * 光标在他点的地方，敲下的字落到文档开头，屏幕上没有任何提示。
 * 同一个原因还让编辑态里拖选正文取不到文本。
 */
describe('widgetIgnoresEvent', () => {
  const HTML =
    '<div class="markdown-body"><p id="para">正文 <a href="#锚">链接</a></p>' +
    '<figure class="code-block"><button class="code-block__action">复制</button>' +
    '<pre class="code-block__pre"><code>代码</code></pre></figure>' +
    '<ul class="contains-task-list"><li><input type="checkbox" disabled> 待办</li></ul></div>';

  /** 在块 DOM 的某个元素上真派发一次鼠标事件，把事件对象捞出来 */
  function mouseEventOn(selector: string): Event {
    const root = document.createElement('div');
    root.innerHTML = HTML;
    document.body.append(root);
    const target = root.querySelector(selector);
    if (!target) throw new Error(`选择器没命中：${selector}`);

    let captured: Event | null = null;
    root.addEventListener(
      'mousedown',
      (event) => {
        captured = event;
      },
      { once: true },
    );
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    root.remove();
    if (!captured) throw new Error('事件没冒泡上来');
    return captured;
  }

  it('编辑态点正文段落不挡——挡住的话光标停在原处，字会打到别的地方', () => {
    expect(widgetIgnoresEvent(mouseEventOn('#para'), true)).toBe(false);
  });

  it('编辑态点代码块里的代码不挡', () => {
    expect(widgetIgnoresEvent(mouseEventOn('code'), true)).toBe(false);
  });

  it('编辑态点块内链接要挡，否则点链接会变成把光标移过去', () => {
    expect(widgetIgnoresEvent(mouseEventOn('a[href]'), true)).toBe(true);
  });

  it('编辑态点代码块工具栏按钮要挡', () => {
    expect(widgetIgnoresEvent(mouseEventOn('.code-block__action'), true)).toBe(true);
  });

  it('编辑态点任务列表复选框要挡', () => {
    expect(widgetIgnoresEvent(mouseEventOn('input[type="checkbox"]'), true)).toBe(true);
  });

  it('selectionchange 这类 target 不是元素的事件不挡——编辑态选中靠它读回选区', () => {
    // CodeMirror 的 DOMObserver.onSelectionChange 也会问这句话，
    // 而 selectionchange 的 target 是 document
    expect(widgetIgnoresEvent(new Event('selectionchange'), true)).toBe(false);
  });

  it('阅读态一律挡——放行会让 CodeMirror 顶掉浏览器原生的拖选', () => {
    /*
     * 回归：阅读态放行之后，CodeMirror 的 mousedown 会接管这次选择
     * （`MouseSelection`，mouseup 时 preventDefault 并把自己的选区写回 DOM）。
     * 实测同一份 dist：挡的时候拖选得到整句，放行时得到空串。
     */
    expect(widgetIgnoresEvent(mouseEventOn('#para'), false)).toBe(true);
    expect(widgetIgnoresEvent(mouseEventOn('code'), false)).toBe(true);
    expect(widgetIgnoresEvent(new Event('selectionchange'), false)).toBe(true);
  });
});

/**
 * 上面那组只证明纯函数判对了，证明不了 CodeMirror 真的问到了它——
 * `ignoreEvent` 要是改回 `return true`，上面六条照样全绿。
 */
describe('BlockWidget 与事件取舍的接线', () => {
  interface ProbedWidget {
    ignoreEvent: (event: Event) => boolean;
    eq: (other: ProbedWidget) => boolean;
  }

  function widgetOf(html: string, editable = true): ProbedWidget | null {
    const block: RenderedBlock = { startLine: 0, endLine: 0, trailing: false, html, key: 'k' };
    const base = EditorState.create({
      doc: '正文\n\n第二段',
      // 编辑态：选区不在这一块上，所以它是被 widget 替换掉的那一块
      extensions: [livePreview(createBlockCache()), EditorView.editable.of(editable)],
    });
    // 行号沿用本文件顶部 `block()` 的语义：startLine 是 0-based 起始行，
    // endLine 是它的 1-based 结束行（buildDecorations 里 `doc.line(endLine).to`）
    const { state } = base.update({
      effects: setBlocks.of([{ ...block, startLine: 2, endLine: 3 }]),
    });
    const decorations = state.facet(EditorView.decorations)[0];
    if (!decorations || typeof decorations === 'function') return null;

    const iter = decorations.iter();
    const spec = iter.value?.spec as { widget?: ProbedWidget };
    return spec.widget ?? null;
  }

  it('装饰集里的 widget 用的就是 widgetIgnoresEvent 的判据', () => {
    const widget = widgetOf('<p id="para">正文 <a href="#锚">链接</a></p>');
    expect(widget).not.toBeNull();

    const root = document.createElement('div');
    root.innerHTML = '<p id="para">正文 <a href="#锚">链接</a></p>';
    document.body.append(root);
    const capture = (selector: string): Event => {
      let captured: Event | null = null;
      root.addEventListener('mousedown', (event) => (captured = event), { once: true });
      root.querySelector(selector)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      if (!captured) throw new Error('事件没冒泡上来');
      return captured;
    };

    expect(widget?.ignoreEvent(capture('#para'))).toBe(false);
    expect(widget?.ignoreEvent(capture('a[href]'))).toBe(true);

    // 阅读态的同一个块：一律挡
    const readOnlyWidget = widgetOf('<p id="para">正文 <a href="#锚">链接</a></p>', false);
    expect(readOnlyWidget?.ignoreEvent(capture('#para'))).toBe(true);
    root.remove();
  });

  it('切换读写状态的同一个块不算同一个 widget', () => {
    /*
     * 这条锁的是 `eq()` 里一道刻意加的保守防线，**不是**某个缺陷的成因。
     *
     * 曾经以为「eq 为真时 CodeMirror 会继续用旧实例，只比 key 的话，切到
     * 编辑态后仍会沿用阅读态的 ignoreEvent」——这个机制说法经查证是错的：
     * `@codemirror/view` 的 `findWidget`/`compare` 在 `eq` 为真但实例不同时，
     * 复用的只是 DOM，采纳的是**新** widget 实例，`ignoreEvent` 会在新实例上
     * 被调用。dist 对照实验证实过：把 `eq()` 改回只比 key，点段落的行为与
     * 加了这条比较完全一致，「光标不动」的老毛病并不会复发。
     *
     * 加这条比较的真正理由只是让读写切换强制换新 widget（更保守、更不容易
     * 被将来的改动意外绕开），代价是模式切换那一下多建一批 DOM 节点。
     * 删掉这条比较不会导致任何已知缺陷复现，见 `live-preview.ts` 的 `eq()`。
     */
    const html = '<p id="para">正文</p>';
    const readWidget = widgetOf(html, false);
    const editWidget = widgetOf(html, true);
    expect(readWidget).not.toBeNull();
    expect(editWidget).not.toBeNull();
    expect(readWidget?.eq(editWidget as ProbedWidget)).toBe(false);
    // 同一种状态下仍然要认成同一个 widget，否则块缓存失去意义
    expect(editWidget?.eq(widgetOf(html, true) as ProbedWidget)).toBe(true);
  });
});

/**
 * 点击落点：绝大多数块落块首，围栏代码块例外——落在开栅栏下一行（代码内容
 * 第一行），空代码块落开栅栏**行尾**（不是块首，见下方 `fenceContentLineStart`
 * 一节的订正）。
 *
 * 缺陷背景：`@codemirror/view` 的 `posAtCoords` 对 `block: true` 的 widget
 * 按几何中点二选一——点在块自身可视高度的上半落块首，下半落块尾，四类块的
 * 落点因此参差不齐。第一版修复统一落块首后又发现：围栏代码块的块首恰好就是
 * 开栅栏那一行，敲字符照样会破坏栅栏配对、牵连后续内容，因此围栏代码块需要
 * 再落深一行。
 *
 * 这里的 `doc` 是**真实的 Markdown 源码**（不再是无意义的占位行）：判据现在
 * 直接读源码里的栅栏语法，用占位文本测不出这条区别。
 *
 * 这一轮还补了「只接管单击」的回归——第一版对整个鼠标手势返回同一个固定
 * `selection`，导致编辑态从渲染块起手的拖选、shift 扩选、双击选词全部失效
 * （详见 `blockStartMouseSelection` 的文件内注释与 `task-13-report.md` 第 4 轮）。
 */
describe('blockStartMouseSelection', () => {
  const doc = [
    '第0行', // 1: h2 块
    '第1行', // 2
    '```js', // 3: pre 块开栅栏（startLine=2）
    'function demo() {', // 4: 代码内容第一行——修复后的落点
    '  return 1;', // 5
    '}', // 6
    '```', // 7: pre 块收尾栅栏（endLine=7，不含）
    '第7行', // 8
    '```', // 9: empty-pre 块开栅栏（startLine=8）
    '```', // 10: empty-pre 块收尾栅栏，紧跟开栅栏，中间没有内容行（endLine=10）
    '第10行', // 11
    '> 引用第一行', // 12: quote 块（非围栏的多行块，startLine=11）
    '> 引用第二行', // 13
  ].join('\n');
  /** 用一个不含任何块渲染扩展的干净 state 算某一行（1-based）的起止偏移 */
  const lineStart = (line: number) => EditorState.create({ doc }).doc.line(line).from;
  const lineEnd = (line: number) => EditorState.create({ doc }).doc.line(line).to;

  const blocks: readonly RenderedBlock[] = [
    { startLine: 0, endLine: 1, trailing: false, html: '<h2></h2>', key: 'h2' },
    // 围栏代码块：开栅栏 + 3 行内容 + 收尾栅栏，共 5 行
    { startLine: 2, endLine: 7, trailing: false, html: '<pre></pre>', key: 'pre' },
    // 空的围栏代码块：开栅栏紧跟收尾栅栏，共 2 行，中间没有内容行
    { startLine: 8, endLine: 10, trailing: false, html: '<pre></pre>', key: 'empty-pre' },
    // 非围栏的多行块（引用块）：块首同样是语法标记所在行，但不应该被特殊对待
    { startLine: 11, endLine: 13, trailing: false, html: '<blockquote></blockquote>', key: 'quote' },
  ];

  /**
   * `posAtCoords` 只在测拖选的用例里用得到，这里用一个可控的桩函数替代
   * 真实的像素计算——那需要完整的浏览器布局环境，jsdom 给不了。
   */
  function viewStub(
    blocks: readonly RenderedBlock[],
    posAtCoords?: (coords: { x: number; y: number }) => number | null,
  ): EditorView {
    const base = EditorState.create({
      doc,
      extensions: [livePreview(createBlockCache()), EditorView.editable.of(true)],
    });
    const { state } = base.update({ effects: setBlocks.of(blocks) });
    // 只需要 `.state`（和按需的 `posAtCoords` 桩）：这里测的是纯粹按状态算
    // 落点的逻辑，不需要真的挂载、布局一个 EditorView（那需要完整的浏览器
    // 度量环境）
    return { state, posAtCoords } as unknown as EditorView;
  }

  /**
   * 派发一次真实的 mousedown 并把事件对象捞出来。
   *
   * `container` 挂到 `document.body`、`clickTarget` 是实际派发事件的节点——
   * 两者分开是因为 `Element.append` 在节点已有父节点时会**移动**它：如果
   * 直接把 `clickTarget` append 到一个新建的临时根节点上，会把它从调用方
   * 搭好的 `data-block-key` 祖先链上摘下来，`closest` 自然再也找不到那层。
   */
  function dispatchMousedown(
    clickTarget: Element,
    container: Element,
    init: MouseEventInit = {},
  ): MouseEvent {
    document.body.append(container);
    let captured: MouseEvent | null = null;
    document.body.addEventListener(
      'mousedown',
      (event) => {
        captured = event;
      },
      { once: true },
    );
    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ...init }));
    container.remove();
    if (!captured) throw new Error('事件没冒泡上来');
    return captured;
  }

  /** 造一个「鼠标点在某个 DOM 节点上」的真实 mousedown 事件，target 是真元素 */
  function mousedownOn(node: Element, init: MouseEventInit = {}): MouseEvent {
    return dispatchMousedown(node, node, init);
  }

  /** 造一个「点在某个块 widget DOM 上」的事件：外层带 data-block-key，命中它内部的子节点 */
  function mousedownOnBlock(key: string, init: MouseEventInit = {}): MouseEvent {
    const host = document.createElement('div');
    host.dataset.blockKey = key;
    const inner = document.createElement('span');
    host.append(inner);
    return dispatchMousedown(inner, host, init);
  }

  it('点在围栏代码块上，落点是开栅栏下一行（代码内容第一行），不是开栅栏本身', () => {
    const event = mousedownOnBlock('pre');
    const style = blockStartMouseSelection(viewStub(blocks), event);
    expect(style).not.toBeNull();
    // 用同一个 event 对象查，模拟 MouseSelection.start 用起始事件本身调 get
    // 的路径——这是「点一下不拖」的落点，见下面「拖选」那组用例的说明
    const head = style?.get(event, false, false).main.head;
    // 第 3 行是开栅栏 "```js"，第 4 行 "function demo() {" 才是落点——
    // 敲字符落在代码内容里，不会再把开栅栏改写成 "Z```js"
    expect(head).toBe(lineStart(4));
  });

  it('点在单行块上，落点是块首（h2/p/li/引用块这一类不受围栏例外影响）', () => {
    const event = mousedownOnBlock('h2');
    const style = blockStartMouseSelection(viewStub(blocks), event);
    expect(style?.get(event, false, false).main.head).toBe(lineStart(1));
  });

  it('点在空的围栏代码块上（开栅栏紧跟收尾栅栏），落开栅栏行尾，不是块首', () => {
    /*
     * 第 3 轮曾经退回块首（开栅栏行首），理由是「行首行尾风险等价」——
     * 这条机制归因用 markdown-it 直接解析验证过是错的，见 `fenceContentLineStart`
     * 的文件内注释：行尾只是在延长开栅栏的信息串，栅栏语法本身不受影响；
     * 行首插入必然顶在反引号前面，让这一行不再以合法栅栏标记开头。
     */
    const event = mousedownOnBlock('empty-pre');
    const style = blockStartMouseSelection(viewStub(blocks), event);
    expect(style?.get(event, false, false).main.head).toBe(lineEnd(9));
  });

  it('点在非围栏的多行块（引用块）上，落点仍是块首——围栏例外不泛化到其他块类型', () => {
    const event = mousedownOnBlock('quote');
    const style = blockStartMouseSelection(viewStub(blocks), event);
    expect(style?.get(event, false, false).main.head).toBe(lineStart(12));
  });

  it('点击目标不在任何块 widget 的 DOM 上——交还给 CodeMirror 的默认落点规则', () => {
    const plain = document.createElement('span');
    expect(blockStartMouseSelection(viewStub(blocks), mousedownOn(plain))).toBeNull();
  });

  it('块列表里找不到匹配的 key（渲染结果已经过期一拍）——同样交还给默认规则', () => {
    expect(blockStartMouseSelection(viewStub(blocks), mousedownOnBlock('不存在的键'))).toBeNull();
  });

  describe('只接管左键单击，其余手势整场交还给 CodeMirror 默认逻辑', () => {
    /*
     * `event.detail`/`event.shiftKey`/`event.button` 在 mousedown 触发的
     * 那一刻就已经定型（CodeMirror 的 `MouseSelection` 构造函数把
     * `extend`/`multiple` 算死在起始事件上），所以这里直接在最外层判断，
     * 不需要真的走一遍拖选/双击的完整手势。
     */
    it('双击（detail=2）—— return null', () => {
      const event = mousedownOnBlock('pre', { detail: 2 });
      expect(blockStartMouseSelection(viewStub(blocks), event)).toBeNull();
    });

    it('三击（detail=3）—— return null', () => {
      const event = mousedownOnBlock('pre', { detail: 3 });
      expect(blockStartMouseSelection(viewStub(blocks), event)).toBeNull();
    });

    it('按住 shift（扩选）—— return null', () => {
      const event = mousedownOnBlock('pre', { shiftKey: true });
      expect(blockStartMouseSelection(viewStub(blocks), event)).toBeNull();
    });

    it('按住 ctrl（多选，Windows/Linux 的 addsSelectionRange）—— return null', () => {
      const event = mousedownOnBlock('pre', { ctrlKey: true });
      expect(blockStartMouseSelection(viewStub(blocks), event)).toBeNull();
    });

    it('按住 cmd/meta（多选，macOS 的 addsSelectionRange）—— return null', () => {
      const event = mousedownOnBlock('pre', { metaKey: true });
      expect(blockStartMouseSelection(viewStub(blocks), event)).toBeNull();
    });

    it('非左键（比如右键菜单）—— return null', () => {
      const event = mousedownOnBlock('pre', { button: 2 });
      expect(blockStartMouseSelection(viewStub(blocks), event)).toBeNull();
    });
  });

  describe('拖选：后续 mousemove/mouseup 用真实坐标现算，不是钉死同一个选区', () => {
    /*
     * 回归背景：第一版 `get: () => selection` 对整个手势返回同一个值，
     * `MouseSelection.select` 在每次 mousemove 上都会重新调 `style.get`
     * 并把结果原样 dispatch 成新选区（dist ≈4826）——固定值意味着不管怎么
     * 拖，选区永远是同一个空区间。复审用探针实测过：mousedown 后拖到另一个
     * 块、或 `extend=true`，返回的仍是同一个空选区。
     */
    it('mousedown 落在锚点，后续 mousemove（不同的 event 对象）用 posAtCoords 现算落点', () => {
      const event = mousedownOnBlock('pre');
      const posAtCoords = () => lineStart(8); // 假装拖到了第 8 行「第7行」那一段
      const style = blockStartMouseSelection(viewStub(blocks, posAtCoords), event);
      expect(style).not.toBeNull();

      // 手势开始：还是同一个 event 对象，钉在锚点（内容第一行）
      expect(style?.get(event, false, false).main.head).toBe(lineStart(4));

      // 拖动：mousemove 派发的是一个新的 MouseEvent 对象，get 必须现算
      const move = new MouseEvent('mousemove', { clientX: 100, clientY: 200 });
      const dragged = style?.get(move, false, false);
      expect(dragged?.main.anchor).toBe(lineStart(4)); // 锚点不变
      expect(dragged?.main.head).toBe(lineStart(8)); // 头随 posAtCoords 走
      expect(dragged?.main.empty).toBe(false); // 真的选中了一段，不是空区间
    });

    it('posAtCoords 拿不到位置（比如拖到了视口外）时退回锚点，选区不丢', () => {
      const event = mousedownOnBlock('pre');
      const style = blockStartMouseSelection(
        viewStub(blocks, () => null),
        event,
      );
      const move = new MouseEvent('mousemove', { clientX: 0, clientY: -999 });
      expect(style?.get(move, false, false).main.head).toBe(lineStart(4));
    });
  });

  it('接线：`EditorView.mouseSelectionStyle` facet 里确实注册了这个函数', () => {
    /*
     * 回归护栏：只测 `blockStartMouseSelection` 本身，防不住「函数写对了，
     * 但没有通过 `EditorView.mouseSelectionStyle.of(...)` 接进 `livePreview`」
     * 这种假绿——那样的话 CodeMirror 永远不会调用它，行为原样退回几何中点
     * 规则，`pre` 块敲字依旧会破坏栅栏配对。
     */
    const state = EditorState.create({
      doc,
      extensions: [livePreview(createBlockCache()), EditorView.editable.of(true)],
    }).update({ effects: setBlocks.of(blocks) }).state;
    const view = { state } as unknown as EditorView;
    const event = mousedownOnBlock('pre');

    const providers = state.facet(EditorView.mouseSelectionStyle);
    const style = providers.reduce<MouseSelectionStyle | null>(
      (found, makeStyle) => found ?? makeStyle(view, event),
      null,
    );
    expect(style).not.toBeNull();
    expect(style?.get(event, false, false).main.head).toBe(lineStart(4));
  });
});

/**
 * 围栏代码块落点例外的纯函数判据，单独测：上面那组用例证明「接上去了」，
 * 这组证明「判据本身对」——尤其是空代码块与非围栏块两条边界。
 */
describe('fenceContentLineStart', () => {
  const doc = [
    '```js', // 1: 开栅栏
    'const a = 1;', // 2: 内容第一行
    'const b = 2;', // 3
    '```', // 4: 收尾栅栏
    '```', // 5: 空代码块开栅栏
    '```', // 6: 空代码块收尾栅栏
    '普通段落，不是围栏', // 7
    '第二行', // 8
    ' ```', // 9: 前导 1 个空格的开栅栏——CommonMark 容许最多 3 个
    'x = 1;', // 10: 内容第一行
    '```', // 11: 收尾栅栏
  ].join('\n');
  const state = EditorState.create({ doc });

  it('围栏代码块有内容时，返回开栅栏下一行的偏移', () => {
    const block: RenderedBlock = { startLine: 0, endLine: 4, trailing: false, html: '', key: 'k' };
    expect(fenceContentLineStart(state.doc, block)).toBe(state.doc.line(2).from);
  });

  it('开栅栏带最多 3 个前导空格时仍能识别（CommonMark 的容差），不是只认顶格的三个反引号', () => {
    // 单独覆盖 FENCE_OPEN_RE 里 `{0,3}` 这个分支——之前没有任何用例走到
    // 「前导空格非零」这条路径，删掉这个分支也不会有测试变红
    const block: RenderedBlock = { startLine: 8, endLine: 11, trailing: false, html: '', key: 'k' };
    expect(fenceContentLineStart(state.doc, block)).toBe(state.doc.line(10).from);
  });

  it('空围栏代码块（开栅栏紧跟收尾栅栏）落开栅栏行尾，不是块首也不是 null', () => {
    /*
     * 第 3 轮这里曾经返回 null（调用方回退到块首），理由是「行首行尾风险
     * 等价」——用 markdown-it 验证过是错的，见 `fenceContentLineStart` 的
     * 文件内注释：行尾只是延长开栅栏的信息串，不影响栅栏语法本身。
     */
    const block: RenderedBlock = { startLine: 4, endLine: 6, trailing: false, html: '', key: 'k' };
    expect(fenceContentLineStart(state.doc, block)).toBe(state.doc.line(5).to);
  });

  it('块首不是开栅栏语法（普通段落）返回 null，不会被误判成围栏代码块', () => {
    const block: RenderedBlock = { startLine: 6, endLine: 8, trailing: false, html: '', key: 'k' };
    expect(fenceContentLineStart(state.doc, block)).toBeNull();
  });

  it('块的起始行超出文档范围（渲染结果过期一拍）返回 null，不抛错', () => {
    const block: RenderedBlock = { startLine: 100, endLine: 101, trailing: false, html: '', key: 'k' };
    expect(fenceContentLineStart(state.doc, block)).toBeNull();
  });
});
