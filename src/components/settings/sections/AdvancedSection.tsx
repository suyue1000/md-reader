import { Section } from '../Section';
import { CodeArea, Field, Switch } from '@/components/ui/form';
import { useSettingsStore } from '@/stores/settings.store';

/** 自定义 CSS 的示例，兼作占位提示 */
const CSS_PLACEHOLDER = `h1 {
  color: #2563eb;
}

table {
  border-radius: 12px;
}`;

/**
 * 自定义 JS 无法执行的原因说明。
 *
 * Manifest V3 的 `extension_pages` CSP 固定为 `script-src 'self'`：
 * 内联脚本、eval、blob: 脚本 URL 全部被拒绝，而且这条 CSP 不允许放宽。
 * 也就是说无论怎么实现，用户提供的 JS 在扩展页面里都跑不起来，
 * 因此项目里根本没有执行它的代码路径——开关无条件禁用，
 * 而不是「在扩展里禁用、在开发预览里放行」，后者同样是个点了没反应的开关。
 */
const CUSTOM_JS_REASON =
  "Manifest V3 的扩展页面 CSP 固定为 script-src 'self'，内联脚本与 eval 一律被拒绝，用户脚本无法在此执行";

/** 高级设置：自定义 CSS / JS 与实验特性 */
export function AdvancedSection(): React.JSX.Element {
  const advanced = useSettingsStore((state) => state.settings.advanced);
  const setAdvanced = useSettingsStore((state) => state.setAdvanced);
  const resetAll = useSettingsStore((state) => state.resetAll);

  return (
    <Section title="高级" group="advanced">
      <Field
        label="接管浏览器打开的 .md"
        description="在浏览器里直接打开 Markdown 文件时用阅读器渲染，地址栏保持不变。本地文件还需在 chrome://extensions 里为本扩展勾选「允许访问文件网址」。关闭后仍显示纯文本源码"
      >
        {(id) => (
          <Switch
            id={id}
            checked={advanced.takeoverMarkdownPages}
            onChange={(takeoverMarkdownPages) => setAdvanced({ takeoverMarkdownPages })}
          />
        )}
      </Field>

      <Field
        label="自定义 CSS"
        description="注入到 <style id=&quot;user-style&quot;>，保存即生效；留空则移除该节点"
        layout="stacked"
      >
        {(id) => (
          <CodeArea
            id={id}
            value={advanced.customCss}
            placeholder={CSS_PLACEHOLDER}
            onChange={(customCss) => setAdvanced({ customCss })}
          />
        )}
      </Field>

      <Field
        label="启用自定义 JS"
        description="默认关闭，属于危险能力"
        disabledReason={CUSTOM_JS_REASON}
      >
        {(id) => (
          <Switch
            id={id}
            checked={advanced.enableCustomJs}
            disabled
            onChange={(enableCustomJs) => setAdvanced({ enableCustomJs })}
          />
        )}
      </Field>

      <Field label="自定义 JS" layout="stacked">
        {(id) => (
          <CodeArea
            id={id}
            value={advanced.customJs}
            rows={5}
            disabled
            placeholder="console.log('hello');"
            onChange={(customJs) => setAdvanced({ customJs })}
          />
        )}
      </Field>

      <Field
        label="实验功能"
        description="提前启用尚未稳定的特性"
        disabledReason="当前没有可用的实验特性"
      >
        {(id) => (
          <Switch
            id={id}
            checked={advanced.experimental}
            disabled
            onChange={(experimental) => setAdvanced({ experimental })}
          />
        )}
      </Field>

      <Field
        label="全部恢复默认"
        description="重置所有分组，包括自定义 CSS。此操作不可撤销"
      >
        {() => (
          <button
            type="button"
            onClick={() => {
              // 自定义 CSS 可能是用户攒了很久的成果，删掉前必须确认
              if (window.confirm('确定要把所有设置恢复为默认值吗？自定义 CSS 也会被清空。')) {
                resetAll();
              }
            }}
            className="rounded-md px-2.5 py-1 text-xs transition-colors duration-[var(--app-duration)]"
            style={{ border: '1px solid var(--app-danger)', color: 'var(--app-danger)' }}
          >
            恢复默认
          </button>
        )}
      </Field>
    </Section>
  );
}
