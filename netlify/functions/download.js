// netlify/functions/download.mjs  (Functions v2, ESM)
// Streams validated CSV from Netlify Blobs; Request/Response API.

import { getStore } from '@netlify/blobs';
import prismaCjs from './utils/prisma.js';
import authUtilsCjs from './utils/auth.js';

const prisma = prismaCjs; // CJS default export
const { getUserFromRequest } = authUtilsCjs; // named export from CJS module

export default async (req) => {
  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job');
    if (!jobId) return new Response('Missing job id', { status: 400 });

    // Reuse v1 auth util by passing only the cookie header
    const eventLike = { headers: { cookie: req.headers.get('cookie') || '' } };
    const user = await getUserFromRequest(eventLike);
    if (!user) return new Response('Unauthorized', { status: 401 });

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return new Response('Job not found', { status: 404 });

    const isOwner = job.userId === user.id;
    const isAdmin = user.isAdmin;
    if (!isOwner && !isAdmin) return new Response('Forbidden', { status: 403 });

    if (!job.outputBlobKey) return new Response('No output available', { status: 404 });

    const outputs = getStore('outputs');
    const arrBuf = await outputs.get(job.outputBlobKey, { type: 'arrayBuffer' });
    if (!arrBuf) return new Response('Output not found', { status: 404 });

    const suggested = job.outputBlobKey.split('/').pop() || 'output.csv';

    return new Response(Buffer.from(arrBuf), {
      status: 200,
      headers: {
        'content-type': 'text/csv',
        'content-disposition': `attachment; filename="${suggested}"`,
      },
    });
  } catch (err) {
    console.error('download_v2_error', err);
    return new Response('Internal server error', { status: 500 });
  }
};
