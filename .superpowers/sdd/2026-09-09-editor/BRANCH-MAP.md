# 全分支改动地图（16fcce9..56b4687，43 个提交）

配合 review-16fcce9..56b4687.diff（907KB）使用：先看这份地图定位，再按需读大文件的对应段落。

## 提交清单（按时间正序）

60c0355 docs: 编辑能力设计 spec
0cca897 docs: 编辑能力实现计划
1514468 feat: 引入 CodeMirror 6 依赖
6905eb9 fix: 更新 vite.config.ts 注释，改为前瞻式写法
eb88543 feat: 顶层块切分
c28d728 fix: 补充注释和嵌套容器测试用例
f481015 feat: 按块渲染并保留跨块上下文
8fd0c1b feat: 块 DOM 缓存
02a3027 feat: 块级实时预览装饰
2c3edaa docs: 补充 editable 与 readOnly 独立性的注释
32157a9 feat: 用 CodeMirror 视图替换分块渲染的正文
489ed42 fix: 主题切换刷新视口外缓存块、惰性创建块缓存、去掉宿主的 h-full
a2f250c refactor: 阅读位置改为行号定位
3f18108 fix: 阅读位置恢复需要等首轮渲染与增强完成
edd1052 fix: 增强等待改用 allSettled 加超时，用户滚动检测改为比对写入值
20e0046 refactor: 目录跳转与滚动同步改为行号定位
d4f9905 fix: 锚点跳转优先于阅读位置恢复，到底判据抽成纯函数
06cdf04 修复正文锚点链接与锚点跳转的增强后落点校正
0509e78 fix: 块高度估算、地址栏 hash 同步与闩锁复位
9fcb079 fix: 丢弃上一版本结构的阅读位置记录
660453c fix: 重复块抢 DOM 节点、重开文档目录变空，并校正块高度常量
c386914 fix: 订正块高度常量的归因，并给 openEpoch 接线补上用例
69b560b fix: 让显式导航像用户滚动一样使阅读位置恢复撤防
1d2eac2 fix: 把「显式导航」这个抽象补全，并给它写明判定标准
dafaf23 refactor: 查找改用 CodeMirror 源文本搜索，高亮改按块重画
6ba7229 test: 补上重画机制的用例，并订正两处未经查证的注释归因
f55a92b refactor: 导出与打印改用离屏渲染
4c4a978 fix: 打印等图片解码，并补上两处零覆盖的用例
0bb9fe0 refactor: 删除分块渲染残留，并完成阶段 A 整体验收
c0fd594 docs: 补做阶段 A 的新旧构建对照与生产保存分支实测，并查证 trap 成因
2cb8ef8 feat: 编辑设置分组
6794e67 feat: 编辑态开关与写权限申请
211c9e0 fix: 编辑态点击落点、选区、自动刷新护栏与 defaultMode 接线
ee7ba10 fix: 修正 eq() 机制归因、去除虚假的 ⌘S 承诺、统一块首落点
a07bc8e fix: 围栏代码块的点击落点改到开栅栏下一行
d1a06a4 fix: 修复拖选回归，空代码块落点改到开栅栏行尾
7358dab feat: 保存决策
bc2039b feat: 保存执行、自写登记与版本缓冲
33b3bbd feat: 外部改动的冲突判定
f5dad21 test: 补顺序红线常驻断言与 useAutoRefresh hook 级测试
c776593 feat: 自动保存、脏状态与关页拦截
a585c45 fix: 修掉快捷键导出/打印用陈旧内容、写盘期间换文档两处缺陷
56b4687 docs: 更新编辑能力相关文案

## 改动统计

 README.md                                          |   30 +-
 STORE.md                                           |   48 +-
 docs/superpowers/plans/2026-09-09-editor.md        | 3356 ++++++++++++++++++++
 docs/superpowers/specs/2026-09-09-editor-design.md |  349 ++
 package-lock.json                                  |  239 ++
 package.json                                       |    9 +-
 public/_locales/zh_CN/messages.json                |    2 +-
 src/components/layout/AppShell.tsx                 |    2 +
 src/components/layout/ConflictBanner.test.tsx      |  170 +
 src/components/layout/ConflictBanner.tsx           |   75 +
 src/components/layout/StatusBar.test.tsx           |  111 +
 src/components/layout/StatusBar.tsx                |  110 +-
 src/components/markdown/MarkdownView.tsx           |  160 -
 src/components/reader/BackToTop.test.tsx           |   67 +
 src/components/reader/BackToTop.tsx                |   13 +-
 src/components/search/SearchBar.tsx                |    2 +-
 src/components/settings/SettingsPanel.tsx          |    2 +
 src/components/settings/sections/EditorSection.tsx |  123 +
 src/components/settings/settings-coverage.test.ts  |   13 +
 src/components/toc/TocItem.tsx                     |   10 +-
 src/components/toc/TocPanel.test.tsx               |  141 +
 src/components/toc/TocPanel.tsx                    |   50 +-
 src/editor/EditorContext.test.tsx                  |   81 +
 src/editor/EditorContext.tsx                       |   74 +
 src/editor/MarkdownEditor.test.tsx                 |  208 ++
 src/editor/MarkdownEditor.tsx                      |  444 +++
 src/editor/block-cache.test.ts                     |  162 +
 src/editor/block-cache.ts                          |  167 +
 src/editor/block-height.test.ts                    |  156 +
 src/editor/block-height.ts                         |  309 ++
 src/editor/block-render.test.ts                    |   80 +
 src/editor/block-render.ts                         |   99 +
 src/editor/block-slice.test.ts                     |   74 +
 src/editor/block-slice.ts                          |   81 +
 src/editor/conflict.test.ts                        |   87 +
 src/editor/conflict.ts                             |   85 +
 src/editor/enhance.test.ts                         |  144 +
 src/editor/enhance.ts                              |   65 +
 src/editor/live-preview.test.ts                    |  575 ++++
 src/editor/live-preview.ts                         |  460 +++
 src/editor/offscreen-render.test.ts                |  138 +
 src/editor/offscreen-render.ts                     |   97 +
 src/editor/save-target.test.ts                     |   55 +
 src/editor/save-target.ts                          |   48 +
 src/editor/save.test.ts                            |  205 ++
 src/editor/save.ts                                 |  164 +
 src/editor/self-write.test.ts                      |   26 +
 src/editor/self-write.ts                           |   38 +
 src/editor/smoke.test.ts                           |   10 +
 src/editor/theme.ts                                |   41 +
 src/editor/versions.test.ts                        |   34 +
 src/editor/versions.ts                             |   44 +
 src/export/dom-snapshot.ts                         |   43 +-
 src/export/download.ts                             |   20 +-
 src/export/export.test.ts                          |  275 +-
 src/export/index.ts                                |  125 +-
 src/hooks/index.ts                                 |    2 +-
 src/hooks/unsaved-guard.test.tsx                   |  144 +
 src/hooks/useAutoRefresh.test.tsx                  |  165 +
 src/hooks/useAutoRefresh.ts                        |   74 +-
 src/hooks/useAutoSave.test.tsx                     |  434 +++
 src/hooks/useAutoSave.ts                           |  304 ++
 src/hooks/useEditMode.test.tsx                     |  123 +
 src/hooks/useEditMode.ts                           |  129 +
 src/hooks/useEmbeddedDocument.test.ts              |  180 ++
 src/hooks/useEmbeddedDocument.ts                   |   89 +-
 src/hooks/useExport.test.tsx                       |  266 ++
 src/hooks/useExport.ts                             |  120 +-
 src/hooks/useGlobalHotkeys.test.tsx                |  228 ++
 src/hooks/useGlobalHotkeys.ts                      |   17 +-
 src/hooks/useMarkdownRender.ts                     |  180 --
 src/hooks/useOpenFile.ts                           |    4 +
 src/hooks/usePendingAnchor.test.tsx                |  338 ++
 src/hooks/usePendingAnchor.ts                      |  228 +-
 src/hooks/useReadingPosition.test.tsx              |  365 +++
 src/hooks/useReadingPosition.ts                    |  398 ++-
 src/hooks/useRelativeLinks.test.tsx                |  328 ++
 src/hooks/useRelativeLinks.ts                      |  147 +-
 src/hooks/useScrollSpy.ts                          |  192 +-
 src/hooks/useSearch.test.tsx                       |  313 ++
 src/hooks/useSearch.ts                             |  260 +-
 src/hooks/useToolbarActions.ts                     |  123 +-
 src/hooks/useWorkspace.ts                          |    4 +
 src/markdown/chunker.test.ts                       |   77 -
 src/markdown/chunker.ts                            |  124 -
 src/markdown/contract.ts                           |   91 +-
 src/markdown/renderer.bench.ts                     |   28 +-
 src/markdown/renderer.test.ts                      |   92 -
 src/markdown/renderer.ts                           |  127 +-
 src/markdown/toc.test.ts                           |  111 +-
 src/markdown/toc.ts                                |   98 +-
 src/plugins/builtin/code-block.test.ts             |  136 +
 src/plugins/builtin/code-block.ts                  |  153 +-
 src/search/block-highlight.ts                      |  332 ++
 src/search/highlight.ts                            |  180 --
 src/search/matcher.ts                              |   72 +-
 src/search/search.test.ts                          |  107 +-
 src/stores/document.store.ts                       |  225 +-
 src/stores/settings.store.test.ts                  |   41 +-
 src/stores/settings.store.ts                       |   12 +
 src/styles/markdown.css                            |   20 +
 src/styles/print.css                               |   24 +
 src/styles/print.test.ts                           |   89 +
 src/test/setup.ts                                  |   59 +
 src/types/document.ts                              |   27 +-
 src/types/export.ts                                |   39 +-
 src/types/plugin.ts                                |   13 +
 src/types/settings.ts                              |   50 +-
 src/utils/auto-refresh.test.ts                     |   65 -
 src/utils/auto-refresh.ts                          |   56 -
 src/utils/file-open.test.ts                        |   70 +-
 src/utils/file-open.ts                             |   32 +
 src/utils/reading-position.test.ts                 |  182 +-
 src/utils/reading-position.ts                      |   90 +-
 src/utils/scroll-math.test.ts                      |   93 +
 src/utils/scroll-math.ts                           |   77 +
 src/utils/scroll-settle.test.ts                    |   98 +
 src/utils/scroll-settle.ts                         |   75 +
 src/utils/settle-with-timeout.test.ts              |   41 +
 src/utils/settle-with-timeout.ts                   |   19 +
 src/viewer/App.tsx                                 |   15 +-
 src/viewer/pages/ReaderPage.test.tsx               |  380 +++
 src/viewer/pages/ReaderPage.tsx                    |  129 +-
 vite.config.ts                                     |   19 +-
 124 files changed, 16830 insertions(+), 1889 deletions(-)
