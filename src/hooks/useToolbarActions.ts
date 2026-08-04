import { useMemo } from 'react';
import {
  FileCode,
  FileDown,
  FileText,
  FolderOpen,
  FolderTree,
  List,
  Maximize2,
  Minimize2,
  Moon,
  PanelLeft,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Sun,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';
import { useDocumentStore } from '@/stores/document.store';
import { useUiStore, type SidebarPanel } from '@/stores/ui.store';
import { useExport } from './useExport';
import { useFullscreen } from './useFullscreen';
import { useOpenFile } from './useOpenFile';
import { useThemeMode } from './useTheme';
import { useWorkspace } from './useWorkspace';

/** 工具栏动作 */
export interface ToolbarAction {
  id: string;
  /** 按钮文案与无障碍标签 */
  label: string;
  icon: LucideIcon;
  /** 组合键描述；同时用于 tooltip 与全局快捷键注册 */
  hotkey?: string;
  /** 不可用时的原因，会显示在 tooltip 里——比单纯置灰更容易理解 */
  disabledReason?: string;
  /** 是否处于激活态 */
  active?: boolean;
  onSelect: () => void;
  /** 靠左还是靠右排列 */
  align: 'start' | 'end';
  /** 分组，相邻不同组之间渲染分隔线 */
  group: string;
  /** 窄窗口时是否可以收进「更多」菜单 */
  collapsible?: boolean;
}

/** 主题模式对应的图标与说明 */
const THEME_META = {
  auto: { icon: SunMoon, text: '跟随系统' },
  light: { icon: Sun, text: '浅色' },
  dark: { icon: Moon, text: '深色' },
} as const;

/**
 * 工具栏动作清单。
 *
 * 把动作抽成数据而不是直接写成一堆 JSX 按钮，是为了让三处消费同一份声明：
 * 工具栏渲染、窄窗口的「更多」菜单、全局快捷键注册。
 * 否则新增一个动作要改三个地方，快捷键与按钮的可用状态也很容易走偏
 * （比如按钮已置灰、快捷键还在拦截浏览器默认行为）。
 */
export function useToolbarActions(): readonly ToolbarAction[] {
  const sidebarVisible = useUiStore((state) => state.sidebarVisible);
  const sidebarPanel = useUiStore((state) => state.sidebarPanel);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setSidebarPanel = useUiStore((state) => state.setSidebarPanel);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const searchOpen = useUiStore((state) => state.searchOpen);
  const setSearchOpen = useUiStore((state) => state.setSearchOpen);

  const documentSource = useDocumentStore((state) => state.document?.source ?? null);
  const hasDocument = useDocumentStore((state) => state.document !== null);

  const { open, reload } = useOpenFile();
  const { exportAs, busy: exporting } = useExport();
  const { openFolder } = useWorkspace();
  const { mode, setMode } = useThemeMode();
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen();

  return useMemo<readonly ToolbarAction[]>(() => {
    /**
     * 面板开关的统一行为：面板没显示就显示它，已经显示则收起侧栏。
     * 这样一个按钮既是「切到这个面板」也是「关掉侧栏」，符合 VSCode 的习惯。
     */
    const togglePanel = (panel: SidebarPanel): void => {
      if (sidebarVisible && sidebarPanel === panel) {
        toggleSidebar(false);
      } else {
        setSidebarPanel(panel);
      }
    };

    const themeMeta = THEME_META[mode];

    /** 导出期间置灰，避免大文档连点导出堆起多个保存对话框 */
    const exportDisabledReason = !hasDocument
      ? '尚未打开文件'
      : exporting
        ? '正在导出…'
        : undefined;

    /** 只有 File System Access API 打开的文档才有句柄，才能重新读取 */
    const refreshDisabledReason =
      documentSource === 'fs-handle'
        ? undefined
        : documentSource === null
          ? '尚未打开文件'
          : '通过拖拽或文件选择框打开的文档没有文件句柄，无法重新读取';

    return [
      {
        id: 'sidebar',
        label: '切换侧边栏',
        icon: PanelLeft,
        hotkey: 'mod+b',
        active: sidebarVisible,
        onSelect: () => toggleSidebar(),
        align: 'start',
        group: 'sidebar',
      },
      {
        id: 'files',
        label: '文件树',
        icon: FolderTree,
        active: sidebarVisible && sidebarPanel === 'files',
        onSelect: () => togglePanel('files'),
        align: 'start',
        group: 'sidebar',
      },
      {
        id: 'toc',
        label: '目录',
        icon: List,
        active: sidebarVisible && sidebarPanel === 'toc',
        onSelect: () => togglePanel('toc'),
        align: 'start',
        group: 'sidebar',
      },
      {
        id: 'open-file',
        label: '打开文件',
        icon: FileText,
        hotkey: 'mod+o',
        onSelect: () => void open(),
        align: 'start',
        group: 'file',
      },
      {
        id: 'open-folder',
        label: '打开文件夹',
        icon: FolderOpen,
        hotkey: 'mod+shift+o',
        onSelect: () => void openFolder(),
        align: 'start',
        group: 'file',
      },
      {
        id: 'refresh',
        label: '重新读取文件',
        icon: RefreshCw,
        disabledReason: refreshDisabledReason,
        onSelect: () => void reload(),
        align: 'start',
        group: 'file',
      },
      {
        id: 'search',
        label: '查找正文',
        icon: Search,
        hotkey: 'mod+f',
        active: searchOpen,
        disabledReason: hasDocument ? undefined : '尚未打开文件',
        onSelect: () => setSearchOpen(!searchOpen),
        align: 'end',
        group: 'find',
        collapsible: true,
      },
      {
        /**
         * 打印与导出 PDF 在实现上是同一件事——都走浏览器打印管线，
         * PDF 只是打印对话框里的一个目标（详见 export/index.ts 的说明）。
         * 摆成两个按钮点下去弹出同一个对话框，只会让人以为自己点错了。
         */
        id: 'print',
        label: '打印 / 导出 PDF',
        icon: Printer,
        hotkey: 'mod+p',
        disabledReason: hasDocument ? undefined : '尚未打开文件',
        onSelect: () => void exportAs('pdf'),
        align: 'end',
        group: 'output',
        collapsible: true,
      },
      {
        id: 'export-html',
        label: '导出 HTML',
        icon: FileCode,
        hotkey: 'mod+shift+e',
        disabledReason: exportDisabledReason,
        onSelect: () => void exportAs('html'),
        align: 'end',
        group: 'output',
        collapsible: true,
      },
      {
        id: 'export-markdown',
        label: '导出 Markdown',
        icon: FileDown,
        disabledReason: exportDisabledReason,
        onSelect: () => void exportAs('markdown'),
        align: 'end',
        group: 'output',
        collapsible: true,
      },
      {
        id: 'fullscreen',
        label: fullscreen ? '退出全屏' : '全屏阅读',
        icon: fullscreen ? Minimize2 : Maximize2,
        active: fullscreen,
        onSelect: toggleFullscreen,
        align: 'end',
        group: 'view',
        collapsible: true,
      },
      {
        id: 'theme',
        label: `主题：${themeMeta.text}`,
        icon: themeMeta.icon,
        // 三态循环：跟随系统 -> 浅色 -> 深色
        onSelect: () => setMode(mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'),
        align: 'end',
        group: 'view',
      },
      {
        id: 'settings',
        label: '设置',
        icon: Settings,
        hotkey: 'mod+,',
        onSelect: () => setSettingsOpen(true),
        align: 'end',
        group: 'app',
      },
    ];
  }, [
    sidebarVisible,
    sidebarPanel,
    toggleSidebar,
    setSidebarPanel,
    setSettingsOpen,
    searchOpen,
    setSearchOpen,
    documentSource,
    hasDocument,
    open,
    reload,
    openFolder,
    exportAs,
    exporting,
    mode,
    setMode,
    fullscreen,
    toggleFullscreen,
  ]);
}
