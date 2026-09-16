import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
  type MouseSelectionStyle,
} from '@codemirror/view';
import type { BlockCache } from './block-cache';
import { estimateBlockHeight } from './block-height';
import type { RenderedBlock } from './block-render';

/** 把新一轮渲染结果送进编辑器状态 */
export const setBlocks = StateEffect.define<readonly RenderedBlock[]>();

/**
 * 当前的块列表。
 *
 * 放在 state 里而不是组件的 ref 里：装饰的重算必须与状态更新在同一个事务
 * 里发生，否则会出现「文本已经变了、装饰还指着旧行号」的一帧，
 * CodeMirror 会因为装饰越界直接抛错。
 */
export const blocksField = StateField.define<readonly RenderedBlock[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBlocks)) return effect.value;
    }
    return value;
  },
});

/**
 * 挑出应该被渲染结果替换的块。
 *
 * 规则只有一条：**选区碰到的块让出源码，其余渲染**。抽成纯函数是因为这是
 * 整个实时预览里唯一有分支的决策，而它在真实编辑器里很难构造用例——
 * 得先有文档、有布局、再模拟选区。
 *
 * @param selection 选区覆盖的 0-based 行区间（闭区间）；阅读态传 null
 */
export function visibleBlocks(
  blocks: readonly RenderedBlock[],
  selection: { fromLine: number; toLine: number } | null,
): readonly RenderedBlock[] {
  if (selection === null) return blocks;
  return blocks.filter((block) => {
    // trailing 块没有源码行可以让出，永远保持渲染
    if (block.trailing) return true;
    return block.endLine <= selection.fromLine || block.startLine > selection.toLine;
  });
}

/**
 * 块内自带交互语义的元素。
 *
 * 点这些东西的意思是「用这个控件」，不是「把光标放到这里」：正文链接、
 * 代码块工具栏的复制 / 下载 / 折叠按钮（`plugins/builtin/code-block.ts`
 * 建的 `button.code-block__action`）、任务列表的复选框。
 */
const INTERACTIVE_IN_BLOCK =
  'a[href], button, input, textarea, select, label, summary, [role="button"], [role="link"]';

/**
 * 块 widget 要不要把这个事件挡在编辑器之外。
 *
 * CodeMirror 在两个地方问这句话（`@codemirror/view` 的 `eventBelongsToEditor`
 * 与 `DOMObserver.onSelectionChange`）：前者决定鼠标事件算不算编辑器的，
 * 后者决定 widget 里的 DOM 选区变化要不要读进编辑器状态。
 *
 * ## 编辑态：只挡块内的控件
 *
 * 一律返回 true（改之前的做法）会让编辑态出现一个**静默写坏文件**的缺陷：
 * 点中段落时焦点进了正文、选区却一步没动，用户以为光标在他点的地方，
 * 敲下的字落到文档开头。同一个原因还让编辑态里选不中正文——选区变化被挡掉，
 * CodeMirror 随后把 DOM 选区按状态里的旧位置复位。
 *
 * 所以编辑态的判据是看**事件目标**：命中 `INTERACTIVE_IN_BLOCK` 才挡
 * （Task 6 那个决定——块里的链接与按钮照常可点——由此保住），其余交给编辑器。
 * `selectionchange` 的 target 是 document，不是 Element，走 false 分支，
 * 于是 widget 内的选区能被正常读进状态。
 *
 * ## 阅读态：一律挡，保持改动之前的行为
 *
 * 视图不可编辑时根本没有「把光标移到这里」这回事（`buildDecorations` 只在
 * `EditorView.editable` 为真时才看选区），放行只有坏处：CodeMirror 的
 * `mousedown` 会接管这次选择（`@codemirror/view` 的 `MouseSelection`，
 * 它在 mouseup 时 `preventDefault` 并把自己算出的选区写回 DOM），
 * 浏览器原生的拖选被一并顶掉。**实测**：同一份 dist、同一套拖选动作，
 * 挡的时候选中「第 1 章的正文段落 ABCDEFGHI」，放行时选中的是空串。
 */
export function widgetIgnoresEvent(event: Event, editable: boolean): boolean {
  if (!editable) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_IN_BLOCK) !== null;
}

/** 承载一块渲染结果的 widget */
class BlockWidget extends WidgetType {
  /**
   * 这一块没量到真实高度时用的经验估值。
   *
   * 惰性算一次即可——它只由 block 决定，而 block 在 widget 的一生里不变。
   * 真实高度不缓存在这里：它会随着 Shiki 上色、Mermaid 出图不断变准，
   * 每次都要现查。
   */
  private fallbackHeight: number | null = null;

  constructor(
    private readonly block: RenderedBlock,
    private readonly cache: BlockCache,
    /**
     * 视图当前是否可编辑，决定块内事件的取舍，见 `widgetIgnoresEvent`。
     *
     * 名字不能叫 `editable`：`WidgetType` 上已经有一个同名的内部 getter
     * （`@codemirror/view` 里标着 `@internal`，表示 widget 自身的内容可不可编辑），
     * 同名字段会在构造时直接抛 `Cannot set property editable of #<WidgetType>`。
     */
    private readonly viewEditable: boolean,
  ) {
    super();
  }

  /**
   * 告诉 CodeMirror 这一块大概多高。
   *
   * **不实现这个属性，视口外的滚动定位会整个失效**，而且是静默失效：
   * 默认值 -1 会让 CodeMirror 把**整块**按一个行高（27px）算，一个 20 行的
   * 代码块因此被低估几百像素，`scrollIntoView` 反复重排也收敛不了，最后打一条
   * `Viewport failed to stabilize` 就放弃，`scrollTop` 一动不动。完整诊断与
   * 估算依据见 `block-height.ts` 的文件注释。
   *
   * 优先用块缓存里量到的真实高度：这一块要是渲染过，真实值比任何公式都准，
   * 而且拿到它只是一次 Map 查询，不触发布局。
   */
  override get estimatedHeight(): number {
    const measured = this.cache.measuredHeight(this.block.key);
    if (measured !== null) return measured;
    this.fallbackHeight ??= estimateBlockHeight(this.block);
    return this.fallbackHeight;
  }

  /**
   * 键相同就认为是同一个 widget，CodeMirror 因此不会重建它的 DOM。
   *
   * 这是块缓存生效的前提：`key` 是「源码文本 + 它在本篇文档里的出现序号」
   * （见 `block-render.ts`），改动一个段落只会让那一个 widget 失配，其余
   * 整篇复用；而两个内容相同、位置不同的块**不会**被认成同一个 widget——
   * 认成同一个就会让它们共用一个 DOM 节点，互相把节点从对方那里摘走。
   */
  override eq(other: BlockWidget): boolean {
    /*
     * 读写状态也要比。
     *
     * 之前这里的注释说「CodeMirror 对 eq 为真的 widget 会继续用旧实例，
     * 只比 key 的话，切到编辑态后块里仍沿用阅读态那套『一律挡』」——**这个
     * 机制说法查证后是错的**。查的是 `@codemirror/view` 的
     * `WidgetViewport`/`findWidget`（dist 里 `compare()` 为真的分支）：
     * `compare()`（也就是 `eq`）为真但实例不同时，它复用的只是 DOM 节点，
     * `WidgetTile` 换上的是**新的** widget 实例（`new WidgetTile(tile.dom,
     * length, widget, ...)`，这里的 `widget` 是新实例，不是 `tile.widget`）。
     * `ignoreEvent` 因此会在新实例——也就是带着正确 `viewEditable` 的
     * 那一个——上被调用。dist 对照实验证实了这一点：把这里改回只比 `key`，
     * 点段落让出源码的行为与加了这条比较完全一致，老毛病没有回来。
     *
     * 加这条比较真正的作用是**更保守的一道防线**：读写状态切换时强制换新
     * widget 而不是复用旧实例，代价只是切换模式那一下多建一批 DOM 节点，
     * 而不是修复某个已知会复发的缺陷。保留它无害，删掉也不会让 Critical
     * 复现——见 `live-preview.test.ts` 里同一条用例的说明。
     */
    return other.block.key === this.block.key && other.viewEditable === this.viewEditable;
  }

  toDOM(): HTMLElement {
    return this.cache.acquire(this.block.key, this.block.html);
  }

  /** 见 `widgetIgnoresEvent`：编辑态只挡块内的控件，阅读态一律挡 */
  override ignoreEvent(event: Event): boolean {
    return widgetIgnoresEvent(event, this.viewEditable);
  }
}

/** 由块列表与选区算出装饰集 */
function buildDecorations(state: EditorState, cache: BlockCache): DecorationSet {
  const blocks = state.field(blocksField);
  if (blocks.length === 0) return Decoration.none;

  /**
   * 只读态下不存在「光标所在的块」，因此所有块都渲染。
   *
   * 判据用 `EditorView.editable` 而不是 `EditorState.readOnly`：前者管的是
   * 「这个视图能不能获得编辑焦点」，后者只管「事务能不能改文档」。二者在
   * CodeMirror 里是独立的两档开关——只设 readOnly 的话视图仍可聚焦、仍有
   * 选区，于是光标所在的块会当场变回源码，阅读体验就破了。
   *
   * 所以配置这个扩展的地方**必须同时**设置这两项。
   */
  const editable = state.facet(EditorView.editable);
  const selection = editable
    ? {
        fromLine: state.doc.lineAt(state.selection.main.from).number - 1,
        toLine: state.doc.lineAt(state.selection.main.to).number - 1,
      }
    : null;

  const lineCount = state.doc.lines;
  const decorations = [];

  for (const block of visibleBlocks(blocks, selection)) {
    if (block.trailing) {
      // 挂在文末：零宽度的插入点，widget 显示在最后一行之后
      const end = state.doc.line(lineCount).to;
      decorations.push(
        Decoration.widget({
          widget: new BlockWidget(block, cache, editable),
          block: true,
          side: 1,
        }).range(end),
      );
      continue;
    }
    // 行号越界说明块列表比文档旧了一拍，跳过而不是让 CodeMirror 抛错
    if (block.startLine + 1 > lineCount || block.endLine > lineCount) continue;

    const from = state.doc.line(block.startLine + 1).from;
    const to = state.doc.line(block.endLine).to;
    decorations.push(
      Decoration.replace({ widget: new BlockWidget(block, cache, editable), block: true }).range(
        from,
        to,
      ),
    );
  }

  return Decoration.set(decorations, true);
}

/**
 * 围栏代码块开栅栏行的判据。
 *
 * 规则取自 CommonMark：最多 3 个前导空格，后跟 3 个以上反引号或波浪线。
 * 直接读**源码文本**判断，不摸 HTML class：`sliceTopLevelBlocks`
 * （`block-slice.ts`）之所以把这一段单独切成一块，本来就是因为 markdown-it
 * 把块首那一行解析成了 fence token 的开栅栏（`token.map` 的起点）——用
 * markdown-it 直接解析核对过：`` ```js\nfunction demo() {\n  return 1;\n}\n``` ``
 * 单独成篇时得到 `token.map === [0, 5]`，第 0 行（0-based）正是 `` ```js ``
 * 那一行；这段代码块前面如果还有 4 行别的内容，`token.map` 的起点就会跟着
 * 变成 4，不是这段源码本身的固定值。所以只要块首那一行本身满足这条语法，
 * 这一块就一定是围栏代码块，不需要另外从渲染出的 HTML 结构反推。
 */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 围栏代码块专属的落点：开栅栏**下一行**，也就是代码内容的第一行；代码块是
 * 空的（没有内容行）时，落在开栅栏**行尾**。
 *
 * ## 为什么单独给围栏代码块开例外，而不是所有块都落块首
 *
 * 块首对 `h2`/`p`/`li`/引用块都是安全的：这些块自己的语法标记
 * （`## `、`- `、`> `）只影响**这一行**怎么被解析，敲坏了至多让这一行退化成
 * 普通段落文本，不会牵连别的内容。围栏代码块不一样：开栅栏与收尾栅栏是一对
 * **跨行配对**的语法，敲坏其中任何一行都会让 markdown-it 找下一个能配对的
 * 栅栏，从而牵连后面一段本不该受影响的内容（用真实浏览器 + 真实 dist 实测
 * 过：点代码块敲一个字符，紧邻的下一个章节被整个吞进一个渲染畸形的 widget，
 * 见本文件同目录 `task-13-report.md` 第 3 轮）。块首恰好就是开栅栏那一行的
 * 开头，踩得最准，所以围栏代码块必须单独处理，落到栅栏包裹的内容里去，
 * 别的块不需要、也不做这个例外——泛化成「首行是语法脚手架的块都跳过首行」
 * 会牵出 HTML 块、脚注定义、表格分隔行等一串新判断，收益不明而复杂度确定。
 *
 * ## 空代码块（开栅栏后面直接是收尾栅栏，中间没有内容行）落**开栅栏行尾**
 *
 * 这时没有内容行可落，「下一行」就是收尾栅栏本身，落在那里同样会踩坏配对。
 * 第 3 轮的选择是退回块首（开栅栏行首），理由是「行首行尾风险等价，不如
 * 都用同一条规则」——**这个机制归因用 markdown-it 直接解析验证过是错的**：
 *
 * ```
 * 原样（未编辑）：      fence[0,2] "", paragraph_open[3,4] "after para" 完好
 * 落行首敲 Z（Z```js）： paragraph_open[0,1]（该行降级成段落）,
 *                       fence[1,4] 内容变成 "\nafter para\n"（后文被吞）
 * 落行尾敲 Z（```jsZ）： fence[0,2] ""（跟原样完全一样），paragraph_open[3,4] 完好
 * ```
 *
 * （用本仓库的 `markdown-it` 依赖对着这三种输入实跑过 `md.parse`，上面是
 * 实测的 `token.map`/`content`，不是推断。）行尾之所以安全：开栅栏后面
 * 本来就允许跟一段「信息串」（```js` 的 `js`），追加字符只是把信息串从
 * `js` 变成 `jsZ`，栅栏语法本身完全不受影响；行首之前完全没有字符，插入
 * 一个字符必然顶到反引号前面，让这一行不再以合法的栅栏标记开头。两者不是
 * 「等价的两种插入位置」，而是「一个动的是语法之外的内容，另一个动的是语法
 * 本身」。落到行尾之后，`resolveLanguage()` 认不出 `jsZ` 这种语言标签，
 * `highlightCode()` 会降级成纯文本高亮（`lang: 'text'`），不抛错、不发起
 * 任何网络请求，只是这一次编辑丢失了语法高亮——这是可以接受的代价。
 */
export function fenceContentLineStart(doc: Text, block: RenderedBlock): number | null {
  if (block.startLine + 1 > doc.lines) return null;
  const openLine = doc.line(block.startLine + 1);
  if (!FENCE_OPEN_RE.test(openLine.text)) return null;
  if (block.endLine > doc.lines) return null;
  // endLine 是 0-based、不含；开栅栏 + 收尾栅栏各占一行，等于 2 说明中间没有
  // 内容行——空代码块，落开栅栏行尾（见上方说明），不是块首
  if (block.endLine - block.startLine <= 2) return openLine.to;
  return doc.line(block.startLine + 2).from;
}

/**
 * 点在渲染块上时，把光标钉在一个确定的位置，不让 CodeMirror 自己按像素猜。
 *
 * ## 不管这件事会发生什么
 *
 * `Decoration.replace({ block: true, ... })` 把一整块源码换成一个不可再分的
 * widget，`@codemirror/view` 的 `posAtCoords`（dist ≈3825-3827）对这类
 * 「非文本」块的落点规则是按**几何中点**二选一：
 *
 * ```js
 * if (block.type != BlockType.Text)
 *   return yOffset < (block.top + block.bottom) / 2
 *     ? new PosAssoc(block.from, 1)
 *     : new PosAssoc(block.to, -1);
 * ```
 *
 * 点击的 y 坐标在块自身可视高度的上半就落 `block.from`（块首），下半就落
 * `block.to`（块尾）。单行块（`h2`/`p`/`li`）滚到视口中央后点正中，几乎总是
 * 命中上半；多行的 `pre` 代码块块高远超视口，点「视口正中」实际点在整块的
 * 下半，于是落到 `block.to`——也就是收尾栅栏 ` ``` ` 之后。敲一个字符会把
 * 收尾栅栏改写成新的开栅栏，其后内容被牵连进渲染畸形的 widget。这是
 * CodeMirror 的通行几何规则，不是本项目的 bug，但配合这条规则，
 * 「点代码块」和「炸开后续内容」只有一步之遥。
 *
 * ## 怎么绕开它
 *
 * `posAtCoords` 的这条中点规则没有暴露任何配置项可以覆盖，但 CodeMirror
 * 在 `mousedown` 上专门开了一个更高层的口子——`EditorView.mouseSelectionStyle`
 * facet：`handlers.mousedown`（dist ≈4967）先问这个 facet 里注册的每个函数
 * 能不能给出一个「这次鼠标手势该选中什么」的 style，都不给才退回内置的
 * `basicMouseSelection`（也就是上面那条中点规则）。这里注册的函数一旦认出
 * 点击落在某个块 widget 的 DOM 上（`[data-block-key]`，见 `block-cache.ts`
 * 的 `acquire`），直接返回一个固定结果，中点规则完全不会被问到。
 *
 * ## 落点具体是哪——**不是**统一落块首
 *
 * 绝大多数块（`h2`/`p`/`li`/引用块……）落**块首**。围栏代码块是唯一的例外，
 * 落在开栅栏**下一行**（代码内容第一行），理由与空代码块的处理见
 * `fenceContentLineStart` 的说明——那是为了不踩在栅栏配对语法上，不是
 * 随意加的特例。
 *
 * 只在编辑态生效：阅读态下 `widgetIgnoresEvent` 一律挡，`mousedown` 根本
 * 走不到 `eventBelongsToEditor` 判定之后的 `handlers.mousedown`（`ignoreEvent`
 * 为真时 `eventBelongsToEditor` 直接判定这次事件不属于编辑器），这个函数
 * 不会被调用。块内的交互控件（链接、按钮、复选框）同理：`ignoreEvent` 已经
 * 把它们的 `mousedown` 挡在外面，落点判定轮不到这里。
 *
 * 落点仍然只到**行**，不到点中的那个字符——字符级映射需要「渲染坐标 →
 * 源码偏移」，本项目已明确不做这个量级的方案。
 *
 * ## 只接管「单击」，不接管拖选/扩选/多选——这是补第 4 轮那次回归的关键
 *
 * 第一版实现给整个鼠标手势返回同一个固定 `selection`（`get: () => selection`），
 * 而 CodeMirror 的 `MouseSelection.move`/`select`（dist ≈4762/4826）在**每次
 * mousemove** 上都会重新调 `style.get(event, extend, multiple)`，把返回值
 * 原样当作新选区 dispatch 出去。固定值意味着无论怎么拖，选区永远是同一个
 * 空区间——编辑态下从渲染块起手的拖选、shift 扩选、双击选词全部失效
 * （复审用探针实测过：mousedown 后拖到别的块、或 `extend=true`，返回的
 * 仍是同一个空选区）。而这些手势能不能被我们的判据处理，从**它们各自的
 * 语义**上看根本不是一回事：拖选要跟着鼠标实时移动，双击/三击要选词/选行，
 * shift 扩选要在原有选区基础上延伸——照单实现整套语义等于重写一遍
 * CodeMirror 内置的 `basicMouseSelection`，而它并不对外导出。
 *
 * 所以这里改成只在**能在 mousedown 这一刻就确定**是一次「左键 + 单击 +
 * 不按 shift/ctrl/cmd」的手势时才接管；`event.detail`（点击次数）、
 * `event.shiftKey`、`event.button` 在 mousedown 触发的那一刻就已经定型
 * （`MouseSelection` 构造函数把 `this.extend = startEvent.shiftKey`、
 * `this.multiple = addsSelectionRange(view, startEvent)` 都算死在起始事件上，
 * dist ≈4752-4753），不需要等后续事件才能判断。不满足就直接 `return null`，
 * 把**整个手势**都交还给 CodeMirror 默认的 `mouseSelectionStyle` 链
 * （最终是 `basicMouseSelection`），双击选词、shift 扩选因此完全不受
 * 我们这段代码影响，恢复到 Round 2 之前的正常表现。
 *
 * 接管之后：手势刚开始（`get` 收到的还是这次 mousedown 的原始 `event` 对象，
 * 因为 `MouseSelection.start` 在未命中已有选区时直接用 `startEvent` 调
 * `select`）钉在算好的落点上——这是「点一下」要修的东西。后续的
 * mousemove/mouseup（`event` 换成了新的事件对象）用 `view.posAtCoords`
 * 现算鼠标真实指向的位置，与锚点一起组成一个跟着走的区间——这才是拖选
 * 要的行为。因为已经在上面把 shift/ctrl/cmd 都筛掉了，这个分支永远不会被
 * `extend`/`multiple` 污染，不需要在这里再处理那两种情形。
 */
export function blockStartMouseSelection(
  view: EditorView,
  event: MouseEvent,
): MouseSelectionStyle | null {
  if (event.button !== 0 || event.detail > 1 || event.shiftKey || event.ctrlKey || event.metaKey) {
    return null;
  }

  const target = event.target;
  if (!(target instanceof Element)) return null;
  const key = target.closest<HTMLElement>('[data-block-key]')?.dataset.blockKey;
  if (key === undefined) return null;

  const blocks = view.state.field(blocksField, false);
  // trailing 块没有可落的源码位置，交还给默认规则（它本就挂在文末）
  const block = blocks?.find((b) => !b.trailing && b.key === key);
  if (!block) return null;

  const lineCount = view.state.doc.lines;
  if (block.startLine + 1 > lineCount) return null;

  let anchor =
    fenceContentLineStart(view.state.doc, block) ?? view.state.doc.line(block.startLine + 1).from;

  return {
    get(curEvent) {
      if (curEvent === event) return EditorSelection.single(anchor);
      const cur = view.posAtCoords({ x: curEvent.clientX, y: curEvent.clientY }, false) ?? anchor;
      return EditorSelection.single(anchor, cur);
    },
    update(update) {
      if (update.docChanged) anchor = update.changes.mapPos(anchor);
      return false;
    },
  };
}

/**
 * 实时预览扩展。
 *
 * 装饰由状态直接算出（`EditorView.decorations.compute`），而不是由
 * ViewPlugin 产出：CodeMirror 明确禁止插件提供**块级**装饰
 * （`RangeError: Block decorations may not be specified via plugins`），
 * 因为块级装饰会改变行高，而插件是在布局阶段之后才求值的。
 * 这里的 widget 全部是 `block: true`，只能走状态派生这条路。
 *
 * 依赖项列全了：块列表、文档、选区，以及 `EditorView.editable`——
 * 少一项就会出现「状态已变、装饰还是旧的」的一帧。
 *
 * cache 通过闭包传入，而不是模块级单例：模块级单例在同时存在两个编辑器
 * 实例时会互相串味。
 *
 * 配置只读视图时，务必同时设置 `EditorView.editable.of(false)` 与
 * `EditorState.readOnly.of(true)`——本扩展判断「阅读态」用的是前者
 * （见 `buildDecorations` 里的说明），只设后者会导致光标所在的块
 * 在只读视图里仍然被打回源码。
 */
export function livePreview(cache: BlockCache): Extension {
  return [
    blocksField,
    EditorView.decorations.compute(
      [blocksField, 'doc', 'selection', EditorView.editable],
      (state) => buildDecorations(state, cache),
    ),
    EditorView.mouseSelectionStyle.of(blockStartMouseSelection),
  ];
}
