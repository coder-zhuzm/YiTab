# YiTab 一签

> 围绕 Chrome 标签页与书签的效率工具套件。第一个功能：**打开重复标签前拦截，自动切换或一键确认。**

[![Chrome](https://img.shields.io/badge/Chrome-MV3-blue)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![React](https://img.shields.io/badge/React-18-61dafb)](https://react.dev)
[![WXT](https://img.shields.io/badge/Built%20with-WXT-5a0fc8)](https://wxt.dev)

## 这解决了什么问题

日常开网页时经常遇到「这个页面我是不是已经开过了？」——靠人眼翻标签太累，等发现重复时已经堆了一堆。YiTab 在你**照常使用**（地址栏输入、点书签、点链接、中键新开）的同时自动完成判断：

- **没有重复** → 什么都不发生，体验零变化
- **发现重复** → 按你选的模式处理：
  - **静默切换**（默认）：自动跳到已有标签，新开的标签一闪即逝
  - **页内确认**：新标签原地变成大按钮确认页，一眼看到已有标签的标题/图标，「切换过去」「仍要新开 ↗」点一下即可（支持 `Enter` / `Esc`）

## 界面预览

### 1. 拦截确认页（整页导航拦截）
> 当你在地址栏、书签、或外部链接打开已有标签时自动拦截。顶部磨砂吸顶操作栏确保按钮永远触手可及，配合等宽 URL 结构高亮和立体 `<kbd>` 快捷键提示。

<p align="center">
  <img src="./docs/images/yitab-preview-confirm.png" alt="YiTab 拦截确认页预览" width="850" />
</p>

### 2. SPA 站内路由悬浮提示（非侵入式轻量拦截）
> 针对现代单页应用（GitHub、Jira、各类管理控制台）的前端路由跳转，采用隔离 Shadow DOM 灵动岛通知条，不刷新、不破坏当前页面状态与输入内容。

<p align="center">
  <img src="./docs/images/yitab-preview-spa-toast.png" alt="YiTab SPA 站内路由悬浮提示预览" width="560" />
</p>

### 3. 设置中心（全局与细粒度网站规则）
> 提供 2x2 交互式匹配模式网格（智能 Smart、完整 URL、同路径 Path、同域名 Domain），带有实时代码芯片说明，支持参数忽略与域名例外规则。

<p align="center">
  <img src="./docs/images/yitab-preview-options.png" alt="YiTab 设置中心预览" width="850" />
</p>

## 特性

| 特性 | 说明 |
|---|---|
| 全入口与 SPA 覆盖 | 地址栏、书签、页内链接、中键新标签（`onCommitted`）以及单页应用路由跳转（`onHistoryStateUpdated`、`onReferenceFragmentUpdated`）统一检测 |
| 智能轻量确认 | 整页导航拦截至操作页；SPA 站内跳转采用非侵入式页内 Shadow DOM 悬浮提示，不卸载当前页面 |
| 可配置粒度 | 智能匹配（新安装默认）/ 完整地址 / 同路径 / 同域名，升级保留旧设置 |
| 网站规则 | 按精确域名或含子域覆盖匹配模式，智能模式可额外忽略指定参数 |
| 可解释匹配 | 确认页与悬浮提示展示目标与已有地址、匹配原因、命中的网站规则 |
| 确认页快捷操作 | 吸顶操作条（防卡片推挤）、URL 摘要折叠、单项/批量关闭、仅留此项、全键盘操作（`↵` / `Esc` / `↑` / `↓`） |
| Chrome 标签分组 | 支持在确认页为所选标签一键新建 Chrome 标签组（调色板配色）或加入当前窗口已有分组 |
| 可配置交互 | 静默切换 / 页内确认，随时切换 |
| 域名白名单 | 白名单域名永不拦截（如邮箱、协作工具） |
| 重定向精准放行 | 「仍要打开」针对目标 URL 与匹配特征放行 8 秒，http→https 及重定向链不再误拦，无关网址不越权放行 |
| 快 | 设置内存缓存 + 序列号防竞态 + 并行查询，检测「一闪即切」 |

## 安装（开发版）

```bash
git clone https://github.com/coder-zhuzm/YiTab.git
cd YiTab
pnpm install
pnpm build
```

构建产物在 `.output/chrome-mv3/`，Chrome → `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」选择该目录。

## 重复判定（0.3.0）

- **智能匹配**：比较协议、域名、端口、路径及内容参数。忽略 `utm_*`、`gclid`、`dclid`、`fbclid`、`msclkid`、`mc_cid`、`mc_eid`，未知参数默认保留。参数按名称排序，但同名多值顺序保留。路径大小写、尾斜杠和 www 不自动合并。
- **完整地址**：完整 URL 一致，保留查询参数顺序与锚点，不主动忽略参数。
- **同路径**：比较协议、域名、端口、路径，忽略所有查询参数。搜索词、视频 ID 也会被忽略，请谨慎使用。
- **同域名**：兼容旧行为，忽略路径、参数、协议、端口，www 与裸域名等价。适合限制同站点多开，不代表相同内容。

智能/同路径模式忽略简单页内锚点（如 `#comments`），保留 `#/...`、`#!/...` 和其他复杂 Hash。无法可靠识别所有 SPA 路由；例如 `#settings` 这种简单 Hash 路由，请为该网站选择完整地址模式。不同路径默认放行，不自动猜测重写路由或网页内容。

规则优先级：**白名单 → 最具体的网站规则 → 全局模式**。网站规则默认仅精确域名，可显式覆盖子域名；最长域名优先，同域名精确规则优先。额外忽略参数仅适用于智能模式，参数名精确区分大小写，不支持通配符，不应填 `id`、`v`、`q` 等内容标识。白名单保持旧版精确域名行为（www 等价），不自动覆盖其他子域名。

宽泛模式搭配静默切换可能误跳到不同内容，设置页会提示风险，建议搭配页内确认。现有用户的匹配和处理模式不会在升级时自动修改。「仍要新开」仍在后台登记 8 秒放行后原地导航，不关闭当前标签。

## 验证

使用 Node.js 22.6+（测试依赖原生 TypeScript stripping）：

```bash
npm test
npm run compile
npm run build
```

可选浏览器回归（需 `/usr/bin/chromium`）：`node tests/browser-smoke.mjs`。使用独立临时配置，不修改当前浏览器；验证设置保存、智能拦截、原因显示及「仍要新开」原地导航。

## 技术栈

- **WXT**：基于 Vite 的现代 WebExtension 框架，MV3 优先、HMR、entrypoint 约定式开发
- **React 18 + TypeScript**（strict）
- **Ant Design 5**：选项页 / 确认页 UI
- 核心逻辑独立于 UI（`src/lib/`）：`settings`（存储+缓存）、`match`（匹配规则）、`messaging`（消息协议），新功能以钩子形式接入检测管线

## 目录结构

```
src/
├── entrypoints/
│   ├── background.ts      # 后台：导航与 SPA 监听、去重决策、标签管理
│   ├── content.ts         # 内容脚本：SPA 路由重复页内轻量提示（Shadow DOM）
│   ├── confirm/           # 页内确认页（吸顶栏、摘要折叠、标签分组管理）
│   └── options/           # 设置页（React + AntD）
├── lib/
│   ├── settings.ts        # 设置模型、storage.sync + 内存缓存
│   ├── match.ts           # URL/域名匹配、归一化、白名单、MatchKey 计算
│   └── messaging.ts       # confirm/content/options ↔ background 消息协议与分组类型
└── public/icon.png
```

## Roadmap

YiTab 的目标是标签页/书签效率套件，按痛点分四条线：

### 1. 防堆积 ✅ 起步 / 持续增强
- [x] 重复标签检测（静默切换 / 页内确认）
- [ ] 标签挂起休眠：N 小时未访问自动释放内存，保留标题与 favicon
- [ ] 定时清理：清理 N 天未动的标签，清理前可预览

### 2. 快速检索与切换
- [ ] 全局命令面板：一个框搜「已开标签 + 书签 + 历史」，回车直达
- [ ] omnibox 增强：地址栏下拉插入自定义高亮建议

### 3. 自动整理
- [ ] 按域名自动分组（对接 Chrome 标签组）
- [ ] 会话快照：整窗保存为命名会话，一键恢复
- [ ] 书签去重 / 失效链接检测

### 4. 效率输出
- [ ] 一键复制所有标签为 URL / Markdown 列表
- [ ] 选中标签生成资料收集笔记（Markdown）

## License

[MIT](./LICENSE)
