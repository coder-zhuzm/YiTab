/**
 * 命令面板页内自定义快捷键配置与匹配工具
 * 使用 KeyboardEvent.code 进行物理键位匹配，避免 macOS 下 Option+K 输出特殊字符导致匹配失效。
 */

export const PALETTE_SHORTCUT_STORAGE_KEY = 'yitab_palette_shortcut';

export interface PaletteShortcutConfig {
  /** 是否启用页内自定义快捷键 */
  enabled: boolean;
  /** 物理键位 code（例如 KeyK、Space、KeyP） */
  code: string;
  /** 展示用键名（例如 K、Space、P） */
  label: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const MODIFIER_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'CapsLock',
]);

const SPECIAL_CODE_LABELS: Record<string, string> = {
  Space: 'Space',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
};

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
}

export function getDefaultPaletteShortcut(isMac = isMacPlatform()): PaletteShortcutConfig {
  return {
    enabled: false,
    code: 'KeyK',
    label: 'K',
    meta: isMac,
    ctrl: !isMac,
    alt: false,
    shift: false,
  };
}

export function codeToKeyLabel(code: string): string | null {
  if (!code || MODIFIER_CODES.has(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code in SPECIAL_CODE_LABELS) return SPECIAL_CODE_LABELS[code];
  return null;
}

export function sanitizePaletteShortcut(
  raw: unknown,
  isMac = isMacPlatform(),
): PaletteShortcutConfig {
  const fallback = getDefaultPaletteShortcut(isMac);
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Partial<PaletteShortcutConfig>;
  const code = typeof obj.code === 'string' && codeToKeyLabel(obj.code) ? obj.code : fallback.code;
  const label = codeToKeyLabel(code) ?? fallback.label;
  const meta = obj.meta === true;
  const ctrl = obj.ctrl === true;
  const alt = obj.alt === true;
  const shift = obj.shift === true;

  // 至少需要一个主修饰键（Meta / Ctrl / Alt），避免单键或 Shift+字母劫持正常打字
  if (!meta && !ctrl && !alt) {
    return {
      ...fallback,
      enabled: obj.enabled === true,
    };
  }

  return {
    enabled: obj.enabled === true,
    code,
    label,
    meta,
    ctrl,
    alt,
    shift,
  };
}

/**
 * 将录制到的键盘事件解析为快捷键配置（不含 enabled）；若不合法（如缺少修饰键或仅为修饰键）返回 null
 */
export function parseKeyboardEventToShortcut(
  e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): Omit<PaletteShortcutConfig, 'enabled'> | null {
  const label = codeToKeyLabel(e.code);
  if (!label) return null;
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;

  return {
    code: e.code,
    label,
    meta: e.metaKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
  };
}

/**
 * 判断按键事件是否命中自定义命令面板快捷键
 */
export function matchesPaletteShortcut(
  e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>,
  cfg: PaletteShortcutConfig,
): boolean {
  if (!cfg.enabled) return false;
  if (e.isComposing) return false;
  if (e.code !== cfg.code) return false;
  return (
    e.metaKey === cfg.meta &&
    e.ctrlKey === cfg.ctrl &&
    e.altKey === cfg.alt &&
    e.shiftKey === cfg.shift
  );
}

/**
 * 格式化为用于键帽渲染的按键数组，例如 ['⌘', 'K'] 或 ['Ctrl', 'Shift', 'K']
 */
export function formatShortcutParts(
  cfg: Pick<PaletteShortcutConfig, 'label' | 'code' | 'meta' | 'ctrl' | 'alt' | 'shift'>,
  isMac = isMacPlatform(),
): string[] {
  const parts: string[] = [];
  if (cfg.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (cfg.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (cfg.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (cfg.meta) parts.push(isMac ? '⌘' : 'Win');
  parts.push(cfg.label || codeToKeyLabel(cfg.code) || cfg.code);
  return parts;
}

export function getShortcutPresets(isMac = isMacPlatform()): Omit<PaletteShortcutConfig, 'enabled'>[] {
  if (isMac) {
    return [
      { code: 'KeyK', label: 'K', meta: true, ctrl: false, alt: false, shift: false },
      { code: 'KeyK', label: 'K', meta: true, ctrl: false, alt: false, shift: true },
      { code: 'KeyK', label: 'K', meta: false, ctrl: false, alt: true, shift: false },
      { code: 'Space', label: 'Space', meta: false, ctrl: false, alt: true, shift: false },
    ];
  }
  return [
    { code: 'KeyK', label: 'K', meta: false, ctrl: false, alt: true, shift: false },
    { code: 'KeyK', label: 'K', meta: false, ctrl: true, alt: false, shift: false },
    { code: 'KeyK', label: 'K', meta: false, ctrl: false, alt: true, shift: true },
    { code: 'Space', label: 'Space', meta: false, ctrl: false, alt: true, shift: false },
  ];
}

export async function getPaletteShortcut(): Promise<PaletteShortcutConfig> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
    return getDefaultPaletteShortcut();
  }
  try {
    const res = await chrome.storage.sync.get(PALETTE_SHORTCUT_STORAGE_KEY);
    return sanitizePaletteShortcut(res[PALETTE_SHORTCUT_STORAGE_KEY]);
  } catch {
    return getDefaultPaletteShortcut();
  }
}

export async function savePaletteShortcut(
  cfg: PaletteShortcutConfig,
): Promise<PaletteShortcutConfig> {
  const clean = sanitizePaletteShortcut(cfg);
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    await chrome.storage.sync.set({ [PALETTE_SHORTCUT_STORAGE_KEY]: clean });
  }
  return clean;
}
