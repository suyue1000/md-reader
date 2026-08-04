import type { ReadingTheme, ThemeRegistry } from '@/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('theme-registry');

/**
 * 阅读主题注册表。
 *
 * 与 Markdown 插件注册表同一套模式：新增一套配色只需要写一个模块并注册，
 * 设置页的选项、令牌应用逻辑都不需要改动。
 *
 * 与插件注册表的一处差别：这里按**注册顺序**返回而不是排序。
 * 主题之间没有依赖关系，注册顺序就是设置页里的展示顺序，
 * 由清单文件的书写顺序决定，比再引入一个 order 字段直观。
 */
class DefaultThemeRegistry implements ThemeRegistry {
  private readonly themes = new Map<string, ReadingTheme>();

  register(theme: ReadingTheme): void {
    if (this.themes.has(theme.id)) {
      log.warn(`主题 ${theme.id} 被重复注册，后者覆盖前者`);
    }
    this.themes.set(theme.id, theme);
  }

  get(id: string): ReadingTheme | undefined {
    return this.themes.get(id);
  }

  all(): readonly ReadingTheme[] {
    return [...this.themes.values()];
  }
}

/** 全局唯一注册表实例 */
export const themeRegistry: ThemeRegistry = new DefaultThemeRegistry();

/** 创建独立注册表（单元测试用，避免测试间互相污染） */
export function createThemeRegistry(): ThemeRegistry {
  return new DefaultThemeRegistry();
}
