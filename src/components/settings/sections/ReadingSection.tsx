import { Section } from '../Section';
import { Field, Slider, Switch } from '@/components/ui/form';
import { useSettingsStore } from '@/stores/settings.store';
import { SETTINGS_BOUNDS, type ReadingSettings } from '@/types';

/** 布尔类阅读设置 */
const TOGGLES: ReadonlyArray<{
  key: keyof ReadingSettings;
  label: string;
  description?: string;
}> = [
  { key: 'autoRefresh', label: '自动刷新', description: '文件在磁盘上变化后自动重新渲染（Phase 6 接入）' },
  { key: 'scrollSync', label: '目录跟随滚动', description: '滚动正文时高亮当前所在章节' },
  { key: 'expandTocByDefault', label: '默认展开目录', description: '关闭后目录树初始为折叠状态' },
  { key: 'restoreScrollPosition', label: '恢复阅读位置', description: '重新打开同一文件时回到上次的位置（Phase 6 接入）' },
  { key: 'showProgressBar', label: '阅读进度条', description: '在工具栏下方显示一条细进度条' },
  { key: 'codeLineNumbers', label: '代码行号' },
  { key: 'codeWordWrap', label: '代码自动换行', description: '关闭时超长代码横向滚动' },
  { key: 'codeCollapseLong', label: '折叠超长代码块', description: '超过 20 行的代码块默认折叠' },
];

/** 阅读行为设置 */
export function ReadingSection(): React.JSX.Element {
  const reading = useSettingsStore((state) => state.settings.reading);
  const setReading = useSettingsStore((state) => state.setReading);

  return (
    <Section title="阅读" group="reading">
      {TOGGLES.map((toggle) => (
        <Field key={toggle.key} label={toggle.label} description={toggle.description}>
          {(id) => (
            <Switch
              id={id}
              checked={reading[toggle.key] as boolean}
              onChange={(checked) => setReading({ [toggle.key]: checked })}
            />
          )}
        </Field>
      ))}

      <Field
        label="自动刷新间隔"
        description="拿不到文件系统事件时的轮询间隔，越短越灵敏也越费电"
        layout="stacked"
      >
        {(id) => (
          <Slider
            id={id}
            value={reading.autoRefreshInterval}
            min={SETTINGS_BOUNDS.autoRefreshInterval.min}
            max={SETTINGS_BOUNDS.autoRefreshInterval.max}
            step={SETTINGS_BOUNDS.autoRefreshInterval.step}
            unit="ms"
            disabled={!reading.autoRefresh}
            onChange={(autoRefreshInterval) => setReading({ autoRefreshInterval })}
          />
        )}
      </Field>
    </Section>
  );
}
