/**
 * In-memory CSV / Drive import jobs with row-level progress for the pipeline toolbar.
 * Jobs are short-lived (cleaned after a few minutes) and scoped to one Node process.
 */
const crypto = require('crypto');

const jobs = new Map();
const TTL_MS = 30 * 60 * 1000;
const MAX_JOBS = 200;

function pruneJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (!job) {
      jobs.delete(id);
      continue;
    }
    const stamp = Number(job.updatedAt || job.startedAt || 0);
    if (stamp && now - stamp > TTL_MS) jobs.delete(id);
  }
  if (jobs.size <= MAX_JOBS) return;
  const oldest = [...jobs.entries()].sort(
    (a, b) => Number(a[1].startedAt || 0) - Number(b[1].startedAt || 0),
  );
  while (jobs.size > MAX_JOBS && oldest.length) {
    const [id] = oldest.shift();
    jobs.delete(id);
  }
}

function createJob({ workspaceId, fileName, source }) {
  pruneJobs();
  const id = crypto.randomUUID();
  const now = Date.now();
  const job = {
    id,
    workspaceId: String(workspaceId || ''),
    fileName: String(fileName || 'import.csv'),
    source: String(source || 'csv'),
    status: 'queued',
    processed: 0,
    total: 0,
    percent: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    rejected: 0,
    rawRowCount: 0,
    realEstateImport: false,
    error: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  if (!id) return null;
  pruneJobs();
  return jobs.get(String(id)) || null;
}

function touch(job, patch) {
  if (!job) return null;
  Object.assign(job, patch || {});
  job.updatedAt = Date.now();
  if (job.total > 0) {
    job.percent = Math.max(
      0,
      Math.min(100, Math.round((Number(job.processed) || 0) / job.total * 100)),
    );
  } else if (job.status === 'done') {
    job.percent = 100;
  }
  return job;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    fileName: job.fileName,
    source: job.source,
    processed: job.processed,
    total: job.total,
    percent: job.percent,
    created: job.created,
    updated: job.updated,
    skipped: job.skipped,
    failed: job.failed,
    rejected: job.rejected,
    rawRowCount: job.rawRowCount,
    realEstateImport: !!job.realEstateImport,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    imported: (Number(job.created) || 0) + (Number(job.updated) || 0),
  };
}

module.exports = {
  createJob,
  getJob,
  touch,
  publicJob,
  pruneJobs,
  _jobsForTests: jobs,
};
