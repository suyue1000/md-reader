import { AlertTriangle } from 'lucide-react';
import { useEditorView } from '@/editor/EditorContext';
import { pushVersionBeforeOverwrite } from '@/editor/save';
import { useDocumentStore } from '@/stores/document.store';

/**
 * 外部改动冲突提示条。
 *
 * 复用 `Toast` 的配色变量，但**不会自动消失**——这与瞬时提示是两类不同的
 * 东西：磁盘上的文件被编辑器之外的程序改了，而编辑器里还有没保存的改动，
 * 两份都有值钱的内容，只能等用户自己选，不能替他倒计时决定。
 *
 * 只在 `document.store.conflict` 非空时渲染；这个字段只在编辑态下会被
 * `decideRefresh` 判定出来（见 `useAutoRefresh`），阅读态不可能出现。
 */
export function ConflictBanner(): React.JSX.Element | null {
  const conflict = useDocumentStore((state) => state.conflict);
  // 「用磁盘的」需要在覆盖之前拿到编辑器里此刻的活文本，见 useDisk 的说明
  const view = useEditorView();

  if (!conflict) return null;

  /** 保留我的改动：什么都不用做，磁盘那份原样留着，下次保存会覆盖它 */
  const keepMine = (): void => {
    useDocumentStore.getState().clearConflict();
  };

  /**
   * 改用磁盘上的版本。
   *
   * 顺序不能反：必须先把编辑器里这份还没保存的文本推进版本缓冲，再用磁盘
   * 内容覆盖编辑器。反过来的话，`applyRefreshedDocument` 那一刻编辑器原文
   * 就已经被替换掉了，版本缓冲里什么都没留下——版本缓冲是这份未保存改动
   * 唯一的后悔药，漏这一步或顺序颠倒，它就是无声、且不可逆地丢失。
   */
  const useDisk = (): void => {
    if (view) pushVersionBeforeOverwrite(view.state.doc.toString());
    useDocumentStore.getState().applyRefreshedDocument(conflict);
    useDocumentStore.getState().clearConflict();
  };

  return (
    <div
      // alert 而不是 status：这是需要用户立刻决断的事，理应打断当前的朗读
      role="alert"
      className="no-print flex shrink-0 items-center gap-3 border-b px-3 py-2 text-sm"
      style={{
        background: 'var(--app-elevated)',
        borderColor: 'var(--app-warning)',
        color: 'var(--app-text)',
      }}
    >
      <AlertTriangle size={15} style={{ color: 'var(--app-warning)', flexShrink: 0 }} />
      <span className="flex-1">
        文件在编辑器之外被修改了，与你还没保存的改动发生冲突。
      </span>
      <button
        type="button"
        onClick={keepMine}
        className="shrink-0 rounded-md border px-2.5 py-1 text-sm transition-colors duration-[var(--app-duration)]"
        style={{ borderColor: 'var(--app-border)', color: 'var(--app-text)' }}
      >
        保留我的改动
      </button>
      <button
        type="button"
        onClick={useDisk}
        className="shrink-0 rounded-md px-2.5 py-1 text-sm transition-colors duration-[var(--app-duration)]"
        style={{ background: 'var(--app-accent)', color: 'var(--app-accent-contrast)' }}
      >
        改用磁盘上的版本
      </button>
    </div>
  );
}
