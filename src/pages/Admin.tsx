import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Header from '../components/Header';

interface MasterRow {
  pairId: string;
  concept_a: string;
  concept_b: string;
  concept_a_t: string;
  concept_b_t: string;
  cooc_event_count: number;
  lift_lower_95: number;
  lift_upper_95: number;
}

interface JobRow {
  id: string;
  fileName: string;
  userEmail: string;
  rowCount: number;
  createdAt: string;
  status: string;
  outputUrl?: string;
}

/**
 * Administrator dashboard. Displays a summary of the master record table, the
 * ability to search entries, a list of all uploads, and tools to delete
 * jobs/files based on filters.
 */
const AdminPage: React.FC = () => {
  const [summary, setSummary] = useState<{ count: number; lastUpdated: string } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MasterRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [deleteFilters, setDeleteFilters] = useState({ date: '', status: '', user: '' });
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await axios.get('/api/admin/summary');
        setSummary(res.data);
      } catch (err) {
        setError('Failed to fetch summary');
      } finally {
        setLoadingSummary(false);
      }
    };
    const fetchJobs = async () => {
      try {
        const res = await axios.get('/api/admin/jobs');
        setJobs(res.data);
      } catch (err) {
        setError('Failed to fetch jobs');
      } finally {
        setLoadingJobs(false);
      }
    };
    fetchSummary();
    fetchJobs();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.get('/api/admin/master-record', { params: { query } });
      setResults(res.data);
    } catch (err) {
      setError('Failed to search master record');
    }
  };

  const handleDelete = async () => {
    try {
      await axios.delete('/api/admin/jobs', { data: deleteFilters });
      // Refresh jobs list
      const res = await axios.get('/api/admin/jobs');
      setJobs(res.data);
      setDeleteFilters({ date: '', status: '', user: '' });
    } catch (err) {
      setError('Failed to delete jobs');
    }
  };

  return (
    <div>
      <Header title="Administrator Dashboard" />
      <main style={{ padding: '1rem' }}>
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Master Record Summary</h2>
            {loadingSummary ? (
              <p>Loading…</p>
            ) : summary ? (
              <div>
                <p>Total rows: {summary.count}</p>
                <p>Last updated: {new Date(summary.lastUpdated).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })}</p>
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
                    style={{ padding: '0.25rem 0.5rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.25rem' }}
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
                              {row.lift_lower_95.toFixed(2)} – {row.lift_upper_95.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ marginTop: '0.5rem' }}>
                  <a
                    href="/api/admin/download-master"
                    style={{ color: '#2563eb', textDecoration: 'underline' }}
                  >
                    Download MasterRecord
                  </a>
                </div>
              </div>
            ) : (
              <p>No summary available</p>
            )}
          </section>
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>All Jobs</h2>
            {loadingJobs ? (
              <p>Loading…</p>
            ) : jobs.length === 0 ? (
              <p>No uploaded jobs.</p>
            ) : (
              <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>File</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>User</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Records</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Uploaded</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.fileName}</td>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.userEmail}</td>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.rowCount}</td>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>
                          {new Date(job.createdAt).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })}
                        </td>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.status}</td>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>
                          {job.outputUrl ? (
                            <a href={job.outputUrl} style={{ color: '#2563eb' }} download>
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
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Delete Jobs</h2>
            <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
              Use the filters below to delete jobs and their associated files. Leave
              a field blank to ignore that filter.
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