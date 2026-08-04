import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings.store';
import type { Settings } from '@/types';

export interface SectionProps {
  title: string;
  /** 对应设置结构里的分组名，用于「恢复默认」 */
  group: keyof Omit<Settings, 'schemaVersion'>;
  children: ReactNode;
}

/**
 * 设置分组容器。
 *
 * 每组自带「恢复默认」而不是只在页面底部放一个全局重置：
 * 用户改坏的通常只是某一类设置（比如把字号调乱了），
 * 按组恢复不会连带丢掉精心写好的自定义 CSS。
 */
export function Section({ title, group, children }: SectionProps): React.JSX.Element {
  const resetGroup = useSettingsStore((state) => state.resetGroup);

  return (
    <section className="border-b px-4 py-3" style={{ borderColor: 'var(--app-border-subtle)' }}>
      <header className="mb-1 flex items-center justify-between">
        <h3
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          {title}
        </h3>
        <button
          type="button"
          onClick={() => resetGroup(group)}
          title={`将「${title}」恢复为默认值`}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)]"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          <RotateCcw size={11} />
          恢复默认
        </button>
      </header>
      <div className="divide-y" style={{ borderColor: 'var(--app-border-subtle)' }}>
        {children}
      </div>
    </section>
  );
}
