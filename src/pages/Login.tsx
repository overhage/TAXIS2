import React, { useState } from 'react'

export default function Login() {
  const [loading, setLoading] = useState<null | 'google' | 'github'>(null)

  function handleLogin(provider: 'google' | 'github') {
    if (loading) return
    setLoading(provider)
    window.location.assign(`/api/login?provider=${provider}`)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-white shadow-lg rounded-2xl p-8 space-y-6 text-center">
          <header className="space-y-3">
            {/* Brand mark */}
            <img
              src="/Taxis%20Owl%20Transparent.png" // file lives in /public
              alt="TAXIS Owl"
              className="mx-auto h-16 w-16 object-contain"
              loading="lazy"
              decoding="async"
            />

            <h1 className="text-2xl font-semibold tracking-tight">TAXIS Sign in</h1>

            <p className="text-xs text-gray-500 max-w-md mx-auto">
              The Greek word τάξις (táxis) means "arrangement," "order," or "rank". It is derived from the verb tassō,
              meaning "to arrange or order". Together, through the TAXIS project, we are working to order clinical knowledge.
            </p>
            <p className="text-sm text-gray-500">Choose a provider to continue</p>
          </header>

          <div className="space-y-3">
            {/* Google */}
            <button
              onClick={() => handleLogin('google')}
              disabled={!!loading}
              aria-label="Continue with Google"
              className="w-full sm:w-80 mx-auto inline-flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 px-4 py-3 text-sm font-medium shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <img
                src="/google-logo.svg" /* or .png */
                alt="Google"
                width={20}
                height={20}
                className="shrink-0"
                loading="lazy"
              />
              <span>{loading === 'google' ? 'Redirecting…' : 'Continue with Google'}</span>
            </button>

            {/* GitHub */}
            <button
              onClick={() => handleLogin('github')}
              disabled={!!loading}
              aria-label="Continue with GitHub"
              className="w-full sm:w-80 mx-auto inline-flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 px-4 py-3 text-sm font-medium shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <img
                src="/github-mark.svg" /* or .png */
                alt="GitHub"
                width={20}
                height={20}
                className="shrink-0"
                loading="lazy"
              />
              <span>{loading === 'github' ? 'Redirecting…' : 'Continue with GitHub'}</span>
            </button>
          </div>

          //  <div className="pt-2 text-center text-xs text-gray-500">
          //    By continuing you agree to our <a href="/terms" className="underline">Terms</a> and{' '}
          //    <a href="/privacy" className="underline">Privacy Policy</a>.
          //  </div>

          <noscript>
            <div className="text-center text-sm text-gray-500">
              JavaScript is disabled. Use these links: <a className="underline" href="/api/login?provider=google">Google</a> •{' '}
              <a className="underline" href="/api/login?provider=github">GitHub</a>
            </div>
          </noscript>
        </div>
      </div>
    </div>
  )
}
