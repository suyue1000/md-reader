import { useCallback, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import { hasHostChannel, requestWriteGrant } from '@/editor/host-write';
import { ensureFileWritePermission, getCurrentFileHandle } from '@/utils/file-open';
import { formatCombo, isMacPlatform } from '@/utils/hotkeys';

/** 保存快捷键的展示文本。提示条里要写得和用户键盘上的一致，Mac 是 ⌘S、其余是 Ctrl+S */
const SAVE_HOTKEY = formatCombo('mod+s', isMacPlatform());

/** `useEditMode` 的返回值 */
export interface EditModeControls {
  mode: 'read' | 'edit';
  writable: boolean;
  /** 必须在用户手势的调用栈内调用，见下方说明 */
  enterEdit: () => Promise<void>;
  leaveEdit: () => void;
}

/**
 * 编辑态的进出。
 *
 * `enterEdit` **必须在用户手势的调用栈内调用**——它会在需要时弹出写权限
 * 授权提示，而 `FileSystemFileHandle.requestPermission` 要求调用处于
 * 用户激活状态下（同一条限制已经用在目录句柄上，见 `handle-store.ts` 的
 * `ensureReadPermission`）。整条保存链路上只有这里满足条件：自动保存由
 * 定时器触发，那里没有任何手势可用，申请必然被浏览器直接拒掉。
 *
 * 因此这个函数里**不能**在申请之前插入会耗尽用户激活的等待（弹自己的
 * 确认框、await 一次网络/存储往返）。当前实现里申请之前只有一次
 * `queryPermission`——它是同源的权限查询，与后面的申请同属一次手势。
 * （实测这一点时用的是立即 resolve 的句柄替身，而真实的 `queryPermission`
 * 要走一次浏览器进程的 IPC 往返，比替身慢几个数量级。结论仍然成立：
 * 短暂用户激活的有效期是**秒级**，一次 IPC 往返远在其内；但「实测过」
 * 这句话的强度到此为止，真实句柄下的往返没有被测到。）
 *
 * 权限被拒不阻止进入编辑态：用户可能只是想改点东西再另存到别处。
 * 这种情况下 `writable` 保持 false，自动保存随之整个停手（`decideSaveTarget`
 * 对自动保存 + 不可写的组合一律返回 clean，否则每 800ms 弹一次对话框）。
 * 降级路径是手动保存：按 ⌘S 时若还握着句柄，会**再申请一次**写权限——那一下
 * 是用户手势，条件与这里相同；没有句柄则弹另存对话框存成新文件。
 */
export function useEditMode(): EditModeControls {
  const mode = useDocumentStore((state) => state.mode);
  const writable = useDocumentStore((state) => state.writable);
  const showNotice = useUiStore((state) => state.showNotice);

  const enterEdit = useCallback(async () => {
    /*
     * 从 getState 取写入动作而不是订阅它们：这两个 setter 在 store 里是常量，
     * 订阅只会让本 hook 的调用方多出两条无意义的重渲染依赖。
     */
    const { setMode, setWritable } = useDocumentStore.getState();
    const handle = getCurrentFileHandle();

    /*
     * 记下「这是第几次打开」。
     *
     * 下面两条分支都要 await 一个**用户可能盯着看很久**的系统对话框（写权限
     * 授权框、文件选择器），而弹着的时候用户完全可以换一篇文档——切换前那个
     * 未保存确认框就是入口。落定后 store 里的 document 已经是另一篇了。
     *
     * 不核对的后果分两档：轻的是给乙记上一份只对甲成立的写权限；重的是代劳
     * 分支里那次 `applyRefreshedDocument`——它会把**甲的正文**替换进乙，而乙
     * 的下一次保存就把甲的内容写进了乙的文件。同一类事故在另存那条路上真的
     * 发生过，记在 `editor/save.ts` 头部。
     */
    const epoch = useDocumentStore.getState().openEpoch;
    /** await 落定后，这次结果还属不属于当初那篇文档 */
    const sameDocument = (): boolean => useDocumentStore.getState().openEpoch === epoch;

    if (handle) {
      const outcome = await ensureFileWritePermission(handle, true);
      if (!sameDocument()) return;
      setWritable(outcome === 'granted');
      if (outcome !== 'granted') {
        showNotice(`未获得写入权限，改动不会自动写回原文件；按 ${SAVE_HOTKEY} 会再申请一次`, 'info');
      }
    } else if (hasHostChannel()) {
      /*
       * 被内容脚本接管的 file:// 页面。这里的阅读器是跨源 iframe，浏览器
       * 禁止它弹任何文件选择器，句柄只能由宿主页面代持——所以要请用户在
       * 宿主弹出的选择器里亲手选中**正在看的这一篇**。绕不过去：File System
       * Access API 没有「由 URL 换取句柄」的能力。
       */
      const outcome = await requestWriteGrant();
      if (!sameDocument()) return;
      setWritable(outcome.kind === 'granted');

      if (outcome.kind === 'granted') {
        const doc = useDocumentStore.getState().document;
        /*
         * 第二道闸：宿主回传的是磁盘上的**真实字节**，而页面上那份取自
         * 浏览器渲染出来的 <pre>，二者未必逐字节相同（换行、BOM 都可能被
         * 归一），文件也可能在打开之后被别的程序改过。
         *
         * 不一致时以磁盘为准重载。这保证写回的基线是真实字节——否则用户
         * 什么都没改、按一下保存，就会把一份被变换过的文本盖回原文件，
         * 而「保存不做任何文本规整」是这个功能的底线。
         */
        if (doc && outcome.content !== doc.content) {
          useDocumentStore.getState().applyRefreshedDocument({
            ...doc,
            content: outcome.content,
            size: new Blob([outcome.content]).size,
            lastModified: outcome.lastModified,
          });
          showNotice('磁盘上的内容与页面上那份不一致，已按磁盘的版本重新载入', 'info');
        } else if (doc) {
          // 基线对齐：写回时要拿它跟磁盘比对，不对齐第一次保存就会被判成冲突
          useDocumentStore.getState().applyRefreshedDocument({
            ...doc,
            lastModified: outcome.lastModified,
          });
        }
      } else if (!(outcome.kind === 'denied' && outcome.cancelled)) {
        const reason = outcome.kind === 'denied' ? outcome.reason : '宿主页面不可用';
        showNotice(`未获得写回授权：${reason}`, 'info');
      }
    } else {
      // 拖拽或 <input type="file"> 打开的文档没有句柄，原地写回无从谈起
      setWritable(false);
      showNotice(
        `该文档没有文件句柄，改动不会写回原文件；按 ${SAVE_HOTKEY} 可以另存为新文件`,
        'info',
      );
    }

    setMode('edit');
  }, [showNotice]);

  const leaveEdit = useCallback(() => {
    /*
     * 退出编辑态不动 `writable`。权限是浏览器按句柄记着的，用户退出一次
     * 阅读并不会把它收回；清掉只会让下一次进入编辑态白弹一次授权提示。
     */
    useDocumentStore.getState().setMode('read');
  }, []);

  return { mode, writable, enterEdit, leaveEdit };
}

/**
 * 按设置进入编辑态（`editor.defaultMode`）。必须挂在**只有一份实例**的地方
 * （目前是 `ReaderPage`）。
 *
 * 为什么不并进 `useEditMode`：那个 hook 被 `useToolbarActions` 使用，而后者
 * 同时挂在工具栏和 `useGlobalHotkeys`（`App` 的组件体）里——并进去会有两份
 * 实例各跑一遍，提示条弹两次。
 *
 * 这条路没有用户手势，因此**不申请写权限**，`writable` 保持 `setDocument`
 * 给的 false。提示条现在可以如实承诺「按 ⌘S 时会申请」——⌘S 已经接上，
 * 而它的 handler 就跑在按键这个用户手势的调用栈里，`performSave` 的
 * needs-permission 分支会在那里补发这次申请（见 `editor/save.ts`）。
 * 措辞与 `useEditMode.enterEdit` 里那两条保持一致。
 *
 * ## 为什么进入编辑态不把焦点交给正文（手动与自动都不交）
 *
 * 试过，实测结论是**不该交**。编辑器的选区此刻停在文档位置 0（首块）。
 * 长文档滚到中部（`.app-main` 的 scrollTop≈1772）后按 ⌘E 并自动聚焦，
 * 再敲一个字——字落在**文档第一行**，而那一行远在视口之外，用户看不到任何
 * 变化。这正是本轮修掉的那个「字打到看不见的地方」缺陷的另一个入口。
 * 不聚焦时按键落到 body 上什么也不发生，是安全的失败。
 *
 * 要聚焦，得先把光标放到**视口里**的那一块上——那会碰到选区与滚动定位，
 * 值得单独做、单独实测，不在这里顺手加。
 */
export function useApplyDefaultMode(): void {
  const openEpoch = useDocumentStore((state) => state.openEpoch);
  const hasDocument = useDocumentStore((state) => state.document !== null);
  const defaultMode = useSettingsStore((state) => state.settings.editor.defaultMode);
  const showNotice = useUiStore((state) => state.showNotice);

  /** 已经按设置自动进过编辑态的那次打开，避免用户退出后又被拽回去 */
  const appliedEpochRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasDocument || defaultMode !== 'edit') return;
    if (appliedEpochRef.current === openEpoch) return;
    appliedEpochRef.current = openEpoch;
    useDocumentStore.getState().setMode('edit');
    showNotice(
      `已按设置进入编辑态；暂时没有写入权限（这条路没有用户手势），按 ${SAVE_HOTKEY} 保存时会申请一次`,
      'info',
    );
  }, [hasDocument, defaultMode, openEpoch, showNotice]);
}
