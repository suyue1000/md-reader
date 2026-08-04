import { create } from 'zustand';
import type { FileTreeNode, RecentFileEntry } from '@/types';
import { debounce } from '@/utils/fn';
import { STORAGE_AREAS, STORAGE_KEYS, readValue, writeValue } from '@/utils/storage';

/** 最近打开保留多少条 */
const MAX_RECENT = 20;

/**
 * 工作区状态：打开的文件夹、最近打开、收藏。
 *
 * 与 `document.store` 分开，是因为两者的生命周期不同：文件夹可以在没有
 * 打开任何文档时存在，一个文件夹里也会先后打开多份文档。硬塞进同一个
 * store 会让「换文档」与「换文件夹」的重置逻辑互相纠缠。
 */
export interface WorkspaceStore {
  /** 打开的文件夹名；null 表示未打开 */
  rootName: string | null;
  /** 文件树（根目录的子节点） */
  tree: FileTreeNode[];
  /** 是否正在扫描 */
  scanning: boolean;
  /** 扫描是否因触达上限而截断 */
  truncated: boolean;
  /** 收录的 Markdown 文件数 */
  fileCount: number;
  /** 最近打开，按时间倒序 */
  recentFiles: RecentFileEntry[];
  /** 收藏的文档 id */
  favorites: string[];
  /**
   * 本次会话里仍持有文件句柄的路径。
   *
   * 句柄本身不可序列化、也不该进 store，但「这条历史记录还能不能点开」
   * 是实实在在的界面状态。把路径集合放进 store，UI 就能从状态推导，
   * 而不必去读一个不会触发重渲染的模块级 Map。
   */
  availablePaths: ReadonlySet<string>;
  /** 是否已从存储恢复最近打开与收藏 */
  hydrated: boolean;

  setScanning: (scanning: boolean) => void;
  setWorkspace: (payload: {
    rootName: string;
    tree: FileTreeNode[];
    fileCount: number;
    truncated: boolean;
    paths: readonly string[];
  }) => void;
  /** 登记一个新的可用路径（单独打开文件时） */
  addAvailablePath: (path: string) => void;
  clearWorkspace: () => void;
  hydrate: () => Promise<void>;
  addRecent: (entry: RecentFileEntry) => void;
  toggleFavorite: (documentId: string) => void;
  clearRecent: () => void;
}

/** 最近打开写盘（防抖：连续打开多个文件时不必每次都写） */
const persistRecent = debounce((entries: RecentFileEntry[]) => {
  void writeValue(STORAGE_AREAS.recentFiles, STORAGE_KEYS.recentFiles, entries);
}, 300);

/** 收藏写盘 */
const persistFavorites = debounce((favorites: string[]) => {
  void writeValue(STORAGE_AREAS.favorites, STORAGE_KEYS.favorites, favorites);
}, 300);

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  rootName: null,
  tree: [],
  scanning: false,
  truncated: false,
  fileCount: 0,
  recentFiles: [],
  favorites: [],
  availablePaths: new Set<string>(),
  hydrated: false,

  setScanning: (scanning) => set({ scanning }),

  setWorkspace: ({ rootName, tree, fileCount, truncated, paths }) =>
    set({
      rootName,
      tree,
      fileCount,
      truncated,
      scanning: false,
      // 扫描会重建句柄表，因此这里是替换而不是合并
      availablePaths: new Set(paths),
    }),

  addAvailablePath: (path) =>
    set((state) =>
      // 已存在就返回空补丁，避免造出一个新 Set 触发无谓的重渲染
      state.availablePaths.has(path)
        ? {}
        : { availablePaths: new Set([...state.availablePaths, path]) },
    ),

  clearWorkspace: () =>
    set({
      rootName: null,
      tree: [],
      fileCount: 0,
      truncated: false,
      scanning: false,
      // 关闭文件夹会清空句柄表，可用路径随之作废
      availablePaths: new Set<string>(),
    }),

  hydrate: async () => {
    const [recentFiles, favorites] = await Promise.all([
      readValue<RecentFileEntry[]>(STORAGE_AREAS.recentFiles, STORAGE_KEYS.recentFiles, []),
      readValue<string[]>(STORAGE_AREAS.favorites, STORAGE_KEYS.favorites, []),
    ]);
    set({ recentFiles, favorites, hydrated: true });
  },

  addRecent: (entry) => {
    // 同一个文件重新打开时提到最前，而不是产生重复条目
    const rest = get().recentFiles.filter((item) => item.id !== entry.id);
    const recentFiles = [entry, ...rest].slice(0, MAX_RECENT);
    set({ recentFiles });
    persistRecent(recentFiles);
  },

  toggleFavorite: (documentId) => {
    const current = get().favorites;
    const favorites = current.includes(documentId)
      ? current.filter((id) => id !== documentId)
      : [...current, documentId];
    set({ favorites });
    persistFavorites(favorites);
  },

  clearRecent: () => {
    set({ recentFiles: [] });
    persistRecent([]);
  },
}));
