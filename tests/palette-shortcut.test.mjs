import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatShortcutParts,
  getDefaultPaletteShortcut,
  matchesPaletteShortcut,
  parseKeyboardEventToShortcut,
  sanitizePaletteShortcut,
} from '../src/lib/palette-shortcut.ts';

test('parseKeyboardEventToShortcut requires a modifier and non-modifier key', () => {
  assert.equal(
    parseKeyboardEventToShortcut({
      code: 'KeyK',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    }),
    null,
  );
  assert.equal(
    parseKeyboardEventToShortcut({
      code: 'KeyK',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    }),
    null,
  );
  assert.equal(
    parseKeyboardEventToShortcut({
      code: 'MetaLeft',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    }),
    null,
  );

  assert.deepEqual(
    parseKeyboardEventToShortcut({
      code: 'KeyK',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    }),
    {
      code: 'KeyK',
      label: 'K',
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    },
  );
});

test('matchesPaletteShortcut matches exact modifiers via physical code and ignores IME', () => {
  const cfg = {
    enabled: true,
    code: 'KeyK',
    label: 'K',
    meta: false,
    ctrl: false,
    alt: true,
    shift: false,
  };

  // Option+K on macOS still has code KeyK even though e.key is '˚'
  assert.equal(
    matchesPaletteShortcut(
      { code: 'KeyK', metaKey: false, ctrlKey: false, altKey: true, shiftKey: false, isComposing: false },
      cfg,
    ),
    true,
  );

  // Extra Shift modifier must not match
  assert.equal(
    matchesPaletteShortcut(
      { code: 'KeyK', metaKey: false, ctrlKey: false, altKey: true, shiftKey: true, isComposing: false },
      cfg,
    ),
    false,
  );

  // IME composing must not trigger
  assert.equal(
    matchesPaletteShortcut(
      { code: 'KeyK', metaKey: false, ctrlKey: false, altKey: true, shiftKey: false, isComposing: true },
      cfg,
    ),
    false,
  );

  // Disabled shortcut must not trigger
  assert.equal(
    matchesPaletteShortcut(
      { code: 'KeyK', metaKey: false, ctrlKey: false, altKey: true, shiftKey: false, isComposing: false },
      { ...cfg, enabled: false },
    ),
    false,
  );
});

test('sanitizePaletteShortcut falls back safely on invalid or modifier-less payloads', () => {
  const macDefault = getDefaultPaletteShortcut(true);
  assert.deepEqual(sanitizePaletteShortcut(null, true), macDefault);
  assert.deepEqual(
    sanitizePaletteShortcut({ enabled: true, code: 'KeyK', meta: false, ctrl: false, alt: false }, true),
    { ...macDefault, enabled: true },
  );
});

test('formatShortcutParts formats platform-appropriate keycap labels', () => {
  assert.deepEqual(
    formatShortcutParts({ code: 'KeyK', label: 'K', meta: true, ctrl: false, alt: false, shift: false }, true),
    ['⌘', 'K'],
  );
  assert.deepEqual(
    formatShortcutParts({ code: 'Space', label: 'Space', meta: false, ctrl: true, alt: false, shift: true }, false),
    ['Ctrl', 'Shift', 'Space'],
  );
});
