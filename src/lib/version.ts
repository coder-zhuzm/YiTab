import pkg from '../../package.json' with { type: 'json' };

/**
 * 获取当前应用的版本号（纯数字版本，如 "1.1.0"）
 * 优先读取扩展清单 manifest.json，降级读取 package.json
 */
export function getAppVersion(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.version) {
        return manifest.version;
      }
    }
  } catch {
    // 忽略异常（如扩展上下文失效等），降级使用 package.json 版本
  }
  return pkg.version;
}

/**
 * 格式化后的应用版本展示字符串（如 "v1.1.0"）
 */
export const APP_VERSION = `v${getAppVersion()}`;
