import { Section } from '../Section';
import { Field, Select, Slider } from '@/components/ui/form';
import { useSettingsStore } from '@/stores/settings.store';
import { registerBuiltinThemes, themeRegistry } from '@/themes';
import {
  CODE_THEME_OPTIONS,
  CONTENT_WIDTH_OPTIONS,
  FONT_FAMILIES,
  SETTINGS_BOUNDS,
  type ContentWidth,
  type FontFamilyKey,
  type ThemeMode,
} from '@/types';

/** 主题选项 */
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

/** 字体选项，从字体表推导，避免两处维护 */
const FONT_OPTIONS = (Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((key) => ({
  value: key,
  label: FONT_FAMILIES[key].label,
}));

/** 内容宽度选项 */
const WIDTH_OPTIONS = CONTENT_WIDTH_OPTIONS.map((width) => ({
  value: String(width),
  label: width === 'full' ? '100%（自适应）' : `${String(width)}px`,
}));

/** 代码主题选项，按「浅色主题名」标识一对主题 */
const CODE_THEME_SELECT = CODE_THEME_OPTIONS.map((theme) => ({
  value: theme.light,
  label: theme.label,
}));

/** 外观设置：主题、字体、排版、宽度 */
export function AppearanceSection(): React.JSX.Element {
  const appearance = useSettingsStore((state) => state.settings.appearance);
  const setAppearance = useSettingsStore((state) => state.setAppearance);
  const setReadingTheme = useSettingsStore((state) => state.setReadingTheme);

  // 主题清单来自注册表，新增一套配色不需要改动这里
  registerBuiltinThemes();
  const themes = themeRegistry.all();
  const activeTheme = themes.find((theme) => theme.id === appearance.readingTheme);

  return (
    <Section title="外观" group="appearance">
      <Field label="明暗模式">
        {(id) => (
          <Select
            id={id}
            value={appearance.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => setAppearance({ theme })}
          />
        )}
      </Field>

      <Field
        label="阅读主题"
        description={activeTheme?.description ?? '配色风格，与明暗模式相互独立'}
      >
        {(id) => (
          <Select
            id={id}
            value={appearance.readingTheme}
            options={themes.map((theme) => ({ value: theme.id, label: theme.name }))}
            onChange={setReadingTheme}
          />
        )}
      </Field>

      <Field label="正文字体">
        {(id) => (
          <Select
            id={id}
            value={appearance.fontFamily}
            options={FONT_OPTIONS}
            onChange={(fontFamily) => setAppearance({ fontFamily })}
          />
        )}
      </Field>

      <Field label="内容宽度" description="正文区域的最大宽度，超出部分作为左右留白">
        {(id) => (
          <Select
            id={id}
            value={String(appearance.contentWidth)}
            options={WIDTH_OPTIONS}
            onChange={(value) => {
              // select 的值永远是字符串，这里还原成数字或 'full'
              const contentWidth: ContentWidth = value === 'full' ? 'full' : (Number(value) as ContentWidth);
              setAppearance({ contentWidth });
            }}
          />
        )}
      </Field>

      <Field label="字号" layout="stacked">
        {(id) => (
          <Slider
            id={id}
            value={appearance.fontSize}
            min={SETTINGS_BOUNDS.fontSize.min}
            max={SETTINGS_BOUNDS.fontSize.max}
            step={SETTINGS_BOUNDS.fontSize.step}
            unit="px"
            onChange={(fontSize) => setAppearance({ fontSize })}
          />
        )}
      </Field>

      <Field label="行高" layout="stacked">
        {(id) => (
          <Slider
            id={id}
            value={appearance.lineHeight}
            min={SETTINGS_BOUNDS.lineHeight.min}
            max={SETTINGS_BOUNDS.lineHeight.max}
            step={SETTINGS_BOUNDS.lineHeight.step}
            onChange={(lineHeight) =>
              // 滑块步进会带来 1.7000000000000002 这类浮点误差，保留一位小数
              setAppearance({ lineHeight: Math.round(lineHeight * 10) / 10 })
            }
          />
        )}
      </Field>

      <Field label="字间距" layout="stacked">
        {(id) => (
          <Slider
            id={id}
            value={appearance.letterSpacing}
            min={SETTINGS_BOUNDS.letterSpacing.min}
            max={SETTINGS_BOUNDS.letterSpacing.max}
            step={SETTINGS_BOUNDS.letterSpacing.step}
            unit="px"
            onChange={(letterSpacing) =>
              setAppearance({ letterSpacing: Math.round(letterSpacing * 10) / 10 })
            }
          />
        )}
      </Field>

      <Field label="代码配色" description="浅色与深色主题各自的代码高亮配色，切换主题时自动跟随">
        {(id) => (
          <Select
            id={id}
            value={appearance.codeTheme}
            options={CODE_THEME_SELECT}
            onChange={(light) => {
              const pair = CODE_THEME_OPTIONS.find((theme) => theme.light === light);
              if (pair) setAppearance({ codeTheme: pair.light, codeThemeDark: pair.dark });
            }}
          />
        )}
      </Field>

      <Field
        label="预览"
        description="以上排版设置会实时作用到正文，这里只是一个即时参考"
        layout="stacked"
      >
        {() => (
          <div
            className="rounded-md p-2 text-xs"
            style={{
              border: '1px solid var(--app-border-subtle)',
              fontFamily: FONT_FAMILIES[appearance.fontFamily].stack,
              fontSize: `${String(appearance.fontSize)}px`,
              lineHeight: appearance.lineHeight,
              letterSpacing: `${String(appearance.letterSpacing)}px`,
              color: 'var(--app-text)',
            }}
          >
            阅读是一种缓慢的手艺 · The quick brown fox jumps over the lazy dog.
          </div>
        )}
      </Field>
    </Section>
  );
}
