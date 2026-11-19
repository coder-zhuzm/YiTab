/**
 * 自适应检测 Chrome 本地图标库 (_favicon) 返回的单色图标明暗度。
 *
 * 背景：Chrome `_favicon` 仅缓存访问该站点时的单一静态位图（例如在系统深色模式下访问
 * GitHub 会缓存纯白 Octocat，浅色模式下访问 Vercel/GitHub 会缓存纯黑图标）。
 * 当用户在 YiTab 中手动切换浅/深色主题时，纯白图标落到浅色底座上（或纯黑图标落到深色底座上）
 * 会因对比度归零而「隐身」。
 *
 * 策略：在图片 onLoad 后将其绘制到 16x16 离屏画布，分析非透明像素的色度与亮度分布：
 * - 仅对「低饱和度 + 极亮无暗部」判定为 `light-mono`（浅色主题下反相为深色）
 * - 仅对「低饱和度 + 极暗无亮部」判定为 `dark-mono`（深色主题下反相为浅色）
 * - 彩色图标、自带黑字白底/白字黑底容器的图标、默认中灰地球占位图均判定为 `normal` 不做处理
 */

export type FaviconTone = 'normal' | 'light-mono' | 'dark-mono';

const toneCache = new Map<string, FaviconTone>();

/** 纯函数：根据 RGBA 像素数据判定图标单色明暗类别（便于单测） */
export function classifyRgbaPixels(data: Uint8ClampedArray): FaviconTone {
  const lums: number[] = [];
  let chromaSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 40) continue; // 忽略透明背景
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    chromaSum += max - min;
    lums.push(0.299 * r + 0.587 * g + 0.114 * b);
  }

  if (lums.length === 0) return 'normal';

  const avgChroma = chromaSum / lums.length;
  // 彩色品牌图标绝不反相
  if (avgChroma >= 28) return 'normal';

  lums.sort((a, b) => a - b);
  const avgLum = lums.reduce((s, v) => s + v, 0) / lums.length;
  const p10 = lums[Math.floor(lums.length * 0.1)];
  const p90 = lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.9))];

  // 纯白/极浅单色图标（且不含暗部笔画，排除「白底黑字」型图标）
  if (avgLum > 210 && p10 > 175) return 'light-mono';

  // 纯黑/极深单色图标（且不含亮部笔画，排除「黑底白字」型图标）
  if (avgLum < 55 && p90 < 85) return 'dark-mono';

  return 'normal';
}

/** 根据已加载的 <img> 元素检测图标明暗类别并缓存结果 */
export function detectFaviconTone(img: HTMLImageElement, cacheKey?: string): FaviconTone {
  const key = cacheKey || img.currentSrc || img.src;
  if (key && toneCache.has(key)) {
    return toneCache.get(key)!;
  }
  // data:image/svg+xml 为本地生成的首字母渐变图，无需分析
  if (!key || key.startsWith('data:')) {
    return 'normal';
  }
  try {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'normal';
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const tone = classifyRgbaPixels(data);
    toneCache.set(key, tone);
    return tone;
  } catch {
    // 跨域或环境不支持 canvas 时安全回退
    return 'normal';
  }
}

/** 计算给定图标在当前主题下是否需要反相以保证可见性 */
export function shouldInvertFavicon(tone: FaviconTone, isDark: boolean): boolean {
  return (tone === 'light-mono' && !isDark) || (tone === 'dark-mono' && isDark);
}
