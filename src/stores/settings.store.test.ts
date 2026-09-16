import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types';
import {
  STORAGE_AREAS,
  STORAGE_KEYS,
  createMemoryStorageDriver,
  setStorageDriver,
  writeValue,
} from '@/utils/storage';
import { useSettingsStore } from './settings.store';

describe('settings store', () => {
  beforeEach(() => {
    setStorageDriver(createMemoryStorageDriver());
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, hydrated: false });
  });

  it('存储为空时回落到默认设置', async () => {
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(useSettingsStore.getState().hydrated).toBe(true);
  });

  it('局部更新只影响目标字段', () => {
    useSettingsStore.getState().setAppearance({ fontSize: 20 });
    const { appearance } = useSettingsStore.getState().settings;
    expect(appearance.fontSize).toBe(20);
    expect(appearance.lineHeight).toBe(DEFAULT_SETTINGS.appearance.lineHeight);
  });

  it('写入的设置会被持久化并可恢复', async () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setAppearance({ contentWidth: 1200 });
    // 写盘是防抖的，需要推进定时器
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, hydrated: false });
    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().settings.appearance.contentWidth).toBe(1200);
  });

  it('自定义 CSS 走 local 区，也能正确恢复', async () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setAdvanced({ customCss: 'h1{color:red}' });
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, hydrated: false });
    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().settings.advanced.customCss).toBe('h1{color:red}');
  });

  it('切换阅读主题会一并应用配套的代码配色', () => {
    // 「预设」的语义是一次应用一整套搭配；代码配色脱节会像贴在页面上的补丁
    useSettingsStore.getState().setReadingTheme('sepia');
    const { appearance } = useSettingsStore.getState().settings;

    expect(appearance.readingTheme).toBe('sepia');
    expect(appearance.codeTheme).toBe('vitesse-light');
    expect(appearance.codeThemeDark).toBe('vitesse-dark');
  });

  it('换主题后仍可单独调整代码配色', () => {
    useSettingsStore.getState().setReadingTheme('sepia');
    useSettingsStore.getState().setAppearance({ codeTheme: 'one-light' });

    const { appearance } = useSettingsStore.getState().settings;
    expect(appearance.readingTheme).toBe('sepia');
    expect(appearance.codeTheme).toBe('one-light');
  });

  it('未知主题 id 回落到默认主题', () => {
    useSettingsStore.getState().setReadingTheme('不存在的主题');
    expect(useSettingsStore.getState().settings.appearance.readingTheme).toBe('github');
  });

  it('从 schemaVersion 1 的旧结构升级：editor 分组补上默认值，其余分组的自定义值原样保留', async () => {
    // 这是 R28 的实测：SETTINGS_SCHEMA_VERSION 从 1 升到 2 时新增了 editor 分组，
    // 计划里写的是「不写迁移脚本，靠 hydrate 里的 deep-merge 兜底」。
    // 本项目已经在 ReadingPosition 改结构时吃过一次同类亏——升级后旧数据被直接断言
    // 成新类型，缺失字段变成 undefined 一路传导到渲染层，最终白屏。
    // 所以这里不能只读代码就相信"deep-merge 会兜住"，必须绕开 store 的现有类型定义，
    // 手写一份 schemaVersion:1 时代、真正没有 editor 字段的存量数据直接写入存储，
    // 再走 hydrate 这条真实读取路径，实测升级后的行为。
    const legacySynced = {
      schemaVersion: 1,
      appearance: { ...DEFAULT_SETTINGS.appearance, fontSize: 20 }, // 用户改过的旧字段
      markdown: DEFAULT_SETTINGS.markdown,
      reading: { ...DEFAULT_SETTINGS.reading, scrollSync: false }, // 用户改过的旧字段
      // 故意不写 editor：schemaVersion 1 时这个分组还不存在
    };
    const legacyAdvanced = { ...DEFAULT_SETTINGS.advanced, customCss: 'body{color:red}' };

    await writeValue(STORAGE_AREAS.settings, STORAGE_KEYS.settings, legacySynced);
    await writeValue(STORAGE_AREAS.advanced, STORAGE_KEYS.advanced, legacyAdvanced);

    await useSettingsStore.getState().hydrate();
    const { settings } = useSettingsStore.getState();

    // 确认 1：editor 分组存在且是默认值（旧数据里压根没有这个 key）
    expect(settings.editor).toEqual(DEFAULT_SETTINGS.editor);
    // 确认 2：其余分组没有被 deep-merge 误伤——用户在旧结构里改过的值原样保留
    expect(settings.appearance.fontSize).toBe(20);
    expect(settings.reading.scrollSync).toBe(false);
    expect(settings.advanced.customCss).toBe('body{color:red}');
    // 确认 3：结构版本号以代码为准前进到 2，不会卡在旧值上
    expect(settings.schemaVersion).toBe(2);
  });

  it('resetGroup 只重置指定分组', () => {
    useSettingsStore.getState().setAppearance({ fontSize: 22 });
    useSettingsStore.getState().setReading({ scrollSync: false });
    useSettingsStore.getState().resetGroup('appearance');

    const { settings } = useSettingsStore.getState();
    expect(settings.appearance.fontSize).toBe(DEFAULT_SETTINGS.appearance.fontSize);
    expect(settings.reading.scrollSync).toBe(false);
  });
});
