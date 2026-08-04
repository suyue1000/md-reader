import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types';
import { MARKDOWN_TOGGLES } from './sections/MarkdownSection';

/**
 * 防漂移测试。
 *
 * 每新增一种 Markdown 渲染能力都要同时改三处：类型定义、默认值、设置开关。
 * 前两处漏了会编译报错，第三处漏了只会「悄悄少一个开关」——用户永远
 * 关不掉这个能力，而且没人会发现。这条测试就是补上那个缺失的编译期约束。
 */
describe('设置页覆盖度', () => {
  it('每个 Markdown 能力开关都在设置页里出现', () => {
    const declared = Object.keys(DEFAULT_SETTINGS.markdown).sort();
    const exposed = MARKDOWN_TOGGLES.map((toggle) => String(toggle.key)).sort();
    expect(exposed).toEqual(declared);
  });

  it('设置页没有重复的开关项', () => {
    const keys = MARKDOWN_TOGGLES.map((toggle) => toggle.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('每个开关都有可读的中文标签', () => {
    for (const toggle of MARKDOWN_TOGGLES) {
      expect(toggle.label.trim()).not.toBe('');
    }
  });
});
