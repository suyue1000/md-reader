import { create } from 'zustand';
import { clamp, debounce } from '@/utils/fn';
import { STORAGE_AREAS, STORAGE_KEYS, readValue, writeValue } from '@/utils/storage';

/** 侧边栏当前展示的面板；查找不在其中——它是顶部的临时浮条，不占常驻栏位 */
export type SidebarPanel = 'files' | 'toc';

/** 校正持久化的面板值：旧版本存过 'search'，如今已没有这一栏 */
function normalizePanel(value: unknown): SidebarPanel {
  return value === 'files' ? 'files' : 'toc';
}

/** 侧栏宽度边界 */
export const SIDEBAR_WIDTH = { min: 200, max: 560, default: 280 } as const;

/** 需要持久化的布局状态 */
interface PersistedLayout {
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarPanel: SidebarPanel;
}

/**
 * 一条瞬时提示。
 *
 * 带自增 id 是为了让「连续两次内容相同的提示」也能被组件识别为新事件——
 * 只比较文本的话，连点两次导出只会看到一次提示。
 */
export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

/** 全局 UI 状态：只放「界面形态」，不放业务数据 */
export interface UiStore extends PersistedLayout {
  /** 设置抽屉是否打开 */
  settingsOpen: boolean;
  /** 全文搜索框是否打开 */
  searchOpen: boolean;
  /** 是否处于全屏阅读 */
  fullscreen: boolean;
  /** 是否已从存储恢复布局 */
  hydrated: boolean;
  /** 当前的瞬时提示，null 表示没有 */
  notice: Notice | null;

  hydrate: () => Promise<void>;
  showNotice: (text: string, tone?: Notice['tone']) => void;
  dismissNotice: () => void;
  toggleSidebar: (visible?: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setSettingsOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setFullscreen: (value: boolean) => void;
}

/** 布局状态写盘（防抖，拖动侧栏时会高频触发） */
const persistLayout = debounce((layout: PersistedLayout) => {
  void writeValue(STORAGE_AREAS.layout, STORAGE_KEYS.layout, layout);
}, 300);

/** 提示的自增序号；单调递增，重置后也不会与旧提示撞号 */
let noticeSeq = 0;

/** 从 store 中提取需要持久化的字段 */
function pickLayout(state: UiStore): PersistedLayout {
  return {
    sidebarVisible: state.sidebarVisible,
    sidebarWidth: state.sidebarWidth,
    sidebarPanel: state.sidebarPanel,
  };
}

export const useUiStore = create<UiStore>((set, get) => ({
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH.default,
  sidebarPanel: 'toc',
  settingsOpen: false,
  searchOpen: false,
  fullscreen: false,
  hydrated: false,
  notice: null,

  /** 恢复上次的侧栏形态 */
  hydrate: async () => {
    const stored = await readValue<Partial<PersistedLayout>>(
      STORAGE_AREAS.layout,
      STORAGE_KEYS.layout,
      {},
    );
    set({
      sidebarVisible: stored.sidebarVisible ?? true,
      sidebarWidth: clamp(
        stored.sidebarWidth ?? SIDEBAR_WIDTH.default,
        SIDEBAR_WIDTH.min,
        SIDEBAR_WIDTH.max,
      ),
      sidebarPanel: normalizePanel(stored.sidebarPanel),
      hydrated: true,
    });
  },

  toggleSidebar: (visible) => {
    set({ sidebarVisible: visible ?? !get().sidebarVisible });
    persistLayout(pickLayout(get()));
  },

  setSidebarWidth: (width) => {
    set({ sidebarWidth: clamp(width, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) });
    persistLayout(pickLayout(get()));
  },

  setSidebarPanel: (panel) => {
    set({ sidebarPanel: panel, sidebarVisible: true });
    persistLayout(pickLayout(get()));
  },

  /**
   * 弹出一条瞬时提示。
   *
   * 自动消失的计时器交给组件而不是放在这里：store 里挂 setTimeout 会在
   * 测试中留下悬挂的定时器，也无法实现「鼠标悬停时暂停倒计时」这类需求。
   */
  showNotice: (text, tone = 'info') => {
    noticeSeq += 1;
    set({ notice: { id: noticeSeq, text, tone } });
  },

  dismissNotice: () => set({ notice: null }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setFullscreen: (value) => set({ fullscreen: value }),
}));
