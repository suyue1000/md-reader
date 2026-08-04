import { BookOpen, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { sendMessage } from '@/utils/messaging';
import { useSettingsStore, watchSettingsChanges } from '@/stores/settings.store';
import { applyResolvedTheme, resolveTheme } from '@/utils/theme';

/**
 * 浏览器工具栏弹窗。
 *
 * 职责刻意收窄：只做「跳转到阅读器 / 设置」两件事。
 * 真正的功能都在阅读器页面里，弹窗保持轻量以获得瞬开体验。
 */
export function App(): React.JSX.Element {
  const theme = useSettingsStore((state) => state.settings.appearance.theme);

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
    return watchSettingsChanges();
  }, []);

  useEffect(() => {
    applyResolvedTheme(resolveTheme(theme));
  }, [theme]);

  return (
    <div className="w-60 p-2" style={{ background: 'var(--app-bg)' }}>
      <button
        type="button"
        onClick={() => void sendMessage({ type: 'open-viewer' })}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)]"
        style={{ color: 'var(--app-text)' }}
      >
        <BookOpen size={16} />
        打开阅读器
      </button>
      <button
        type="button"
        onClick={() => void sendMessage({ type: 'open-options' })}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)]"
        style={{ color: 'var(--app-text)' }}
      >
        <Settings size={16} />
        设置
      </button>
    </div>
  );
}
