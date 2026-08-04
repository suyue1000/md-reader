import { describe, expect, it } from 'vitest';
import { createPluginRegistry } from './registry';
import { DEFAULT_SETTINGS, type MarkdownPlugin, type Settings } from '@/types';

/** 构造一个最小插件 */
function makePlugin(id: string, order?: number, isEnabled?: MarkdownPlugin['isEnabled']) {
  const plugin: MarkdownPlugin = { id, name: id };
  if (order !== undefined) plugin.order = order;
  if (isEnabled) plugin.isEnabled = isEnabled;
  return plugin;
}

describe('PluginRegistry', () => {
  it('按 order 升序返回插件', () => {
    const registry = createPluginRegistry();
    registry.register(makePlugin('c', 30));
    registry.register(makePlugin('a', 10));
    registry.register(makePlugin('b', 20));

    expect(registry.all().map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('未声明 order 的插件排在默认优先级位置', () => {
    const registry = createPluginRegistry();
    registry.register(makePlugin('late', 200));
    registry.register(makePlugin('default'));
    registry.register(makePlugin('early', 1));

    expect(registry.all().map((p) => p.id)).toEqual(['early', 'default', 'late']);
  });

  it('enabled 只返回在当前设置下启用的插件', () => {
    const registry = createPluginRegistry();
    registry.register(makePlugin('always'));
    registry.register(
      makePlugin('mermaid', 10, (settings: Settings) => settings.markdown.mermaid),
    );

    const disabled: Settings = {
      ...DEFAULT_SETTINGS,
      markdown: { ...DEFAULT_SETTINGS.markdown, mermaid: false },
    };

    expect(registry.enabled(DEFAULT_SETTINGS).map((p) => p.id)).toEqual(['mermaid', 'always']);
    expect(registry.enabled(disabled).map((p) => p.id)).toEqual(['always']);
  });

  it('注销后不再出现在列表里', () => {
    const registry = createPluginRegistry();
    registry.register(makePlugin('a'));
    registry.unregister('a');
    expect(registry.get('a')).toBeUndefined();
    expect(registry.all()).toHaveLength(0);
  });
});
