/**
 * 干净链接提取与 Markdown 链接格式化（零网络请求，纯函数）。
 * 自动剥离常见营销/追踪参数，保留所有业务与内容参数。
 */

const TRACKING_EXACT = new Set([
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'spm',
  'spm_id_from',
  'vd_source',
  'share_source',
  'share_medium',
  'share_plat',
  'share_session_id',
  'share_tag',
  'share_times',
  'bbid',
  'ts',
  'igshid',
  'si',
  'feature',
]);

export function stripTrackingParams(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    if (!/^https?:$/i.test(u.protocol)) return trimmed;
    const keys = [...u.searchParams.keys()];
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_EXACT.has(lower)) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

export function formatCleanMarkdownLink(title: string, rawUrl: string): string {
  const cleanUrl = stripTrackingParams(rawUrl);
  const safeTitle = (title || cleanUrl)
    .trim()
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  return `[${safeTitle}](${cleanUrl})`;
}
