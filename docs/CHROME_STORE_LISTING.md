# YiTab Chrome Web Store 上架申报与文案材料指南

本文档汇集了提交至 **Chrome Web Store Developer Dashboard** 时所需的所有文案、权限申述理由及隐私问卷答案。你可以直接复制各模块内容填入控制台。

---

## 模块 1：基本信息（Store Listing）

- **扩展名称（Extension Name）**：
  `YiTab 一签 - 标签页智能去重与效率套件`
  *(英文备用：`YiTab - Smart Tab Deduplication & Launcher`)*
- **简短说明（Summary / Short Description - 不超过 132 字符）**：
  - 中文：`打开重复网页时智能识别并切换或页内确认；内置 Alt+K 极速搜索面板、新标签页启动器与书签健康去重。`
  - 英文：`Detect duplicate tabs, switch instantly or confirm with in-page banner. Features Alt+K launcher and bookmark deduplication.`
- **主要类别（Category）**：
  `Productivity`（效率 / 生产力）
- **官方支持语言（Languages）**：
  `中文 (简体)`、`English`

---

## 模块 2：商店详细说明（Detailed Description）

你可以将以下文本直接粘贴至 Chrome Web Store 的 **详细说明（Detailed Description）** 输入框：

### 中文版本（建议默认）
```markdown
🚀 YiTab（一签）— 专为高效工作者打造的 Chrome 标签页去重与效率套件。

你是否经常遇到这些困扰？
- 在写代码、查文档、办公或写文章时，不知不觉开了一两百个标签页？
- 经常从 Slack/微信、邮件、书签反复打开同一个 Jira、GitHub PR、文档或视频，导致后台满是重复标签？
- 想要找一个刚刚打开过的页面，却在密密麻麻的标签栏里迷失？

YiTab 让你的 Chrome 恢复清爽高效：

✨ 核心功能亮点：

1. 智能标签去重与平滑拦截
- 无感直达或大按钮确认：打开重复链接时，可配置自动跳转至已有标签，或展示友好确认页由你决定。
- 4 种精细化匹配粒度：
  • 智能模式（推荐）：自动剥离 utm_*、fbclid、spm 等追踪参数，保留真实内容参数。
  • 完整地址（严格）：参数完全一致才判定为重复。
  • 同路径模式：忽略所有查询参数，同一路由视为重复。
  • 同域名模式：同站点一键归集。
- 智能白名单：为搜索引擎、文档对比等特殊网站单独配置放行规则。

2. 全局命令面板（Alt+K / Cmd+K）
- 在任何网页按下 Alt+K，即可唤起极速搜索面板。
- 毫秒级联合检索打开中的标签页、书签以及历史记录，键盘上下键极速跳转。
- 支持批量复制标签为 Markdown 格式列表、按域名自动一键分组（Tab Groups）。

3. 极速新标签页启动器（Smart Launcher）
- 模块化书签矩阵：按文件夹层级优雅归类，快速展开。
- 常开工作现场胶囊（Session Resume）：智能识别深层工作流路由，一键找回上下文。
- 零延迟秒级打开，无任何臃肿广告。

4. 书签生态治理与重复检测
- 智能扫描浏览器中因多次保存导致的重复或无效书签。
- 支持安全一键清理并导出 Netscape HTML / JSON 备份。

🔒 隐私第一承诺（100% Local-First）：
- YiTab 绝不收集、上传或出售您的任何个人浏览数据！
- 所有 URL 比对、书签检索与配置均在您的本地设备上离线运行。
- 代码完全开源透明：https://github.com/coder-zhuzm/YiTab
```

### 英文版本（供海外用户 / 英文环境使用）
```markdown
🚀 YiTab — The all-in-one smart tab deduplication and productivity suite for Google Chrome.

Tired of tab clutter? Frequently reopening duplicate GitHub PRs, Jira tickets, docs, or dashboards from chat messages and bookmarks? YiTab keeps your browser clean, organized, and lightning fast.

✨ Key Features:

1. Smart Tab Deduplication & Interception
- Seamless Switch or In-Page Confirmation: Jump directly to existing tabs or confirm with a high-contrast action card.
- 4 Granular Matching Modes:
  • Smart Mode (Recommended): Strips UTM, tracking tokens, and query noise while preserving content parameters.
  • Exact URL: Strict 1:1 match.
  • Same Path: Matches identical routes regardless of parameters.
  • Same Domain: Clustered by host.
- Whitelist Engine: Easily exempt search engines or multi-tab comparison tools.

2. Global Command Palette (Alt+K / Cmd+K)
- Hit Alt+K on any webpage to bring up the instant launcher.
- Millisecond multi-token search across open tabs, bookmarks, and history.
- One-click export open tabs as Markdown lists or cluster tabs into neat Chrome Tab Groups.

3. Smart Launcher New Tab
- Beautiful bookmarks matrix organized by folder hierarchy.
- Session resume capsules for deep workflow routes.
- Zero bloat, instant startup, and clean dark/light themes.

4. Bookmark Health & Deduplication
- Detect and safely merge duplicated or obsolete bookmarks with Netscape HTML / JSON backup exports.

🔒 Privacy First & 100% Offline:
- Zero data tracking. No analytics, no ads, no remote servers.
- All URL comparisons and bookmark queries are processed strictly on your local machine.
- 100% open source: https://github.com/coder-zhuzm/YiTab
```

---

## 模块 3：权限申报理由（Permission Justifications）

在 Chrome Web Store 开发者后台的 **“隐私权做法 (Privacy Practices)”** 页面中，需要针对每一项权限填写申述理由。以下为精准符合 Google 审查要求的双语理由：

### 1. `tabs`
- **英文（推荐直接填入）**：
  > Required to inspect open tabs' URLs and titles to detect whether a requested webpage is already open, and to switch focus to the existing tab upon user confirmation.
- **中文含义**：用于读取已打开标签页的 URL 和标题，判断当前请求的页面是否已在其他标签中打开，并在确认后聚焦切换至已有标签。

### 2. `webNavigation`
- **英文（推荐直接填入）**：
  > Required to listen to onCommitted navigation events so YiTab can intercept duplicate page requests before redundant content begins loading, preventing wasted system resources.
- **中文含义**：用于监听导航提交事件，在目标网页重复加载前进行拦截或切换，避免浪费网络带宽和系统内存。

### 3. `storage`
- **英文（推荐直接填入）**：
  > Required to persist user configuration locally, such as match granularity (Smart/Exact/Path/Domain), whitelist rules, and interface preferences across sessions via chrome.storage.sync and chrome.storage.local.
- **中文含义**：用于在本地持久化保存匹配模式、域名白名单和界面设置，并通过 sync 保持用户在多设备间的偏好一致。

### 4. `bookmarks`
- **英文（推荐直接填入）**：
  > Required to index and display bookmarks in the Alt+K Global Command Palette, power the New Tab launcher matrix, and perform local duplicate bookmark health diagnostics.
- **中文含义**：用于在 Alt+K 全局命令面板和新标签页中快速检索书签，以及提供本地书签去重诊断功能。

### 5. `history`
- **英文（推荐直接填入）**：
  > Required to retrieve recent browsing visits strictly to display the "Recent Session Resume" capsule on the New Tab page, allowing users to restore unfinished workflow tabs.
- **中文含义**：用于在新标签页展示“工作现场恢复胶囊”，方便用户一键重新唤出最近的高频工作流页面。

### 6. `tabGroups`
- **英文（推荐直接填入）**：
  > Required to automatically group and color-code browser tabs by domain or category when requested by the user, organizing tab clutter.
- **中文含义**：用于根据用户指令或设置，按域名将杂乱的标签页归类到 Chrome 标签分组中。

### 7. `clipboardWrite`
- **英文（推荐直接填入）**：
  > Required only when the user explicitly clicks the "Export Tabs" action to copy formatted Markdown or plain-text tab lists to the system clipboard.
- **中文含义**：仅在用户主动点击“导出标签”功能时，将格式化后的 Markdown 或纯文本标签列表写入系统剪贴板。

---

## 模块 4：隐私权实务申报（Privacy Practices Questionnaire）

在后台隐私选项卡中勾选以下内容：

1. **单一用途声明（Single Purpose Justification）**：
   > `YiTab provides a unified tab and bookmark productivity toolset that eliminates redundant duplicate tabs, organizes bookmarks, and enables instant keyboard navigation.`
   *(中文：YiTab 提供统一的标签页与书签效率套件，旨在消除重复标签、整理书签并提供即时键盘导航。)*
2. **是否收集用户数据（User Data Collection）**：
   - 勾选：**不收集任何用户数据（No, I do not collect or use user data）**，或者所有勾选框均保持未勾选（因为没有服务器接收任何数据）。
3. **隐私权政策链接（Privacy Policy URL）**：
   填入 GitHub 仓库公开访问地址：
   `https://github.com/coder-zhuzm/YiTab/blob/main/PRIVACY.md`
   *(或者如果开启了 GitHub Pages，可填 `https://coder-zhuzm.github.io/YiTab/privacy.html`)*
4. **认证（Certification）**：
   - 勾选同意遵守《Chrome Web Store 开发者计划政策》。

---

## 模块 5：上传文件清单

- **代码压缩包**：`.output/yitab-1.1.1-chrome.zip`（由 `npm run zip` 生成）
- **商店截图**：见 `docs/store-assets/screenshots/`（标准 1280 × 800 像素）
- **商店图标**：`docs/store-assets/icon-128.png`（128 × 128 像素）
- **小型宣传瓷砖（可选）**：`docs/store-assets/promo-tile-440x280.png`
