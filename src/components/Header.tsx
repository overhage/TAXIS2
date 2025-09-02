import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface HeaderProps {
  title: string;
}

/**
 * Header displayed on every page. Includes the owl logo, project name, page
 * title, navigation links and a logout button when a user is authenticated.
 */
const Header: React.FC<HeaderProps> = ({ title }) => {
  const { user } = useAuth();
  const location = useLocation();

  const handleLogout = () => {
    window.location.href = '/api/logout';
  };

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 1rem',
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: '#fff'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img
          src="/logo.png"
          alt="TAXIS owl logo"
          style={{ height: '40px', marginRight: '0.75rem' }}
        />
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>OHDSI TAXIS</h1>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>{title}</p>
        </div>
      </div>
      {user && (
        <nav style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link
            to="/dashboard"
            style={{
              color: location.pathname === '/dashboard' ? '#111827' : '#6b7280',
              fontWeight: location.pathname === '/dashboard' ? 600 : 500
            }}
          >
            My Jobs
          </Link>
          {user.isAdmin && (
            <Link
              to="/admin"
              style={{
                color: location.pathname === '/admin' ? '#111827' : '#6b7280',
                fontWeight: location.pathname === '/admin' ? 600 : 500
              }}
            >
              Admin
            </Link>
          )}
          <button
            onClick={handleLogout}
            style={{
              padding: '0.25rem 0.75rem',
              backgroundColor: '#2563eb',
              color: '#fff',
              borderRadius: '0.25rem',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Logout
          </button>
        </nav>
      )}
    </header>
  );
};

export default Header;