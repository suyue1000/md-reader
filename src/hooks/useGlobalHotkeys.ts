import { useMemo } from 'react';
import { useHotkeys, type HotkeyBinding } from './useHotkeys';
import { useToolbarActions } from './useToolbarActions';

/**
 * 全局快捷键注册。
 *
 * 绑定表直接从工具栏动作推导，而不是另写一份：按钮与快捷键永远指向
 * 同一个 handler、共享同一个可用状态。这一点很重要——如果分开维护，
 * 很容易出现「按钮已置灰、快捷键还在拦截浏览器默认行为」这种别扭情况。
 *
 * `Ctrl/⌘+F` 由工具栏的「查找正文」动作带进来，打开的是自研的 `SearchBar`，
 * 而**不是** CodeMirror 自带的搜索面板（那套面板的高亮是 `Decoration.mark`，
 * 在块 widget 之下一个像素都看不见，见 `search/block-highlight.ts`）。
 * 没有打开文档时这个动作是停用的，快捷键随之让位给浏览器的原生查找。
 */
export function useGlobalHotkeys(): void {
  const actions = useToolbarActions();

  const bindings = useMemo<HotkeyBinding[]>(
    () =>
      actions
        .filter((action) => action.hotkey !== undefined)
        .map((action) => ({
          combo: action.hotkey ?? '',
          handler: action.onSelect,
          // 动作不可用时连带停用快捷键，浏览器默认行为得以保留
          enabled: action.disabledReason === undefined,
          /*
           * 「在可编辑区域内是否生效」由动作自己声明，这里只做转发。
           *
           * 早先是在这里按 id 白名单判断的，而编辑态的正文（CodeMirror 的
           * `.cm-content`）本身就是 contenteditable——漏声明一个动作的后果
           * 是它的快捷键在编辑态里整个失灵，而白名单离动作声明太远，
           * 新增动作时几乎不可能想起来回这里改一行。
           */
          allowInInput: action.allowInInput === true,
        })),
    [actions],
  );

  useHotkeys(bindings);
}
