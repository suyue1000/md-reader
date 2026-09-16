import { create } from 'zustand';
import type { MarkdownDocument, TocNode, WatchStatus } from '@/types';

/** 文档加载状态机 */
export type DocumentStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 当前文档 / 目录树的全局状态 */
export interface DocumentStore {
  /** 当前打开的文档 */
  document: MarkdownDocument | null;
  /**
   * 「第几次打开」的序号，每次 `setDocument` / `reset` 自增。
   *
   * 存在的理由是 documentId **不足以标识一次打开**：同一篇文档可以被打开
   * 两次，第一次带 `#锚点`、第二次不带，而两次的 id 完全一样。凡是「这一次
   * 打开是怎么发生的」这类状态（`useReadingPosition` 里那道「锚点优先于
   * 阅读位置」的闩锁、`usePendingAnchor` 记下的锚点行号）都必须按这个序号
   * 复位，否则会粘在文档上跨越多次打开——那正是闩锁曾经的缺陷。
   *
   * 自动刷新（`applyRefreshedDocument`）**不**自增：那是「同一次打开换了
   * 内容」，用户仍停在他打开时指定的锚点上，闩锁不该在这里松开。
   */
  openEpoch: number;
  /**
   * 「第几次显式导航」的序号，每次 `markNavigation` 自增。
   *
   * **显式导航**指用户明确表达了「去别处」的意图。它与「用户自己滚了一下」
   * 是同一件事的两种形态，因此对「待执行的阅读位置恢复 / 锚点重跳」必须有
   * 同样的效力——把它作废。
   *
   * ## 什么算显式导航（三条同时成立）
   *
   * 1. **起因是用户的一次明确操作**——点击、快捷键、输入。页面自己的时序不算：
   *    增强完成后的校正、块渲染、自动刷新，这些都是我们替用户做的事。
   * 2. **它真的把视口带到别处**——代码里确实执行了一次滚动。只改高亮、只写
   *    地址栏、或者目标本来就在视口里因而没滚，都不算。
   * 3. **落点是我们自己算出来的**——正因如此，被带走的这段距离不属于「用户
   *    自己滚的」，`useReadingPosition` 的值比对判据认不出它。
   *
   * 第 3 条是这个字段存在的全部理由，但**不要**把它读成「只有 CodeMirror 的
   * `scrollIntoView` 才需要记」。`scrollTo` / `Element.scrollIntoView` 这类会
   * 产生真实 `scroll` 事件的形式同样要记：事件排在 `onEnhanced` 后面，指望它
   * 撤防一样来不及——这正是本字段要修的那个缺陷的形状。
   *
   * ## 怎么记
   *
   * 紧挨着滚动那一行调用，**在同一个同步流程里**（时序要求见
   * `TocPanel.handleSelect`）。没真的滚就不要记（编辑器还没就绪、目标已在
   * 视口内、锚点没命中标题）——白撤一次防会吃掉一次本该发生的阅读位置恢复。
   *
   * ## 目前的调用点
   *
   * 侧栏目录点击（`TocPanel`）、正文 `#锚点` 链接（`useRelativeLinks`）、
   * 跳到搜索命中（`useSearch`）、返回顶部（`BackToTop`）。
   *
   * 为什么这件事得放在全局 store 里：目录面板挂在侧栏（`AppShell` 的兄弟
   * 子树），而消费方 `useReadingPosition` 挂在阅读页，两边传不了回调。
   * store 本来就是这类「这一次打开是怎么发生的」状态的落脚处（见 openEpoch、
   * pendingAnchor），放这里不新增一套机制。
   *
   * 为什么是单调自增的序号而不是一个布尔量：布尔量必须在「新的一次打开」
   * 里被抹掉，于是又多出一处「抹除与置位谁先跑」的时序要求——闩锁栽过的
   * 正是这种坑。序号从不复位，谁关心「我在意的这段时间里有没有发生过导航」，
   * 谁自己存一份起点做比对，互不干扰。
   *
   * 地址栏锚点**不**走这里：它就是「这一次打开」本身，已经由
   * `useReadingPosition` 的 `anchorOpenRef` 按 openEpoch 闩住了，再记一次
   * 只是同一个事实的第二份表述。
   */
  navigationEpoch: number;
  /** 加载状态 */
  status: DocumentStatus;
  /** 出错信息 */
  error: string | null;
  /** 当前文档的目录树（Phase 3 填充） */
  toc: TocNode[];
  /** 当前高亮的目录节点 id */
  activeHeadingId: string | null;
  /**
   * 待跳转的标题锚点，消费一次即清空。
   *
   * 存在的理由是时序：打开 `xxx.md#某标题` 时，锚点在地址里，
   * 而目标元素要等渲染完才存在——浏览器原生的锚点跳转早就错过了时机。
   */
  pendingAnchor: string | null;
  /** 文件监听状态 */
  watchStatus: WatchStatus;
  /** 监听停止的原因，仅在 stopped 时有值 */
  watchMessage: string | null;
  /** 上一次因文件变化而自动刷新的时间戳；0 表示尚未发生过 */
  lastRefreshedAt: number;
  /**
   * 阅读还是编辑。两者共用同一个编辑器实例，差别只是若干扩展的开关
   * （`EditorView.editable` 与 `EditorState.readOnly` 成对切换，见 `MarkdownEditor`）。
   */
  mode: 'read' | 'edit';
  /**
   * 是否已拿到当前文件的写权限，决定保存能不能静默进行。
   *
   * 主要由 `useEditMode.enterEdit` 写入：`requestPermission` 要求用户手势，
   * 而「点编辑按钮那一下」是整条链路上最正常的那个时机。
   * 为 false 不代表不能编辑，只代表保存要降级成「另存」。
   *
   * 另有两处也会置真，都在 `useAutoSave.runSave` 里、都在 openEpoch 守卫
   * **之后**（手动 ⌘S 补申请到了写权限、另存对话框返回了新句柄）。它们必须
   * 在守卫之后，因为两者都跨了一个 await：授权框或另存框弹着的时候用户可以
   * 换文档，落到新文档头上就是给乙记了一份对它并不成立的写权限。
   */
  writable: boolean;
  /**
   * 磁盘上被外部改动、且与本地未保存内容冲突的那份文档；null 表示没有冲突。
   *
   * 只在编辑态下会出现：`decideRefresh`（`src/editor/conflict.ts`）只在
   * 「外部真的变了 + 编辑器里有未保存改动」时才判定为冲突，阅读态下编辑器
   * 内容永远跟 `document.content` 一致，不可能触发。冲突期间自动刷新暂停
   * 轮询（见 `useAutoRefresh`），避免用户还没决断就又弹一次同样的提示。
   *
   * 保存链路也必须在这期间停手：这个字段非空就意味着磁盘上那份是别的程序
   * 写的、且本应用里没有它的任何副本，写盘会不可逆地抹掉它。判据落在
   * `decideSaveTarget`（`conflictPending`），自动与手动两条路共用。
   */
  conflict: MarkdownDocument | null;
  /**
   * 编辑器里的正文与上次落盘内容是否已经不同。
   *
   * 判据是 `编辑器文本 !== document.content`，由 `useAutoSave` 在文本变化时
   * 算好写进来——store 自己算不了，它手上没有编辑器里的活文本。
   *
   * 三个消费方：状态栏的「● 未保存」、关页拦截（`beforeunload`）、
   * 切换文档前的确认。它们都需要在**编辑页之外**读到这个事实，这正是它
   * 必须放在全局 store 而不是 `ReaderPage` 的本地 state 里的原因。
   */
  dirty: boolean;
  /** 保存状态；只驱动状态栏的文案，不参与任何判定 */
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  /** 保存失败的原因，仅在 saveStatus 为 error 时有值 */
  saveError: string | null;
  /** 上次保存成功的时间戳；0 表示这次打开还没保存过 */
  lastSavedAt: number;

  setLoading: () => void;
  setDocument: (doc: MarkdownDocument) => void;
  setError: (message: string) => void;
  setToc: (toc: TocNode[]) => void;
  setPendingAnchor: (anchor: string | null) => void;
  /** 记下一次显式导航，见 `navigationEpoch` */
  markNavigation: () => void;
  setWatchStatus: (status: WatchStatus, message?: string | null) => void;
  /** 文件变化引起的内容更新：与 setDocument 的区别是不清空目录、并记录刷新时间 */
  applyRefreshedDocument: (doc: MarkdownDocument) => void;
  setActiveHeadingId: (id: string | null) => void;
  setMode: (mode: 'read' | 'edit') => void;
  setWritable: (writable: boolean) => void;
  /** 记下一次外部改动冲突，供 UI 弹出决断条 */
  setConflict: (document: MarkdownDocument) => void;
  /**
   * 清掉冲突记录。
   *
   * 只负责清状态本身，不负责「选哪一份」——那需要拿到编辑器里的当前文本
   * （把它推进版本缓冲）与 `applyRefreshedDocument`，两者都不是 store 该管的
   * 依赖（前者要读 CodeMirror 实例，后者是 `editor/save.ts` 的模块状态）。
   * 具体决断的编排放在发起决断的 UI 组件里（`ConflictBanner`）。
   */
  clearConflict: () => void;
  setDirty: (dirty: boolean) => void;
  setSaveStatus: (status: DocumentStore['saveStatus'], error?: string | null) => void;
  /**
   * 标记保存成功。
   *
   * 把 `document.content` 推进到刚写下去的文本——这个字段的语义是「上次与
   * 磁盘一致的内容」，是脏判定（`useAutoSave`）与冲突判定（`decideRefresh`
   * 的 `savedContent`）共同的基准，**不是渲染输入**（渲染输入是编辑器自己的
   * 文档）。不推进它，`dirty` 会永远为真：状态栏永远挂着「未保存」、每次
   * 停笔都再写一遍同样的内容、关页永远弹确认；而一旦自写登记表
   * （`self-write.ts`，只留最近 12 条）滚过了这次写入，轮询还会把「我们自己
   * 刚存好的那份」当成外部改动，与编辑器里的内容一比就报冲突。
   *
   * `lastModified` 一并推进，是为了让下一次轮询的时间戳比对直接判为
   * `unchanged`，连内容都不必读。
   */
  markSaved: (content: string, lastModified: number) => void;
  reset: () => void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  document: null,
  openEpoch: 0,
  navigationEpoch: 0,
  status: 'idle',
  error: null,
  toc: [],
  activeHeadingId: null,
  pendingAnchor: null,
  watchStatus: 'inactive',
  watchMessage: null,
  lastRefreshedAt: 0,
  mode: 'read',
  writable: false,
  conflict: null,
  dirty: false,
  saveStatus: 'idle',
  saveError: null,
  lastSavedAt: 0,

  setLoading: () => set({ status: 'loading', error: null }),

  setDocument: (doc) =>
    set((state) => ({
      document: doc,
      // 一次新的「打开」，见 openEpoch 的说明
      openEpoch: state.openEpoch + 1,
      status: 'ready',
      error: null,
      // 换文档时清空上一份目录，避免闪烁出旧目录
      toc: [],
      activeHeadingId: null,
      /*
       * 待跳转锚点属于「正在打开的这篇文档」，换文档必须清掉。
       *
       * 带锚点打开的调用方（见 `useEmbeddedDocument`）是先 `setDocument`
       * 再 `setPendingAnchor`，所以本次的锚点不会被这里误伤；被清掉的只有
       * 上一篇文档没能消费掉的残留——文档里压根没有标题时就会留下一个，
       * 不清的话它会在下一篇文档上被莫名其妙地兑现。
       */
      pendingAnchor: null,
      // 新文档的监听状态由 useAutoRefresh 重新判定
      watchStatus: 'inactive',
      watchMessage: null,
      lastRefreshedAt: 0,
      /*
       * 换文档一律退回阅读态、并丢掉写权限判定。
       *
       * 权限是**按句柄**授予的，新文档换了句柄，上一份的授权对它不成立；
       * 留着 writable=true 会让保存链路以为可以静默写回一个从没授权过的文件。
       * 模式一并退回阅读态，是因为重新进入编辑态才会再走一次权限申请——
       * 这是让「writable 与当前文档一致」成立的唯一办法。
       */
      mode: 'read',
      writable: false,
      // 换文档必须把上一篇文档的冲突记录带走，否则新文档一打开就顶着一条
      // 与它无关的「用哪一份」提示
      conflict: null,
      /*
       * 保存状态同样属于上一篇文档。不清的话，刚打开一份干净的新文档，
       * 状态栏会挂着上一篇的「已保存」甚至「未保存」——后者还会让关页拦截
       * 对着一份根本没被改过的文档弹确认。
       */
      dirty: false,
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: 0,
    })),

  /**
   * 文件变化引起的内容更新。
   *
   * 与 `setDocument` 的关键区别：**不清空目录、不清空高亮**。
   * 自动刷新是「同一篇文档换了内容」，把目录清成空再重建会让侧栏闪一下，
   * 而阅读器里最刺眼的就是这种无谓的闪烁。新目录会在渲染完成后原地替换。
   */
  applyRefreshedDocument: (doc) =>
    set({
      document: doc,
      status: 'ready',
      error: null,
      lastRefreshedAt: Date.now(),
    }),

  setError: (message) => set({ status: 'error', error: message }),
  setToc: (toc) => set({ toc }),

  setPendingAnchor: (anchor) => set({ pendingAnchor: anchor }),

  markNavigation: () => set((state) => ({ navigationEpoch: state.navigationEpoch + 1 })),
  setWatchStatus: (status, message = null) => set({ watchStatus: status, watchMessage: message }),
  setActiveHeadingId: (id) => set({ activeHeadingId: id }),
  setMode: (mode) => set({ mode }),
  setWritable: (writable) => set({ writable }),
  setConflict: (document) => set({ conflict: document }),
  clearConflict: () => set({ conflict: null }),

  setDirty: (dirty) => set({ dirty }),
  setSaveStatus: (status, error = null) => set({ saveStatus: status, saveError: error }),

  markSaved: (content, lastModified) =>
    set((state) => ({
      document: state.document ? { ...state.document, content, lastModified } : null,
      dirty: false,
      saveStatus: 'saved',
      saveError: null,
      lastSavedAt: Date.now(),
    })),

  reset: () =>
    set((state) => ({
      document: null,
      // 关掉文档同样结束了这一次打开：不自增的话，下一次打开恰好是同一篇
      // 文档时，闩锁会以为自己还在同一次打开里
      openEpoch: state.openEpoch + 1,
      status: 'idle',
      error: null,
      toc: [],
      activeHeadingId: null,
      watchStatus: 'inactive',
      watchMessage: null,
      lastRefreshedAt: 0,
      mode: 'read',
      writable: false,
      conflict: null,
      dirty: false,
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: 0,
    })),
}));
