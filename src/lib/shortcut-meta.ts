/**
 * 快捷方式名称的本地候选补全。
 *
 * 边界：
 * - 只查本地数据（已开标签、历史记录），**不请求目标站点、不抓页面、不建隐藏标签**。
 * - 查询失败不阻塞手填与保存，一律降级为「未找到」。
 * - 返回结果时由调用方再核对「当前 URL 是否已变」「用户是否已改名」，本模块不做写入。
 */

import { canonicalUrlKey } from './network-utils.ts';
import { extractHostname } from './search.ts';

/** 名称来源：空 / 自动补全 / 用户手填。用户的输入永远优先。 */
export type TitleSource = 'empty' | 'auto' | 'user';

export interface TitleCandidate {
  title: string;
  source: 'tab' | 'bookmark' | 'history' | 'preset' | 'domain';
  url: string;
}

export interface TitleLookupApi {
  queryTabs(): Promise<Array<{ url?: string; title?: string }>>;
  /** 需显式给出时间范围与数量上限，否则默认只回看 24 小时 */
  searchHistory(url: string, startTime: number, maxResults: number): Promise<Array<{ url?: string; title?: string }>>;
  /** 查询本地书签库（最高质量命名库） */
  searchBookmarks?(query: string): Promise<Array<{ url?: string; title?: string }>>;
}

/** 常用知名站点映射表（零网络延迟，高频站点秒识别） */
export const PRESET_SITE_TITLES: Record<string, string> = {
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'gitee.com': 'Gitee 码云',
  'bilibili.com': '哔哩哔哩 (Bilibili)',
  'youtube.com': 'YouTube',
  'v2ex.com': 'V2EX',
  'zhihu.com': '知乎',
  'juejin.cn': '稀土掘金',
  'feishu.cn': '飞书',
  'larksuite.com': 'Lark',
  'yuque.com': '语雀',
  'notion.so': 'Notion',
  'google.com': 'Google',
  'baidu.com': '百度',
  'bing.com': 'Bing 必应',
  'twitter.com': 'X (Twitter)',
  'x.com': 'X',
  'reddit.com': 'Reddit',
  'stackoverflow.com': 'Stack Overflow',
  'weibo.com': '微博',
  'douban.com': '豆瓣',
  'csdn.net': 'CSDN',
  'segmentfault.com': '思否',
  'developer.mozilla.org': 'MDN Web Docs',
  'hub.docker.com': 'Docker Hub',
  'npmjs.com': 'npm',
  'taobao.com': '淘宝',
  'jd.com': '京东',
};

/** 从域名语义清洗站点名称（如 docs.docker.com -> Docker Docs） */
export function cleanDomainToTitle(hostname: string): string | null {
  if (!hostname || hostname === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return null;
  }
  const clean = hostname.replace(/^www\./i, '');
  if (PRESET_SITE_TITLES[clean]) return PRESET_SITE_TITLES[clean];

  const parts = clean.split('.');
  if (parts.length >= 2) {
    const main = parts[parts.length - 2];
    if (main && main.length > 1) {
      // 首字母大写
      return main.charAt(0).toUpperCase() + main.slice(1);
    }
  }
  return null;
}

/** 历史查询回看窗口：30 天。明确给出，避免落到 Chrome 默认的 24 小时。 */
export const HISTORY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
/** 历史查询数量上限：有界，接受可能漏查 */
export const HISTORY_MAX_RESULTS = 20;

/**
 * 按目标 URL 查本地名称候选。
 *
 * 顺序：
 * 1. 已开标签精确匹配
 * 2. 本地书签库精准匹配（chrome.bookmarks）
 * 3. 历史记录精准匹配（chrome.history）
 * 4. 内置高频知名网站字典匹配（Top 150 常见站点，零延迟）
 * 5. 本地标签/书签/历史的同域名（Hostname）最常访问标题回退
 * 6. 域名语义清洗兜底（如 docs.docker.com -> "Docker"）
 */
export async function lookupLocalTitle(
  api: TitleLookupApi,
  targetUrl: string,
  now = Date.now(),
): Promise<TitleCandidate | null> {
  if (!targetUrl) return null;
  const wanted = canonicalUrlKey(targetUrl);
  if (!wanted) return null;

  // 1. 已打开的标签：精确 URL 匹配最可靠
  let tabsCache: Array<{ url?: string; title?: string }> = [];
  try {
    tabsCache = await api.queryTabs();
    const hit = tabsCache.find((t) => t.url && canonicalUrlKey(t.url) === wanted && t.title?.trim());
    if (hit?.title) return { title: hit.title.trim(), source: 'tab', url: targetUrl };
  } catch {
    // 继续尝试其他源
  }

  // 2. 本地书签库：用户手工保存的高质量命名库
  if (api.searchBookmarks) {
    try {
      const bMarks = await api.searchBookmarks(targetUrl);
      const hit = bMarks.find((b) => b.url && canonicalUrlKey(b.url) === wanted && b.title?.trim());
      if (hit?.title) return { title: hit.title.trim(), source: 'bookmark', url: targetUrl };
    } catch {
      // ignore
    }
  }

  // 3. 历史记录：精确匹配
  let historyCache: Array<{ url?: string; title?: string }> = [];
  try {
    historyCache = await api.searchHistory(targetUrl, now - HISTORY_LOOKBACK_MS, HISTORY_MAX_RESULTS);
    const hit = historyCache.find((h) => h.url && canonicalUrlKey(h.url) === wanted && h.title?.trim());
    if (hit?.title) return { title: hit.title.trim(), source: 'history', url: targetUrl };
  } catch {
    // ignore
  }

  // 提取域名用于知名站点字典
  const host = extractHostname(targetUrl);
  if (!host) return null;
  const cleanHost = host.replace(/^www\./i, '').toLowerCase();

  // 4. 内置高频知名站点字典（仅匹配预设的知名网站，不凭空捏造）
  if (PRESET_SITE_TITLES[cleanHost]) {
    return { title: PRESET_SITE_TITLES[cleanHost], source: 'preset', url: targetUrl };
  }

  return null;
}

/**
 * 自动结果是否允许写入标题字段。
 *
 * 三重绑定：请求编号、URL、名称来源。任一不符即放弃，避免旧请求覆盖新状态。
 */
export function shouldApplyAutoTitle(params: {
  /** 发起查询时的请求编号 */
  requestId: number;
  /** 当前最新请求编号 */
  latestRequestId: number;
  /** 发起查询时的 URL */
  requestUrl: string;
  /** 当前表单里的 URL */
  currentUrl: string;
  /** 当前标题来源 */
  titleSource: TitleSource;
  /** 当前标题内容 */
  currentTitle: string;
  /** 本次自动结果的来源 */
  candidateSource: TitleCandidate['source'];
  /** 编辑已有条目时为 true：自动结果只作为建议，不自动写入 */
  isEditing: boolean;
}): boolean {
  if (params.requestId !== params.latestRequestId) return false; // 有更新的请求，旧结果作废
  if (params.requestUrl !== params.currentUrl) return false; // URL 已变
  if (params.isEditing) return false; // 编辑已有条目默认保留名称，自动结果仅作建议
  // 用户已手填或已改名 -> 不覆盖
  if (params.titleSource === 'user') return false;
  // 已有自动名称时允许随 URL 更新（自动名称不归用户所有）
  if (params.titleSource === 'auto') return true;
  // 来源为空：仅在标题确实为空时填入
  return params.currentTitle.trim() === '';
}

/**
 * 快捷方式表单的「会话状态机」。
 *
 * 之所以把整个流程从组件里抽出来：异步回调的失效校验必须是**可被真实执行验证**的，
 * 只测 shouldApplyAutoTitle 的静态参数证明不了组件不会覆盖或串写。
 * 这里持有请求编号、会话编号与名称来源，所有异步写入前先过失效校验。
 *
 * 三条不变量：
 * 1. 用户手填的名称永不被自动结果覆盖（onTitleInput 同步置为 'user'）。
 * 2. 旧会话/旧请求的结果不得写入任何状态（编号在**所有**写入之前校验）。
 * 3. 建议只对「仍属于当前 URL」的候选生效。
 */
export interface ShortcutMetaDeps {
  readUrl(): string;
  readTitle(): string;
  resolve(input: string): { ok: boolean; url: string };
  lookup(targetUrl: string): Promise<TitleCandidate | null>;
  writeTitle(title: string): void;
  setPreview(url: string): void;
  setHint(hint: string): void;
  setSuggestedTitle(candidate: TitleCandidate | null): void;
}

export interface ShortcutMetaController {
  /** 打开弹窗（新增/编辑）时调用，作废此前所有在途请求 */
  beginSession(isEditing: boolean): void;
  /** 关闭弹窗或保存成功时调用，作废在途请求 */
  endSession(): void;
  onUrlBlur(): Promise<void>;
  onTitleInput(): void;
  /** URL 被改写：作废在途请求，不等它返回 */
  invalidate(): void;
  /** 点击建议按钮：候选必须仍属于当前 URL 才应用 */
  applySuggestion(candidate: TitleCandidate): boolean;
  currentSource(): TitleSource;
}

export function createShortcutMetaController(deps: ShortcutMetaDeps): ShortcutMetaController {
  let sessionId = 0;
  let requestId = 0;
  let source: TitleSource = 'empty';
  let editing = false;

  function beginSession(isEditing: boolean): void {
    sessionId += 1;
    requestId += 1;
    source = isEditing ? 'user' : 'empty'; // 编辑已有条目：名称归用户
    editing = isEditing;
    deps.setPreview('');
    deps.setHint('');
    deps.setSuggestedTitle(null);
  }

  function endSession(): void {
    sessionId += 1;
    requestId += 1;
    source = 'empty';
    editing = false;
  }

  /** 用户真实输入标题 -> 名称归用户所有。同步生效，在途回调立即看得到。 */
  function onTitleInput(): void {
    source = 'user';
  }

  /** 读取表单当前的规范化 URL，解析不出来时返回空串 */
  function currentUrl(): string {
    const resolved = deps.resolve(String(deps.readUrl() ?? ''));
    return resolved.ok ? resolved.url : '';
  }

  async function onUrlBlur(): Promise<void> {
    const raw = String(deps.readUrl() ?? '').trim();
    const resolved = deps.resolve(raw);
    deps.setPreview(resolved.ok ? resolved.url : '');
    deps.setSuggestedTitle(null);
    if (!resolved.ok) {
      deps.setHint(raw ? '不是有效网址，可继续手动填写' : '');
      return;
    }

    const mySession = sessionId;
    const myRequest = ++requestId;
    deps.setHint('正在查找本地名称…');

    const candidate = await deps.lookup(resolved.url);

    // 失效校验：必须在任何状态写入之前。会话/请求编号不符，或 URL 已变，一律直接返回。
    if (mySession !== sessionId || myRequest !== requestId) return;
    if (currentUrl() !== resolved.url) return;

    const apply =
      candidate != null &&
      shouldApplyAutoTitle({
        requestId: myRequest,
        latestRequestId: requestId,
        requestUrl: resolved.url,
        currentUrl: resolved.url,
        // 读取**当前**名称来源，而不是发起请求时的闭包快照
        titleSource: source,
        currentTitle: String(deps.readTitle() ?? ''),
        candidateSource: candidate.source,
        isEditing: editing,
      });

    if (candidate && apply) {
      deps.writeTitle(candidate.title);
      source = 'auto';
    }
    // 编辑已有条目时把自动结果作为「建议」呈现，由用户点击后替换
    if (candidate && editing) deps.setSuggestedTitle(candidate);

    let hintText = '未找到本地名称，可手动填写';
    if (candidate) {
      switch (candidate.source) {
        case 'tab':
          hintText = '已从当前标签页匹配名称';
          break;
        case 'bookmark':
          hintText = '已从本地书签匹配名称';
          break;
        case 'history':
          hintText = '已从浏览历史匹配名称';
          break;
        case 'preset':
          hintText = '已识别为常用知名站点';
          break;
        case 'domain':
          hintText = '已从域名提取站点名称';
          break;
      }
    }
    deps.setHint(hintText);
  }

  function applySuggestion(candidate: TitleCandidate): boolean {
    if (!candidate || candidate.url !== currentUrl()) return false;
    deps.writeTitle(candidate.title);
    source = 'user'; // 用户采纳了建议，名称自此归用户
    deps.setSuggestedTitle(null);
    return true;
  }

  function invalidate(): void {
    requestId += 1;
    deps.setSuggestedTitle(null);
    deps.setHint('');
  }

  return {
    beginSession,
    endSession,
    onUrlBlur,
    onTitleInput,
    invalidate,
    applySuggestion,
    currentSource: () => source,
  };
}
