import React, { createContext, useContext, useEffect, useState } from 'react';

export type User = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  roles?: string[];
  // derived
  displayName?: string;
  isAdmin?: boolean;
};

type SessionState = {
  loading: boolean;
  user: User | null;
  refresh: () => Promise<void>;
};

const SessionCtx = createContext<SessionState>({
  loading: true,
  user: null,
  refresh: async () => {},
});

function normalize(u: any): User {
  const roles = Array.isArray(u?.roles) ? u.roles : [];
  const isAdmin = !!(u?.isAdmin || roles.includes('admin'));
  const displayName = u?.name || (u?.email ? String(u.email).split('@')[0] : 'User');
  return { ...u, roles, isAdmin, displayName };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = async () => {
    try {
      // Use '/api/session' if you have the redirect in netlify.toml; otherwise use '/.netlify/functions/session'
      const r = await fetch('/api/session', { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        setUser(data?.user ? normalize(data.user) : null);
      } else if (r.status === 401) {
        setUser(null);
      } else {
        console.error('session fetch failed', r.status);
        setUser(null);
      }
    } catch (e) {
      console.error('session fetch error', e);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SessionCtx.Provider value={{ loading, user, refresh }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  return useContext(SessionCtx);
}
