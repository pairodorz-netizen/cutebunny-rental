import { create } from 'zustand';

interface AuthState {
  isAuthenticated: boolean;
  user: { email: string; name: string } | null;
  login: (email: string, _password: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  login: (email: string, _password: string) => {
    set({
      isAuthenticated: true,
      user: { email, name: 'Admin User' },
    });
  },
  logout: () => {
    set({ isAuthenticated: false, user: null });
  },
}));
