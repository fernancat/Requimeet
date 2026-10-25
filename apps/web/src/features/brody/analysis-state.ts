import type { AnalysisStatus } from '@requimeet/contracts';
export function analysisState(data: AnalysisStatus | null) {
  const jobs = (data?.jobs ?? []).filter(job => job.kind === 'analysis');
  const latest = jobs.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const active = data?.activeJob !== undefined ? data.activeJob : jobs.find(job => ['queued', 'running'].includes(job.status));
  return {
    working: Boolean(active),
    retrying: active?.status === 'queued' && (active.attempts ?? 0) > 0,
    queued: active?.status === 'queued',
    failed: !active && latest?.status === 'failed',
    error: !active && latest?.status === 'failed' ? latest.error : null,
  };
}
