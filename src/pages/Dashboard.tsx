// ─────────────────────────────────────────────────────────────────────────────
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


const formatDate = (s?: string) => (s ? new Date(s).toLocaleString() : '')


return (
<ErrorBoundary>
<div>
<Header title="User Dashboard" />
<main style={{ padding: '1rem' }}>
{!!error && (
<div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem' }}>
{error}
</div>
)}


<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
{/* Jobs list */}
<section>
<h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Recent Jobs</h2>
{isLoading ? (
<p>Loading jobs…</p>
) : jobs.length === 0 ? (
<p>No jobs yet.</p>
) : (
<table style={{ width: '100%', borderCollapse: 'collapse' }}>
<thead>
<tr>
<th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '0.5rem' }}>ID</th>
<th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '0.5rem' }}>Status</th>
<th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '0.5rem' }}>Created</th>
<th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '0.5rem' }}>Finished</th>
</tr>
</thead>
<tbody>
{jobs.map((j) => (
<tr key={j.id}>
<td style={{ padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>{j.id}</td>
<td style={{ padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>{j.status}</td>
<td style={{ padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>{formatDate(j.createdAt)}</td>
<td style={{ padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>{formatDate(j.finishedAt)}</td>
</tr>
))}
</tbody>
</table>
)}
</section>


{/* Upload */}
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