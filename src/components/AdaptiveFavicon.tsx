import { useEffect, useRef, useState } from 'react';
import {
  detectFaviconTone,
  shouldInvertFavicon,
  type FaviconTone,
} from '@/lib/favicon-tone';

export interface AdaptiveFaviconProps {
  src: string;
  fallback: string;
  isDark: boolean;
  className?: string;
}

/**
 * 主题自适应站点图标：
 * 自动识别 Chrome `_favicon` 缓存的单色纯白/纯黑图标，并在浅/深色主题不匹配时反相，
 * 避免如「系统深色下缓存的白色 GitHub 图标在浅色工作台隐身」的问题。
 */
export function AdaptiveFavicon({ src, fallback, isDark, className }: AdaptiveFaviconProps) {
  const [imgSrc, setImgSrc] = useState(src);
  const [tone, setTone] = useState<FaviconTone>('normal');
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setImgSrc(src);
    setTone('normal');
  }, [src]);

  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0 && imgSrc !== fallback) {
      setTone(detectFaviconTone(el, imgSrc));
    }
  }, [imgSrc, fallback]);

  const invert = imgSrc !== fallback && shouldInvertFavicon(tone, isDark);
  const mergedClass = [className, invert ? 'yt-favicon-invert' : ''].filter(Boolean).join(' ');

  return (
    <img
      ref={imgRef}
      src={imgSrc}
      alt=""
      className={mergedClass || undefined}
      onLoad={(e) => {
        if (imgSrc === fallback) {
          setTone('normal');
          return;
        }
        setTone(detectFaviconTone(e.currentTarget, imgSrc));
      }}
      onError={() => {
        if (imgSrc !== fallback) {
          setImgSrc(fallback);
          setTone('normal');
        }
      }}
    />
  );
}
