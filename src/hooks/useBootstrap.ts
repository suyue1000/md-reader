import { useEffect } from 'react';
import { useSettingsStore, watchSettingsChanges } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

/**
 * 应用启动流程：恢复持久化状态并监听跨页面变更。
 *
 * 收敛成一个 hook 的原因：viewer / options / popup 三个入口的启动步骤一致，
 * 任何一步顺序改变只需要改这一处。
 *
 * 注意这里**不**加载 Markdown 插件——整条渲染管线是按需加载的，
 * 由第一次真正渲染文档时触发（见 `ensureBuiltinPlugins`）。
 *
 * @returns 是否已完成启动
 */
export function useBootstrap(): boolean {
  const settingsHydrated = useSettingsStore((state) => state.hydrated);
  const uiHydrated = useUiStore((state) => state.hydrated);

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
    void useUiStore.getState().hydrate();
    // 最近打开与收藏不阻塞首屏，恢复失败也只是少一段历史
    void useWorkspaceStore.getState().hydrate();

    // 监听其它扩展页面对设置的修改
    return watchSettingsChanges();
  }, []);

  return settingsHydrated && uiHydrated;
}
