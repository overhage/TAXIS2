import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../hooks/useAuth';

interface MasterRow {
  pairId: string;
  concept_a: string;
  concept_b: string;
  concept_a_t: string;
  concept_b_t: string;
  cooc_event_count: number;
  lift_lower_95: number | null;
  lift_upper_95: number | null;
}

interface AdminJobRow {
  id: string;
  fileName: string;
  userEmail?: string;
  rowCount?: number;
  createdAt: string;
  status: string;
  outputUrl?: string; // server returns /api/download?job=<id>
}

/**
 * Administrator dashboard. Displays a summary of the master record table, the
 * ability to search entries, a list of all uploads, and tools to delete
 * jobs/files based on filters.
 */
const AdminPage: React.FC = () => {
  const { isAdmin, loading: authLoading } = useAuth();

  const [summary, setSummary] = useState<{ count: number; lastUpdated: string } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MasterRow[]>([]);
  const [jobs, setJobs] = useState<AdminJobRow[]>([]);
  const [deleteFilters, setDeleteFilters] = useState({ date: '', status: '', user: '' });
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Data loaders ----
  const fetchSummary = async () => {
    try {
      setLoadingSummary(true);
      // Adjust the endpoint name if your API differs
      const res = await axios.get('/api/admin/master-summary', { withCredentials: true });
      setSummary(res.data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch master summary');
    } finally {
      setLoadingSummary(false);
    }
  };

  const fetchJobs = async () => {
    try {
      setLoadingJobs(true);
      // Use credentials so session cookies pass through
      const res = await fetch('/api/admin-jobs', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`admin-jobs ${res.status}: ${body}`);
      }
      const data: AdminJobRow[] = await res.json();
      setJobs(data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load admin jobs');
    } finally {
      setLoadingJobs(false);
    }
  };

  // ---- Effects ----
  useEffect(() => {
    if (authLoading) return;
    fetchSummary();
    fetchJobs();
  }, [authLoading, isAdmin]);

  // ---- Handlers ----
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.get('/api/admin/master-record', {
        params: { query },
        withCredentials: true,
      });
      setResults(res.data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to search master record');
    }
  };

  const handleDelete = async () => {
    try {
      await axios.delete('/api/admin-jobs', {
        data: deleteFilters,
        withCredentials: true,
      });
      await fetchJobs();
      setDeleteFilters({ date: '', status: '', user: '' });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete jobs');
    }
  };

  // ---- Early auth-gate rendering ----
  if (authLoading) {
    return (
      <div>
        <Header title="Admin" />
        <main className="p-4">Checking admin status…</main>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <Header title="Admin" />
        <main className="p-4">You do not have admin access.</main>
      </div>
    );
  }

  // ---- Main render ----
  return (
    <div>
      <Header title="Administrator Dashboard" />
      <main style={{ padding: '1rem' }}>
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
          {/* Master Record Summary & Search */}
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Master Record Summary</h2>
            {loadingSummary ? (
              <p>Loading…</p>
            ) : summary ? (
              <div>
                <p>Total rows: {summary.count}</p>
                <p>
                  Last updated:{' '}
                  {new Date(summary.lastUpdated).toLocaleString('en-US', {
                    timeZone: 'America/Indiana/Indianapolis',
                  })}
                </p>
                <form onSubmit={handleSearch} style={{ marginTop: '1rem' }}>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search concept_a_t or concept_b_t"
                    style={{ padding: '0.25rem', width: '100%', marginBottom: '0.5rem' }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#2563eb',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '0.25rem',
                    }}
                  >
                    Search
                  </button>
                </form>
                {results.length > 0 && (
                  <div style={{ maxHeight: '200px', overflowY: 'auto', marginTop: '0.5rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Concept A</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Concept B</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Events</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Lift (95% CI)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((row) => (
                          <tr key={row.pairId}>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{row.concept_a_t}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{row.concept_b_t}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{row.cooc_event_count}</td>
                            <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>
                              {row.lift_lower_95 != null && row.lift_upper_95 != null
                                ? `${row.lift_lower_95.toFixed(2)} – ${row.lift_upper_95.toFixed(2)}`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ marginTop: '0.5rem' }}>
                  <a href="/api/admin/download-master" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                    Download MasterRecord
                  </a>
                </div>
              </div>
            ) : (
              <p>No summary available</p>
            )}
          </section>

          {/* Jobs List */}
          <section>
            <h2 className="text-xl font-semibold mb-2">All Jobs</h2>
            {loadingJobs ? (
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
                          {new Date(j.createdAt).toLocaleString('en-US', {
                            timeZone: 'America/Indiana/Indianapolis',
                          })}
                        </td>
                        <td className="p-2 border-b align-top">{j.status}</td>
                        <td className="p-2 border-b align-top">
                          {j.outputUrl ? (
                            <a href={j.outputUrl} className="text-blue-600 underline">
                              Download
                            </a>
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

          {/* Delete Jobs */}
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Delete Jobs</h2>
            <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
              Use the filters below to delete jobs and their associated files. Leave a field blank to ignore that filter.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="date"
                value={deleteFilters.date}
                onChange={(e) => setDeleteFilters({ ...deleteFilters, date: e.target.value })}
                style={{ padding: '0.25rem' }}
              />
              <select
                value={deleteFilters.status}
                onChange={(e) => setDeleteFilters({ ...deleteFilters, status: e.target.value })}
                style={{ padding: '0.25rem' }}
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
                style={{ padding: '0.25rem' }}
              />
              <button
                onClick={handleDelete}
                style={{ padding: '0.5rem', backgroundColor: '#b91c1c', color: '#fff', border: 'none', borderRadius: '0.25rem' }}
              >
                Delete Selected Jobs
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default AdminPage;
