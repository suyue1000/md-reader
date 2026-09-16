import { useMemo } from 'react';
import {
  BookOpen,
  FileCode,
  FileDown,
  FileText,
  FolderOpen,
  FolderTree,
  History,
  List,
  Maximize2,
  Minimize2,
  Moon,
  PanelLeft,
  Pencil,
  Printer,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sun,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';
import { useDocumentStore } from '@/stores/document.store';
import { useUiStore, type SidebarPanel } from '@/stores/ui.store';
import { useSaveCommands } from './useAutoSave';
import { useEditMode } from './useEditMode';
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
  /**
   * 快捷键在可编辑区域内是否照样生效；默认 false。
   *
   * 默认关掉，是因为大多数动作（打开文件、打印）在用户打字时应该让位给
   * 浏览器与输入法（见 `utils/hotkeys.ts` 的 `isEditableTarget`）。
   *
   * 但**编辑态的正文本身就是可编辑区域**：CodeMirror 按 `editable` facet 给
   * `.cm-content` 写 `contenteditable`——facet 为真时是 `"true"`，为假时是
   * `"false"`（`@codemirror/view/dist/index.js` 的 `contentAttrs`，本项目的
   * `MarkdownEditor` 正是用这个 facet 切换读写）。也就是说阅读态下
   * `isEditableTarget` 为 false、快捷键照常工作，一进编辑态它对每一次按键都
   * 返回 true。凡是「要在编辑态里用」的快捷键，不显式开这一项就等于没有。
   */
  allowInInput?: boolean;
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

  const { mode: editMode, enterEdit, leaveEdit } = useEditMode();
  const { saveNow, restorePreviousVersion } = useSaveCommands();
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
        // 切换侧边栏不产生文本，在搜索框与编辑态正文里都应该生效
        allowInInput: true,
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
        /**
         * 编辑态的进出。
         *
         * `enterEdit` 要在用户手势里申请写权限，所以这里直接把它挂在
         * onSelect 上、中间不加任何等待——按钮点击与快捷键都是手势，
         * 而 `useGlobalHotkeys` 注册的 handler 就是这个 onSelect 本身。
         */
        id: 'edit',
        label: editMode === 'edit' ? '退出编辑' : '编辑',
        icon: editMode === 'edit' ? BookOpen : Pencil,
        hotkey: 'mod+e',
        /*
         * 必须为 true。编辑态的正文是 contenteditable，不开这一项的话
         * `useHotkeys` 会把编辑态里的每一次 ⌘E 都跳过——用户进得去出不来。
         * 见上面 `allowInInput` 的说明。
         */
        allowInInput: true,
        active: editMode === 'edit',
        disabledReason: hasDocument ? undefined : '尚未打开文件',
        onSelect: () => {
          if (editMode === 'edit') leaveEdit();
          else void enterEdit();
        },
        align: 'start',
        group: 'file',
      },
      {
        /**
         * 保存。
         *
         * 不按编辑态置灰：阅读态下编辑器内容与上次落盘内容一致，这次保存会被
         * `decideSaveTarget` 判成 clean 而什么都不做——比「按了没反应还被告知
         * 按钮不可用」更省事。顺带把浏览器的「保存网页」对话框挡掉了。
         */
        id: 'save',
        label: '保存',
        icon: Save,
        hotkey: 'mod+s',
        /*
         * 必须为 true，而且这是最需要它的一个：⌘S 的用武之地几乎全在编辑态，
         * 而编辑态的正文是 contenteditable，不开这一项 `useHotkeys` 会把每一次
         * ⌘S 都跳过——按下去只会弹出浏览器自己的「保存网页」。
         */
        allowInInput: true,
        disabledReason: hasDocument ? undefined : '尚未打开文件',
        onSelect: () => void saveNow(),
        align: 'start',
        group: 'file',
      },
      {
        id: 'search',
        label: '查找正文',
        icon: Search,
        hotkey: 'mod+f',
        /*
         * 编辑态里同样要能查找——「在自己正在写的长文里找一处」正是最需要
         * 它的时候，而不开这一项它在编辑态整个失灵。
         *
         * 与编辑器自身不冲突：`MarkdownEditor` 只挂了 `defaultKeymap` 与
         * `historyKeymap`，没挂 `@codemirror/search` 的 `searchKeymap`（查了
         * `@codemirror/commands` 的 dist，这两套 keymap 里带 Mod 的绑定是
         * Mod-a/i/u/y/z 与几个方向键，没有 Mod-f），所以这里拦下来不会盖掉
         * 编辑器的任何行为。代价是让位不了浏览器的原生查找——但原生查找只找
         * 得到视口里渲染出来的那几块（正文是按视口逐块渲染的），在这个阅读器
         * 里本来就是残缺的，自研查找搜的是完整源文本。
         */
        allowInInput: true,
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
        /*
         * 编辑态也要生效。让位给浏览器原生打印在这里不是「保守」而是「出错」：
         * 原生打印印的是屏幕上的 DOM，而正文是按视口逐块渲染的，印出来只有
         * 视口附近那几块。我们自己的这条路会先把整篇离屏渲染一遍再交给打印
         * 管线（见 `useExport`），拿到的才是完整文档。
         */
        allowInInput: true,
        // 打印现在也要先离屏渲染一遍整篇文档，和导出一样有个可观的等待期，
        // 期间同样该置灰——否则连点两下会同时跑两趟渲染
        disabledReason: exportDisabledReason,
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
        /**
         * 回到上一个保存版本。
         *
         * 自动保存写的是磁盘上的真实文件，没有回收站，版本缓冲是唯一的后悔药
         * （见 `editor/versions.ts`）。它必须有一个用户够得着的入口，否则这份
         * 后悔药只存在于代码里。
         *
         * 只在编辑态可用：阅读态下把旧版本灌回编辑器，只会让屏幕上的内容与
         * 磁盘不一致，而用户没有任何要改东西的意图。
         */
        id: 'restore-version',
        label: '回到上一个保存版本',
        icon: History,
        disabledReason: editMode === 'edit' ? undefined : '只在编辑态可用',
        onSelect: restorePreviousVersion,
        align: 'end',
        group: 'history',
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
    editMode,
    enterEdit,
    leaveEdit,
    saveNow,
    restorePreviousVersion,
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
