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

## 特性

| 特性 | 说明 |
|---|---|
| 全入口覆盖 | 地址栏、书签、页内链接、中键新标签统一检测（`webNavigation.onCommitted`） |
| 可配置粒度 | 完整 URL 一致（默认，精确）/ 同域名即算（激进，防堆积） |
| 可配置交互 | 静默切换 / 页内确认，随时切换 |
| 域名白名单 | 白名单域名永不拦截（如邮箱、协作工具） |
| 重定向友好 | 「仍要新开」按标签放行 8 秒，http→https、301 跳转链不再误拦 |
| 快 | 设置内存缓存 + 并行查询，检测「一闪即切」 |

## 安装（开发版）

```bash
git clone https://github.com/coder-zhuzm/YiTab.git
cd YiTab
pnpm install
pnpm build
```

构建产物在 `.output/chrome-mv3/`，Chrome → `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」选择该目录。

## 技术栈

- **WXT**：基于 Vite 的现代 WebExtension 框架，MV3 优先、HMR、entrypoint 约定式开发
- **React 18 + TypeScript**（strict）
- **Ant Design 5**：选项页 / 确认页 UI
- 核心逻辑独立于 UI（`src/lib/`）：`settings`（存储+缓存）、`match`（匹配规则）、`messaging`（消息协议），新功能以钩子形式接入检测管线

## 目录结构

```
src/
├── entrypoints/
│   ├── background.ts      # 后台：导航监听、去重决策、标签切换
│   ├── confirm/           # 页内确认页（大按钮二选一）
│   └── options/           # 设置页（React + AntD）
├── lib/
│   ├── settings.ts        # 设置模型、storage.sync + 内存缓存
│   ├── match.ts           # URL/域名匹配、归一化、白名单
│   └── messaging.ts       # confirm/options ↔ background 消息协议
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