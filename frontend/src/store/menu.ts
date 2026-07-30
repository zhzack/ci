import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type MenuStore = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
};

export const useMenuStore = create<MenuStore>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    { name: 'mini-pipeline-menu' },
  ),
);
