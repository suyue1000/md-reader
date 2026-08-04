import { AlertTriangle, Eye, PauseCircle } from 'lucide-react';
import type { RenderStages } from '@/markdown/contract';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { WatchStatus } from '@/types';

/** 把字节数格式化为人类可读的大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 把渲染各阶段耗时排成一行，用于 tooltip */
function formatStages(stages: RenderStages): string {
  return [
    `解析 ${stages.parseMs.toFixed(1)}ms`,
    `目录 ${stages.tocMs.toFixed(1)}ms`,
    `生成 ${stages.renderMs.toFixed(1)}ms`,
    `净化 ${stages.sanitizeMs.toFixed(1)}ms`,
  ].join(' · ');
}

/** 把时间戳格式化为「刚刚 / x 分钟前」 */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${String(seconds)} 秒前`;
  return `${String(Math.floor(seconds / 60))} 分钟前`;
}

/** 监听状态对应的图标与文案 */
const WATCH_META: Record<Exclude<WatchStatus, 'inactive'>, { icon: typeof Eye; text: string }> = {
  watching: { icon: Eye, text: '监听中' },
  paused: { icon: PauseCircle, text: '已暂停' },
  stopped: { icon: AlertTriangle, text: '已停止' },
};

/** 文件监听状态指示 */
function WatchIndicator(): React.JSX.Element | null {
  const watchStatus = useDocumentStore((state) => state.watchStatus);
  const watchMessage = useDocumentStore((state) => state.watchMessage);
  const lastRefreshedAt = useDocumentStore((state) => state.lastRefreshedAt);

  if (watchStatus === 'inactive') return null;

  const meta = WATCH_META[watchStatus];
  const Icon = meta.icon;
  // 停止是异常状态，用警示色；其余保持低调，不与正文抢注意力
  const color = watchStatus === 'stopped' ? 'var(--app-warning)' : 'var(--app-text-subtle)';

  return (
    <span
      className="flex items-center gap-1"
      style={{ color }}
      title={watchMessage ?? '文件变化后会自动重新渲染'}
    >
      <Icon size={11} />
      {meta.text}
      {watchStatus === 'watching' && lastRefreshedAt > 0 && (
        <span>· 已更新 {formatRelativeTime(lastRefreshedAt)}</span>
      )}
    </span>
  );
}

/**
 * 底部状态栏：展示当前文档的元信息、渲染耗时、监听状态与关键设置。
 *
 * 把渲染耗时常驻在这里，是为了让性能退化能被立刻看见——
 * 需求里「首次渲染 <500ms」这条指标没有可观测性就等于没有。
 */
export function StatusBar(): React.JSX.Element {
  const doc = useDocumentStore((state) => state.document);
  const status = useDocumentStore((state) => state.status);
  const tocCount = useDocumentStore((state) => state.toc.length);
  const durationMs = useDocumentStore((state) => state.renderDurationMs);
  const stages = useDocumentStore((state) => state.renderStages);
  const progress = useDocumentStore((state) => state.renderProgress);
  const contentWidth = useSettingsStore((state) => state.settings.appearance.contentWidth);

  return (
    <footer
      className="no-print flex h-6 shrink-0 items-center gap-3 border-t px-3 text-[11px]"
      style={{
        borderColor: 'var(--app-border-subtle)',
        background: 'var(--app-surface)',
        color: 'var(--app-text-subtle)',
      }}
    >
      <span className="truncate">{doc ? doc.path : '未打开文件'}</span>
      {doc && <span>{formatSize(doc.size)}</span>}
      {doc && tocCount > 0 && <span>{tocCount} 个顶级标题</span>}
      <WatchIndicator />
      <span className="flex-1" />
      {doc && durationMs > 0 && (
        // 悬停给出阶段明细：只看总耗时无法判断该优化哪一段
        <span title={stages ? formatStages(stages) : undefined}>
          渲染 {durationMs.toFixed(1)}ms
        </span>
      )}
      <span>宽度 {contentWidth === 'full' ? '100%' : `${contentWidth}px`}</span>
      <span>
        {status === 'loading'
          ? '加载中…'
          : status === 'error'
            ? '出错'
            : progress.total > 1 && progress.done < progress.total
              ? // 大文档是逐块长出来的，不说一声用户会以为文档到此为止了
                `渲染中 ${String(progress.done)}/${String(progress.total)}`
              : '就绪'}
      </span>
    </footer>
  );
}
