// netlify/functions/_admin-gate.mjs — shim for legacy imports
// Purpose: allow existing .js/.mjs admin functions that import "./_admin-gate.mjs"
// to continue working after migrating the implementation to TypeScript
// in netlify/functions/_admin-gate.ts.
//
// Netlify's esbuild bundler will resolve the .ts import at build-time.
// Once you've updated all admin functions to TypeScript (and switched their
// imports to "./_admin-gate"), you can delete this shim.

export { requireAdmin, requireUser } from './_admin-gate.ts'
