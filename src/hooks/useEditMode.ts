import { useCallback, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
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

    if (handle) {
      const outcome = await ensureFileWritePermission(handle, true);
      setWritable(outcome === 'granted');
      if (outcome !== 'granted') {
        showNotice(`未获得写入权限，改动不会自动写回原文件；按 ${SAVE_HOTKEY} 会再申请一次`, 'info');
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
