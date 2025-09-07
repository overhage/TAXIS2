import { useEffect, useState } from 'react'


export function useSession() {
const [loading, setLoading] = useState(true)
const [user, setUser] = useState<null | { email?: string; name?: string; sub?: string }>(null)


useEffect(() => {
fetch('/api/session', { credentials: 'include' })
.then(r => (r.ok ? r.json() : Promise.reject(r)))
.then(data => { if (data?.authenticated) setUser(data.user || {}) })
.catch(() => {})
.finally(() => setLoading(false))
}, [])


return { loading, authenticated: !!user, user }
}