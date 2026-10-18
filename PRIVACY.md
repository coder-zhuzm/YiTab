# YiTab Privacy Policy / 隐私权政策

**Last Updated / 最近更新日期**: October 16, 2026

[English Version](#english-version) | [中文版本](#中文版本)

---

## English Version

### 1. Introduction
YiTab ("YiTab 一签", "we", "our") is an open-source productivity extension for Google Chrome designed to eliminate redundant browser tabs, organize bookmarks, and provide an instant search launcher. We take user privacy extremely seriously.

Our core commitment: **YiTab operates entirely locally on your device. We do not collect, transmit, store on external servers, or sell any of your personal data or browsing activity.**

### 2. Information Handled by YiTab
To provide its functionality, YiTab accesses certain browser APIs provided by Chrome. All data processing occurs strictly in-memory or in local browser storage:

- **Tabs and URLs (`tabs`, `webNavigation`)**: Used in real-time to detect duplicate URLs, switch to existing tabs, or present in-page confirmation dialogs. URLs are evaluated on-device and are never transmitted to external servers.
- **Bookmarks (`bookmarks`)**: Used to search bookmarks in the Alt+K Global Command Palette, display the workspace's bookmark matrix, and detect duplicate bookmarks.
- **Browsing History (`history`)**: Used strictly to populate the "Recently Visited" recovery capsule and quick jump recommendations in the workspace. It is also queried locally to suggest a name when you add a shortcut.
- **Extension Settings (`storage`)**: Preferences such as match granularity (Strict, Smart, Path, Domain), whitelist rules, and interface customizations are stored locally via `chrome.storage.sync` (synced securely across your own signed-in Chrome devices via Google Sync) or `chrome.storage.local`.
- **Tab Groups (`tabGroups`)**: Used to organize tabs by domain into color-coded browser tab groups when initiated by the user.
- **Clipboard (`clipboardWrite`)**: Used only when the user explicitly clicks the "Export Tabs as Markdown" or "Copy Links" action.
- **Favicon (`favicon`)**: Used to display site icons by reading Chrome's **local** favicon store (the `_favicon` interface). This makes no network requests.

### 3. Chrome Web Store Limited Use Disclosure
YiTab complies fully with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/user-data-policy/), including the **Limited Use** requirements:
1. YiTab only requests permissions strictly necessary to deliver its user-facing features (tab deduplication, bookmark search, and tab productivity).
2. YiTab does **not** transfer or sell user data to third parties.
3. YiTab does **not** use or transfer user data for serving personalized advertising.
4. YiTab does **not** use user data to determine creditworthiness or for lending purposes.

### 4. Third-Party Services & Network Requests
YiTab contains no analytics trackers, advertising SDKs, telemetry beacons, or remote code execution. The extension's own code makes no telemetry network requests, and every feature works fully offline.

Specifically:
- **New Tab shortcut name suggestions and icons do not contact the target site or any third party.** Name suggestions query only local browser data (open tabs and browsing history); shortcut icons are read from Chrome's local favicon store (the `favicon` permission, i.e. the `_favicon` interface). Neither makes a network request.
- **Shortcut icons are never backfilled** by hidden tabs, page scraping, or requesting `/favicon.ico`.
- **No network host permissions such as `<all_urls>` are requested.**
- Browsing history used by the New Tab "recommended" and "continue where you left off" features is **processed in memory on your device only**, and is never uploaded.
- **Not yet unified:** the popup, the in-page confirmation banner and the command palette still use the `favIconUrl` that Chrome reports for a tab. Displaying such an icon can trigger a resource request to that URL; whether it reaches the network depends on factors such as caching. It is therefore **not** covered by the local-icon guarantee above.

### 5. Open Source Transparency
YiTab is open source. You can audit the complete source code and build instructions at our official GitHub repository:
- **Repository**: [https://github.com/coder-zhuzm/YiTab](https://github.com/coder-zhuzm/YiTab)

### 6. Contact Us
If you have questions, concerns, or bug reports regarding this Privacy Policy, please open an issue on our GitHub repository:
- **GitHub Issues**: [https://github.com/coder-zhuzm/YiTab/issues](https://github.com/coder-zhuzm/YiTab/issues)

---

## 中文版本

### 1. 前言与隐私承诺
YiTab（“YiTab 一签”）是一款专为 Chrome 设计的高效标签页与书签管理扩展，旨在消除重复打开的冗余标签、整理书签，并提供极速启动检索体验。我们高度重视您的隐私安全。

我们最核心的承诺：**YiTab 的所有功能与数据计算 100% 运行在您的本地设备上。我们绝不收集、上传、存储或出售您的任何个人数据、浏览记录或敏感信息。**

### 2. 扩展所处理的数据
为了实现核心功能，YiTab 会调用部分 Chrome 官方接口。所有数据处理均严格在您本机的内存或本地存储中完成：

- **标签页与网址（`tabs`、`webNavigation`）**：仅用于实时检测当前浏览器中是否存在重复打开的网页，并执行自动切换或页内确认拦截。所有 URL 比对均在本地实时完成，绝不上报远程服务器。
- **书签数据（`bookmarks`）**：用于在 Alt+K 全局命令面板中进行极速搜索、在工作台中呈现常用书签网格，以及进行书签去重与健康检查。
- **历史记录（`history`）**：仅用于工作台中的“常开与恢复胶囊”，方便您一键找回此前未完成的工作标签。
- **配置项（`storage`）**：保存您的匹配模式（严格/智能/同路径/同域名）、域名白名单及自定义偏好。数据仅存储在浏览器的 `chrome.storage.sync`（通过 Google 账号在您自己的设备间安全同步）或 `chrome.storage.local` 中。
- **标签分组（`tabGroups`）**：仅在用户触发或启用自动整理时，按域名对标签页进行色彩标记与折叠归类。
- **剪贴板（`clipboardWrite`）**：仅当用户主动点击“复制标签为 Markdown”或“导出链接列表”等导出功能时触发。

### 3. Chrome Web Store 用户数据合规声明
YiTab 严格遵守 Google Chrome Web Store 开发者政策与有限使用（Limited Use）要求：
1. 仅申请实现“标签页与书签效率套件”所必需的最小权限。
2. 不会向任何第三方机构、广告商或数据代理出售用户数据。
3. 不会将任何数据用于个性化广告推广、用户画像追踪或信贷风控。

### 4. 第三方服务与网络连接
YiTab 在日常使用过程中**不包含任何远程第三方分析代码、不包含广告 SDK、不发起任何埋点网络请求**。所有功能均可完全离线运行。

具体而言：

- **工作台的快捷方式名称补全与图标展示不主动请求目标站点或第三方。** 名称补全只查询浏览器本地数据（已打开的标签页、浏览历史）；快捷方式图标读取 Chrome 本地图标库（`favicon` 权限，即 `_favicon` 接口）。两者均不发起网络请求。
- **不通过隐藏标签页、网页抓取或请求 `/favicon.ico` 来补齐快捷方式图标缓存。**
- **不请求 `<all_urls>` 等网络权限。**
- 工作台「猜你想开」推荐与「继续上次」胶囊所依据的浏览历史，**仅在本机内存中用于排序与展示**，不会上传。
- **尚未统一处理**：弹出面板、页内确认条与命令面板仍直接使用 Chrome 提供的 `favIconUrl`。展示图标时可能触发对该 URL 的资源请求，是否访问网络取决于缓存等因素，因此**不属于上述本地图标保证范围**。

### 5. 开源与透明度
YiTab 为开源软件，所有源代码公开透明，接受社区审查：
- **项目开源仓库**：[https://github.com/coder-zhuzm/YiTab](https://github.com/coder-zhuzm/YiTab)

### 6. 联系我们
如果您对本隐私政策有任何疑问、建议或反馈，欢迎通过 GitHub Issues 与我们联系：
- **反馈入口**：[https://github.com/coder-zhuzm/YiTab/issues](https://github.com/coder-zhuzm/YiTab/issues)
