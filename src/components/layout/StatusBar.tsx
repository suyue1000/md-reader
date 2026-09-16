import { useMemo } from 'react';
import { AlertTriangle, Eye, PauseCircle } from 'lucide-react';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { WatchStatus } from '@/types';
import { formatCombo, isMacPlatform } from '@/utils/hotkeys';

/** 把字节数格式化为人类可读的大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

/** 保存状态对应的文案。未保存用点而不是文字，避免和监听状态抢注意力 */
const SAVE_META = {
  idle: null,
  saving: { text: '保存中…', tone: 'muted' },
  saved: { text: '已保存', tone: 'muted' },
  error: { text: '保存失败', tone: 'danger' },
} as const;

/** 保存状态指示 */
function SaveIndicator(): React.JSX.Element | null {
  const dirty = useDocumentStore((state) => state.dirty);
  const saveStatus = useDocumentStore((state) => state.saveStatus);
  const saveError = useDocumentStore((state) => state.saveError);

  /*
   * 脏状态优先于「已保存」这类历史状态显示，但让位给「保存中」——正在写盘
   * 的那一刻内容确实还没落盘（dirty 仍为真），此时报「未保存」会让用户以为
   * 什么都没发生，而事实是马上就好。
   */
  if (dirty && saveStatus !== 'saving') {
    return <span title="改动还没有写回文件">● 未保存</span>;
  }

  const meta = SAVE_META[saveStatus];
  if (!meta) return null;

  return (
    <span
      style={{ color: meta.tone === 'danger' ? 'var(--app-danger)' : 'var(--app-text-subtle)' }}
      title={saveError ?? undefined}
    >
      {meta.text}
    </span>
  );
}

/**
 * 「写不回原文件」的常驻提示。
 *
 * 进入编辑态时若没拿到写权限，只会弹一条几秒后自动消失的提示条
 * （`Toast` 的 info 停留 2.6 秒）。提示条消失之后，界面上原本再没有任何
 * 地方能看出这份文档存不回去——工具栏的按钮与已授权时长得一模一样，
 * 而用户会一直编辑下去。状态栏是这条信息的常驻出口。
 *
 * 只在编辑态显示：阅读态下 `writable` 为 false 是常态（写权限只在点「编辑」
 * 的那一下申请），在那时报「无法写回」既没有意义，也是不准确的——那时根本
 * 还没问过浏览器。
 */
function WriteTargetIndicator(): React.JSX.Element | null {
  const mode = useDocumentStore((state) => state.mode);
  const writable = useDocumentStore((state) => state.writable);
  const hasDocument = useDocumentStore((state) => state.document !== null);
  const saveHotkey = useMemo(() => formatCombo('mod+s', isMacPlatform()), []);

  if (!hasDocument || mode !== 'edit' || writable) return null;

  return (
    <span
      style={{ color: 'var(--app-warning)' }}
      title="没有这个文件的写入权限，自动保存不会动它。手动保存会弹出另存对话框，把改动存成一份新文件"
    >
      <AlertTriangle size={11} className="mr-1 inline align-[-1px]" />
      无法写回原文件，{saveHotkey} 另存
    </span>
  );
}

/**
 * 底部状态栏：展示当前文档的元信息、监听状态与关键设置。
 *
 * 曾经这里还常驻一个「渲染 xx ms」。它随分块渲染一起撤掉了：正文改由
 * CodeMirror 按视口逐块渲染之后，「一次渲染的总耗时」这个量不再存在——
 * 首屏只渲染看得见的几块，剩下的随滚动陆续补上，报任何一个数字都是
 * 在误导人。右侧腾出的位置现在归保存状态与「写不回原文件」的常驻提示。
 */
export function StatusBar(): React.JSX.Element {
  const doc = useDocumentStore((state) => state.document);
  const status = useDocumentStore((state) => state.status);
  const tocCount = useDocumentStore((state) => state.toc.length);
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
      <WriteTargetIndicator />
      <SaveIndicator />
      <span>宽度 {contentWidth === 'full' ? '100%' : `${contentWidth}px`}</span>
      <span>{status === 'loading' ? '加载中…' : status === 'error' ? '出错' : '就绪'}</span>
    </footer>
  );
}
