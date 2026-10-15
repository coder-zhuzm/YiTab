import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'YiTab 一签',
    description:
      '地址栏/书签/链接照常使用；打开重复标签时自动切换，或在页内大按钮确认，粒度和交互均可配置。',
    permissions: [
      'tabs',
      'storage',
      'webNavigation',
      'tabGroups',
      'clipboardWrite',
      'bookmarks',
      'history',
    ],
    omnibox: {
      keyword: 'tab',
    },
    commands: {
      'toggle-palette': {
        suggested_key: {
          default: 'Alt+K',
          mac: 'Command+K',
        },
        description: '唤出全局命令与标签搜索面板',
      },
    },
    minimum_chrome_version: '116',
    icons: {
      '16': '/icon.png',
      '48': '/icon.png',
      '128': '/icon.png',
    },
  },
});