'use client'

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../hooks/useAuth';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; msg?: string }>{
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, msg: String(error?.message || error) };
  }
  componentDidCatch(error: any, info: any) {
    // Surface to console so we don't get a silent blank page
    console.error('[Dashboard ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '1rem' }}>
          <h2 style={{ color: '#b91c1c' }}>Something went wrong loading the dashboard.</h2>
          <p style={{ fontSize: '0.9rem' }}>{this.state.msg}</p>
        </div>
      );
    }
    return this.props.children as any;
  }
}

interface JobItem {
  id: string;
  fileName: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  outputBlobKey?: string; // optional, used to label the download link
}

const DashboardPage: React.FC = () => {
  // Be resilient to different useAuth() return shapes
  const auth = useAuth() as any;
  const user = auth?.user ?? auth ?? null;

  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchJobs() {
      try {
        console.log('[Dashboard] fetching jobs');
        const res = await axios.get('/api/jobs', { withCredentials: true });
        if (!cancelled) setJobs(Array.isArray(res.data) ? res.data : []);
      } catch (err: any) {
        console.error('[Dashboard] jobs fetch failed', err);
        if (!cancelled) setError(err?.response?.data?.error || 'Failed to fetch jobs.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchJobs();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        withCredentials: true,
      });
      // Refresh job list after upload
      const jobsRes = await axios.get('/api/jobs', { withCredentials: true });
      setJobs(Array.isArray(jobsRes.data) ? jobsRes.data : []);
      setFile(null);
    } catch (err: any) {
      console.error('[Dashboard] upload failed', err);
      setError(err?.response?.data?.error || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <ErrorBoundary>
      <div>
        <Header title="User Dashboard" />
        <main style={{ padding: '1rem' }}>
          {/* Signed-in user banner */}
          {user && (
            <div style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>
              Signed in as <strong>{user?.name || user?.email || 'User'}</strong>
              {user?.email ? ` (${user.email})` : null}
            </div>
          )}

          {error && (
            <div style={{ color: '#b91c1c', marginBottom: '1rem' }}>{error}</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            <section>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Your Jobs</h2>
              {isLoading ? (
                <p>Loading jobs…</p>
              ) : jobs.length === 0 ? (
                <p>No jobs found. Upload a file to start processing.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Upload File</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Upload Date</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => {
                      const href = `/api/download?job=${encodeURIComponent(job.id)}`;
                      const status = (job.status || '').toLowerCase();
                      const canDownload = status === 'completed' || status === 'finished';
                      const label = job.outputBlobKey?.match(/\.xlsx?$/i)
                        ? 'Download XLSX'
                        : job.outputBlobKey?.match(/\.csv$/i)
                        ? 'Download CSV'
                        : 'Download';

                      return (
                        <tr key={job.id}>
                          <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.fileName}</td>
                          <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.status}</td>
                          <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>
                            {new Date(job.createdAt).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })}
                          </td>
                          <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>
                            {canDownload ? (
                              <a href={href} style={{ color: '#2563eb' }}>{label}</a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            <section>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Upload New File</h2>
              <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Please upload a CSV or Excel file with a header row containing the columns: <code>concept_a</code>, <code>concept_b</code>, <code>concept_a_t</code>, <code>concept_b_t</code>, <code>system_a</code>, <code>system_b</code>, <code>cooc_event_count</code>, <code>lift_lower_95</code>, and <code>lift_upper_95</code>. At least one data row is required.
              </p>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} style={{ marginBottom: '0.5rem' }} />
              <br />
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  borderRadius: '0.25rem',
                  border: 'none',
                  cursor: file && !uploading ? 'pointer' : 'not-allowed',
                }}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </section>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
};

export default DashboardPage;
