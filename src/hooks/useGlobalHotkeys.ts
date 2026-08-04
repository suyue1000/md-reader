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
 * 注意 `Ctrl+F` 没有被注册：我们自己的全文搜索要到 Phase 10 才有，
 * 在那之前应该把它留给浏览器的原生查找，而不是抢过来什么都不做。
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
          // 切换侧边栏不产生文本，在搜索框里也应该生效
          allowInInput: action.id === 'sidebar',
        })),
    [actions],
  );

  useHotkeys(bindings);
}
