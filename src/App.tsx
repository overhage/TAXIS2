import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AdminPage from './pages/Admin';
import { useAuth } from './hooks/useAuth';

/**
 * The main application component sets up routing and enforces authentication.
 */
const App: React.FC = () => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  // Render nothing while loading user state
  if (isLoading) return null;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          user ? <DashboardPage /> : <Navigate to="/login" state={{ from: location }} replace />
        }
      />
      <Route
        path="/admin"
        element={
          user && user.isAdmin ? (
            <AdminPage />
          ) : (
            <Navigate to="/dashboard" state={{ from: location }} replace />
          )
        }
      />
      <Route
        path="/"
        element={<Navigate to={user ? '/dashboard' : '/login'} replace />}
      />
    </Routes>
  );
};

export default App;