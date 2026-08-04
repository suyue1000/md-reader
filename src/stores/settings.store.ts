import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  type AdvancedSettings,
  type AppearanceSettings,
  type MarkdownSettings,
  type ReadingSettings,
  type Settings,
} from '@/types';
import { resolveReadingTheme } from '@/themes';
import { debounce, deepMerge } from '@/utils/fn';
import { createLogger } from '@/utils/logger';
import {
  STORAGE_AREAS,
  STORAGE_KEYS,
  readValue,
  subscribeStorage,
  writeValue,
} from '@/utils/storage';

const log = createLogger('settings-store');

/** 除 advanced 之外、走 chrome.storage.sync 的部分 */
type SyncedSettings = Omit<Settings, 'advanced'>;

/** 设置 store 的状态与行为 */
export interface SettingsStore {
  /** 当前生效的设置 */
  settings: Settings;
  /** 是否已完成首次从存储恢复；未恢复前 UI 应避免写入 */
  hydrated: boolean;
  /** 从存储恢复设置，应用启动时调用一次 */
  hydrate: () => Promise<void>;
  setAppearance: (patch: Partial<AppearanceSettings>) => void;
  /**
   * 切换阅读主题，并一并应用它建议的代码配色。
   *
   * 单独开一个 action 而不是让调用方连写三次 `setAppearance`：
   * 「预设」的语义就是一次应用一整套搭配。代码配色与阅读主题脱节时，
   * 代码块会像贴在页面上的一块补丁，比不换主题还难看。
   * 换完之后用户仍可单独调整代码配色，不会被锁死。
   */
  setReadingTheme: (themeId: string) => void;
  setMarkdown: (patch: Partial<MarkdownSettings>) => void;
  setReading: (patch: Partial<ReadingSettings>) => void;
  setAdvanced: (patch: Partial<AdvancedSettings>) => void;
  /** 重置某个分组到默认值 */
  resetGroup: (group: keyof Omit<Settings, 'schemaVersion'>) => void;
  /** 全部恢复默认 */
  resetAll: () => void;
}

/** 防止「存储变更 -> 更新 store -> 又写回存储」的回环 */
let applyingRemoteChange = false;

/** 把 sync 分组写盘（防抖，避免拖动滑块时打爆配额） */
const persistSynced = debounce((settings: Settings) => {
  const payload: SyncedSettings = {
    schemaVersion: settings.schemaVersion,
    appearance: settings.appearance,
    markdown: settings.markdown,
    reading: settings.reading,
  };
  void writeValue(STORAGE_AREAS.settings, STORAGE_KEYS.settings, payload);
}, 300);

/** 把 advanced 分组写盘（自定义 CSS/JS 体积大，单独放 local） */
const persistAdvanced = debounce((advanced: AdvancedSettings) => {
  void writeValue(STORAGE_AREAS.advanced, STORAGE_KEYS.advanced, advanced);
}, 300);

/** 根据本次变更涉及的分组决定写哪个存储区 */
function persist(settings: Settings, touchedAdvanced: boolean): void {
  if (applyingRemoteChange) return;
  if (touchedAdvanced) {
    persistAdvanced(settings.advanced);
  } else {
    persistSynced(settings);
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  /** 从两个存储区读取并与默认值深合并 */
  hydrate: async () => {
    const [synced, advanced] = await Promise.all([
      readValue<Partial<SyncedSettings>>(STORAGE_AREAS.settings, STORAGE_KEYS.settings, {}),
      readValue<Partial<AdvancedSettings>>(STORAGE_AREAS.advanced, STORAGE_KEYS.advanced, {}),
    ]);

    const merged = deepMerge(DEFAULT_SETTINGS, {
      ...synced,
      advanced,
      // 结构版本始终以代码为准，为后续迁移留出口子
      schemaVersion: SETTINGS_SCHEMA_VERSION,
    });

    set({ settings: merged, hydrated: true });
    log.debug('设置已恢复', merged);
  },

  setAppearance: (patch) => {
    const next: Settings = {
      ...get().settings,
      appearance: { ...get().settings.appearance, ...patch },
    };
    set({ settings: next });
    persist(next, false);
  },

  setReadingTheme: (themeId) => {
    const theme = resolveReadingTheme(themeId);
    const next: Settings = {
      ...get().settings,
      appearance: {
        ...get().settings.appearance,
        readingTheme: theme.id,
        codeTheme: theme.code.light,
        codeThemeDark: theme.code.dark,
      },
    };
    set({ settings: next });
    persist(next, false);
  },

  setMarkdown: (patch) => {
    const next: Settings = {
      ...get().settings,
      markdown: { ...get().settings.markdown, ...patch },
    };
    set({ settings: next });
    persist(next, false);
  },

  setReading: (patch) => {
    const next: Settings = {
      ...get().settings,
      reading: { ...get().settings.reading, ...patch },
    };
    set({ settings: next });
    persist(next, false);
  },

  setAdvanced: (patch) => {
    const next: Settings = {
      ...get().settings,
      advanced: { ...get().settings.advanced, ...patch },
    };
    set({ settings: next });
    persist(next, true);
  },

  resetGroup: (group) => {
    const next: Settings = { ...get().settings, [group]: DEFAULT_SETTINGS[group] };
    set({ settings: next });
    persist(next, group === 'advanced');
  },

  resetAll: () => {
    set({ settings: DEFAULT_SETTINGS });
    persistSynced(DEFAULT_SETTINGS);
    persistAdvanced(DEFAULT_SETTINGS.advanced);
  },
}));

/**
 * 监听其它扩展上下文（popup / options 页）对设置的修改，实时同步到本页面。
 * 在模块加载时注册一次即可，扩展页面的生命周期与模块一致。
 */
export function watchSettingsChanges(): () => void {
  return subscribeStorage((changes, area) => {
    const state = useSettingsStore.getState();
    if (!state.hydrated) return;

    applyingRemoteChange = true;
    try {
      if (area === STORAGE_AREAS.settings && STORAGE_KEYS.settings in changes) {
        const incoming = changes[STORAGE_KEYS.settings] as Partial<SyncedSettings> | undefined;
        if (incoming) {
          useSettingsStore.setState({
            settings: deepMerge(state.settings, incoming),
          });
        }
      }
      if (area === STORAGE_AREAS.advanced && STORAGE_KEYS.advanced in changes) {
        const incoming = changes[STORAGE_KEYS.advanced] as Partial<AdvancedSettings> | undefined;
        if (incoming) {
          useSettingsStore.setState({
            settings: deepMerge(state.settings, { advanced: incoming }),
          });
        }
      }
    } finally {
      applyingRemoteChange = false;
    }
  });
}

/** 便捷选择器：只订阅外观设置，减少无关重渲染 */
export const selectAppearance = (state: SettingsStore): AppearanceSettings =>
  state.settings.appearance;
/** 便捷选择器：只订阅 Markdown 开关 */
export const selectMarkdown = (state: SettingsStore): MarkdownSettings => state.settings.markdown;
/** 便捷选择器：只订阅阅读设置 */
export const selectReading = (state: SettingsStore): ReadingSettings => state.settings.reading;
