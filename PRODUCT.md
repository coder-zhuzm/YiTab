# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

高频使用浏览器、同时处理几十上百个标签页的研发与知识办公人员。日常高频在公网开发文档/工单系统（GitHub、Sentry、Docs）与公司内网服务/本地端口（`localhost`、`10.x.x.x`、`.corp`、`.oa`、`.lan`）之间切换。

## Product Purpose

让浏览器成为无感且高效的个人工作台，而非卡顿与重复标签堆砌的源头。帮助用户实现高频站点的毫秒级直达、重复打开标签的自动拦截或优雅切换、闲置标签与混乱书签的自动化治理。

## Positioning

- **双层无感去重**：整页导航前拦截与单页应用（SPA）Shadow DOM 页内浮窗并存，完整保留 `#inbox` 等 Hash 路由并智能剥离追踪参数，站内跳转不抢夺用户当前输入焦点。
- **内网与端口优先直达**：在工作台输入私有 IP、`localhost` 或内网域时优先识别并直达导航，避免被地址栏误送入公共搜索引擎。
- **全键盘流与零外网本地隐私**：全程支持 `/`、`↑↓`、`Enter`、`Esc`、`Alt/Cmd+Shift+K` 键盘操作；100% 本地运行（Chrome MV3 + Chrome `_favicon` + 本地 Gemini Nano 端侧模型），不向任何外部服务器发送浏览或书签数据。

## Operating Context

- **核心高频入口（第一阶段视觉重构目标）**：
  1. **NewTab 工作台**（`src/entrypoints/newtab/`）：每日打开新标签页即达，含时钟问候与会话上下文、全能搜索/网址直达、办公内网/个人模式切换、分组快捷磁贴（支持拖拽排序与右键分组）、最近工作区「继续上次」微胶囊、会话现场唤醒、平铺书签矩阵。
  2. **全局命令面板**（`src/entrypoints/content.ts`，Shadow DOM）：任意网页通过 `Alt/Cmd+Shift+K` 唤出，支持标签/指令/书签/历史全局检索、`Tab` 切分类、回车切换或直接关闭标签。
  3. **SPA 路由轻量浮窗**（`src/entrypoints/content.ts`，Shadow DOM）：单页应用内部跳转命中重复标签时右上角轻提示，带自动倒计时与一键切换/留在当前页。
- **次级工具面板（后续阶段对齐）**：Toolbar Popup（`src/entrypoints/popup/`）、拦截确认页 Confirm（`src/entrypoints/confirm/`）、控制中心 Options（`src/entrypoints/options/`）。

## Capabilities and Constraints

- **技术栈**：WXT + React 18 + TypeScript (Strict) + Ant Design 5（Chrome MV3 扩展，最低 Chrome 116）。
- **硬性约束**：
  - 严禁加载外部 CDN 字体、脚本或远程图标请求（100% 本地运行）。
  - 完整保留所有现有业务逻辑、存储结构、151 项单元测试与快捷键绑定。
  - 同时支持**浅色 / 深色 / 跟随系统**三态实时切换。
  - 保留 `scripts/capture-previews.mjs` 高清双模式预览截图管线，重构完成后需刷新对应截图并人工查验。
- **视觉改造权限**：可重构或替换高频入口中的默认组件样式与结构，打造统一、非模板化的效率工具视觉语言。

## Brand Commitments

- **产品名称**：YiTab 一签
- **界面语言**：简体中文为主，技术标识符（URL、端口、域名、快捷键）保持精准原样。
- **已选定审美方向**：**方向 A · 精密极客工具风（Precision Slate）**——克制冷静的灰阶/石墨表面层级、1px 细腻结构线、极少且精准的强调色、专业级键盘流与等宽数据排版，去除 AI 紫蓝渐变与通用卡片堆叠感。

## Evidence on Hand

- 现有视觉预览基线：`docs/images/yitab-preview-*.png`（含亮/暗双模式截图）。
- 自动化构建与测试命令：`npm run compile`、`npm test`、`npm run build`、`npm run screenshot`。

## Product Principles

1. **工具隐身于任务之后（Earned Familiarity）**：界面不靠花哨渐变与装饰抢戏，而是靠信息密度、对比度与可预测的状态反馈加速操作。
2. **极速冷启动与零阻塞键盘流**：首屏直接出内容，核心路径均可不离键盘完成。
3. **单一视觉语言贯穿多端**：无论是主工作台还是注入宿主网页的 Shadow DOM 浮窗，均呈现同一款精密工具的统一手感。
4. **本地隐私与资源克制**：零外部网络依赖，动效仅服务于状态传达并尊重 `prefers-reduced-motion`。
