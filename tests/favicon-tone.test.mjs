import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRgbaPixels, shouldInvertFavicon } from '../src/lib/favicon-tone.ts';

function makePixels(colors) {
  const out = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b, a], idx) => {
    out[idx * 4] = r;
    out[idx * 4 + 1] = g;
    out[idx * 4 + 2] = b;
    out[idx * 4 + 3] = a;
  });
  return out;
}

test('classifyRgbaPixels detects white monochrome icon on transparent bg (GitHub dark cache)', () => {
  const pixels = makePixels([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [248, 250, 252, 255],
    [255, 255, 255, 255],
  ]);
  const tone = classifyRgbaPixels(pixels);
  assert.equal(tone, 'light-mono');
  assert.equal(shouldInvertFavicon(tone, false), true);
  assert.equal(shouldInvertFavicon(tone, true), false);
});

test('classifyRgbaPixels detects black monochrome icon on transparent bg (Vercel/GitHub light cache)', () => {
  const pixels = makePixels([
    [0, 0, 0, 0],
    [15, 17, 21, 255],
    [0, 0, 0, 255],
    [20, 20, 24, 255],
  ]);
  const tone = classifyRgbaPixels(pixels);
  assert.equal(tone, 'dark-mono');
  assert.equal(shouldInvertFavicon(tone, true), true);
  assert.equal(shouldInvertFavicon(tone, false), false);
});

test('classifyRgbaPixels leaves colorful, white-card-with-dark-logo, and gray placeholder untouched', () => {
  // Colorful icon (Google / Sentry)
  const colorful = makePixels([
    [66, 133, 244, 255],
    [234, 67, 53, 255],
    [251, 188, 5, 255],
    [52, 168, 83, 255],
  ]);
  assert.equal(classifyRgbaPixels(colorful), 'normal');

  // White square with black 'N' (Notion-style)
  const whiteCardDarkLogo = makePixels([
    [255, 255, 255, 255],
    [255, 255, 255, 255],
    [255, 255, 255, 255],
    [255, 255, 255, 255],
    [20, 20, 20, 255],
    [20, 20, 20, 255],
  ]);
  assert.equal(classifyRgbaPixels(whiteCardDarkLogo), 'normal');

  // Chrome default gray globe placeholder
  const grayGlobe = makePixels([
    [0, 0, 0, 0],
    [118, 122, 128, 255],
    [125, 128, 132, 255],
  ]);
  assert.equal(classifyRgbaPixels(grayGlobe), 'normal');
});
