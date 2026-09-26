import { CheckCircle2, Clock, Loader2, XCircle, Inbox } from 'lucide-react';
import { PROFILES } from '../../shared/processing.js';
import { formatDuration, timeAgo, timeUntil } from '../../services/media';
import type { ClientJob } from './JobDetail';

interface LibraryProps {
  jobs: ClientJob[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function Library({ jobs, loading, selectedId, onSelect }: LibraryProps) {
  return (
    <aside className="card flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden lg:sticky lg:top-24">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-bold">Library</h2>
        <span className="text-xs text-muted">Recent files</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {loading && jobs.length === 0 && (
          <div className="space-y-2 p-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-sunken" />
            ))}
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Inbox className="mx-auto h-6 w-6 text-faint" />
            <p className="mt-3 text-sm font-semibold">Nothing here yet</p>
            <p className="mt-1 text-xs text-muted">Cleaned files show up here so you can come back and download them.</p>
          </div>
        )}

        <ul className="space-y-1">
          {jobs.map((job) => {
            const active = job.fileId === selectedId;
            const running = job.status === 'uploading' || job.status === 'uploaded' || job.status === 'processing';
            const percent = job.status === 'uploading' ? job.uploadPercent ?? 0 : job.percent ?? 3;
            return (
              <li key={job.fileId}>
                <button
                  type="button"
                  onClick={() => onSelect(job.fileId)}
                  className={`w-full rounded-2xl px-3 py-3 text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-sunken'}`}
                >
                  <div className="flex items-center gap-3">
                    {running ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                    ) : job.status === 'failed' ? (
                      <XCircle className="h-4 w-4 shrink-0 text-danger" />
                    ) : job.status === 'expired' ? (
                      <Clock className="h-4 w-4 shrink-0 text-faint" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{job.originalFileName}</p>
                      <p className="truncate text-xs text-muted">
                        {running
                          ? job.status === 'uploading'
                            ? `Uploading ${percent}%`
                            : job.stage || 'Starting'
                          : job.status === 'expired'
                            ? 'Audio deleted · notes kept'
                            : [job.feature && PROFILES[job.feature]?.name, job.durationSeconds ? formatDuration(job.durationSeconds) : null, job.expiresAt ? `deletes ${timeUntil(job.expiresAt)}` : timeAgo(job.createdAt)]
                              .filter(Boolean)
                              .join(' · ')}
                      </p>
                    </div>
                  </div>
                  {running && (
                    <div className="ml-7 mt-2 h-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, percent)}%` }} />
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
