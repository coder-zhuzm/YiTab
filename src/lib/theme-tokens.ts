// 控制中心 / 控制弹窗 / 拦截确认页共用的 Precision Slate 配色令牌。
// 统一对齐 DESIGN.md 规范与工作台 style.css 的色彩层级。

export interface ThemeTokens {
  /** 页面底色 */
  canvas: string;
  /** 卡片、输入框等承载面 */
  surface: string;
  /** 次级填充（凹槽轨道、标签、代码块、图标底座） */
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
  /** 卡片投影（单声明环形阴影） */
  shadowCard: string;
  /** 吸顶栏投影 */
  shadowSticky: string;
  /** 品牌主色（按钮背景、边框强调） */
  accent: string;
  /** 品牌悬停色 */
  accentHover: string;
  /** 品牌文字色（深色模式下提亮以满足 WCAG AA 对比度） */
  accentInk: string;
  /** 选中态浅底 */
  accentSoft: string;
  /** 选中态描边 / 环形边框 */
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
  /** 警告浅底与描边 */
  warnSoft: string;
  warnBorder: string;
  /** 危险文字 */
  dangerInk: string;
  /** 信息文字 */
  infoInk: string;
  /** 成功文字 */
  successInk: string;
  /** 警告文字 */
  warnInk: string;
  /** 中性提示浅底 */
  neutralSoft: string;
}

export const LIGHT_TOKENS: ThemeTokens = {
  canvas: '#f2f4f7',
  surface: '#ffffff',
  surfaceMuted: '#eaeef4',
  surfaceHover: '#f4f6f9',
  ink: '#111318',
  ink2: '#464f5e',
  ink3: '#525d70',
  hairline: '#dfe4ec',
  hairlineStrong: '#c8d0dc',
  stickyBg: 'rgba(255, 255, 255, 0.90)',
  stickyBorder: '#dfe4ec',
  shadowCard:
    '0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.05), 0 4px 14px -4px oklch(0 0 0 / 0.05)',
  shadowSticky: '0 1px 0 #dfe4ec, 0 6px 20px -6px rgba(17, 19, 24, 0.08)',
  accent: '#2563eb',
  accentHover: '#1d4ed8',
  accentInk: '#2563eb',
  accentSoft: 'rgba(37, 99, 235, 0.09)',
  accentBorder: 'rgba(37, 99, 235, 0.24)',
  successSoft: 'rgba(15, 118, 110, 0.10)',
  successBorder: 'rgba(15, 118, 110, 0.24)',
  dangerSoft: 'rgba(220, 38, 38, 0.10)',
  dangerBorder: 'rgba(220, 38, 38, 0.24)',
  infoSoft: 'rgba(37, 99, 235, 0.08)',
  infoBorder: 'rgba(37, 99, 235, 0.22)',
  warnSoft: 'rgba(180, 83, 9, 0.09)',
  warnBorder: 'rgba(180, 83, 9, 0.24)',
  dangerInk: '#b91c1c',
  infoInk: '#1d4ed8',
  successInk: '#0f766e',
  warnInk: '#b45309',
  neutralSoft: '#eaeef4',
};

export const DARK_TOKENS: ThemeTokens = {
  canvas: '#0b0d11',
  surface: '#13161c',
  surfaceMuted: '#1a1e26',
  surfaceHover: '#1d222b',
  ink: '#edf0f5',
  ink2: '#a6b0c0',
  ink3: '#939dae',
  hairline: '#232833',
  hairlineStrong: '#323947',
  stickyBg: 'rgba(19, 22, 28, 0.90)',
  stickyBorder: '#232833',
  shadowCard: '0 0 0 1px oklch(1 0 0 / 0.07), 0 8px 24px -8px rgba(0, 0, 0, 0.55)',
  shadowSticky: '0 1px 0 #232833, 0 8px 24px -6px rgba(0, 0, 0, 0.55)',
  accent: '#2563eb',
  accentHover: '#1d4ed8',
  accentInk: '#60a5fa',
  accentSoft: 'rgba(96, 165, 250, 0.14)',
  accentBorder: 'rgba(96, 165, 250, 0.28)',
  successSoft: 'rgba(45, 212, 191, 0.14)',
  successBorder: 'rgba(45, 212, 191, 0.28)',
  dangerSoft: 'rgba(248, 113, 113, 0.14)',
  dangerBorder: 'rgba(248, 113, 113, 0.28)',
  infoSoft: 'rgba(96, 165, 250, 0.14)',
  infoBorder: 'rgba(96, 165, 250, 0.28)',
  warnSoft: 'rgba(251, 191, 36, 0.12)',
  warnBorder: 'rgba(251, 191, 36, 0.28)',
  dangerInk: '#f87171',
  infoInk: '#93c5fd',
  successInk: '#2dd4bf',
  warnInk: '#fbbf24',
  neutralSoft: '#1a1e26',
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
