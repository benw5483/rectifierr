import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, RefreshCw } from "lucide-react";
import { api, ScanJob } from "../api/client";
import StatusBadge from "../components/StatusBadge";

function formatDate(s?: string): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function formatDuration(s?: number): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function JobRow({ job }: { job: ScanJob }) {
  const qc = useQueryClient();
  const cancelMut = useMutation({
    mutationFn: () => api.cancelJob(job.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity"] }),
  });

  const isActive = job.status === "pending" || job.status === "running";

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <StatusBadge status={job.status} />
            <span className="text-xs text-slate-500 font-mono">#{job.id}</span>
            <span className="text-xs text-slate-400 capitalize">{job.scan_type.replace(/_/g, " ")}</span>
          </div>

          {job.target_path && (
            <p className="text-xs text-slate-500 font-mono truncate mb-1.5">{job.target_path}</p>
          )}

          {isActive && job.total_files > 0 && (
            <div className="mb-2">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>{job.processed_files} / {job.total_files} files</span>
                <span>{job.progress_pct}%</span>
              </div>
              <div className="h-1.5 bg-surface-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${job.progress_pct}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-4 text-xs text-slate-500">
            <span>Started: {formatDate(job.started_at)}</span>
            {job.completed_at && <span>Duration: {formatDuration(job.duration_seconds)}</span>}
            {job.issues_found > 0 && (
              <span className="text-amber-400">{job.issues_found} issue{job.issues_found !== 1 ? "s" : ""}</span>
            )}
          </div>

          {job.error_message && (
            <p className="text-xs text-red-400 mt-1.5 font-mono">{job.error_message}</p>
          )}
        </div>

        {isActive && (
          <button
            onClick={() => cancelMut.mutate()}
            disabled={cancelMut.isPending}
            className="btn-secondary text-xs py-1 px-2 shrink-0"
            title="Cancel job"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function Activity() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.getActivity(0, 100),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity</h1>
          <p className="text-sm text-slate-400 mt-0.5">Scan queue and history</p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["activity"] })}
          className="btn-secondary"
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
        </div>
      ) : !data?.items.length ? (
        <div className="card text-center py-12">
          <p className="text-slate-400">No scan history yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((job) => <JobRow key={job.id} job={job} />)}
        </div>
      )}
    </div>
  );
}
