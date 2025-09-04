'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  outputBlobKey?: string;
}

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const LS_KEY = 'dashboard.autoRefresh';

const DashboardPage: React.FC = () => {
  const auth = useAuth() as any
  const user = auth?.user ?? auth ?? null

  const [jobs, setJobs] = useState<JobItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const [requiredFields, setRequiredFields] = useState<string[]>([])

  // ... keep autoRefresh state, refs, fetchJobs, effects

  // NEW: fetch required fields from the upload function (GET)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await axios.get('/api/upload')
        if (!cancelled) setRequiredFields(Array.isArray(res.data?.requiredFields) ? res.data.requiredFields : [])
      } catch {
        // fallback to a sensible default, matching server REQUIRED_FIELDS
        if (!cancelled) setRequiredFields(['concept_a','concept_b','concept_a_t','concept_b_t','system_a','system_b','cooc_event_count','lift_lower_95','lift_upper_95'])
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await axios.post('/api/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' }, withCredentials: true })
      setFile(null)
      await fetchJobs()
    } catch (err: any) {
      console.error('[Dashboard] upload failed', err)
      const data = err?.response?.data
      if (data?.missing && data?.requiredFields) {
        setError(`Upload failed. Missing required columns: ${data.missing.join(', ')}. Required: ${data.requiredFields.join(', ')}.`)
      } else if (data?.error) {
        setError(String(data.error))
      } else {
        setError('Upload failed.')
      }
    } finally {
      setUploading(false)
    }
  }

  // ... keep rest of component

  return (
    <ErrorBoundary>
      <div>
        <Header title="User Dashboard" />
        <main style={{ padding: '1rem' }}>
          {/* ... existing signed-in banner + errors ... */}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            {/* ... left column (jobs) unchanged ... */}

            <section>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Upload New File</h2>
              <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Required header columns:&nbsp;
                {requiredFields.length > 0 ? (
                  <code>{requiredFields.join(', ')}</code>
                ) : (
                  <em>loading…</em>
                )}
              </p>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} style={{ marginBottom: '0.5rem' }} />
              <br />
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                style={{ padding: '0.5rem 1rem', backgroundColor: '#2563eb', color: '#fff', borderRadius: '0.25rem', border: 'none', cursor: file && !uploading ? 'pointer' : 'not-allowed' }}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </section>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  )
}

export default DashboardPage

