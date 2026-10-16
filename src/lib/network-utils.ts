import type { SearchEngine } from './newtab-types.ts';

/** 内置主流及技术搜索引擎 */
export const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: 'google',
    name: 'Google',
    prefix: 'g',
    urlTemplate: 'https://www.google.com/search?q=%s',
    icon: '🌐',
    placeholder: '搜索 Google 或输入内网地址 (前缀: g)',
  },
  {
    id: 'baidu',
    name: '百度',
    prefix: 'b',
    urlTemplate: 'https://www.baidu.com/s?wd=%s',
    icon: '🔍',
    placeholder: '搜索 百度 (前缀: b)',
  },
  {
    id: 'github',
    name: 'GitHub',
    prefix: 'gh',
    urlTemplate: 'https://github.com/search?q=%s&type=repositories',
    icon: '🐙',
    placeholder: '搜索 GitHub 开源项目 (前缀: gh)',
  },
  {
    id: 'bing',
    name: 'Bing',
    prefix: 'w',
    urlTemplate: 'https://www.bing.com/search?q=%s',
    icon: '🚀',
    placeholder: '搜索 Bing (前缀: w)',
  },
  {
    id: 'zhihu',
    name: '知乎',
    prefix: 'zh',
    urlTemplate: 'https://www.zhihu.com/search?type=content&q=%s',
    icon: '💡',
    placeholder: '搜索 知乎 (前缀: zh)',
  },
];

/** 常见内网顶级域名或后缀 */
const INTRANET_TLDS = new Set([
  'local',
  'internal',
  'corp',
  'lan',
  'home',
  'intra',
  'oa',
  'test',
  'example',
  'invalid',
  'priv',
]);

/** 常见公共顶级域名：用于判断无协议输入是否更像域名而非搜索词 */
const PUBLIC_TLDS = new Set([
  'com', 'cn', 'net', 'org', 'io', 'dev', 'me', 'icu', 'cc', 'info', 'edu', 'gov',
  'co', 'app', 'ai', 'sh', 'tv', 'xyz', 'top', 'site', 'online', 'tech', 'cloud',
  'uk', 'de', 'jp', 'fr', 'ru', 'au', 'ca', 'in', 'hk', 'tw', 'sg', 'kr',
]);

/**
 * 判定主机名是否属于私有内网/局域网/本机地址
 */
export function isIntranetHost(rawHost: string): boolean {
  if (!rawHost || typeof rawHost !== 'string') return false;
  let host = rawHost.trim().toLowerCase();

  // 处理 [::1]:8080 或 [::1] 形式
  if (host.startsWith('[')) {
    const endBracket = host.indexOf(']');
    if (endBracket !== -1) {
      host = host.slice(1, endBracket);
    }
  } else if (host.includes(':') && !host.includes('::')) {
    // 普通 IPv4 或域名带端口，去除端口
    host = host.split(':')[0];
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }

  // IPv4 私有网段判断
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // 169.254.0.0/16 Link-local
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

  // 包含内网 TLD 后缀判断，如 gitlab.corp, jenkins.internal, nas.local
  const parts = host.split('.');
  if (parts.length > 1) {
    const tld = parts[parts.length - 1];
    if (INTRANET_TLDS.has(tld)) return true;
  } else if (parts.length === 1 && host.length > 0) {
    // 纯单节主机名（企业内部 DNS 短名，如 gitlab, jira, wiki）
    return true;
  }

  return false;
}

/** 快捷方式表单等「必须给出有效地址」的场景要求的协议白名单 */
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/** 无协议输入补全协议时，走 http 的内网/本机主机（与既有直达行为保持一致） */
function defaultsToHttp(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  // 私有/保留 IPv4 字面量
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return false;
}

/**
 * 地址解析的**唯一入口**：补全、预览、保存、打开都必须消费这一份结果，
 * 不得各自另做 URL 猜测（例如用去重的 smart/domain 规则代替地址解析）。
 *
 * 规则：
 * 1. 显式 http/https：原样保留协议、端口、路径、查询参数与 Hash，绝不擅自替换。
 * 2. 无协议时补全协议，且**只补协议**，其余部分保持用户输入不变：
 *    - 内网/本机主机 -> http（保持既有内网直达行为）
 *    - 公共域名 -> https
 * 3. 非 http/https 协议（如 javascript:、data:）一律拒绝，避免把可执行内容当成地址。
 * 4. 其余情况视为搜索词，不当作地址。
 */
export function resolveTargetUrl(input: string): { isAddress: boolean; url: string } {
  const trimmed = input.trim();
  if (!trimmed) return { isAddress: false, url: '' };

  // 1. 已带协议
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!WEB_PROTOCOLS.has(parsed.protocol)) return { isAddress: false, url: '' };
      // 原样返回用户输入，避免规范化改写其路径/查询/锚点
      return { isAddress: true, url: trimmed };
    } catch {
      return { isAddress: false, url: '' };
    }
  }

  // 1b. 形如 "scheme:payload" 的非 web 协议（javascript:、data:、mailto: 等）一律拒绝。
  //     注意与 "localhost:5173" 这类 host:port 区分：冒号后若是纯端口（可带路径）则不是协议。
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):(.*)$/i);
  if (schemeMatch && !/^\d+([/?#].*)?$/.test(schemeMatch[2])) {
    return { isAddress: false, url: '' };
  }

  // 2. 端口快捷输入 (如 ":3000" 或 ":8080/dashboard")
  const portMatch = trimmed.match(/^:(\d{2,5})(\/.*)?$/);
  if (portMatch) {
    const port = Number.parseInt(portMatch[1], 10);
    if (port > 0 && port <= 65535) {
      const rest = portMatch[2] || '';
      return { isAddress: true, url: `http://localhost:${port}${rest}` };
    }
    return { isAddress: false, url: '' };
  }

  // 3. localhost 开头 (如 "localhost:5173", "localhost/app")
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(trimmed)) {
    return { isAddress: true, url: `http://${trimmed}` };
  }

  // 4. IPv4 格式 (如 "192.168.1.254", "10.0.0.1:8080/portal")
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?([/?#].*)?$/.test(trimmed)) {
    return { isAddress: true, url: `http://${trimmed}` };
  }

  // 5. 无协议的 主机[:端口][/路径]：必须有**显式**地址信号（带点、带端口、带路径），
  //    否则视为搜索词。注意不能用 isIntranetHost 单独判定 —— 它对任意单节字符串都返回 true，
  //    会把「普通搜索内容」「hello」这类搜索词误当成内网主机名。
  if (!trimmed.includes(' ')) {
    const hostPart = trimmed.split(/[/?#]/)[0];
    const hostname = hostPart.split(':')[0];
    const hasDot = hostname.includes('.');
    const hasPort = hostPart.includes(':');
    const hasPath = /[/?#]/.test(trimmed);
    if (hasDot || hasPort || hasPath) {
      const protocol = defaultsToHttp(hostname) ? 'http' : 'https';
      return { isAddress: true, url: `${protocol}://${trimmed}` };
    }
  }

  // 6. 纯域名（含已知公共 TLD 或内网 TLD，如 "nas.local"、"github.com"）
  if (!trimmed.includes(' ') && trimmed.includes('.')) {
    const parts = trimmed.split('.');
    const tld = parts[parts.length - 1].toLowerCase().split(':')[0];
    if (INTRANET_TLDS.has(tld) || PUBLIC_TLDS.has(tld)) {
      const hostname = trimmed.split(':')[0];
      const protocol = defaultsToHttp(hostname) ? 'http' : 'https';
      return { isAddress: true, url: `${protocol}://${trimmed}` };
    }
  }

  return { isAddress: false, url: '' };
}

/**
 * 判定用户输入是否可作为网络地址直达。
 * 与 resolveTargetUrl 共用同一份规则，保证「能否直达」与「解析成什么 URL」永不脱节。
 */
export function isDirectAddress(input: string): { isAddress: boolean; url: string } {
  return resolveTargetUrl(input);
}

/** 快捷方式表单专用：要求解析结果必须是 http/https 地址 */
export function resolveShortcutUrl(input: string): { ok: boolean; url: string } {
  const resolved = resolveTargetUrl(input);
  if (!resolved.isAddress) return { ok: false, url: '' };
  try {
    const parsed = new URL(resolved.url);
    if (!WEB_PROTOCOLS.has(parsed.protocol)) return { ok: false, url: '' };
    return { ok: true, url: resolved.url };
  } catch {
    return { ok: false, url: '' };
  }
}

/**
 * 解析用户搜索输入，识别是否有引擎切换前缀或直达地址
 */
export function parseSearchQuery(
  input: string,
  defaultEngineId = 'google',
): {
  engine: SearchEngine;
  cleanQuery: string;
  isAddress: boolean;
  targetUrl?: string;
} {
  const trimmed = input.trim();
  const defaultEngine =
    SEARCH_ENGINES.find((e) => e.id === defaultEngineId) || SEARCH_ENGINES[0];

  if (!trimmed) {
    return {
      engine: defaultEngine,
      cleanQuery: '',
      isAddress: false,
    };
  }

  // 先检查是否为直接网络地址直达
  const direct = isDirectAddress(trimmed);
  if (direct.isAddress) {
    return {
      engine: defaultEngine,
      cleanQuery: trimmed,
      isAddress: true,
      targetUrl: direct.url,
    };
  }

  // 检查前缀切换 (例如 "g vue 3", "gh yitab", "b 深度学习")
  const prefixMatch = trimmed.match(/^([a-zA-Z]{1,4})\s+(.+)$/);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toLowerCase();
    const rest = prefixMatch[2].trim();
    const matchedEngine = SEARCH_ENGINES.find((e) => e.prefix === prefix);
    if (matchedEngine) {
      return {
        engine: matchedEngine,
        cleanQuery: rest,
        isAddress: false,
      };
    }
  }

  return {
    engine: defaultEngine,
    cleanQuery: trimmed,
    isAddress: false,
  };
}

/**
 * 构造浏览器本地图标 URL（Chrome `_favicon` API，需 manifest `favicon` 权限）。
 *
 * 特点：读取 Chrome 本地图标库，**不发起网络请求**。
 * 注意：未访问过的站点会返回浏览器默认占位图，且该图同样触发 `onload` ——
 * 无法用 `onError` 区分真假图标，因此本模块**不做占位检测**，调用方也不应
 * 据此宣称「已获得真实网站图标」。拿不到真图标时由调用方回退到首字母 SVG。
 *
 * 必须传入完整 pageUrl（含协议、端口、路径），不要只传主机名。
 */
export function browserFaviconUrl(pageUrl: string, size = 32): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return '';
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.toString();
  } catch {
    return '';
  }
}

/** 优雅生成高辨识度双色渐变 SVG Favicon */
const GRADIENTS = [
  ['#3b82f6', '#1d4ed8'], // 科技蓝
  ['#10b981', '#047857'], // 翡翠绿
  ['#8b5cf6', '#6d28d9'], // 紫罗兰
  ['#f59e0b', '#b45309'], // 琥珀橙
  ['#ec4899', '#be185d'], // 玫红
  ['#06b6d4', '#0e7490'], // 青蓝
  ['#64748b', '#334155'], // 极简灰
];

function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * 为没有 Favicon 或内网 IP 的站点生成优雅的带首字母的矢量 SVG 图标
 */
export function generateSvgFavicon(title: string, hostname: string): string {
  const seed = (hostname || title || 'YiTab').toLowerCase();
  const hash = stringHash(seed);
  const [col1, col2] = GRADIENTS[hash % GRADIENTS.length];

  // 提取 1~2 个大写字符作为首字母标识
  let initials = 'YT';
  const cleanTitle = (title || hostname || '').replace(/https?:\/\//i, '').trim();
  if (cleanTitle) {
    const letters = cleanTitle.replace(/[^a-zA-Z0-9一-龥]/g, '');
    if (letters.length >= 2) {
      // 若包含中文字符，取前 1 个汉字；若英文取前 2 个字母
      if (/[一-龥]/.test(letters[0])) {
        initials = letters.slice(0, 1);
      } else {
        initials = letters.slice(0, 2).toUpperCase();
      }
    } else if (letters.length === 1) {
      initials = letters.toUpperCase();
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <defs>
    <linearGradient id="g_${hash}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${col1}" />
      <stop offset="100%" stop-color="${col2}" />
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="12" fill="url(#g_${hash})" />
  <text x="24" y="30" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${
    initials.length > 1 ? '18' : '22'
  }" font-weight="600" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${initials}</text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * 格式化时间与日期问候语
 */
export function formatTimeGreeting(now = new Date()): {
  greeting: string;
  timeStr: string;
  dateStr: string;
} {
  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}`;

  let greeting = '你好';
  if (hours >= 5 && hours < 9) {
    greeting = '清晨好';
  } else if (hours >= 9 && hours < 12) {
    greeting = '上午好';
  } else if (hours >= 12 && hours < 14) {
    greeting = '中午好';
  } else if (hours >= 14 && hours < 18) {
    greeting = '下午好';
  } else if (hours >= 18 && hours < 23) {
    greeting = '晚上好';
  } else {
    greeting = '夜深了';
  }

  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const dayName = days[now.getDay()];
  const dateStr = `${month}月${date}日 · ${dayName}`;

  return { greeting, timeStr, dateStr };
}
