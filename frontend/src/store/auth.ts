import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loadStoredAuth, type StoredAuth } from '@/api/http';

import type { CurrentUser } from '@/api/auth';

type AuthStore = {
  token: string | null;
  user: CurrentUser | null;
  setAuth: (auth: StoredAuth) => void;
  setUser: (user: CurrentUser) => void;
  clear: () => void;
};

/**
 * Session state (token + user), persisted to localStorage by the zustand
 * persist middleware under the same key the axios interceptor reads.
 */
export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: loadStoredAuth()?.token ?? null,
      user: loadStoredAuth()?.user ?? null,
      setAuth: (auth) => set({ token: auth.token, user: auth.user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: 'mini-pipeline-auth' },
  ),
);

