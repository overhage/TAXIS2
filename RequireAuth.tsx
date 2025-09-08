// src/routes/RequireAuth.tsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../session/SessionProvider';

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { loading, user } = useSession();
  const loc = useLocation();

  if (loading) return null;      // ← DO NOT redirect while loading
  if (user) return children;

  // SPA navigation fallback (Edge handles hard loads)
  if (loc.pathname !== '/login') {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return children;
}
