import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import clsx from "clsx";
import { api, ScanJob } from "../api/client";

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n !== 1 ? "s" : ""}`;
}

type ToastPhase = "hidden" | "running" | "completed" | "failed";

export default function ScanToast() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<ToastPhase>("hidden");
  const [snap, setSnap] = useState<ScanJob | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRunning = useRef(false);

  const cancelMut = useMutation({
    mutationFn: () => api.cancelJob(snap!.id),
    onSuccess: () => {
      setPhase("hidden");
      qc.invalidateQueries({ queryKey: ["active-jobs"] });
    },
  });

  // Shared with Dashboard — TanStack deduplicates the request.
  // Use a faster interval while jobs are active.
  const { data: activeJobs } = useQuery({
    queryKey: ["active-jobs"],
    queryFn: api.getActiveScan,
    refetchInterval: (query) => {
      const jobs = query.state.data as ScanJob[] | undefined;
      return jobs && jobs.length > 0 ? 2000 : false;
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (!activeJobs) return;

    if (activeJobs.length > 0) {
      const job = activeJobs[0];
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setSnap(job);
      setPhase("running");
      wasRunning.current = true;
    } else if (wasRunning.current && snap) {
      wasRunning.current = false;
      // Fetch final status now that the job left the active queue
      api.getJob(snap.id).then((finalJob) => {
        setSnap(finalJob);
        if (finalJob.status === "completed") {
          setPhase("completed");
          qc.invalidateQueries({ queryKey: ["stats"] });
          qc.invalidateQueries({ queryKey: ["media-list"] });
          qc.invalidateQueries({ queryKey: ["media"] }); // refreshes any expanded rows
          dismissTimer.current = setTimeout(() => setPhase("hidden"), 5000);
        } else if (finalJob.status === "failed") {
          setPhase("failed");
        } else {
          // cancelled or other terminal state
          setPhase("hidden");
        }
      }).catch(() => setPhase("hidden"));
    }
  }, [activeJobs]);

  // Seed on initial mount if a scan was already running
  useEffect(() => {
    if (activeJobs && activeJobs.length > 0) {
      setSnap(activeJobs[0]);
      setPhase("running");
      wasRunning.current = true;
    }
  }, []); // intentionally only on mount

  const dismiss = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setPhase("hidden");
  };

  if (phase === "hidden" || !snap) return null;

  const pct =
    snap.total_files && snap.processed_files
      ? Math.round((snap.processed_files / snap.total_files) * 100)
      : 0;

  return (
    <div
      className={clsx(
        "rounded-xl border p-3",
        phase === "running" && "bg-surface-900 border-brand-700",
        phase === "completed" && "bg-surface-900 border-emerald-700",
        phase === "failed" && "bg-surface-900 border-red-700",
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {phase === "running" && (
            <>
              <Loader2 size={14} className="animate-spin text-brand-400 shrink-0" />
              <span className="text-sm font-medium text-slate-200">Scanning library</span>
            </>
          )}
          {phase === "completed" && (
            <>
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <span className="text-sm font-medium text-slate-200">Scan complete</span>
            </>
          )}
          {phase === "failed" && (
            <>
              <XCircle size={14} className="text-red-400 shrink-0" />
              <span className="text-sm font-medium text-slate-200">Scan failed</span>
            </>
          )}
        </div>
        {phase === "running" && (
          <button
            onClick={() => cancelMut.mutate()}
            disabled={cancelMut.isPending}
            title="Cancel scan"
            className="ml-auto text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
          >
            <X size={14} />
          </button>
        )}
        {(phase === "completed" || phase === "failed") && (
          <button onClick={dismiss} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Progress bar (running only) */}
      {phase === "running" && snap.total_files > 0 && (
        <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Stats */}
      <div className="text-xs text-slate-400 space-y-0.5">
        {phase === "running" && (
          <>
            {snap.total_files > 0 ? (
              <div className="flex justify-between">
                <span>{snap.processed_files} / {snap.total_files} files</span>
                <span className="text-brand-400 tabular-nums">{pct}%</span>
              </div>
            ) : (
              <span>Preparing…</span>
            )}
            {snap.issues_found > 0 && (
              <div className="text-amber-400">
                {plural(snap.issues_found, "issue")} found
              </div>
            )}
          </>
        )}
        {phase === "completed" && (
          <div className="text-emerald-400">
            {plural(snap.total_files, "file")} scanned
            {snap.issues_found > 0 ? `, ${plural(snap.issues_found, "issue")} found` : ", no issues"}
          </div>
        )}
        {phase === "failed" && (
          <div className="text-red-300">{snap.error_message ?? "An unknown error occurred"}</div>
        )}
      </div>
    </div>
  );
}
