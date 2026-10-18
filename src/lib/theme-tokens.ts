// 控制中心 / 控制弹窗 / 拦截确认页共用的配色令牌。
// 这三页的样式原本是内联字面量，深色模式需要按语义取值，故集中在此处。
// 语义参考工作台 style.css 的 --canvas / --surface / --ink 体系。

export interface ThemeTokens {
  /** 页面底色 */
  canvas: string;
  /** 卡片、输入框等承载面 */
  surface: string;
  /** 次级填充（标签、代码块、图标底座） */
  surfaceMuted: string;
  /** 悬停态填充 */
  surfaceHover: string;
  /** 主要文字 */
  ink: string;
  /** 次级文字 */
  ink2: string;
  /** 辅助文字 / 占位符 */
  ink3: string;
  /** 常规描边 */
  hairline: string;
  /** 强描边（虚线框、Kbd 底边） */
  hairlineStrong: string;
  /** 吸顶栏半透明底色 */
  stickyBg: string;
  /** 吸顶栏描边 */
  stickyBorder: string;
  /** 卡片投影 */
  shadowCard: string;
  /** 吸顶栏投影 */
  shadowSticky: string;
  /** 选中态浅底（对应浅色 #f5f3ff / #eef2ff） */
  accentSoft: string;
  /** 选中态描边 */
  accentBorder: string;
  /** 成功浅底与描边 */
  successSoft: string;
  successBorder: string;
  /** 危险浅底与描边 */
  dangerSoft: string;
  dangerBorder: string;
  /** 信息浅底与描边 */
  infoSoft: string;
  infoBorder: string;
  /** 危险文字（浅底上的深红 / 深底上的浅红） */
  dangerInk: string;
  /** 信息文字 */
  infoInk: string;
  /** 成功文字 */
  successInk: string;
  /** 中性提示浅底（浅色 #fafafa） */
  neutralSoft: string;
}

export const LIGHT_TOKENS: ThemeTokens = {
  canvas: '#f8fafc',
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9',
  surfaceHover: '#f8fafc',
  ink: '#0f172a',
  ink2: '#475569',
  ink3: '#64748b',
  hairline: '#e2e8f0',
  hairlineStrong: '#cbd5e1',
  stickyBg: 'rgba(255, 255, 255, 0.88)',
  stickyBorder: 'rgba(226, 232, 240, 0.8)',
  shadowCard: '0 1px 3px rgba(0, 0, 0, 0.04)',
  shadowSticky: '0 4px 20px -2px rgba(15, 23, 42, 0.05)',
  accentSoft: '#f5f3ff',
  accentBorder: '#ddd6fe',
  successSoft: '#f0fdf4',
  successBorder: '#86efac',
  dangerSoft: '#fef2f2',
  dangerBorder: '#fecaca',
  infoSoft: '#eff6ff',
  infoBorder: '#bfdbfe',
  dangerInk: '#991b1b',
  infoInk: '#1e40af',
  successInk: '#065f46',
  neutralSoft: '#fafafa',
};

export const DARK_TOKENS: ThemeTokens = {
  canvas: '#0f1115',
  surface: '#16181d',
  surfaceMuted: '#1e2127',
  surfaceHover: '#1e2127',
  ink: '#e8eaee',
  ink2: '#b3bac5',
  ink3: '#8f96a2',
  hairline: '#262a31',
  hairlineStrong: '#343941',
  stickyBg: 'rgba(22, 24, 29, 0.88)',
  stickyBorder: 'rgba(52, 58, 68, 0.8)',
  shadowCard: '0 1px 3px rgba(0, 0, 0, 0.4)',
  shadowSticky: '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
  accentSoft: '#23243a',
  accentBorder: '#3b3d63',
  successSoft: '#12261f',
  successBorder: '#1f4a3a',
  dangerSoft: '#2a1618',
  dangerBorder: '#4d2529',
  infoSoft: '#131e2e',
  infoBorder: '#23395a',
  dangerInk: '#f0a3a3',
  infoInk: '#9dbcf0',
  successInk: '#7fd6b4',
  neutralSoft: '#1a1d23',
};

/** 监听系统配色变化；返回取消订阅函数。 */
export function watchColorScheme(onChange: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}

/** 首次渲染时的系统配色。 */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 返回令牌。isDark 由调用方从主题偏好解析后传入，
 * 这样「浅色 / 深色 / 跟随系统」三态只需在 useThemeMode 里判断一次。
 */
export function useThemeTokens(isDark: boolean): { isDark: boolean; tk: ThemeTokens } {
  return { isDark, tk: isDark ? DARK_TOKENS : LIGHT_TOKENS };
}
