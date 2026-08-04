import { useEffect } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useUiStore } from '@/stores/ui.store';

/** 提示的停留时长 */
const DURATION_MS = { info: 2600, error: 5200 } as const;

/**
 * 瞬时提示。
 *
 * 只显示一条。导出这类动作的反馈天然是串行的，做成堆叠列表只会在
 * 用户连点时糊一屏，而后来的那条几乎总是他真正关心的。
 *
 * 自动消失的计时器放在组件里而不是 store 里：这样卸载时能干净地清掉，
 * 也避免在单元测试里留下悬挂的定时器。
 */
export function Toast(): React.JSX.Element | null {
  const notice = useUiStore((state) => state.notice);
  const dismissNotice = useUiStore((state) => state.dismissNotice);

  // 依赖 notice?.id 而不是 notice 对象：同样文案连弹两次也要重新计时
  const noticeId = notice?.id;
  const tone = notice?.tone;

  useEffect(() => {
    if (noticeId === undefined || tone === undefined) return;
    const timer = setTimeout(dismissNotice, DURATION_MS[tone]);
    return () => {
      clearTimeout(timer);
    };
  }, [noticeId, tone, dismissNotice]);

  if (!notice) return null;

  const isError = notice.tone === 'error';
  const Icon = isError ? XCircle : CheckCircle2;

  return (
    <div
      className="no-print pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2"
      // 提示是播报性质的，用 status 而不是 alert，不打断读屏用户当前的朗读
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-3.5 py-2 text-sm shadow-[var(--app-shadow-lg)]"
        style={{
          background: 'var(--app-elevated)',
          color: 'var(--app-text)',
          border: `1px solid ${isError ? 'var(--app-danger)' : 'var(--app-border)'}`,
        }}
      >
        <Icon size={15} style={{ color: isError ? 'var(--app-danger)' : 'var(--app-success)' }} />
        <span>{notice.text}</span>
      </div>
    </div>
  );
}
