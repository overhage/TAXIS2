import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

// ---- Page modules (adjust paths to your project structure) -----------------
import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import AdminPage from './pages/Admin'
// If you created these, uncomment the imports and routes below
// import TermsPage from './pages/Terms'
// import PrivacyPage from './pages/Privacy'

// ----------------------------------------------------------------------------
// Centralized session handling that trusts the server via /api/session.
// This avoids trying to read HttpOnly cookies in JS (which is impossible) and
// fixes the classic "login → login" redirect loop.
// ----------------------------------------------------------------------------

type User = {
  email?: string
  name?: string
  sub?: string
  isAdmin?: boolean
}

type SessionState = {
  loading: boolean
  user: User | null
  authenticated: boolean
  refresh: () => Promise<void>
}

const SessionCtx = createContext<SessionState | null>(null)

function useSessionInternal(): SessionState {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  const refresh = async () => {
    try {
      const r = await fetch('/api/session', { credentials: 'include' })
      if (!r.ok) throw new Error('session fetch failed')
      const data = await r.json()
      setUser(data?.authenticated ? (data.user as User) ?? {} : null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // initial load
    refresh()
  }, [])

  useEffect(() => {
    // refresh when tab regains focus
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return useMemo(() => ({ loading, user, authenticated: !!user, refresh }), [loading, user])
}

export function useSession() {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>')
  return ctx
}

function SessionProvider({ children }: { children: React.ReactNode }) {
  const state = useSessionInternal()
  return <SessionCtx.Provider value={state}>{children}</SessionCtx.Provider>
}

// ----------------------------------------------------------------------------
// Route guards
// ----------------------------------------------------------------------------

function RequireAuth({ children }: { children: JSX.Element }) {
  const { loading, authenticated } = useSession()
  const location = useLocation()
  if (loading) return null // or a spinner
  return authenticated ? children : <Navigate to="/login" state={{ from: location }} replace />
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { loading, user } = useSession()
  const location = useLocation()
  if (loading) return null
  return user && user.isAdmin ? children : <Navigate to="/dashboard" state={{ from: location }} replace />
}

// ----------------------------------------------------------------------------
// Not found (simple)
// ----------------------------------------------------------------------------

function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f9fafb' }}>
      <div style={{ background: '#fff', padding: '2rem', borderRadius: 16, boxShadow: '0 10px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>Page not found</h1>
        <p><a href="/">Go home</a></p>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// App (Routes)
// ----------------------------------------------------------------------------

const App: React.FC = () => {
  const location = useLocation()
  return (
    <SessionProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        {/* Uncomment if you created the pages */}
        {/* <Route path="/terms" element={<TermsPage />} /> */}
        {/* <Route path="/privacy" element={<PrivacyPage />} /> */}

        {/* Protected routes */}
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />

        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />

        {/* Default routes */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SessionProvider>
  )
}

export default App
