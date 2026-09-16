# Task 18 审查记录

## 一、两条合规事项

### (1) 权限用途说明「只读」表述
- `git grep -n 只读 README.md STORE.md package.json public/_locales/` 仅剩一处命中：`STORE.md:165`，语境是「**不能再写「只读」**——扩展现在支持编辑……」，这是审查提示句，不是残留的失实声明。
- `host_permissions: file:///*` 的用途说明改为「用于读取用户主动打开的文件及其所在目录」，不再写「只读」；新增独立小节「文件写入（File System Access API，不在 manifest 权限清单里）」，据实说明写入是运行时 Web API 授权、非 manifest 权限，写入目标限于用户主动打开的文件，拒绝后降级为另存，方式三跨源 iframe 下无法写回。
- 结论：**据实**，未发现「既说只读又说能编辑」的前后矛盾残留。

### (2) storage 用途说明 —— 六项 vs 七项
- 对照 `src/types/settings.ts` 的 `EditorSettings`，Task 12 实际新增字段为 7 个：`autoSave`、`autoSaveDelay`、`defaultMode`、`showLineNumbers`、`tabSize`、`indentWithTabs`、`keepVersions`。
- 检查 `STORE.md` 实际提交文本（storage 段落）：「是否自动保存、自动保存的停笔延迟、打开文档时默认进入编辑还是阅读态、编辑态是否显示行号、缩进方式、内存版本缓冲保留几份」——逐一对应：autoSave / autoSaveDelay / defaultMode / showLineNumbers / **(tabSize+indentWithTabs 合并为「缩进方式」)** / keepVersions。**7 个字段实际全部被覆盖**，只是 `tabSize` 与 `indentWithTabs` 被合并成一个描述短语「缩进方式」。
- 但**报告正文**（task-18-report.md 第 8、29 行）两次自称补的是「六项」，并在第 29 行逐项列举时也是把 `tabSize`/`indentWithTabs` 并成一项来凑数，对外仍称「六项」。这是报告叙述与实际字段数的计数错误（工作产物本身没有遗漏字段，只是报告里的数字和说法不准确）。
- 全仓库 grep 「六项」「七项」：命中只在 task-18-report.md 里，README.md/STORE.md 正文都没有出现这个数字，所以**不构成对外文案的失实**，但属于交付报告自查不严谨，建议纠正说法（工作是对的，说法应改为「七项，其中缩进相关的两项合并成一句话描述」）。

## 二、三条代价是否如实写明
1. 自动保存写真实磁盘文件、无回收站；版本缓冲仅内存、刷新即失——README「安装」节「编辑与保存」小节与 STORE.md 隐私政策都写了，且 STORE.md 补充说明了「为什么不写入本地存储」（避免留存用户文档历史，越过零网络承诺边界），与 `src/editor/versions.ts:8` 的实现注释「这是刻意的：把用户文档的历史副本悄悄写进……」一致。**如实**。
2. 方式三（浏览器直开 .md，跨源 iframe）无法写回，⌘S 退化为下载——README 新增专门加粗提示，STORE.md 详细描述、权限说明、上传前自查清单都提到。**如实**，且指出了替代方案（方式一/二）。
3. 首次编辑触发写入权限请求，拒绝后仍可编辑但只能另存——README「编辑与保存」小节、常见问题新增条目、STORE.md 权限说明都写了。**如实**。

三条代价均未被回避或淡化，且都给出了用户可执行的后续路径（换入口 / 用 Git 管理历史 / 另存），符合「必须如实写明代价」的要求。

## 三、零网络请求核实
- 独立核查 `src/editor/versions.ts` 注释，确认版本缓冲不落盘的动机记录一致。
- `grep -rn "fetch(\|XMLHttpRequest\|WebSocket\|navigator.sendBeacon" src/editor src/export src/utils`：唯一命中是 `src/utils/file-listing.ts` 用 `XMLHttpRequest` 读取 `file://` 目录列表（用于「同目录文档」功能，非本任务改动、非网络请求，注释里写明是因为 Chrome 的 `fetch` 不支持 `file` 协议）。编辑/保存路径（`src/editor/*`、`saveFile`/`FileSystemFileHandle`）里没有任何网络 API 调用。
- 检查 `dist/background.js`、`dist/content.js`（`npm run package` 产物）：无 `fetch`/`XMLHttpRequest`/`WebSocket`/`http(s)://` 字面量（排除 sourceMappingURL 注释）；`manifest.json` CSP 为 `script-src 'self'`，无远程代码、无 `content_security_policy` 放开外部脚本，`permissions` 仍只有 `storage`，`host_permissions` 仍只有 `file:///*`。
- 结论：**零网络请求承诺经独立复核成立**，编辑与保存链路未引入任何网络行为，产物里也未混入联网代码。

## 四、7 条验收标准核对的诚实度
- 报告如实标注了两条真实缺口（第 4 条冲突提示未做真实浏览器端到端验证；第 5 条无句柄跨源 iframe 下载链路只有单测覆盖），并且**主动指出**这是「本轮核对中发现的、比 task-17 报告自己承认的缺口更靠前一步的未验证点」——这个自我加码的坦白态度是可信的信号。
- 定性准确：这两条确实是「平时走不到、一旦走到就必须对」的分支（冲突覆盖=数据丢失风险，下载降级=用户以为保存了实际没保存的风险），风险等级高，报告也用了这个措辞，判断到位。
- 其余 5 条中，第 1、2、6、7 条都点名了具体的真实浏览器操作记录（headless Chrome + CDP、真实 Chrome 153、磁盘外读回比对），不是简单地把单测通过当验收通过；第 3 条更进一步坦白承认「第一次的绿不能算数」，体现了对本项目历史上「测试全绿但功能是坏的」教训的warily 态度。这种颗粒度的自我核查在这类文档收尾任务里是少见的严谨，可信度高。
- 未发现把单测结果包装成「真实浏览器已验证」的情况。

## 五、版本号
- `package.json:4` = `0.1.0`，`public/manifest.json:4` = `1.0.0`，`npm run package` 按 manifest 版本号产出 `md-reader-v1.0.0.zip`。
- 商店审核与用户可见的版本号来自 manifest（Chrome Web Store 用 manifest.json 的 version 字段做版本管理与「不接受重复版本」校验），`package.json` 的 version 仅供 npm/内部工具链使用，两者语义不同、不要求一致，但**当前处于两者都在被使用又互相矛盾的状态**（0.1.0 读起来像「未发布的早期版本」，与「即将上架 1.0.0」的商店定位冲突，容易让阅读仓库的人产生误判）。
- 建议：合并前把 `package.json` 的 version 与 manifest 对齐到 `1.0.0`（或至少建立「manifest 是唯一真源、package.json 版本号仅供工具链参考」的显式约定并写进 STORE.md 或 README），避免下一次发布时再次出现「改了哪个」的疑问。这不是本任务引入的问题，不构成 Critical，但既然项目正要打包上架，建议在合并前顺手处理，否则会一直带着这个不一致进商店。

## 六、超出简报范围的改动
- 对照 brief 四个改动文件（README.md / STORE.md / messages.json / package.json），diff 完全落在这四个文件内，没有触碰任何生产代码（`src/`、`public/manifest.json` 均未改动）。
- STORE.md 里「自动刷新」表述从「外部编辑器改完保存」改为「文件在别处被改动」，以及新增「冲突不会静默覆盖」的措辞——严格说超出了 brief Step 3 字面要求（brief 只要求「补上编辑能力，保留零联网承诺」），但报告在正文里主动说明了改动理由（避免暗示「本扩展不能编辑」、避免遗漏自写回环判定），且是同一批对外文案一致性修正的自然延伸，判断为合理的必要修订，不算越界。

## 七、文案风格与是否过度承诺
- 未发现将「仅在某些入口成立的能力」泛化为普遍成立的表述——凡是方式三的限制，文案都专门标注了「仅此入口」；凡是拒绝权限的降级，都写清楚仍可编辑、只是另存。
- 风格与既有 README 一致：短句、具体机制（防抖毫秒数、逐字节不变、跨源 iframe 原因）、不使用营销式形容词，延续了「克制、具体」的既有基调。

## 结论

**规范符合性**：✅ 符合（改动范围、文案语言、提交信息格式均满足简报与项目约束；`npm run verify` 57/562 全绿，`npm run package` 产出成功）。

**任务质量**：**批准**。

问题清单：
- **Important**：task-18-report.md 中「Task 12 六项编辑设置」的计数不准确，实际是 7 个字段（`tabSize`/`indentWithTabs` 被合并叙述）。STORE.md 正文本身内容无遗漏，但报告的自查数字应更正，避免后续误认为还有一项设置没写进用途说明里。
- **Minor**：`package.json`（0.1.0）与 `public/manifest.json`（1.0.0）版本号不一致，非本任务引入，但项目即将上架，建议合并前统一或明确「以 manifest 为准」的约定。
- 未发现 Critical 问题。

**是否存在不实陈述（可提交商店审核）**：**没有发现不实陈述**。两条合规声明（权限用途、storage 用途）经核对与实现一致；三条代价据实写明；零网络请求承诺经独立复核成立；验收标准核对诚实呈现了两条真实缺口而非掩盖。唯一需要修正的是内部报告里「六项」这个计数用词不准，但这不影响提交给商店审核的对外文案本身的真实性。
