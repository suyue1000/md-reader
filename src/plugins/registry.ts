import type { MarkdownPlugin, PluginId, PluginRegistry, Settings } from '@/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('plugin-registry');

/**
 * Markdown 插件注册表。
 *
 * 核心渲染器只认识 `MarkdownPlugin` 接口，不认识具体插件。
 * 新增 PlantUML / ECharts 等能力时：写一个模块 -> `registry.register(plugin)`，
 * 渲染管线零改动。这就是需求里「插件化、无需修改核心代码」的落点。
 */
class DefaultPluginRegistry implements PluginRegistry {
  private readonly plugins = new Map<PluginId, MarkdownPlugin>();
  /** 排序结果缓存，注册表变更时失效 */
  private sortedCache: readonly MarkdownPlugin[] | null = null;

  /** 注册插件；重复 id 会覆盖并告警，便于开发期发现冲突 */
  register(plugin: MarkdownPlugin): void {
    if (this.plugins.has(plugin.id)) {
      log.warn(`插件 ${String(plugin.id)} 被重复注册，后者覆盖前者`);
    }
    this.plugins.set(plugin.id, plugin);
    this.sortedCache = null;
  }

  /** 注销插件 */
  unregister(id: PluginId): void {
    this.plugins.delete(id);
    this.sortedCache = null;
  }

  /** 按 id 取插件 */
  get(id: PluginId): MarkdownPlugin | undefined {
    return this.plugins.get(id);
  }

  /** 按 order 升序返回全部插件 */
  all(): readonly MarkdownPlugin[] {
    if (!this.sortedCache) {
      this.sortedCache = [...this.plugins.values()].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100),
      );
    }
    return this.sortedCache;
  }

  /** 返回在当前设置下启用的插件 */
  enabled(settings: Settings): readonly MarkdownPlugin[] {
    return this.all().filter((plugin) => plugin.isEnabled?.(settings) ?? true);
  }
}

/** 全局唯一注册表实例 */
export const pluginRegistry: PluginRegistry = new DefaultPluginRegistry();

/** 创建独立注册表（单元测试用，避免测试间互相污染） */
export function createPluginRegistry(): PluginRegistry {
  return new DefaultPluginRegistry();
}
