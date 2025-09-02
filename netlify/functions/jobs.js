// netlify/functions/jobs.mjs  (Functions v2, ESM)
import { PrismaClient } from '@prisma/client';
import authUtilsCjs from './utils/auth.js';

const prisma = globalThis.__prisma || new PrismaClient();
// @ts-ignore
globalThis.__prisma = prisma;
const { getUserFromRequest } = authUtilsCjs;

export default async (req) => {
  try {
    // Auth (reuse v1 cookie parser from utils/auth)
    const eventLike = { headers: { cookie: req.headers.get('cookie') || '' } };
    const user = await getUserFromRequest(eventLike);
    if (!user) return new Response('Unauthorized', { status: 401 });

    // Admins can pass ?all=1 to fetch all jobs; users only see their own
    const url = new URL(req.url);
    const all = url.searchParams.get('all') === '1';
    const where = user.isAdmin && all ? {} : { userId: user.id };

    const jobs = await prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { upload: true }, // to get originalName (optional)
    });

    // Shape the response for the Dashboard
    const result = jobs.map((j) => {
      // Prefer the original upload name if present
      const originalName =
        (j.upload && j.upload.originalName) ||
        // fallback: derive something readable from output key
        (j.outputBlobKey
          ? (j.outputBlobKey.split('/').pop() || '').replace('.validated.csv', '')
          : 'file');

      return {
        id: j.id,
        status: j.status,
        createdAt: j.createdAt,     // ISO string is fine; your UI formats it
        finishedAt: j.finishedAt,
        fileName: originalName,
        outputBlobKey: j.outputBlobKey || null, // <-- added field
      };
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('jobs_v2_error', err);
    return new Response('Internal server error', { status: 500 });
  }
};
