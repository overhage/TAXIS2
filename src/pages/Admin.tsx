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
    throw new Error(
      `Expected JSON but got ${res.status} ${res.statusText} (${ct}). First 300 chars: \n` +
        text.slice(0, 300)
    );
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
      setSummary({ rows: Number(j.rows || 0), lastUpdated: last });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const onSearch = async (e?: React.FormEvent) => {
    e?.preventDefault?.();
    setErr('');
    setLoading(true);
    try {
      const j = await fetchJson(`/api/admin-master-record?op=search&q=${encodeURIComponent(q)}&limit=100`, { credentials: 'include' });
      setResults(j.rows || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const csvHref = useMemo(() => '/api/admin-download-master?format=csv', []);

  return (
    <section className="border rounded-2xl p-6 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">MasterRecord</h2>
          <p className="text-sm text-neutral-600">
            {summary.rows.toLocaleString()} rows • last updated {fmtDate(summary.lastUpdated)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchSummary} className="inline-flex items-center rounded-md px-3 py-2 border border-neutral-300 hover:bg-neutral-50 text-sm" disabled={refreshing} title="Refresh summary">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <a href={csvHref} className="inline-flex items-center rounded-md px-3 py-2 border border-neutral-300 hover:bg-neutral-50 text-sm font-medium">Download CSV</a>
        </div>
      </div>

      <form onSubmit={onSearch} className="mt-6 flex gap-2">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search concept_a / concept_b / code…" className="w-full border rounded-md px-3 py-2" />
        <button type="submit" className="px-4 py-2 rounded-md bg-black text-white disabled:opacity-50" disabled={loading || !q.trim()}>{loading ? 'Searching…' : 'Search'}</button>
      </form>

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

      {!!results.length && (
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">A (code | system | type)</th>
                <th className="py-2 pr-4">B (code | system | type)</th>
                <th className="py-2 pr-4">Relationship</th>
                <th className="py-2 pr-4">Source Count</th>
                <th className="py-2 pr-4">LLM</th>
                <th className="py-2 pr-4">User Review</th>
                <th className="py-2 pr-4">Updated</th>
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
                    <div className="text-neutral-600">{fmtDate(r.llm_date)}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <div>{r.human_reviewer || '—'}</div>
                    <div className="text-neutral-600">{r.human_comment || '—'}</div>
                    <div className="text-neutral-600">{fmtDate(r.human_date)}</div>
                    <div className="text-neutral-600">Status: {r.status || '—'}</div>
                  </td>
                  <td className="py-2 pr-4">{fmtDate(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ===== Types =====
interface AdminJobRow { id: string; fileName: string; userEmail?: string; rowCount?: number; createdAt: string; status: string; outputUrl?: string; }

// ===== Page =====
const AdminPage: React.FC = () => {
  const auth = (useAuth() as any) || {};
  const user = auth.user ?? auth ?? null;
  const [jobs, setJobs] = useState<AdminJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [who, setWho] = useState<string>('');

  const [deleteFilters, setDeleteFilters] = useState({ date: '', status: '', user: '' });
  const [confirming, setConfirming] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    setWho('');
    try {
      const res = await fetch('/api/admin-jobs', { credentials: 'include', cache: 'no-store' });
      if (res.status === 200) {
        const data: AdminJobRow[] = await res.json();
        setJobs(Array.isArray(data) ? data : []);
      } else if (res.status === 403) {
        setForbidden(true);
        const body = await res.json().catch(() => null);
        setWho(body?.who || '');
      } else {
        const txt = await res.text();
        throw new Error(`admin-jobs ${res.status}: ${txt}`);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load admin jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const previewDelete = async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (deleteFilters.date) qs.set('date', deleteFilters.date);
      if (deleteFilters.status) qs.set('status', deleteFilters.status);
      if (deleteFilters.user) qs.set('user', deleteFilters.user);
      qs.set('op', 'count');
      const j = await fetchJson(`/api/admin-jobs?${qs.toString()}`, { credentials: 'include' });
      setPreviewCount(Number(j.count || 0));
      setConfirming(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to preview delete');
    }
  };

  const doDelete = async () => {
    setConfirming(false);
    try {
      const res = await fetch('/api/admin-jobs', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deleteFilters),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Delete failed (${res.status})`);
      setPreviewCount(null);
      setDeleteFilters({ date: '', status: '', user: '' });
      await fetchJobs();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete jobs');
    }
  };

  return (
    <div>
      <Header title="Administrator Dashboard" />
      {/* Align with the left edge of the owl logo: push main content right a bit more */}
      <main className="pl-8 sm:pl-12 md:pl-28 lg:pl-32 pr-6 md:pr-12 py-6 space-y-6 max-w-7xl mx-auto">
        {user && (
          <div className="text-sm mb-2">
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
          <div className="grid grid-cols-1 gap-6">
            <AdminMasterRecordSection />

            {/* Jobs list */}
            <section className="border rounded-2xl p-6 bg-white shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium">All Jobs</h2>
                <div className="flex items-center gap-2">
                  <button onClick={fetchJobs} className="inline-flex items-center rounded-md px-3 py-2 border border-neutral-300 hover:bg-neutral-50 text-sm">Refresh</button>
                </div>
              </div>

              {loading ? (
                <div className="text-sm">Loading…</div>
              ) : jobs.length === 0 ? (
                <div className="text-sm text-neutral-600">No jobs found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
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
                        <tr key={j.id} className="border-b align-top">
                          <td className="py-2 pr-4">{j.id}</td>
                          <td className="py-2 pr-4">{j.fileName}</td>
                          <td className="py-2 pr-4">{j.userEmail || '—'}</td>
                          <td className="py-2 pr-4">{j.rowCount ?? '—'}</td>
                          <td className="py-2 pr-4">{fmtDate(j.createdAt)}</td>
                          <td className="py-2 pr-4">{j.status}</td>
                          <td className="py-2 pr-4">{j.outputUrl ? (<a href={j.outputUrl} className="text-blue-600 underline">Download</a>) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Delete jobs */}
            <section className="border rounded-2xl p-6 bg-white shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium">Delete Jobs</h2>
              </div>
              <p className="text-sm text-neutral-600 mb-3">Choose filters. A preview count will be shown before deletion.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
                <input type="date" value={deleteFilters.date} onChange={(e) => setDeleteFilters({ ...deleteFilters, date: e.target.value })} className="border rounded-md px-3 py-2" />
                <select value={deleteFilters.status} onChange={(e) => setDeleteFilters({ ...deleteFilters, status: e.target.value })} className="border rounded-md px-3 py-2">
                  <option value="">--Status--</option>
                  <option value="queued">Queued</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <input type="text" placeholder="User email" value={deleteFilters.user} onChange={(e) => setDeleteFilters({ ...deleteFilters, user: e.target.value })} className="border rounded-md px-3 py-2" />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button onClick={async () => { await previewDelete(); }} className="px-3 py-2 rounded-md bg-black text-white w-fit">Preview</button>
                {previewCount != null && <span className="text-sm text-neutral-600">Matches: {previewCount}</span>}
              </div>

              {confirming && (
                <div className="mt-3 p-3 border rounded-md bg-yellow-50 text-yellow-900">
                  Delete <strong>{previewCount}</strong> job(s)? This cannot be undone.
                  <div className="mt-2 flex gap-2">
                    <button onClick={async () => { await doDelete(); }} className="px-3 py-2 rounded-md bg-red-700 text-white">Confirm delete</button>
                    <button onClick={() => { setConfirming(false); setPreviewCount(null); }} className="px-3 py-2 rounded-md border">Cancel</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPage;
