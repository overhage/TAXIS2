// minutes before a running job is considered stale
const STALE_MINUTES = Number(process.env.WATCHDOG_STALE_MINUTES ?? 15);
const staleCutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

// Find jobs to trigger: queued OR (running & old & unfinished)
const candidates = await prisma.job.findMany({
  where: {
    OR: [
      { status: 'queued' },
      {
        AND: [
          { status: 'running' },
          { finishedAt: null },
          { startedAt: { lt: staleCutoff } },
        ],
      },
    ],
  },
  orderBy: [{ createdAt: 'asc' }], // keep your existing ordering if different
  // take: 50, // keep/adjust if you previously capped batch size
});

