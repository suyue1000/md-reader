import { Section } from '../Section';
import { Field, Switch } from '@/components/ui/form';
import { useSettingsStore } from '@/stores/settings.store';
import type { MarkdownSettings } from '@/types';

/**
 * Markdown 能力开关清单。
 *
 * 用数据驱动而不是写 11 遍 JSX：这一组的每一项结构完全相同，
 * 列成数据后新增一种渲染能力只要加一行，也不会漏掉某项的说明文案。
 */
export const MARKDOWN_TOGGLES: ReadonlyArray<{
  key: keyof MarkdownSettings;
  label: string;
  description?: string;
}> = [
  { key: 'toc', label: '目录', description: '关闭后不再从标题抽取目录树' },
  { key: 'mermaid', label: 'Mermaid 图表', description: '把 ```mermaid 代码块渲染成图；关闭后按普通代码块显示' },
  { key: 'katex', label: '数学公式', description: '$行内$ 与 $$块级$$ LaTeX；关闭后节省约 78KB 的样式与脚本' },
  { key: 'emoji', label: 'Emoji', description: '把 :smile: 这类短代码转成表情字符' },
  { key: 'footnote', label: '脚注', description: '[^1] 引用与文末注解' },
  { key: 'highlight', label: '高亮', description: '==高亮文本== 语法' },
  { key: 'taskList', label: '任务列表', description: '- [ ] / - [x] 复选框' },
  { key: 'deflist', label: '定义列表', description: 'term / : definition 语法' },
  { key: 'subSup', label: '上标与下标', description: 'H~2~O 与 x^2^ 语法' },
  { key: 'images', label: '图片增强', description: '懒加载与异步解码' },
  {
    key: 'html',
    label: '允许原始 HTML',
    description: '关闭后文件里的 HTML 标签会以纯文本显示。无论开关如何，输出都会经过净化',
  },
];

/** Markdown 渲染能力开关 */
export function MarkdownSection(): React.JSX.Element {
  const markdown = useSettingsStore((state) => state.settings.markdown);
  const setMarkdown = useSettingsStore((state) => state.setMarkdown);

  return (
    <Section title="Markdown" group="markdown">
      {MARKDOWN_TOGGLES.map((toggle) => (
        <Field key={toggle.key} label={toggle.label} description={toggle.description}>
          {(id) => (
            <Switch
              id={id}
              checked={markdown[toggle.key]}
              onChange={(checked) => setMarkdown({ [toggle.key]: checked })}
            />
          )}
        </Field>
      ))}
    </Section>
  );
}
