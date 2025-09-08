// src/session/SessionProvider.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
type User = { sub: string; email?: string; name?: string; provider?: 'google'|'github'; roles?: string[] };
type SessionState = { loading: boolean; user: User | null };

const Ctx = createContext<SessionState>({ loading: true, user: null });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, set] = useState<SessionState>({ loading: true, user: null });
  useEffect(() => {
    let cancel = false;
    (async () => {
      const r = await fetch('/.netlify/functions/session', { credentials: 'include' });
      if (cancel) return;
      if (r.ok) set({ loading: false, user: (await r.json()).user });
      else set({ loading: false, user: null });
    })();
    return () => { cancel = true };
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx);
