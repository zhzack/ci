import { theme as antdThemeTokens } from 'antd';
import type { ThemeConfig } from 'antd';

const sharedToken = {
  colorPrimary: '#1677ff',
  borderRadius: 8,
  fontSize: 14,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

const LIGHT: ThemeConfig = {
  algorithm: antdThemeTokens.defaultAlgorithm,
  token: {
    ...sharedToken,
    colorBgLayout: '#f4f6fb',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: '#ffffff',
      bodyBg: '#f4f6fb',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#e6f4ff',
      itemSelectedColor: '#1677ff',
      itemHoverBg: '#f5f7fa',
      itemColor: '#475569',
      itemBorderRadius: 6,
      itemMarginInline: 8,
    },
    Card: {
      boxShadowTertiary: '0 1px 4px rgba(16,26,61,0.06)',
    },
    Table: {
      headerBg: '#f8fafc',
    },
  },
};

const DARK: ThemeConfig = {
  algorithm: antdThemeTokens.darkAlgorithm,
  token: {
    ...sharedToken,
    colorBgLayout: '#0e1220',
    colorBgContainer: '#141414',
    colorBgElevated: '#1a1f2c',
  },
  components: {
    Layout: {
      headerBg: '#141414',
      siderBg: '#141414',
      bodyBg: '#0e1220',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(22, 119, 255, 0.18)',
      itemSelectedColor: '#69b1ff',
      itemHoverBg: '#1f2430',
      itemColor: '#94a3b8',
      itemBorderRadius: 6,
      itemMarginInline: 8,
    },
    Card: {
      boxShadowTertiary: '0 1px 4px rgba(0,0,0,0.25)',
    },
    Table: {
      headerBg: '#1a1f2c',
    },
  },
};

export function antdThemeFor(mode: 'light' | 'dark'): ThemeConfig {
  return mode === 'dark' ? DARK : LIGHT;
}

