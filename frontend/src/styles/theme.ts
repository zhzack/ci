import { theme as antdThemeTokens } from 'antd';
import type { ThemeConfig } from 'antd';

const sharedToken = {
  colorPrimary: '#4056f4',
  borderRadius: 8,
  fontSize: 14,
  fontFamily:
    "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

const LIGHT: ThemeConfig = {
  algorithm: antdThemeTokens.defaultAlgorithm,
  token: {
    ...sharedToken,
    colorBgLayout: '#f4f6fb',
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: '#101a3d',
      bodyBg: '#f4f6fb',
    },
    Menu: {
      darkItemBg: '#101a3d',
      darkItemSelectedBg: '#4056f4',
      darkItemColor: 'rgba(255,255,255,0.72)',
      darkItemSelectedColor: '#ffffff',
    },
    Card: {
      boxShadowTertiary: '0 1px 4px rgba(16,26,61,0.08)',
    },
    Table: {
      headerBg: '#f7f8fd',
    },
  },
};

const DARK: ThemeConfig = {
  algorithm: antdThemeTokens.darkAlgorithm,
  token: {
    ...sharedToken,
    colorBgLayout: '#0e1220',
  },
  components: {
    Layout: {
      headerBg: '#151b30',
      siderBg: '#0d1226',
      bodyBg: '#0e1220',
    },
    Menu: {
      darkItemBg: '#0d1226',
      darkItemSelectedBg: '#4056f4',
    },
  },
};

export function antdThemeFor(mode: 'light' | 'dark'): ThemeConfig {
  return mode === 'dark' ? DARK : LIGHT;
}
