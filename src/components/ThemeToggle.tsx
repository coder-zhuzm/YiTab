// 主题切换控件。Options 用完整三态，Popup / Confirm 用单键循环。
import React from 'react';
import { Button, Dropdown, Tooltip } from 'antd';
import {
  DesktopOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { ThemeMode } from '@/lib/theme-mode';

export const THEME_MODE_META: Record<ThemeMode, { label: string; icon: React.ReactNode }> = {
  system: { label: '跟随系统', icon: <DesktopOutlined /> },
  light: { label: '浅色', icon: <SunOutlined /> },
  dark: { label: '深色', icon: <MoonOutlined /> },
};

const CYCLE: ThemeMode[] = ['system', 'light', 'dark'];

/** 三态下拉，用于设置页。 */
export function ThemeModeDropdown({
  mode,
  onChange,
  ink3,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  ink3: string;
}) {
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectable: true,
        selectedKeys: [mode],
        items: CYCLE.map((m) => ({
          key: m,
          icon: THEME_MODE_META[m].icon,
          label: THEME_MODE_META[m].label,
        })),
        onClick: ({ key }) => onChange(key as ThemeMode),
      }}
    >
      <Button size="small" icon={THEME_MODE_META[mode].icon} style={{ color: ink3 }}>
        {THEME_MODE_META[mode].label}
      </Button>
    </Dropdown>
  );
}

/** 单键循环切换，用于空间有限的 Popup / Confirm。 */
export function ThemeModeButton({
  mode,
  onChange,
  ink3,
  size = 'small',
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  ink3: string;
  size?: 'small' | 'middle';
}) {
  const next = CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
  return (
    <Tooltip title={`主题：${THEME_MODE_META[mode].label}（点击切换为${THEME_MODE_META[next].label}）`}>
      <Button
        type="text"
        size={size}
        aria-label={`主题：${THEME_MODE_META[mode].label}`}
        icon={React.cloneElement(
          THEME_MODE_META[mode].icon as React.ReactElement,
          { style: { fontSize: 13, color: ink3 } },
        )}
        onClick={() => onChange(next)}
      />
    </Tooltip>
  );
}
