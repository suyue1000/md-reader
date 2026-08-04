import { useMemo } from 'react';
import { Clock, Star } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useWorkspace } from '@/hooks/useWorkspace';

/** 条目公用的按钮样式 */
const ITEM_CLASS =
  'w-full truncate rounded px-1 py-1 text-left text-xs transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)] disabled:opacity-40';

/** 句柄已失效时的提示 */
const UNAVAILABLE_HINT = '文件句柄已失效，请重新打开该文件或它所在的文件夹';

/** 一条可展示的历史/收藏记录 */
interface Entry {
  key: string;
  path: string;
  name: string;
  openable: boolean;
}

/** 记录列表 */
function EntryList({
  entries,
  onOpen,
}: {
  entries: readonly Entry[];
  onOpen: (path: string) => void;
}): React.JSX.Element {
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.key}>
          <button
            type="button"
            disabled={!entry.openable}
            title={entry.openable ? entry.path : UNAVAILABLE_HINT}
            onClick={() => onOpen(entry.path)}
            className={ITEM_CLASS}
            style={{ color: 'var(--app-text-muted)' }}
          >
            {entry.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * 最近打开与收藏。
 *
 * 条目是否可点，取决于**这次会话里是否还持有它的文件句柄**——句柄无法
 * 持久化，页面刷新后就没了。所以刷新后的历史条目会被置灰并说明原因，
 * 而不是点了没反应。这也是为什么判据不能简单写成「是否打开了文件夹」：
 * 通过「打开文件」单独打开的文件同样有句柄，同样应该可点。
 */
export function RecentFiles(): React.JSX.Element | null {
  const recentFiles = useWorkspaceStore((state) => state.recentFiles);
  const favorites = useWorkspaceStore((state) => state.favorites);
  const clearRecent = useWorkspaceStore((state) => state.clearRecent);
  const availablePaths = useWorkspaceStore((state) => state.availablePaths);
  const { openPath } = useWorkspace();

  const { recentEntries, favoriteEntries } = useMemo(() => {
    const toEntry = (key: string, path: string, name: string): Entry => ({
      key,
      path,
      name,
      openable: availablePaths.has(path),
    });

    return {
      recentEntries: recentFiles
        .slice(0, 8)
        .map((item) => toEntry(item.id, item.path, item.name)),
      // 收藏项用 doc:<path> 作为 id，这里还原成路径
      favoriteEntries: favorites.map((id) => {
        const path = id.replace(/^doc:/, '');
        const known = recentFiles.find((item) => item.id === id);
        return toEntry(id, path, known?.name ?? path.split('/').pop() ?? path);
      }),
    };
  }, [recentFiles, favorites, availablePaths]);

  if (recentEntries.length === 0 && favoriteEntries.length === 0) return null;

  return (
    <div className="border-t px-2 py-2" style={{ borderColor: 'var(--app-border-subtle)' }}>
      {favoriteEntries.length > 0 && (
        <section className="mb-2">
          <h3
            className="flex items-center gap-1 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            <Star size={10} />
            收藏
          </h3>
          <EntryList entries={favoriteEntries} onOpen={(path) => void openPath(path)} />
        </section>
      )}

      {recentEntries.length > 0 && (
        <section>
          <header className="flex items-center justify-between px-1 pb-1">
            <h3
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              <Clock size={10} />
              最近打开
            </h3>
            <button
              type="button"
              onClick={clearRecent}
              className="rounded px-1 text-[10px] transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)]"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              清空
            </button>
          </header>
          <EntryList entries={recentEntries} onOpen={(path) => void openPath(path)} />
        </section>
      )}
    </div>
  );
}
