import { Section } from '../Section';
import { Field, Select, Slider, Switch } from '@/components/ui/form';
import { useSettingsStore } from '@/stores/settings.store';
import { SETTINGS_BOUNDS, type EditorSettings } from '@/types';

/** 布尔类编辑设置 */
const TOGGLES: ReadonlyArray<{
  key: keyof Pick<EditorSettings, 'autoSave' | 'showLineNumbers' | 'indentWithTabs'>;
  label: string;
  description?: string;
}> = [
  {
    key: 'autoSave',
    label: '自动保存',
    description:
      '停笔后自动写回原文件。写入的是你磁盘上的真实文件，没有回收站——关掉它之后，改动要靠你自己按 ⌘S / Ctrl+S（或工具栏的「保存」）写回。',
  },
  { key: 'showLineNumbers', label: '编辑态显示行号' },
  { key: 'indentWithTabs', label: '用 Tab 缩进', description: '关闭时用空格，宽度由下方「缩进宽度」决定' },
];

/** 默认打开模式选项 */
const MODE_OPTIONS: ReadonlyArray<{ value: EditorSettings['defaultMode']; label: string }> = [
  { value: 'read', label: '阅读' },
  { value: 'edit', label: '编辑' },
];

/**
 * 每个设置项在这里的曝光键，供覆盖测试比对。
 *
 * 三个开关的 key 直接复用 TOGGLES（单一数据源，改开关不会漏改这份清单）；
 * 其余四项是各自独立渲染的 Select / Slider，只能手写补全。
 */
export const EDITOR_FIELD_KEYS: ReadonlyArray<keyof EditorSettings> = [
  ...TOGGLES.map((toggle) => toggle.key),
  'defaultMode',
  'autoSaveDelay',
  'tabSize',
  'keepVersions',
];

/** 编辑设置：自动保存、初始模式、缩进 */
export function EditorSection(): React.JSX.Element {
  const editor = useSettingsStore((state) => state.settings.editor);
  const setEditor = useSettingsStore((state) => state.setEditor);

  return (
    <Section title="编辑" group="editor">
      {TOGGLES.map((toggle) => (
        <Field key={toggle.key} label={toggle.label} description={toggle.description}>
          {(id) => (
            <Switch
              id={id}
              checked={editor[toggle.key]}
              onChange={(checked) => setEditor({ [toggle.key]: checked })}
            />
          )}
        </Field>
      ))}

      <Field
        label="自动保存延迟"
        description="停止输入后等待这么久再写盘"
        layout="stacked"
        disabledReason={editor.autoSave ? undefined : '已关闭自动保存'}
      >
        {(id) => (
          <Slider
            id={id}
            value={editor.autoSaveDelay}
            min={SETTINGS_BOUNDS.autoSaveDelay.min}
            max={SETTINGS_BOUNDS.autoSaveDelay.max}
            step={SETTINGS_BOUNDS.autoSaveDelay.step}
            unit="ms"
            disabled={!editor.autoSave}
            onChange={(autoSaveDelay) => setEditor({ autoSaveDelay })}
          />
        )}
      </Field>

      <Field label="打开文档的初始模式" description="新打开一份文档时默认停在阅读还是编辑">
        {(id) => (
          <Select
            id={id}
            value={editor.defaultMode}
            options={MODE_OPTIONS}
            onChange={(defaultMode) => setEditor({ defaultMode })}
          />
        )}
      </Field>

      <Field label="缩进宽度" layout="stacked">
        {(id) => (
          <Slider
            id={id}
            value={editor.tabSize}
            min={SETTINGS_BOUNDS.tabSize.min}
            max={SETTINGS_BOUNDS.tabSize.max}
            step={SETTINGS_BOUNDS.tabSize.step}
            onChange={(tabSize) => setEditor({ tabSize })}
          />
        )}
      </Field>

      <Field
        label="保留的历史版本数"
        description="内存中保留多少份「保存前」的快照，是自动保存唯一的后悔药"
        layout="stacked"
      >
        {(id) => (
          <Slider
            id={id}
            value={editor.keepVersions}
            min={SETTINGS_BOUNDS.keepVersions.min}
            max={SETTINGS_BOUNDS.keepVersions.max}
            step={SETTINGS_BOUNDS.keepVersions.step}
            onChange={(keepVersions) => setEditor({ keepVersions })}
          />
        )}
      </Field>
    </Section>
  );
}
