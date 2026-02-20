import { type ElementType } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileVideo, AlertTriangle, CheckCircle, Tv, ScanLine,
  AlertCircle, Loader2, Play,
} from "lucide-react";
import { api, RecentIssue } from "../api/client";
import StatusBadge from "../components/StatusBadge";

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string;
  value: number | string;
  sub?: string;
  icon: ElementType;
  color: string;
}) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-slate-400">{label}</p>
        {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}


export default function Dashboard() {
  const qc = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
    refetchInterval: 10_000,
  });

  const { data: activeJobs } = useQuery({
    queryKey: ["active-jobs"],
    queryFn: api.getActiveScan,
    refetchInterval: 3_000,
  });

  const { data: recentIssues } = useQuery({
    queryKey: ["recent-issues"],
    queryFn: () => api.getRecentIssues(10),
    refetchInterval: 15_000,
  });

  const scanMutation = useMutation({
    mutationFn: () => api.startScan({ scan_type: "full_library" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-jobs"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  const hasActive = activeJobs && activeJobs.length > 0;

  return (
    <div className="space-y-6">
      {/* Page title + actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">Media quality overview</p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending || hasActive}
          className="btn-primary disabled:opacity-50"
        >
          {scanMutation.isPending || hasActive ? (
            <><Loader2 size={15} className="animate-spin" /> Scanning…</>
          ) : (
            <><ScanLine size={15} /> Scan Library</>
          )}
        </button>
      </div>

      {/* Active job banner */}
      {hasActive && activeJobs.map((job) => (
        <div key={job.id} className="card border-brand-700/50 bg-brand-900/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-brand-300 font-medium text-sm">
              <Loader2 size={14} className="animate-spin" />
              Scanning — {job.processed_files} / {job.total_files} files
            </div>
            <span className="text-xs text-brand-400">{job.progress_pct}%</span>
          </div>
          <div className="h-1.5 bg-surface-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${job.progress_pct}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            {job.issues_found} issue{job.issues_found !== 1 ? "s" : ""} found so far
          </p>
        </div>
      ))}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Files"
          value={stats?.total_files ?? 0}
          sub={`${stats?.scanned_files ?? 0} scanned`}
          icon={FileVideo}
          color="bg-slate-600"
        />
        <StatCard
          label="Issues Found"
          value={stats?.total_issues ?? 0}
          sub={`${stats?.unresolved_issues ?? 0} unresolved`}
          icon={AlertTriangle}
          color="bg-amber-700"
        />
        <StatCard
          label="Bumpers"
          value={stats?.bumpers_found ?? 0}
          sub="network promos detected"
          icon={Play}
          color="bg-orange-700"
        />
        <StatCard
          label="Channel Logos"
          value={stats?.logos_found ?? 0}
          sub="persistent watermarks"
          icon={Tv}
          color="bg-purple-700"
        />
      </div>

      {/* Clean vs flagged */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card flex items-center gap-4">
          <CheckCircle size={32} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-white">{stats?.clean_files ?? 0}</p>
            <p className="text-sm text-slate-400">Clean files</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <AlertCircle size={32} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-white">{stats?.files_with_issues ?? 0}</p>
            <p className="text-sm text-slate-400">Files with issues</p>
          </div>
        </div>
      </div>

      {/* Recent issues */}
      <div className="card">
        <h2 className="text-base font-semibold text-white mb-4">Recent Detections</h2>
        {!recentIssues || recentIssues.length === 0 ? (
          <p className="text-sm text-slate-500">No issues detected yet. Run a scan to get started.</p>
        ) : (
          <div className="space-y-2">
            {recentIssues.map((issue) => (
              <RecentIssueRow key={issue.id} issue={issue} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentIssueRow({ issue }: { issue: RecentIssue }) {
  const title = issue.series_title
    ? `${issue.series_title} — ${issue.media_title}`
    : issue.media_title ?? "Unknown";

  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
      <StatusBadge status={issue.issue_type} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate">{title}</p>
        <p className="text-xs text-slate-500">{issue.description}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-slate-400">{Math.round(issue.confidence * 100)}% conf.</p>
        {issue.resolved && (
          <p className="text-xs text-emerald-500">resolved</p>
        )}
      </div>
    </div>
  );
}
