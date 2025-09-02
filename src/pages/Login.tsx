import React from 'react';

/**
 * Simple login page prompting the user to sign in with GitHub. The
 * authentication flow is handled server‑side via a Netlify function.
 */
const LoginPage: React.FC = () => {
  const handleLogin = () => {
    window.location.href = '/api/login';
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '4rem' }}>
      <img src="/logo.png" alt="Owl logo" style={{ width: '80px', marginBottom: '1rem' }} />
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Sign in to OHDSI TAXIS</h2>
      <button
        onClick={handleLogin}
        style={{
          backgroundColor: '#000',
          color: '#fff',
          padding: '0.5rem 1rem',
          borderRadius: '0.25rem',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        Login with GitHub
      </button>
    </div>
  );
};

export default LoginPage;