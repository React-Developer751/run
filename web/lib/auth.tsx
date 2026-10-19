'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Session state only. The tokens live in HttpOnly cookies that JavaScript cannot read;
 * "am I signed in?" is answered by asking the server (/me, which silently refreshes when needed).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Older versions kept the login token in localStorage. Remove any leftovers: tokens now live only in HttpOnly cookies.
    try {
      localStorage.removeItem('hostx_token');
      localStorage.removeItem('hostx_theme');
    } catch {
      /* storage blocked */
    }
    let cancelled = false;
    api
      .me()
      .then((r) => !cancelled && setUser(r.user))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));

    const onSignedOut = () => setUser(null);
    window.addEventListener('hostx:signed-out', onSignedOut);
    return () => {
      cancelled = true;
      window.removeEventListener('hostx:signed-out', onSignedOut);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser((await api.login(email, password)).user);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    setUser((await api.register(name, email, password)).user);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signUp, signOut }), [user, loading, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Redirects to /login when signed out. Returns the user once known. */
export function useRequireAuth(): User | null {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);
  return user;
}
