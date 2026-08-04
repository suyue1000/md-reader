import { useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { useSettingsStore, watchSettingsChanges } from '@/stores/settings.store';
import { useCustomStyle } from '@/hooks/useCustomStyle';
import { useThemeStyles } from '@/hooks/useThemeStyles';
import { useThemeSync } from '@/hooks/useTheme';
import { sendMessage } from '@/utils/messaging';
import { isExtensionContext } from '@/utils/env';

/**
 * 独立设置页。
 *
 * 与阅读器里的抽屉共用同一个 `SettingsPanel`——本页只提供容器与页头。
 * 这个入口存在的意义是满足 Chrome 扩展管理页的「扩展选项」链接；
 * 两处的改动会通过 chrome.storage 的变更广播实时互相同步。
 */
export function App(): React.JSX.Element {
  const hydrated = useSettingsStore((state) => state.hydrated);

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
    return watchSettingsChanges();
  }, []);

  // 设置页自己也要应用主题与排版，否则预览与实际效果对不上
  useThemeSync();
  useThemeStyles();
  useCustomStyle();

  const version = isExtensionContext() ? chrome.runtime.getManifest().version : '0.1.0';

  if (!hydrated) {
    return <div className="min-h-screen" style={{ background: 'var(--app-bg)' }} />;
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--app-surface)' }}>
      <div className="mx-auto max-w-2xl px-4 py-10">
        <header className="mb-4 flex items-end justify-between px-1">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--app-text)' }}>
              Markdown Reader
            </h1>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              版本 {version} · 设置会实时同步到所有已打开的阅读器标签页
            </p>
          </div>
          <button
            type="button"
            onClick={() => void sendMessage({ type: 'open-viewer' })}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors duration-[var(--app-duration)]"
            style={{ background: 'var(--app-accent)', color: 'var(--app-accent-contrast)' }}
          >
            <BookOpen size={14} />
            打开阅读器
          </button>
        </header>

        <div
          className="overflow-hidden rounded-lg"
          style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}
        >
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
}
