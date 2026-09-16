import { AppearanceSection } from './sections/AppearanceSection';
import { MarkdownSection } from './sections/MarkdownSection';
import { ReadingSection } from './sections/ReadingSection';
import { EditorSection } from './sections/EditorSection';
import { AdvancedSection } from './sections/AdvancedSection';

/**
 * 设置表单主体。
 *
 * 刻意不包含任何容器（抽屉 / 页面）——同一份表单同时被阅读器里的抽屉
 * 和独立设置页（options.html）复用，容器差异留给各自的宿主处理。
 * 这样「改一个设置项」永远只需要动一个文件。
 */
export function SettingsPanel(): React.JSX.Element {
  return (
    <div>
      <AppearanceSection />
      <MarkdownSection />
      <ReadingSection />
      <EditorSection />
      <AdvancedSection />
    </div>
  );
}
