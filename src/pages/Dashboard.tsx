import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Header from '../components/Header';

interface JobItem {
  id: string;
  fileName: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  outputUrl?: string;
}

/**
 * Dashboard page for authenticated users. Displays the user's past uploads and
 * jobs in one panel and provides a second panel for uploading new files.
 */
const DashboardPage: React.FC = () => {
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const res = await axios.get('/api/jobs');
        setJobs(res.data);
      } catch (err) {
        setError('Failed to fetch jobs.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchJobs();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      // Refresh job list after upload
      const jobsRes = await axios.get('/api/jobs');
      setJobs(jobsRes.data);
      setFile(null);
    } catch (err: any) {
      if (err.response && err.response.data && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError('Upload failed.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Header title="User Dashboard" />
      <main style={{ padding: '1rem' }}>
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
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>File</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Uploaded</th>
                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>Output</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.fileName}</td>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>{job.status}</td>
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid #f3f4f6' }}>
                        {new Date(job.createdAt).toLocaleString('en-US', { timeZone: 'America/Indiana/Indianapolis' })}
                      </td>
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
            )}
          </section>
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Upload New File</h2>
            <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
              Please upload a CSV or Excel file with a header row containing the
              columns: <code>concept_a</code>, <code>concept_b</code>, <code>concept_a_t</code>, <code>concept_b_t</code>, <code>system_a</code>, <code>system_b</code>,
              <code>cooc_event_count</code>, <code>lift_lower_95</code>, and <code>lift_upper_95</code>. At least one
              data row is required.
            </p>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              style={{ marginBottom: '0.5rem' }}
            />
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
                cursor: file && !uploading ? 'pointer' : 'not-allowed'
              }}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </section>
        </div>
      </main>
    </div>
  );
};

export default DashboardPage;