import { theme as antdThemeTokens } from 'antd';
import type { ThemeConfig } from 'antd';

const LIGHT: ThemeConfig = {
  algorithm: antdThemeTokens.defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: '#001529',
      bodyBg: '#f5f6f8',
    },
    Menu: {
      darkItemBg: '#001529',
    },
  },
};

const DARK: ThemeConfig = {
  algorithm: antdThemeTokens.darkAlgorithm,
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: '#1f1f1f',
      siderBg: '#141414',
      bodyBg: '#0f0f0f',
    },
    Menu: {
      darkItemBg: '#141414',
    },
  },
};

export function antdThemeFor(mode: 'light' | 'dark'): ThemeConfig {
  return mode === 'dark' ? DARK : LIGHT;
}
