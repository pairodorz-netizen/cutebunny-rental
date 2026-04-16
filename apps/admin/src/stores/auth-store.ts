import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: AdminUser | null;
  token: string | null;
  loginError: string | null;
  isLoggingIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      user: null,
      token: null,
      loginError: null,
      isLoggingIn: false,
      login: async (email: string, password: string) => {
        set({ isLoggingIn: true, loginError: null });
        try {
          const res = await fetch(`${API_BASE}/api/v1/admin/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const json = await res.json();
          if (!res.ok) {
            set({ isLoggingIn: false, loginError: json.error?.message || 'Login failed' });
            return;
          }
          set({
            isAuthenticated: true,
            user: json.data.admin,
            token: json.data.access_token,
            isLoggingIn: false,
            loginError: null,
          });
        } catch {
          set({ isLoggingIn: false, loginError: 'Network error. Please try again.' });
        }
      },
      logout: () => {
        set({ isAuthenticated: false, user: null, token: null, loginError: null });
      },
      clearError: () => set({ loginError: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        token: state.token,
      }),
    }
  )
);
