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

// Production: empty string → same-origin via Vercel proxy. Local dev: VITE_API_URL.
const API_BASE = import.meta.env.VITE_API_URL || '';

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
            // BUG-224: Specific error messages based on status
            const message = res.status === 401
              ? 'Invalid email or password'
              : res.status === 429
                ? 'Too many attempts. Please wait and try again.'
                : json.error?.message || 'Login failed';
            set({ isLoggingIn: false, loginError: message });
            return;
          }
          set({
            isAuthenticated: true,
            user: json.data.admin,
            token: json.data.access_token,
            isLoggingIn: false,
            loginError: null,
          });
        } catch (err) {
          // BUG-224: Specific error messages instead of generic "Network error"
          const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
          const message = isOffline
            ? 'No internet connection. Check your network and try again.'
            : 'Server unreachable. Please check your connection or try again later.';
          set({ isLoggingIn: false, loginError: message });
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
