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

/**
 * 常见文件扩展名。末段命中这些就不当作域名，避免 `package.json`、`notes.txt`
 * 这类输入被补成 `https://package.json` 而把搜索变成导航。
 *
 * 为什么是「扩展名黑名单 + 通用 DNS 标签规则」而不是「TLD 白名单」：
 * TLD 白名单必然漏掉真实后缀（`.design`、`.museum` 等），只能靠不断补名单，
 * 每补一次都可能引入新回归；扩展名是一个封闭且稳定的集合，漏判代价也小得多。
 *
 * 已知残留：不在本表内、又不是真实 TLD 的末段（如 `lodash.debounce`）会被当作地址。
 * 这是为了让未收录的真实 TLD 可用而必须付出的代价，已在测试中显式记录。
 */
const FILE_EXTENSIONS = new Set([
  // 文本 / 文档
  'txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'ppt', 'pptx', 'odt', 'rtf', 'tex',
  // 代码
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'json5', 'jsonc', 'map', 'py', 'pyi', 'rb',
  'php', 'java', 'kt', 'kts', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'm',
  'mm', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'lua', 'pl', 'r', 'jl', 'dart', 'vue',
  'svelte', 'sql', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'css', 'scss', 'sass',
  'less', 'styl', 'html', 'htm', 'xhtml', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'env', 'lock', 'gradle', 'properties', 'proto', 'graphql', 'gql',
  // 资源 / 二进制 / 归档
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'tif', 'tiff', 'psd',
  'ai', 'sketch', 'fig', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'mp4', 'mov', 'avi', 'mkv',
  'webm', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z', 'dmg', 'iso', 'exe', 'msi',
  'deb', 'rpm', 'apk', 'jar', 'war', 'class', 'o', 'a', 'so', 'dylib', 'dll', 'wasm', 'ttf',
  'otf', 'woff', 'woff2', 'eot',
  // 工程 / 配置
  'gitignore', 'npmrc', 'nvmrc', 'editorconfig', 'eslintrc', 'prettierrc', 'babelrc',
  'dockerfile', 'makefile', 'cmake', 'patch', 'diff', 'bak', 'tmp', 'swp',
]);


/** 端口号必须是 1–65535 的十进制整数（0 与超界端口都不是可用地址） */
function isValidPort(raw: string): boolean {
  if (!/^\d{1,5}$/.test(raw)) return false;
  const port = Number.parseInt(raw, 10);
  return port >= 1 && port <= 65535;
}

/**
 * 严格 IPv4 字面量：四段十进制、每段 0–255，且**不允许前导零**。
 *
 * 前导零（如 `192.168.001.009`）在部分解析器里是八进制含义，浏览器 URL 解析
 * 会直接拒绝这种主机名，所以这里也一并不接受，避免与最终校验结论分裂。
 * 要求四段是为了避免把 `1.2` 当成 IP 简写（浏览器会解析成 `1.0.0.2`）。
 */
function isIPv4Literal(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && String(Number.parseInt(p, 10)) === p && Number.parseInt(p, 10) <= 255);
}

/** 无协议输入补全协议时，走 http 的内网/本机主机（与既有直达行为保持一致） */
function defaultsToHttp(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  // 私有/保留 IPv4 字面量
  if (isIPv4Literal(host)) return true;
  return false;
}

/**
 * 无协议输入的主机是否**足以证明**它是个地址。
 *
 * 取代此前「包含点/冒号/斜杠就算地址」的宽松判定 —— 那种写法会把 `1.2` 判成地址，
 * 再被浏览器 URL 解析当成 IPv4 简写（`https://1.0.0.2/`），使普通搜索输入变成导航。
 *
 * 判定依据是**结构**而非 TLD 白名单：任何 TLD 白名单都必然漏掉真实存在的后缀
 * （`.design`、`.museum` 等），靠补名单只会不断回归。
 *
 * 接受：
 * - 本机名（localhost / 环回 / 0.0.0.0）
 * - 严格 IPv4 字面量（必须四段且无前导零，因此 `1.2` 不算）
 * - 多段主机名，末段是字母开头的合法 DNS 标签且不是已知文件扩展名
 *   （因此 `.design`、`.museum` 可用，而 `1.2`、`3.14`、`package.json` 不算）
 * - 单段企业内网短名，但必须有显式端口或路径（否则 `hello` 这类搜索词会被吞掉）
 */
function looksLikeAddressHost(hostname: string, hasPort: boolean, hasPath: boolean): boolean {
  const host = hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
  if (isIPv4Literal(host)) return true;

  const labels = host.split('.');
  if (labels.length > 1) {
    if (labels.some((l) => l === '')) return false; // 空标签，如 "a..b" / ".com"
    const tld = labels[labels.length - 1];
    // 末段必须是字母开头的合法 DNS 标签，形如 ".design" / ".museum" / ".corp"
    if (!/^[a-z][a-z0-9-]*$/.test(tld)) return false;
    // 但不是已知文件扩展名，否则 package.json / notes.txt 会被当成域名
    return !FILE_EXTENSIONS.has(tld);
  }

  // 单段主机名：需要端口或路径这类显式信号才认，避免吞掉普通搜索词
  return hasPort || hasPath;
}

/**
 * 所有成功候选的**唯一最终校验**。
 *
 * 只在这里做「是不是一个浏览器认可的 http/https 地址」的判定，
 * 返回原样候选串（不做规范化改写，保留用户输入的路径/查询/锚点）。
 * 任何新增的地址分支都必须经由它返回，否则「能否直达」与「能否保存」会再次分裂。
 */
function finalizeCandidate(candidate: string): { isAddress: boolean; url: string } {
  try {
    const parsed = new URL(candidate);
    if (!WEB_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
      return { isAddress: false, url: '' };
    }
    return { isAddress: true, url: candidate };
  } catch {
    return { isAddress: false, url: '' };
  }
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
 *
 * 候选识别与最终校验是衔接的：先按主机形状判断「像不像地址」，
 * 再一律交给 finalizeCandidate 做有效性确认。**每个成功分支都从它返回**，
 * 因此 `localhost:99999`、`192.168.001.009` 这类输入在直达与保存两条路径上结论一致。
 */
export function resolveTargetUrl(input: string): { isAddress: boolean; url: string } {
  const trimmed = input.trim();
  if (!trimmed) return { isAddress: false, url: '' };

  // 1. 已带协议
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return finalizeCandidate(trimmed);
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
    if (!isValidPort(portMatch[1])) return { isAddress: false, url: '' };
    return finalizeCandidate(`http://localhost:${portMatch[1]}${portMatch[2] || ''}`);
  }

  // 3. localhost 开头 (如 "localhost:5173", "localhost/app")
  const localhostMatch = trimmed.match(/^localhost(?::(\d+))?([/?#].*)?$/i);
  if (localhostMatch) {
    const port = localhostMatch[1];
    if (port !== undefined && !isValidPort(port)) return { isAddress: false, url: '' };
    return finalizeCandidate(`http://${trimmed}`);
  }

  // 4. IPv4 格式 (如 "192.168.1.254", "10.0.0.1:8080/portal")
  const ipv4Match = trimmed.match(/^((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?([/?#].*)?$/);
  if (ipv4Match) {
    // 前导零等非规范写法在这里就拒绝，不必等到最终校验
    if (!isIPv4Literal(ipv4Match[1])) return { isAddress: false, url: '' };
    const port = ipv4Match[2];
    if (port !== undefined && !isValidPort(port)) return { isAddress: false, url: '' };
    return finalizeCandidate(`http://${trimmed}`);
  }

  // 5. 无协议的 主机[:端口][/路径]：先判主机形状，再做最终 URL 校验
  if (!trimmed.includes(' ')) {
    const hostPart = trimmed.split(/[/?#]/)[0];
    const hasPath = /[/?#]/.test(trimmed);
    const colonAt = hostPart.lastIndexOf(':');
    const hostname = colonAt === -1 ? hostPart : hostPart.slice(0, colonAt);
    const port = colonAt === -1 ? undefined : hostPart.slice(colonAt + 1);
    const hasPort = port !== undefined && port !== '';

    // 端口写了就必须合法，否则整条输入不是地址
    if (hasPort && !isValidPort(port)) return { isAddress: false, url: '' };

    if (looksLikeAddressHost(hostname, hasPort, hasPath)) {
      const protocol = defaultsToHttp(hostname) ? 'http' : 'https';
      return finalizeCandidate(`${protocol}://${trimmed}`);
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
 * 元数据匹配用的 URL 归一表示。
 *
 * 只归一**表示差异**，不合并**语义差异**：
 * - 归一：主机名大小写、显式默认端口（`:443`/`:80`）、空路径补成 `/`
 *   （`https://example.com` 与标签页里的 `https://example.com/` 是同一地址）
 * - 保留：协议、非默认端口、路径、查询参数、Hash
 *   （`http://a` 与 `https://a` 不同；`a/x` 与 `a/y` 不同；`a#1` 与 `a#2` 不同）
 *
 * 注意：这里**不是**去重的 smart/domain 规则 —— 不合并 www、不删查询、不忽略 Hash。
 * 解析失败返回空串，调用方据此判定「不可比较」而非「相等」。
 */
export function canonicalUrlKey(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (!WEB_PROTOCOLS.has(u.protocol) || !u.hostname) return '';
    // URL 已按规范去掉默认端口、统一小写主机名，并补全空路径为 "/"
    return u.href;
  } catch {
    return '';
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
