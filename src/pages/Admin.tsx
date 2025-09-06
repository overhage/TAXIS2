'use client'

import React, { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import { useAuth } from '../hooks/useAuth';

// ===== Helpers =====
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' }) : '—');

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(`Expected JSON but got ${res.status} (${ct || 'unknown content-type'}). First 300 chars: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

// ===== MasterRecord Section =====
function AdminMasterRecordSection() {
  const [summary, setSummary] = useState<{ rows: number; lastUpdated: string | null }>({ rows: 0, lastUpdated: null });
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = async () => {
    setRefreshing(true);
    setErr('');
    try {
      const j = await fetchJson('/api/admin-master-record?op=summary', { credentials: 'include' });
      const last = j.lastUpdated ? new Date(j.lastUpdated).toISOString() : null;
      setSummary({ rows: j.rows ?? 0, lastUpdated: last });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setResults([]);
    setErr('');
    try {
      const url = '/api/admin-master-record?op=search&q=' + encodeURIComponent(q.trim());
      const j = await fetchJson(url, { credentials: 'include' });
      setResults(j.rows || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const csvHref = '/api/admin-master-record?op=csv';

  return (
    <section className="border rounded-2xl p-6 md:p-7 bg-white shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">MasterRecord</h2>
          <p className="text-sm text-neutral-600">
            {summary.rows.toLocaleString()} rows • last updated {fmtDate(summary.lastUpdated)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchSummary} className="inline-flex items-center rounded-md px-3 py-2 border border-neutral-300 bg-white hover:bg-neutral-50 text-sm" aria-label="Refresh summary">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <a href={csvHref} className="inline-flex items-center rounded-md px-3 py-2 border border-neutral-300 bg-white hover:bg-neutral-50 text-sm font-medium">Download CSV</a>
        </div>
      </div>

      <form onSubmit={onSearch} className="mt-6 flex gap-2">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search concept_a / concept_b / code…" className="w-full border rounded-md px-3 py-2 bg-white" />
        <button type="submit" className="px-4 py-2 rounded-md bg-black text-white" disabled={loading || !q.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {err && <div className="mt-3 text-red-700">{err}</div>}

      {results.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm align-middle">
            <thead>
              <tr className="text-left border-b bg-neutral-50">
                <th className="py-2 pr-4">concept_a</th>
                <th className="py-2 pr-4">concept_b</th>
                <th className="py-2 pr-4">relationship</th>
                <th className="py-2 pr-4">sources</th>
                <th className="py-2 pr-4">LLM</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.pairId} className="border-b align-top">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{r.concept_a}</div>
                    <div className="text-neutral-600">{r.code_a} | {r.system_a} | {r.type_a || '—'}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="font-medium">{r.concept_b}</div>
                    <div className="text-neutral-600">{r.code_b} | {r.system_b} | {r.type_b || '—'}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="font-medium">{r.relationshipType}</div>
                    <div className="text-neutral-600">Code: {r.relationshipCode}</div>
                    <div className="text-neutral-600 italic">{r.rational}</div>
                  </td>
                  <td className="py-2 pr-4">{r.source_count?.toLocaleString?.() ?? r.source_count}</td>
                  <td className="py-2 pr-4">
                    <div>{r.llm_name || '—'}</div>
                    <div className="text-neutral-600">{r.llm_version || '—'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface AdminJobRow { id: string; fileName: string; userEmail?: string; rowCount?: number; createdAt: string; status: string; outputUrl?: string; }

const AdminPage: React.FC = () => {
  const auth = (useAuth() as any) || {};
  const user = auth.user ?? auth ?? null;
  const [jobs, setJobs] = useState<AdminJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);

  const who = useMemo(() => user?.email || user?.name || null, [user]);

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/admin-jobs', { credentials: 'include', cache: 'no-store' });
      if (res.status === 403) {
        setForbidden(who || 'unknown user');
        setJobs([]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      const list = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : [];
      setJobs(list);
      setError(null);
    } catch (e: any) {
      console.error('[admin] jobs fetch failed', e);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <div className="bg-neutral-50 min-h-screen">
      <Header title="Administrator Dashboard" />
      <main className="pl-6 pr-5 md:pl-24 md:pr-12 py-8 space-y-8 max-w-7xl mx-auto">
        {user && (
          <div className="text-sm mb-3 text-neutral-700">
            Signed in as <strong>{user?.name || user?.email || 'User'}</strong>
            {user?.email ? ` (${user.email})` : ''}
          </div>
        )}

        {error && <div className="text-red-700">{error}</div>}

        {forbidden ? (
          <div className="p-3 rounded-md border border-red-300 bg-red-50 text-red-800">
            You do not have admin access.
            {who ? (
              <>
                <span> </span>Detected as <strong>{who}</strong>. Ensure your email is in <code>ADMIN_EMAILS</code> and your session includes it.
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8">
            <AdminMasterRecordSection />
            {/* Jobs list — now wrapped in a card */}
            <section className="border rounded-2xl p-6 md:p-7 bg-white shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">All Jobs</h2>
                <div className="flex items-center gap-2">
                  <button onClick={fetchJobs} className="inline-flex items-center rounded-md px-3 py-2 border border-neutral-300 bg-white hover:bg-neutral-50 text-sm">Refresh</button>
                </div>
              </div>

              {loading ? (
                <div className="text-sm">Loading…</div>
              ) : jobs.length === 0 ? (
                <div className="text-sm text-neutral-600">No jobs found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm align-middle">
                    <thead>
                      <tr className="text-left border-b bg-neutral-50">
                        <th className="py-2 pr-4">ID</th>
                        <th className="py-2 pr-4">File</th>
                        <th className="py-2 pr-4">User</th>
                        <th className="py-2 pr-4">Rows</th>
                        <th className="py-2 pr-4">Created</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr key={j.id} className="border-b hover:bg-neutral-50/80">
                          <td className="py-3 pr-4 whitespace-nowrap">{j.id}</td>
                          <td className="py-3 pr-4">{j.fileName}</td>
                          <td className="py-3 pr-4"><span className="whitespace-nowrap">{j.userEmail || '—'}</span></td>
                          <td className="py-3 pr-4">{j.rowCount ?? '—'}</td>
                          <td className="py-3 pr-4"><span className="whitespace-nowrap">{fmtDate(j.createdAt)}</span></td>
                          <td className="py-3 pr-4 capitalize">{j.status}</td>
                          <td className="py-3 pr-4">{j.outputUrl ? (<a href={j.outputUrl} className="text-blue-600 underline">Download</a>) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Delete jobs */}
            <section className="border rounded-2xl p-6 md:p-7 bg-white shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Delete Jobs</h2>
              </div>
              <p className="text-sm text-neutral-600 mb-4">Choose filters. A preview count will be shown before deletion.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
                <input type="date" className="border rounded-md px-3 py-2 bg-white" />
                <select className="border rounded-md px-3 py-2 bg-white">
                  <option value="">--Status--</option>
                  <option value="queued">Queued</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <input type="text" placeholder="User email" className="border rounded-md px-3 py-2 bg-white" />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button className="px-3 py-2 rounded-md bg-black text-white w-fit">Preview</button>
                <span className="text-sm text-neutral-600">Matches: —</span>
              </div>

              <div className="mt-4 p-3 border rounded-md bg-yellow-50 text-yellow-900">
                Delete <strong>0</strong> job(s)? This cannot be undone.
                <div className="mt-2 flex gap-2">
                  <button className="px-3 py-2 rounded-md bg-red-700 text-white">Confirm delete</button>
                  <button className="px-3 py-2 rounded-md border bg-white">Cancel</button>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPage;
