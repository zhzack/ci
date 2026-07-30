import { create } from 'zustand';

export type UserProfile = {
  name: string;
  role: string;
};

type UserStore = {
  user: UserProfile;
  setUser: (user: UserProfile) => void;
};

const defaultUser: UserProfile = {
  name: 'Pipeline Operator',
  role: 'admin',
};

export const useUserStore = create<UserStore>((set) => ({
  user: defaultUser,
  setUser: (user) => set({ user }),
}));
