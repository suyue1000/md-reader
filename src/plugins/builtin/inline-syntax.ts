import deflist from 'markdown-it-deflist';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import { full as emoji } from 'markdown-it-emoji';
import type { MarkdownPlugin } from '@/types';

/**
 * 行内 / 块级语法扩展。
 *
 * 每个能力单独一个插件对象而不是打包成一个「GFM 插件」，
 * 是为了让设置页可以逐项开关（需求第 9 节），且开关粒度与 id 一一对应。
 */

/** 高亮 ==text== */
export const markPlugin: MarkdownPlugin = {
  id: 'highlight',
  name: '高亮',
  description: '支持 ==高亮文本== 语法',
  order: 10,
  isEnabled: (settings) => settings.markdown.highlight,
  setup: (md) => {
    md.use(mark);
  },
};

/** 下标 H~2~O */
/** 上标 x^2^ —— 与下标共用一个开关，用户心智里它们是一对 */
export const subSupPlugin: MarkdownPlugin = {
  id: 'subSup',
  name: '上标 / 下标',
  description: '支持 H~2~O 与 x^2^ 语法',
  order: 11,
  isEnabled: (settings) => settings.markdown.subSup,
  setup: (md) => {
    md.use(sub).use(sup);
  },
};

/** 定义列表 */
export const deflistPlugin: MarkdownPlugin = {
  id: 'deflist',
  name: '定义列表',
  description: '支持 term / : definition 语法',
  order: 12,
  isEnabled: (settings) => settings.markdown.deflist,
  setup: (md) => {
    md.use(deflist);
  },
};

/** 脚注 */
export const footnotePlugin: MarkdownPlugin = {
  id: 'footnote',
  name: '脚注',
  description: '支持 [^1] 脚注引用与定义',
  order: 13,
  isEnabled: (settings) => settings.markdown.footnote,
  setup: (md) => {
    md.use(footnote);
  },
};

/** 任务列表 */
export const taskListPlugin: MarkdownPlugin = {
  id: 'taskList',
  name: '任务列表',
  description: '支持 - [ ] / - [x] 复选框',
  order: 14,
  isEnabled: (settings) => settings.markdown.taskList,
  setup: (md) => {
    // 阅读器不修改源文件，因此复选框保持只读
    md.use(taskLists, { enabled: false, label: true });
  },
};

/** Emoji */
export const emojiPlugin: MarkdownPlugin = {
  id: 'emoji',
  name: 'Emoji',
  description: '支持 :smile: 短代码',
  order: 15,
  isEnabled: (settings) => settings.markdown.emoji,
  setup: (md) => {
    md.use(emoji);
  },
};
