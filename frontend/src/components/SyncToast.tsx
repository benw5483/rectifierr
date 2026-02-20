import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import clsx from "clsx";
import { api, PlexSyncStatus } from "../api/client";

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n !== 1 ? "s" : ""}`;
}

type ToastPhase = "hidden" | "running" | "completed" | "failed";

export default function SyncToast() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<ToastPhase>("hidden");
  const [snap, setSnap] = useState<PlexSyncStatus | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelMut = useMutation({ mutationFn: api.plexCancelSync });

  // Lightweight poll — only fires while sync is running
  const { data: syncStatus } = useQuery({
    queryKey: ["plex-sync-status"],
    queryFn: api.plexSyncStatus,
    refetchInterval: (query) => {
      const d = query.state.data as PlexSyncStatus | undefined;
      return d?.status === "running" ? 1500 : false;
    },
    staleTime: 0,
  });

  // Also kick off the poll whenever plex-status changes to running
  // (e.g. sync started from the Settings page)
  const { data: plexStatus } = useQuery({
    queryKey: ["plex-status"],
    queryFn: api.plexStatus,
    staleTime: Infinity,
  });

  // Seed the poll when a sync starts
  useEffect(() => {
    if (plexStatus?.sync?.status === "running") {
      qc.invalidateQueries({ queryKey: ["plex-sync-status"] });
    }
  }, [plexStatus?.sync?.status]);

  // React to sync status changes
  useEffect(() => {
    if (!syncStatus) return;

    if (syncStatus.status === "running") {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setSnap(syncStatus);
      setPhase("running");
    } else if (syncStatus.status === "completed" && phase === "running") {
      setSnap(syncStatus);
      setPhase("completed");
      dismissTimer.current = setTimeout(() => setPhase("hidden"), 5000);
      // Refresh media + stats now that library is updated
      qc.invalidateQueries({ queryKey: ["plex-status"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["media-list"] });
    } else if (syncStatus.status === "failed" && phase === "running") {
      setSnap(syncStatus);
      setPhase("failed");
    } else if (syncStatus.status === "cancelled" && phase === "running") {
      setPhase("hidden");
    }
  }, [syncStatus]);

  // On initial load — if a sync was already running before this component mounted
  useEffect(() => {
    if (syncStatus?.status === "running") {
      setSnap(syncStatus);
      setPhase("running");
    }
  }, []); // intentionally only on mount

  const dismiss = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setPhase("hidden");
  };

  if (phase === "hidden" || !snap) return null;

  const pct =
    snap.total && snap.processed
      ? Math.round((snap.processed / snap.total) * 100)
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
              <span className="text-sm font-medium text-slate-200">Syncing Plex library</span>
            </>
          )}
          {phase === "completed" && (
            <>
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <span className="text-sm font-medium text-slate-200">Sync complete</span>
            </>
          )}
          {phase === "failed" && (
            <>
              <XCircle size={14} className="text-red-400 shrink-0" />
              <span className="text-sm font-medium text-slate-200">Sync failed</span>
            </>
          )}
        </div>
        {phase === "running" && (
          <button
            onClick={() => cancelMut.mutate()}
            disabled={cancelMut.isPending}
            title="Cancel sync"
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
      {phase === "running" && (
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
            <div className="flex justify-between">
              <span>{snap.processed ?? 0} / {snap.total ?? "…"} items</span>
              <span className="text-brand-400 tabular-nums">{pct}%</span>
            </div>
            {(snap.imported ?? 0) > 0 && (
              <div className="text-emerald-400">
                +{plural(snap.imported!, "new file")} imported
              </div>
            )}
          </>
        )}
        {phase === "completed" && (
          <div className="text-emerald-400">
            {snap.imported ? plural(snap.imported, "new file") : "No new files"} imported
            {snap.updated ? `, ${plural(snap.updated, "file")} updated` : ""}
          </div>
        )}
        {phase === "failed" && (
          <div className="text-red-300">{snap.error ?? "An unknown error occurred"}</div>
        )}
      </div>
    </div>
  );
}
