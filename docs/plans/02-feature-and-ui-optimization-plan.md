# YiTab（v1.3.1）功能与 UI 深度分析及优化实施指南

> **评估基准**：`v1.3.1`（commit `3cb2571`）  
> **评估范围**：工作台（Newtab）、控制弹窗（Popup）、控制中心（Options）、拦截确认页（Confirm）、全局命令面板（Palette）、SPA 轻提示（Toast）及后台协调/存储逻辑。  
> **文档目标**：结合当前代码实现与实测双模预览截图，按优先级给出**可执行、带理由、定位到具体文件**的功能与 UI 优化方案，便于分阶段直接落地。

---

## 一、现状总览与核心诊断

### 1.1 已有优势（值得保留）
- **核心架构扎实**：基于 WXT + React 18 + TypeScript + Ant Design 5，MV3 后台采用双层拦截（整页导航 + SPA 路由）与跨标签并发协调器（`coordinator.ts`），并发安全与隐私本地化（Chrome `_favicon`、零外联）在 v1.2–v1.3 已打牢基础。
- **产品分工清晰**：工作台负责「启动与找回」、Popup 负责「当前窗口即时操作」、Options 负责「长期策略配置」、Confirm/Toast 负责「重复决策解释」，信息架构方向正确。
- **设计克制感初步成型**：工作台（`newtab/style.css`）的极简中性画布 + 单一强调色风格清爽耐看，并已支持全局浅色/深色/跟随系统三态切换。

### 1.2 四类核心短板
1. **高侵入性快捷键冲突**：`content.ts` 在所有网页的捕获阶段硬编码拦截 `Cmd+K` / `Alt+K`，破坏主流 Web 应用原生快捷键。
2. **「未接通开关」与核心入口断层**：Options 中存在纯摆设 AI 开关、工作台调用后被丢弃的简报逻辑、底层已实现但无 UI 的能力（如 `openInNewTab`、`renameSnapshot`、`deletePinnedGroup`）；同时核心的「当前站点去重状态与一键放行」在最高频的 Popup 缺失。
3. **跨界面 UI 瑕疵与深色模式可读性 Bug**：Popup 导航栏 4 个 Tab 溢出截断、图标与文字无间距、全站大量使用原生 `window.alert()` 阻塞交互、深色模式存在硬编码浅色文字（标题几乎隐身）与低对比度主色。
4. **前端单体膨胀与视觉体系割裂**：4 个入口文件均在 1200–2100 行，Popup 与 Options 存在大量重复业务代码；Newtab、Antd 页面、Shadow DOM 浮窗三套视觉 Token 尚未统一。

---

## 二、功能层面优化建议

### [P0-1] 解除 `content.ts` 对全网 `Cmd+K` 的硬编码劫持
- **现状定位**：[`src/entrypoints/content.ts#L69-L81`](../../src/entrypoints/content.ts) 在 `matches: ['*://*/*']` 的 `capture: true` 阶段无条件拦截 `Cmd+K` / `Alt+K` 并执行 `e.preventDefault()` 与 `e.stopPropagation()`，且未排除输入框/富文本编辑器；同时 [`wxt.config.ts#L26-L34`](../../wxt.config.ts) 已注册 Chrome 原生 `commands.toggle-palette`。
- **优化理由**：在 macOS 上，`Cmd+K` 是 GitHub、Notion、Slack、Linear、Figma、飞书、VS Code Web 的命令面板快捷键，也是 Google Docs / 各类 Markdown 编辑器的「插入链接」快捷键。扩展在捕获阶段强行抢占且无法关闭，是研发类用户卸载扩展的头号诱因。
- **实施建议**：
  1. **移除 `content.ts` 中的硬编码 `window.addEventListener('keydown', ...)`**，完全交由 `manifest.commands` 驱动（后台监听 `chrome.commands.onCommand` 转发 `yitab_toggle_palette`），让用户可在 `chrome://extensions/shortcuts` 自由修改或解绑。
  2. 将 `wxt.config.ts` 中的默认快捷键调整为低冲突组合（如 `Alt+Shift+K` / `Command+Shift+K`），或在 Options 增加「快捷键配置指引」按钮直接跳转 `chrome://extensions/shortcuts`。
  3. 若确需保留页内快捷键兜底，必须满足三条件：**非输入框/可编辑区才触发 + Options 提供关闭开关 + 不使用 `Cmd+K` 单修饰键**。
- **验收标准**：在 GitHub、Notion、输入框内按下 `Cmd+K` 均正常触发原网页功能；通过用户配置的扩展快捷键可稳定唤出/关闭 YiTab 命令面板。

---

### [P0-2] 清理/补全未接通的功能开关与半成品状态
- **现状定位**：
  - **纯摆设 AI 开关**：[`src/entrypoints/options/main.tsx#L1978-L2024`](../../src/entrypoints/options/main.tsx) 暴露了 `taskAutoGrouping`（跨域名任务语义聚类）与 `bookmarkSmartTagging`（书签空闲语义打标），全仓无任何读取调用。
  - **返回值被丢弃的 AI 简报**：[`src/entrypoints/newtab/App.tsx#L258-L260`](../../src/entrypoints/newtab/App.tsx) 执行 `void generateMorningBriefing(initialOpenTabs.length, 0, aiSet)`，既未渲染返回值，又将第二个参数写死为 `0`。
  - **有逻辑无 UI 的设置项**：`NewTabSettings.openInNewTab` 在 [`src/entrypoints/newtab/App.tsx#L363`](../../src/entrypoints/newtab/App.tsx) 已生效，但 Options 工作台页未暴露开关。
  - **有接口无 UI 的快照能力**：`renameSnapshot` 在 [`src/entrypoints/popup/main.tsx#L69`](../../src/entrypoints/popup/main.tsx) 已导入，`newSnapshotName` / `exportSource` 状态已声明，但界面无法命名/重命名快照，也无法切换导出指定快照。
- **优化理由**：可点击但无实际效果的开关会严重透支用户对工具的信任感；反之，已写好的实用能力不暴露则是白白浪费研发投入。
- **实施建议**：
  1. **AI 开关诚实化**：暂时隐藏未实现的 `taskAutoGrouping` 与 `bookmarkSmartTagging`，或明确标注 `规划中` Tag 并设为 `disabled`；对 `morningBriefing`，要么在工作台顶部状态区渲染生成的简报并传入真实的休眠/重复计数，要么一并暂缓展示。
  2. **补齐工作台开关**：在 Options「工作台」Tab 增加「点击快捷方式/书签时默认在新标签页打开（`openInNewTab`）」开关。
  3. **补齐快照管理**：在 Popup「会话快照」Tab 为「新建快照」提供可选名称输入框，为每条快照增加行内重命名按钮，并在底部导出区增加「导出源（当前窗口 / 指定快照）」下拉框。

---

### [P1-1] Popup 顶部增加「当前站点去重状态与一键快捷控制」
- **现状定位**：点击浏览器工具栏的 YiTab 图标打开 Popup（[`src/entrypoints/popup/main.tsx`](../../src/entrypoints/popup/main.tsx)），当前仅展示窗口标签数与 4 个治理 Tab，**完全看不到当前网页的去重拦截状态**。
- **优化理由**：「标签去重」是 YiTab 最核心的差异化卖点，而用户调整去重规则（如临时放行、加白名单、改成同路径匹配）几乎都发生在**刚被拦截或正停留在某网页的当下**。目前必须经过「点 Popup → 点齿轮进 Options → 切去重策略 Tab → 复制域名 → 粘贴保存」共 5 步，链路过长。
- **实施建议**：
  1. 在 Popup Header 下方新增一条紧凑的「当前站点策略条」（约 36px 高），通过 `chrome.tabs.query({ active: true, currentWindow: true })` 读取当前域名并计算生效规则。
  2. 展示内容：`当前站点 domain.com` + 生效策略徽章（如 `智能匹配` / `已加白名单` / `站点规则: 同路径`）。
  3. 快捷操作：一键切换「加入/移出白名单」、以及全局「暂停去重（15 分钟 / 恢复）」轻量开关。

---

### [P1-2] 工作台（Newtab）高频交互补全：聚合搜索 + 实时同步 + 分组与排序
- **现状定位**：
  1. **搜索割裂且延迟高**：[`src/entrypoints/newtab/App.tsx#L285-L347`](../../src/entrypoints/newtab/App.tsx) 顶部搜索框仅搜索 `openTabs`，不搜索快捷方式与书签，且纯本地过滤套了 `400ms` 防抖，手感发粘；下方书签区又单独放了一个「筛选书签」输入框。
  2. **已开标签状态过期**：`openTabs` 仅在组件首次挂载时拉取（`#L210`），当工作台标签页常驻后台再切回时，顶栏活动页数、磁贴已打开绿点、搜索建议均为旧数据。
  3. **分组缺少闭环管理**：可新建分组，但无法重命名/删除分组（尽管 [`src/lib/pinned.ts#L143`](../../src/lib/pinned.ts) 已实现 `deletePinnedGroup`）；快捷方式磁贴不支持拖拽排序。
  4. **模式切换后分组计数失真**：[`src/entrypoints/newtab/App.tsx#L794-L801`](../../src/entrypoints/newtab/App.tsx) 计算 `groupChips` 数量时未按 `settings.profile === 'home'` 过滤内网卡片，导致「个人」模式下分组徽章显示有数量，点进去却提示为空。
- **优化理由**：工作台是用户每天打开数十次的高频入口，毫秒级响应、单一搜索心智与可自由整理是留存的关键。
- **实施建议**：
  1. **搜索升级**：顶部搜索框拆分为两阶段——**本地即时检索（0ms/30ms 防抖）**同时覆盖 `已开标签 + 快捷方式 + 书签`，按分组图标展示；仅端侧 AI 语义补全保留 `400ms` 防抖异步追加。
  2. **实时同步**：在 `NewTabApp` 注册 `chrome.tabs.onCreated / onRemoved / onUpdated`（做 200ms 节流）及 `document.visibilitychange` 监听，切回工作台即刷新 `openTabs`。
  3. **分组管理与拖拽**：为分组 Chip 增加右键菜单或编辑按钮（重命名、删除并确认归属转移）；为磁贴增加轻量原生 HTML5 Drag & Drop 排序并持久化 `order`。
  4. **修正分组计数**：`groupChips` 先基于 `profile` 过滤出可见 `items` 再统计各分组数量。

---

### [P2-1] 确认页（Confirm）与 SPA 浮窗信息降噪与快捷加白
- **现状定位**：
  - 确认页（[`src/entrypoints/confirm/main.tsx`](../../src/entrypoints/confirm/main.tsx)）卡片中直接显示 Chrome 内部 `windowId`（如 `窗口 2020921620`），对用户无语义。
  - 当仅匹配到 1 个已有标签时，顶部吸顶栏有「切换到所选标签 ↵ Enter」，卡片内又同时出现 Radio 单选框和第二个「切换」按钮，视觉和交互冗余。
  - SPA 浮窗（[`src/entrypoints/content.ts`](../../src/entrypoints/content.ts)）仅提供「切换到该标签」「留在本页」，遇到频繁触发误报的 SPA 站点时无法一键静默该域名。
- **优化理由**：拦截页本身是对用户心流的一次打断，每多 1 秒的阅读成本和多余控件都会放大烦躁感。
- **实施建议**：
  1. 将 `windowId` 映射为人类可读标签：`当前窗口` 或 `其他窗口 #2`（可附带该窗口当前激活标签的简短标题作为锚点提示）。
  2. `dups.length === 1` 时，隐藏卡片左侧 Radio 和列表右上角「批量管理」入口，让视线直达「已有标签标题 + 匹配原因 + 顶部主操作」。
  3. 在确认页顶栏和 SPA 浮窗底部补充轻量次级操作：「不再提示此站（加入白名单）」。

---

### [P2-2] 全局配置导入 / 导出（JSON 备份与跨设备迁移）
- **现状定位**：目前仅书签治理支持 HTML/JSON 导出；用户配置好的 `siteRules`、`whitelist`、`pinnedData`（存于 `storage.local` 不随 Chrome 账号同步）、`newtabSettings` 均无法备份迁移。
- **优化理由**：研发用户普遍存在「公司电脑 + 个人电脑」双端切换或重装环境场景，缺少配置导出会显著提高迁移成本。
- **实施建议**：在 Options 增加「配置备份与迁移」模块，导出包含 `schemaVersion`、`exportedAt`、`settings`、`newTabSettings`、`pinnedData` 的单一 JSON 文件；导入时执行 `sanitizeSettings` 等严格校验，并提供「合并 / 覆盖」选择。

---

## 三、UI 与视觉体验优化建议

### [P0-3] 全面替换原生 `window.alert()`，统一非阻塞反馈体系
- **现状定位**：
  - [`src/entrypoints/popup/main.tsx`](../../src/entrypoints/popup/main.tsx) 共 **17 处**调用 `alert(...)`（如 `#L174, L241, L258, L274, L294, L338...`）。
  - [`src/entrypoints/options/main.tsx`](../../src/entrypoints/options/main.tsx) 共 **11 处**调用 `alert(...)`（尽管同文件 `#L174, L180, L186` 已使用 `message.success`）。
  - [`src/entrypoints/content.ts#L58`](../../src/entrypoints/content.ts) 复制剪贴板后调用 `alert(msg.message)`。
- **优化理由**：Chrome 扩展 Popup 中触发原生 `alert()` 会弹出系统级阻塞框，样式突兀且在部分 Chrome 版本下会导致 Popup 失焦直接关闭；在第三方网页上触发 `alert()` 更是严重的打断体验。
- **实施建议**：
  1. Popup 与 Options 统一使用 Antd `const [messageApi, contextHolder] = message.useMessage()`，并按操作类型区分 `success / info / warning / error`。
  2. `content.ts` 封装一个轻量的 Shadow DOM 状态气泡（2.5 秒自动消失，不抢焦点）替代 `alert()`。

---

### [P0-4] 修复深色模式文字隐身 Bug 与低对比度主色
- **现状定位**：
  1. **硬编码深色字导致暗黑模式隐身**：[`src/entrypoints/popup/main.tsx#L874`](../../src/entrypoints/popup/main.tsx) 写死 `color: item.active ? '#4f46e5' : '#1e293b'`，在深色卡片底色 `#16181d` 上 `#1e293b` 几乎完全不可见。
  2. **硬编码暗紫字对比度极低**：[`src/entrypoints/options/main.tsx#L1839`](../../src/entrypoints/options/main.tsx) 写死 `color: '#5b21b6'` 叠加在 `tk.accentSoft`（`#23243a`）上极难辨认。
  3. **品牌主色未做暗黑提亮**：Popup、Options、Confirm 的 `ConfigProvider` 与多处内联样式均固定使用 `#4f46e5`（Indigo 600），在 `#0f1115` / `#16181d` 深色底上对比度仅 ~3.2:1，低于 WCAG AA 4.5:1 标准（实测深色截图中选中 Tab 与 `可休眠: 3` 均明显偏暗发沉）。反观 `newtab/style.css#L33` 已正确使用 `--accent: #8b8bf5`。
- **实施建议**：
  1. 在 [`src/lib/theme-tokens.ts`](../../src/lib/theme-tokens.ts) 新增语义令牌：
     - `accentText`: 浅色 `#4f46e5` / 深色 `#818cf8`（用于高亮文字、激活 Tab、链接、强调数字）
     - `accentBg`: 浅色 `#4f46e5` / 深色 `#6366f1`（用于实心按钮背景）
  2. `ConfigProvider` 的 `token.colorPrimary` 随 `isDark` 动态取 `isDark ? '#6366f1' : '#4f46e5'`，必要时通过 `components.Tabs.itemSelectedColor` 设为 `tk.accentText`。
  3. 全仓正则排查 `popup/`、`options/`、`confirm/` 中的硬编码十六进制色值（如 `#1e293b`、`#5b21b6`、`#4f46e5`），统一替换为 `tk.*` 令牌。

---

### [P0-5] 修复 Popup 导航栏溢出截断与全站 Tab 图标间距缺失
- **现状定位**（已由 `docs/images/yitab-preview-popup.png` 与 `yitab-preview-options.png` 视觉确认）：
  1. [`src/entrypoints/popup/index.html#L10`](../../src/entrypoints/popup/index.html) 宽度固定 `390px`，Popup 内 4 个 Antd Tabs（`标签治理`、`快速检索`、`书签健康`、`会话快照`）超出可用宽度，导致第 4 个 Tab 被裁切并折叠进 `...` 溢出按钮，核心功能入口残缺。
  2. Popup（`#L553` 等）与 Options 的 Tabs 均写成 `<span><Icon />中文</span>`，未设置间距，导致图标与第一个汉字完全贴死（如 `品标签治理`、`⚙去重拦截策略`）。
- **优化理由**：Popup 是用户的第一印象窗口，首屏导航栏出现裁切与贴字会直接拉低产品精致度。
- **实施建议**：
  1. 将 Popup 宽度从 `390px` 放宽至 `420px`，并改用 Antd v5 Tabs 原生的 `icon` 属性（自动带 8px 间距），或给自定义 label 加上 `display: inline-flex; alignItems: center; gap: 6px`。
  2. 将 Popup 的 Tabs 改为**四等分紧凑分段导航**（`tabBarGutter={0}` + 均分宽度，或使用短文案 `治理` / `检索` / `书签` / `快照`），确保 4 个 Tab 100% 一屏完整可见，彻底消除 `...` 溢出。

---

### [P1-3] 局部排版、按钮层级与防误触打磨
针对预览图和代码中发现的高感知度视觉瑕疵，逐项优化：

| 界面 | 现状问题 | 理由 | 优化方案 |
| :--- | :--- | :--- | :--- |
| **工作台 Header** | `.yt-meta`（`max-width: 460px`）换行时，第一行末尾出现悬空圆点 `·` | 视觉对齐破损 | 将 `活动页面 / 未完工现场` 作为整体独立分组，或把分隔符改用 CSS 伪元素控制，避免行尾悬空 |
| **工作台快捷方式** | 仅 3 个磁贴时大屏左侧稀疏；未访问站点显示 Chrome 默认灰色地球图标 | 首屏观感略显单调 | 图标加载检测到占位/无图标时可提供「智能回退首字母渐变」选项；磁贴区在空/少项时保持协调网格间距 |
| **Options 底部栏** | 「恢复默认」按钮在 5 个 Tab 下方全局常驻，包括书签治理与内存休眠页 | 易让用户误以为会重置书签或工作台，造成误点焦虑 | 将「恢复默认」移入「去重拦截策略」Tab 底部，文案明确为「恢复去重默认设置」 |
| **Options 书签空态** | 卡片右上角「开始扫描书签」与居中空态「开始全量书签检测」双主按钮并存且文案不一致 | 视觉重心分散、信息重复 | 空态时隐藏右上角按钮，仅保留居中单一主 CTA，扫描完成后再于右上角显示次级「重新扫描」 |
| **Popup 归档关闭** | 「沉淀归档并关闭」直接关闭窗口内所有闲置标签，无二次确认 | 属于大范围关闭标签的破坏性操作，误点恢复成本高 | 包裹 `Popconfirm`，明确提示「将保存快照并关闭 N 个闲置标签」 |
| **Popup 按钮层级** | 域名归拢卡片用高饱和蓝紫渐变按钮，下方内存卡片两个主操作全是白底线框按钮 | 视觉权重不均衡，缺少统一的设计规范 | 收敛渐变按钮使用，主操作统一使用纯色品牌主按钮（`type="primary"`），次操作统一默认按钮 |
| **SPA Toast 浮窗** | 底部进度条与圆角卡片边缘留白错位；匹配原因长胶囊视觉权重压过标题和按钮 | 浮窗本应克制轻盈，长蓝紫边框胶囊显得臃肿 | 进度条改为 `position: absolute; left: 0; right: 0; bottom: 0` 贴底；匹配原因改为无边框次级文字（`12px`，`ink3`） |

---

### [P2-3] 统一三大界面的 Design Token 与图标规范
- **现状定位**：
  - Newtab（`style.css`）：中性灰 `#f6f7f9` / `#0f1115` + 极简无阴影。
  - Popup / Options / Confirm（`theme-tokens.ts` + Antd）：Slate `#f8fafc` / `#0f1115` + 卡片阴影。
  - Content Shadow DOM（`content.ts`）：Tailwind Slate `#1e293b` / `#0f172a` + 毛玻璃拟态。
  - Options AI 页面混用 Antd 线性图标与原生 Emoji（`🤖`、`🛡️`）。
- **优化理由**：同一款扩展的 6 个表面呈现 3 种不同的深色底色与材质语言，会削弱品牌专业感。
- **实施建议**：
  1. 以 `theme-tokens.ts` 为单一事实来源，将 `content.ts` 的深色底色对齐 `#16181d` / `#0f1115`、边框对齐 `#262a31`，与主界面保持视觉连贯。
  2. 移除 Options AI 卡片标题中的 `🤖`、`🛡️` Emoji，统一使用 Antd 线性图标（如 `<RobotOutlined />`、`<SafetyCertificateOutlined />`）。

---

## 四、前端工程与可维护性建议

1. **拆分巨型单体文件并抽取共享业务组件**
   - **现状**：`options/main.tsx`（2124 行）、`popup/main.tsx`（1400 行）、`newtab/App.tsx`（1389 行）、`confirm/main.tsx`（1279 行）均为单文件，且 Popup 与 Options 几乎复制粘贴了整套「书签去重治理」和「闲置休眠」代码。
   - **建议**：
     - 抽离 `src/components/BookmarkHealthPanel.tsx` 与 `src/components/TabHealthPanel.tsx`，通过 `variant?: 'compact' | 'full'` 适配 Popup 与 Options，一处修复双端生效。
     - 将 `options/main.tsx` 按 5 个 Tab 拆分为 `src/entrypoints/options/tabs/{NewTabConfig,DedupRules,BookmarkGovernance,TabMemory,AiSettings}.tsx`。
     - 将 `newtab/App.tsx` 拆分为 `TopBar`、`ShortcutGrid`、`ResumeBar`、`BookmarkMatrix` 与对应 Modal 组件。
2. **清理 Ant Design v5 废弃属性**
   - 将 `Input` 的 `bordered={false}` 替换为 `variant="borderless"`（`newtab/App.tsx#L859`）；将 `Modal` 的 `destroyOnClose` 替换为 `destroyOnHidden`，消除控制台 Warning 并平滑兼容未来 Antd 升级。
3. **扩展自动化预览检查**
   - 依托现有 `scripts/capture-previews.mjs`，在截图脚本中增加 2 条断言：检查 Popup Tabs 无溢出按钮（`.ant-tabs-nav-more` 不可见）、检查深色模式下关键文本计算色与背景色对比度达标，防止回归。

---

## 五、分阶段实施路线图

建议按「**先止血修 Bug → 再补齐高频体验 → 最后统一架构与视觉**」分三个小版本推进：

### Phase 1：v1.3.2 — 体验止血与高优修复（已完成）
- [x] **P0-1**：移除 `content.ts` 硬编码 `Cmd+K` 监听，改为完全遵循 `manifest.commands`（并调整默认组合键为 `Alt+Shift+K` / `Command+Shift+K`）。
- [x] **P0-2**：禁用或隐藏未接通的 AI 开关（`taskAutoGrouping`、`bookmarkSmartTagging`、`morningBriefing`），在 Options 工作台补齐 `openInNewTab` 开关。
- [x] **P0-3**：全仓替换原生 `window.alert()` 为 Antd `message` / Shadow DOM 轻提示。
- [x] **P0-4**：修复 `popup/main.tsx#L874` 深色隐身字与 `#5b21b6` 低对比度，引入 `accentInk` / `accent` 令牌提升暗黑模式主色可读性。
- [x] **P0-5**：Popup 宽度调至 `420px`、四等分 Tab 消除溢出、修复全站 Tab 图标与文字间距。
- [x] **细节快修**：修复工作台 `.yt-meta` 行尾悬空圆点、`groupChips` 个人模式计数失真、Options 书签双主按钮与「恢复默认」归属、Popup 与 Options 归档关闭加 `Popconfirm`。

### Phase 2：v1.4.0 — 核心高频体验升级（已完成）
- [x] **P1-1**：Popup 顶部新增「当前站点去重状态与一键加白 / 暂停去重」快捷控制条。
- [x] **P1-2**：工作台顶部搜索框升级为本地毫秒级聚合搜索（标签 + 快捷方式 + 书签）；接入 `chrome.tabs` 实时同步；补齐分组重命名/删除与快捷方式拖拽排序。
- [x] **P2-1**：确认页 `windowId` 语义化、单匹配项精简布局；确认页与 SPA 浮窗补齐「加白名单」入口。
- [x] **工程拆分**：抽取 `BookmarkHealthPanel` / `TabHealthPanel` 共享组件，消除 Popup 与 Options 双端重复代码。

### Phase 3：v1.5.0 — 生态闭环与视觉统一（预计 3–5 天）
- [ ] **P2-2**：Options 增加全局配置 JSON 导出/导入（含 Schema 校验与合并策略）。
- [ ] **快照完善**：Popup 快照支持命名保存、行内重命名与选择指定快照导出。
- [ ] **P2-3**：统一 Content Shadow DOM 与主界面的深色 Token、清理 Emoji 混用、优化 SPA Toast 贴底进度条与视觉层次。
- [ ] **AI 能力真落地（可选）**：按需正式实现「晨间工作现场简报」渲染或「跨域名语义分组」，并与端侧 AI 开关一一对应。
