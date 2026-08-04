import anchor from 'markdown-it-anchor';
import type { MarkdownPlugin } from '@/types';
import { Slugger } from '@/markdown/slugger';

/** 挂在 env 上的 Slugger 键 */
const SLUGGER_KEY = '__mdReaderSlugger';

/** env 的最小形状：markdown-it 把它声明成 any，这里收窄到实际用到的部分 */
interface SluggerEnv {
  [SLUGGER_KEY]?: Slugger;
}

/**
 * 取得与本次渲染绑定的 Slugger。
 *
 * 挂在 `env` 上而不是插件闭包里，是分块渲染的要求：一篇文档会被切成
 * 多次 `md.parse()`，而它们共用同一个 env。放闭包里则所有文档共用一个
 * 计数器，换文档不清零；放 parse 内部（markdown-it-anchor 的默认行为）
 * 则每块从头计数，第二块里的同名标题会拿到和第一块相同的 id。
 */
function sluggerFor(env: SluggerEnv): Slugger {
  return (env[SLUGGER_KEY] ??= new Slugger());
}

/**
 * 标题锚点。
 *
 * order 设为 1：必须最先注册，因为目录抽取依赖 heading token 上的 id，
 * 而 id 是这个插件写进去的。
 */
export const anchorPlugin: MarkdownPlugin = {
  id: 'anchor',
  name: '标题锚点',
  description: '为每个标题生成可跳转的 id 与锚点链接',
  order: 1,
  setup(md) {
    md.use(anchor, {
      // 自己保证唯一性（含跨块），markdown-it-anchor 内部那份按 parse 重置的
      // 去重表因此永远命不中，等于被旁路掉
      slugifyWithState: (text: string, state: { env: SluggerEnv }) =>
        sluggerFor(state.env).slug(text),
      uniqueSlugStartIndex: 1,
      permalink: anchor.permalink.linkInsideHeader({
        symbol: '#',
        placement: 'before',
        class: 'heading-anchor',
        ariaHidden: true,
      }),
    });
  },
};
