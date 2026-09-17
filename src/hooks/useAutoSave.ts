import { useCallback, useEffect, useRef } from 'react';
import { useEditorView } from '@/editor/EditorContext';
import { performSave, popPreviousVersion } from '@/editor/save';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore, type Notice } from '@/stores/ui.store';
// 另存拿到的新句柄在 `runSave` 里登记，不在 `performSave` 里——那边在 await
// 之后写全局状态会把结果落到「已经换过的那篇文档」头上，见 editor/save.ts
import { registerFileHandle, setCurrentFileHandle } from '@/utils/file-open';
import { debounce, type Debounced } from '@/utils/fn';
import { createLogger } from '@/utils/logger';

const log = createLogger('auto-save');

/** 弹一条瞬时提示，签名与 `useUiStore.showNotice` 一致 */
type ShowNotice = (text: string, tone?: Notice['tone']) => void;

/**
 * 编辑器里此刻的正文；null 表示当前没有挂载中的阅读页。
 *
 * 为什么必须放在模块作用域，而不是靠 `useEditorView()` 现取：
 * `useGlobalHotkeys()` 是在 `App` 的**组件体**里调用的，而
 * `EditorViewProvider` 是 `App` 渲染出来的子树（见 `viewer/App.tsx`）——
 * 组件体读到的是 provider 之外的默认值，恒为 null。⌘S 的 handler 正是从
 * 那条路来的，靠 view 取文本会拿到 `document.content`（上次落盘的那份），
 * 于是 `decideSaveTarget` 判成 clean，**按 ⌘S 什么都不会发生**。
 *
 * 只由下面 `useAutoSave` 的那一个实例写入（它跟着编辑器挂在 `ReaderPage`
 * 上，全应用只有一份），卸载时置回 null。
 *
 * 第二个消费方是导出与打印（`useExport`）：它挂在 `useToolbarActions` 上，
 * 于是同样有一份实例落在 provider 之外，同样会把「编辑器里的活文本」读成
 * 上次落盘的内容——表现是按 ⌘P 打印出一份不含刚写内容的文档，且毫无提示。
 */
let draftText: string | null = null;

/**
 * 编辑器里此刻的正文；没有挂载中的阅读页时返回 null。
 *
 * 给拿不到 `EditorView` 的调用方兜底用（快捷键那一路，见上）。调用方仍应
 * 优先用 view 上的活文本，这份草稿只是同一事实的副本。
 */
export function getDraftText(): string | null {
  return draftText;
}

/**
 * 执行一次保存并把结果翻译成界面反馈。
 *
 * 自动与手动两条路只差一个 `automatic` 标志——它决定「写不回原文件」时是
 * 弹对话框还是安静地什么都不做。这个分支在 `decideSaveTarget` 那个纯函数
 * 里，这里不重写第二套。
 */
async function runSave(text: string, automatic: boolean, showNotice: ShowNotice): Promise<void> {
  /*
   * 记下「这是第几次打开」。
   *
   * 写盘是异步的，而 `await` 期间用户完全可以换一篇文档——切换前那个确认框
   * 正是入口：此刻 `dirty` 仍为真，用户点「确定」就换了文档，而上一次写盘
   * 还在 await 里。回来之后 store 里的 document 已经是另一篇了。
   *
   * 不核对就把结果落到它头上的后果不是「状态显示错了」这么轻：`markSaved`
   * 会把**甲的文本**写进乙的 `document.content`，而 `ReaderPage` 把
   * `document.content` 当作「上次与磁盘一致的内容」，下一次自动保存于是会
   * 把甲的内容真的写进**乙的文件**——用户从没编辑过乙，而且没有回收站。
   *
   * `openEpoch` 每次 `setDocument` / `reset` 自增，正好是「还是不是同一次
   * 打开」的判据（同一招见 `useReadingPosition` 的闩锁）。
   */
  const epoch = useDocumentStore.getState().openEpoch;

  /*
   * 「保存中…」只给手动保存看。自动保存在写不回原文件时压根不会动手
   * （`decideSaveTarget` 的 clean 分支），无条件先闪一下状态只会让没有写
   * 权限的用户每停一次笔就白看一对 idle→saving→idle 的抖动。
   */
  if (!automatic) useDocumentStore.getState().setSaveStatus('saving');

  const outcome = await performSave(text, automatic);
  // 重新取一次 state：上面 await 期间 store 可能已经换了文档
  const store = useDocumentStore.getState();

  if (store.openEpoch !== epoch) {
    /*
     * 这次保存属于上一篇文档。写盘本身已经发生、而且是对的——`performSave`
     * 在进入时就取好了那一篇的句柄与文本，写进的是甲自己的文件。
     * 要丢掉的只是**结果的落点**：一个字都不能落到新文档头上，状态栏也不行
     * （那会让刚打开的乙顶着一条不属于它的「已保存」）。
     */
    log.warn('保存完成时文档已经换过，这次结果不落到新文档上');
    return;
  }

  switch (outcome.kind) {
    case 'saved':
      /*
       * 写权限如果是这次保存**现申请**到的（⌘S 走 needs-permission 分支），
       * 落点也在这里。`performSave` 不自己写 store，因为那次申请跨了一个
       * await：授权框弹着的时候用户可以换文档，在那里写就会给乙记上一份
       * 只对甲成立的写权限（见 `editor/save.ts` 头部）。
       */
      if (outcome.permissionGranted) store.setWritable(true);
      store.markSaved(text, outcome.lastModified);
      break;

    case 'saved-as':
      /*
       * 另存拿到的句柄在这里——epoch 守卫之后——才登记成「当前文件」。
       *
       * 曾经这一步在 `performSave` 里、紧跟 await 之后，实测后果是：另存
       * 进行中换到乙，落定后当前句柄变成甲刚另存出来的那个文件，于是乙的
       * 下一次自动保存写进了甲的新文件。守卫在这里，那次另存的结果就跟着
       * 「这次保存属于上一篇文档」一起被丢掉，一个字都不落到乙头上。
       *
       * 直接置 writable = true、不再补一次 `ensureFileWritePermission`：
       * 依据是 File System Access API 规范——`showSaveFilePicker` 返回的句柄
       * 调用成功后权限状态即为 granted，「用户在系统对话框里选中这个文件」
       * 本身就是一次明确授权，浏览器不会再为同一件事弹一次提示框。这条是
       * 规范行为，本仓库没有条件在真实浏览器里复测（见任务报告）。
       * 它也是「另存之后自动保存随之恢复」这条回路的落地点。
       *
       * 另存没有可信的 mtime 可用：新文件的时间戳要再读一次磁盘才知道，而
       * `saveFile` 只回传句柄。用 Date.now() 顶上是安全的——它只会让下一次
       * 轮询的时间戳比对判成「变了」，于是多读一次内容，发现与
       * `document.content` 一致（刚被 markSaved 推进），走 touch-timestamp
       * 对时收场，不会重渲染、更不会误判冲突。
       */
      if (outcome.handle) {
        setCurrentFileHandle(outcome.handle);
        registerFileHandle(outcome.filename, outcome.handle);
        store.setWritable(true);
      }
      store.markSaved(text, Date.now());
      showNotice(`已另存为 ${outcome.filename}`);
      break;

    case 'downloaded':
      /*
       * 保存对话框弹不出来，文件被丢进了浏览器下载目录——**原文件一个字节
       * 都没有改动**，所以这里绝不能 `markSaved`：那会把 `document.content`
       * 推进成编辑器里的文本，脏状态归零、关页拦截随之失效、状态栏报「已
       * 保存」，而用户的文件原封未动。不推进，脏状态就继续挂着，状态栏的
       * 「● 未保存」与关页确认都照常——这是如实的状态。
       *
       * 用 error 色而不是普通提示：从用户按下 ⌘S 的意图看，「存回我的文件」
       * 这件事没有发生，措辞必须说得出区别（导出那一路 `useExport.report`
       * 也是这样区分 picker 与 download 的）。
       */
      store.setSaveStatus('idle');
      showNotice(
        `这次弹不出保存对话框，已把改动下载为 ${outcome.filename}，存进浏览器的下载目录——原文件没有改动，改动仍未保存`,
        'error',
      );
      break;

    case 'conflict-pending':
      /*
       * 冲突未决期间一律不写盘（判据在 `decideSaveTarget`）。
       *
       * 自动保存到点时静默收场：用户正看着提示条决断，每 800ms 弹一条
       * 「保存被挡下了」只会更慌。手动 ⌘S 必须说话——用户明确要求保存却
       * 什么都没发生，静默就是在骗人。
       */
      store.setSaveStatus('idle');
      if (!automatic) {
        showNotice('文件在编辑器之外被改过，请先在上方的提示条里选一份，再保存', 'error');
      }
      break;

    case 'host-stale':
      /*
       * 宿主在写之前发现磁盘已被别的程序改过，一个字节都没写。绝不能
       * `markSaved`——那会把「已保存」记在一份根本没落盘的内容上，脏状态
       * 清零、关页不再拦截，而用户的改动还在编辑器里悬着。
       */
      store.setSaveStatus('error', outcome.message);
      showNotice(`${outcome.message}，这次没有写入；请重新打开这篇文档后再改`, 'error');
      break;

    case 'denied':
      store.setSaveStatus('error', '未获得写入权限');
      showNotice('未获得写入权限，改动尚未保存', 'error');
      break;

    case 'error':
      store.setSaveStatus('error', outcome.message);
      showNotice(`保存失败：${outcome.message}`, 'error');
      break;

    case 'cancelled':
    case 'skipped':
      // 用户自己取消的另存、以及「没改动 / 自动保存写不回去」这类无事发生，
      // 都不该在状态栏留下红字
      store.setSaveStatus('idle');
      break;
  }
}

/**
 * 自动保存、脏状态与关页拦截。
 *
 * **必须只挂在一个地方**（目前是 `ReaderPage`，全应用只有一份实例）。挂第二
 * 份的后果是两个防抖定时器对同一份文本各存一次盘、两个 `beforeunload` 监听
 * 各拦一次——这与 `useApplyDefaultMode` 不并进 `useEditMode` 是同一条理由。
 * 工具栏与快捷键要的是「立刻存一次」，走下面的 `useSaveCommands`，那个
 * 不排定时器，可以有多份实例。
 *
 * @param text 编辑器里此刻的正文（由 `ReaderPage` 的 state 持有）
 */
export function useAutoSave(text: string): { saveNow: () => Promise<void> } {
  const mode = useDocumentStore((state) => state.mode);
  /**
   * 上次与磁盘一致的内容。
   *
   * 订阅它而不是在 effect 里用 `getState()` 现取：保存成功后 `markSaved` 会
   * 推进它，此时 `text` 没变，只有把它放进依赖数组，这个 effect 才会重跑一次
   * 把脏状态算准——用户在写盘那几十毫秒里又敲了几个字的话，这一次重算正是
   * 把「其实还脏着」纠回来的地方。
   */
  const savedContent = useDocumentStore((state) => state.document?.content ?? '');
  const enabled = useSettingsStore((state) => state.settings.editor.autoSave);
  const delay = useSettingsStore((state) => state.settings.editor.autoSaveDelay);
  const showNotice = useUiStore((state) => state.showNotice);

  /** 防抖到点时才读的文本；用 ref 是为了不让每个字符都重建定时器 */
  const textRef = useRef(text);
  /** 当前的防抖器，由下面第一个 effect 装填 */
  const scheduleRef = useRef<Debounced<[]> | null>(null);

  const run = useCallback(
    (automatic: boolean) => runSave(textRef.current, automatic, showNotice),
    [showNotice],
  );

  /*
   * 防抖器在 effect 里建，不在渲染期。
   *
   * 渲染期建的话，这个闭包会在渲染过程中就捕获 `textRef`，而 ref 的值本就
   * 「不参与渲染」——React 的 lint 规则（react-hooks/refs）会拦下这种写法，
   * 理由是它无法确定这个函数会不会在渲染期间就被调用。放进 effect 之后，
   * 创建与调用都发生在提交之后，这层不确定性不存在。
   *
   * 声明顺序有讲究：它必须排在下面那个排期的 effect **之前**——同一次提交里
   * effect 按声明顺序执行，反过来的话第一次渲染就会拿着空的 scheduleRef 排期，
   * 于是打开文档后的第一次改动永远等不到自动保存。
   */
  useEffect(() => {
    const scheduled = debounce(() => void run(true), delay);
    scheduleRef.current = scheduled;
    // 改了防抖间隔（换一个防抖器）或页面卸载时，取消还没到点的那次自动保存：
    // 它手里攥着的文本已经不是当前这一份了
    return () => {
      scheduled.cancel();
      scheduleRef.current = null;
    };
  }, [run, delay]);

  useEffect(() => {
    /*
     * 在 effect 里同步 ref 而不是渲染期直接赋值：渲染期写 ref 在并发渲染下
     * 可能被执行多次或被丢弃，React 明确不推荐（同一约束见 `useHotkeys`）。
     * 定时器回调不会在提交阶段插进来，所以「先同步、后排期」的顺序是安全的。
     */
    textRef.current = text;
    draftText = text;

    const dirty = text !== savedContent;
    useDocumentStore.getState().setDirty(dirty);
    // 自动保存只在编辑态排期：阅读态下这两份内容本来就应该相等，真不相等
    // 也轮不到定时器替用户决定要不要写盘
    if (mode === 'edit' && enabled && dirty) scheduleRef.current?.();
  }, [text, savedContent, mode, enabled]);

  useEffect(
    () => () => {
      draftText = null;
    },
    [],
  );

  /*
   * 有未保存改动时拦截关页。
   *
   * 浏览器只允许显示它自己的固定文案（Chrome 早已忽略 returnValue 的内容），
   * 因此这里不必也无法自定义提示内容；`preventDefault()` 与 `returnValue`
   * 都写上是为了覆盖新旧两套规范。
   *
   * 监听无条件注册、条件判在 handler 里：按 dirty 装卸监听会让「刚变脏的
   * 那一瞬间」落在两次 effect 之间，而用户恰恰最可能在改完之后立刻关页。
   */
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!useDocumentStore.getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, []);

  const saveNow = useCallback(() => run(false), [run]);
  return { saveNow };
}

/** 工具栏与快捷键用的即时保存命令 */
export interface SaveCommands {
  /** 立刻保存一次（⌘S 与工具栏按钮调用，处在用户手势内） */
  saveNow: () => Promise<void>;
  /** 把编辑器退回上一个保存前的版本 */
  restorePreviousVersion: () => void;
}

/**
 * 保存相关的即时命令。
 *
 * 与 `useAutoSave` 分开，是因为这个 hook 会被实例化多次（工具栏一份、
 * `useGlobalHotkeys` 一份，两者都经由 `useToolbarActions`）：它只在被点到时
 * 做事，不排定时器、不挂 `beforeunload`，多份实例无害。
 */
export function useSaveCommands(): SaveCommands {
  const showNotice = useUiStore((state) => state.showNotice);
  /**
   * 编辑器实例，只给「回到上一个版本」用——它要把文本写回编辑器。
   *
   * 这里能拿到 view 的只有工具栏那一份实例（工具栏在 `EditorViewProvider`
   * 里），快捷键那一份恒为 null（理由见本文件顶部 `draftText`）。这个动作
   * 没有快捷键、只从工具栏菜单发起，所以够用；拿不到时如实提示而不是静默。
   */
  const view = useEditorView();

  const saveNow = useCallback(async () => {
    // 取模块里那份草稿而不是 store 里的 `document.content`：后者是上次落盘的
    // 内容，用它保存等于永远在存一份没有改动的文本
    const text = draftText ?? useDocumentStore.getState().document?.content ?? '';
    await runSave(text, false, showNotice);
  }, [showNotice]);

  const restorePreviousVersion = useCallback(() => {
    if (!view) {
      showNotice('编辑器还没就绪，稍后再试', 'error');
      return;
    }
    const previous = popPreviousVersion();
    if (previous === null) {
      showNotice('没有更早的版本了');
      return;
    }
    /*
     * 直接 dispatch 进编辑器，而不是去改 `ReaderPage` 的 state：这是一次
     * 真实的文档改动，走 dispatch 才会进撤销栈、才会触发 `onChange` 把脏
     * 状态与下一次自动保存一并带起来。
     *
     * 被换掉的那份（较新的）内容不会就此消失：下一次自动保存写盘前，
     * `writeThrough` 会把当时的 `document.content`——也就是它——推进版本
     * 缓冲，于是「再回去一次」仍然有得可退。
     */
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: previous } });
    showNotice('已回到上一个保存版本');
  }, [view, showNotice]);

  return { saveNow, restorePreviousVersion };
}

/**
 * 切换文档前确认丢弃未保存的改动；返回 false 表示用户选择留下。
 *
 * 用 `window.confirm` 而不是现成的 Toast：Toast 做不到阻塞式确认，而这里
 * 必须在「旧文档被顶掉」之前拿到用户的答复——问完再问后果就已经发生了。
 * 这是全应用唯一一处真的需要阻塞用户的地方。
 */
export function confirmDiscardUnsaved(): boolean {
  if (!useDocumentStore.getState().dirty) return true;
  return window.confirm('当前文档有未保存的改动，切换后这些改动会丢失。确定要切换吗？');
}
