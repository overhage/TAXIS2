'use client'

import React, { useState } from 'react'

export default function Login() {
  const [loading, setLoading] = useState<null | 'google' | 'github'>(null)

  function handleLogin(provider: 'google' | 'github') {
    if (loading) return
    setLoading(provider)
    // Redirect to our Netlify function proxy: /api/login?provider=...
    window.location.assign(`/api/login?provider=${provider}`)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-white shadow-lg rounded-2xl p-8 space-y-6">
          <header className="text-center space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight">TAXIS Sign in</h1>
            <p className="text-xs text-gray-500 max-w-md mx-auto">The Greek word τάξις (táxis) means "arrangement," "order," or "rank". It is derived from the verb tassō, meaning "to arrange or order.  The goal of the TAXIS project is to arrange or order clinical knowledge in order to faclitate its use at scale."</p>
            <p className="text-sm text-gray-500">Choose a provider to continue</p>
          </header>

          <div className="space-y-3">
            {/* Google */}
            <button
              onClick={() => handleLogin('google')}
              disabled={!!loading}
              className="w-full inline-flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 px-4 py-3 text-sm font-medium shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <GoogleIcon className="h-5 w-5" />
              {loading === 'google' ? 'Redirecting…' : 'Continue with Google'}
            </button>

            {/* GitHub */}
            <button
              onClick={() => handleLogin('github')}
              disabled={!!loading}
              className="w-full inline-flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 px-4 py-3 text-sm font-medium shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <GitHubIcon className="h-5 w-5" />
              {loading === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
            </button>
          </div>

          <div className="pt-2 text-center text-xs text-gray-500">
            By continuing you agree to our <a href="/terms" className="underline">Terms</a> and <a href="/privacy" className="underline">Privacy Policy</a>.
          </div>

          {/* Progressive enhancement fallback (in case JS is blocked) */}
          <noscript>
            <div className="text-center text-sm text-gray-500">
              JavaScript is disabled. Use these links: <a className="underline" href="/api/login?provider=google">Google</a> • <a className="underline" href="/api/login?provider=github">GitHub</a>
            </div>
          </noscript>
        </div>
      </div>
    </div>
  )
}

function GoogleIcon({ className = '' }: { className?: string }) {
  // Simple multi-path Google "G" (SVG, no external deps)
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 11h11a11 11 0 1 1-3.2-7.8l-3.1 2.6A6.5 6.5 0 1 0 18.5 12c0-.7-.1-1.3-.3-2H12v1z" />
      <path fill="#FBBC05" d="M1.5 7.3l3.6 2.6A6.5 6.5 0 0 0 12 5.5V2.1A10 10 0 0 0 1.5 7.3z" />
      <path fill="#34A853" d="M12 22a10 10 0 0 0 6.9-2.7l-3.3-2.7A6.5 6.5 0 0 1 5.1 13l-3.6 2.6A10 10 0 0 0 12 22z" />
      <path fill="#4285F4" d="M23 12c0-.7-.1-1.3-.3-2H12v4h6.1a6.8 6.8 0 0 1-2.3 3.6l3.3 2.7A10.9 10.9 0 0 0 23 12z" />
    </svg>
  )
}

function GitHubIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.2.8-.6v-2.1c-3.3.7-4-1.4-4-1.4-.6-1.4-1.3-1.8-1.3-1.8-1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1 .1.8 1.9 2.7 2.3.5-.4 1-.7 1.2-1-2.6-.3-5.4-1.3-5.4-6a4.7 4.7 0 0 1 1.2-3.3c-.2-.3-.5-1.5.1-3.2 0 0 1-.3 3.4 1.3A11.7 11.7 0 0 1 12 7.7c1 0 2 .1 3 .4 2.4-1.6 3.5-1.3 3.5-1.3.6 1.7.3 2.9.1 3.2a4.7 4.7 0 0 1 1.2 3.3c0 4.7-2.8 5.7-5.4 6 .4.3.8.9.8 1.9v2.8c0 .4.2.7.8.6A12 12 0 0 0 12 .5z" />
    </svg>
  )
}
