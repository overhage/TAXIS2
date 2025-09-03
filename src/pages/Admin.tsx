'use client'

import React, { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import { useAuth } from '../hooks/useAuth';

interface AdminJobRow {
  id: string;
  fileName: string;
  userEmail?: string;
  rowCount?: number;
  createdAt: string;
  status: string;
  outputUrl?: string;
}

// ——— MasterRecord Admin Section ———
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' }) : '—');

function AdminMasterRecordSection() {
  const [summary, setSummary] = useState<{ rows: number; lastUpdated: string | null }>({ rows: 0, lastUpdated: null });
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin-master-record?op=summary', { credentials: 'include' });
        const j = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(j?.error || 'Failed to load summary');
        setSummary({ rows: j.rows || 0, lastUpdated: j.lastUpdated || null });
      } catch (e: any) {
        if (active) setErr(String(e?.message || e));
      }
    })();
    return () => { active = false; };
  }, []);

  const onSearch = async (e?: React.FormEvent) => {
    e?.preventDefault?.();
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`/api/admin-master-record?op=search&q=${encodeURIComponent(q)}&limit=100`, { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Search failed');
      setResults(Array.isArray(j.rows) ? j.rows : []);
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
        <a
          href={csvHref}
          className="inline-flex items-center rounded-md px-3 py-2 border border-neutral-300 hover:bg-neutral-50 text-sm font-medium"
        >
          Download CSV
        </a>
      </div>

      <form onSubmit={onSearch} className="mt-6 flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search concept_a / concept_b / code…"
          className="w-full border rounded-md px-3 py-2"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-black text-white disabled:opacity-50"
          disabled={loading || !q.trim()}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
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

const AdminPage: React.FC = () => {
  // Optional user banner; works whether useAuth returns {user,...} or user directly
  const auth = (useAuth() as any) || {};
  const user = auth.user ?? auth ?? null;

  const [jobs, setJobs] = useState<AdminJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [who, setWho] = useState<string>('');

  const [deleteFilters, setDeleteFilters] = useState({ date: '', status: '', user: '' });

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    setWho('');
    try {
      const res = await fetch('/api/admin-jobs', { credentials: 'include' });
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

  useEffect(() => { fetchJobs(); }, []);

  const handleDelete = async () => {
    try {
      const res = await fetch('/api/admin-jobs', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deleteFilters),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`delete failed ${res.status}: ${txt}`);
      }
      await fetchJobs();
      setDeleteFilters({ date: '', status: '', user: '' });
    } catch (e: any) {
      setError(e?.message || 'Failed to delete jobs');
    }
  };

  return (
    <div>
      <Header title="Administrator Dashboard" />
      <main className="p-4 space-y-6">
        {/* Signed-in user banner */}
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
                {' '}Detected as <strong>{who}</strong>. If this is your account, ensure it appears in <code>ADMIN_EMAILS</code> and that your
                session passes the email to the function.
              </>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {/* NEW: MasterRecord section */}
            <AdminMasterRecordSection />

            {/* Jobs list */}
            <section>
              <h2 className="text-xl font-semibold mb-2">All Jobs</h2>
              {loading ? (
                <div>Loading…</div>
              ) : jobs.length === 0 ? (
                <div>No jobs found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left p-2 border-b">ID</th>
                        <th className="text-left p-2 border-b">File</th>
                        <th className="text-left p-2 border-b">User</th>
                        <th className="text-left p-2 border-b">Rows</th>
                        <th className="text-left p-2 border-b">Created</th>
                        <th className="text-left p-2 border-b">Status</th>
                        <th className="text-left p-2 border-b">Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr key={j.id}>
                          <td className="p-2 border-b align-top">{j.id}</td>
                          <td className="p-2 border-b align-top">{j.fileName}</td>
                          <td className="p-2 border-b align-top">{j.userEmail || '—'}</td>
                          <td className="p-2 border-b align-top">{j.rowCount ?? '—'}</td>
                          <td className="p-2 border-b align-top">
                            {new Date(j.createdAt).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })}
                          </td>
                          <td className="p-2 border-b align-top">{j.status}</td>
                          <td className="p-2 border-b align-top">
                            {j.outputUrl ? (
                              <a href={j.outputUrl} className="text-blue-600 underline">Download</a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Delete jobs */}
            <section>
              <h2 className="text-xl font-semibold mb-2">Delete Jobs</h2>
              <p className="text-sm mb-2">Use any combination of filters below; leave blank to ignore a filter.</p>
              <div className="flex flex-col gap-2 max-w-md">
                <input
                  type="date"
                  value={deleteFilters.date}
                  onChange={(e) => setDeleteFilters({ ...deleteFilters, date: e.target.value })}
                  className="border rounded p-1"
                />
                <select
                  value={deleteFilters.status}
                  onChange={(e) => setDeleteFilters({ ...deleteFilters, status: e.target.value })}
                  className="border rounded p-1"
                >
                  <option value="">--Status--</option>
                  <option value="queued">Queued</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <input
                  type="text"
                  placeholder="User email"
                  value={deleteFilters.user}
                  onChange={(e) => setDeleteFilters({ ...deleteFilters, user: e.target.value })}
                  className="border rounded p-1"
                />
                <button onClick={handleDelete} className="px-3 py-2 rounded bg-red-700 text-white w-fit">Delete Selected Jobs</button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPage;
