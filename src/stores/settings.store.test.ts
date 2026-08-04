import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types';
import { createMemoryStorageDriver, setStorageDriver } from '@/utils/storage';
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

  it('resetGroup 只重置指定分组', () => {
    useSettingsStore.getState().setAppearance({ fontSize: 22 });
    useSettingsStore.getState().setReading({ scrollSync: false });
    useSettingsStore.getState().resetGroup('appearance');

    const { settings } = useSettingsStore.getState();
    expect(settings.appearance.fontSize).toBe(DEFAULT_SETTINGS.appearance.fontSize);
    expect(settings.reading.scrollSync).toBe(false);
  });
});
