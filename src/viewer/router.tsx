import { useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * 极简 hash 路由。
 *
 * 为什么不用 react-router：
 * 1. 阅读器只有「阅读 / 欢迎 / 导出预览」这种整页级视图，路由需求是几十行的量；
 * 2. `chrome-extension://` 页面没有服务端 history fallback，只能用 hash；
 * 3. react-router 全系列版本都带有针对 SSR/RSC 场景的公开漏洞告警，
 *    虽然与本项目的纯客户端 hash 场景无关，但会让 `npm audit` 长期不干净。
 *
 * 保留了与 react-router 一致的心智模型（路由表 + navigate），
 * 后续若确实需要嵌套路由、loader 等能力，可以按同一套 API 平滑替换回去。
 */

/** 路由定义 */
export interface RouteDefinition {
  /** 路径，以 `/` 开头 */
  path: string;
  /** 该路径渲染的视图 */
  element: ReactNode;
}

/**
 * 读取当前 hash 对应的路径。
 *
 * 约定：**路由 hash 一律以 `/` 开头**，其余一切（`#某个标题`）都视为文档锚点。
 * 这条约定是必须的——目录跳转、标题锚点链接都会写 hash，如果不加区分，
 * 每次点目录都会被当成一次路由跳转。
 *
 * @returns 路由路径；当前 hash 是文档锚点时返回 null，表示路由不该变化
 */
function readPath(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '') return '/';
  return hash.startsWith('/') ? hash : null;
}

/** 跳转到指定路径 */
export function navigate(path: string): void {
  window.location.hash = path;
}

/** 订阅当前路径 */
export function useRoutePath(): string {
  const [path, setPath] = useState(() => readPath() ?? '/');

  useEffect(() => {
    const handleHashChange = (): void => {
      const next = readPath();
      // 文档锚点不改变路由，交给浏览器原生滚动处理
      if (next !== null) setPath(next);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return path;
}

/** 按当前路径渲染匹配的视图，未匹配时渲染 fallback */
export function RouterOutlet({
  routes,
  fallback,
}: {
  routes: readonly RouteDefinition[];
  fallback: ReactNode;
}): React.JSX.Element {
  const path = useRoutePath();
  const matched = useMemo(
    () => routes.find((route) => route.path === path)?.element,
    [routes, path],
  );
  return <>{matched ?? fallback}</>;
}
