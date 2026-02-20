import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Loader2, Scissors, X, XCircle,
} from "lucide-react";
import clsx from "clsx";
import { api, Issue, MediaFile, TrimJob } from "../api/client";

// ── Utilities ────────────────────────────────────────────────────────────────

/** Format fractional seconds as M:SS.t */
function fmtTime(s: number): string {
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const formatted = `${m}:${sec.toFixed(1).padStart(4, "0")}`;
  return neg ? `-${formatted}` : formatted;
}

/** Clamp a value between min and max, rounded to 1 decimal */
function clamp(v: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, v)) * 10) / 10;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** The draggable timeline bar.
 *  Clicking/dragging on it moves the nearest handle (start or end). */
function Timeline({
  total,
  start,
  end,
  onChange,
  disabled,
}: {
  total: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  disabled: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const toSeconds = useCallback(
    (clientX: number): number => {
      const rect = barRef.current!.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return clamp(ratio * total, 0, total);
    },
    [total]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = toSeconds(e.clientX);
    // Pick the closer handle
    dragging.current = Math.abs(t - start) <= Math.abs(t - end) ? "start" : "end";
    move(t);
  };

  const move = (t: number) => {
    if (dragging.current === "start") {
      onChange(clamp(t, 0, end - 0.5), end);
    } else if (dragging.current === "end") {
      onChange(start, clamp(t, start + 0.5, total));
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || disabled) return;
    move(toSeconds(e.clientX));
  };

  const handlePointerUp = () => {
    dragging.current = null;
  };

  const startPct = (start / total) * 100;
  const removePct = ((end - start) / total) * 100;
  const endPct = (end / total) * 100;

  return (
    <div className="select-none">
      {/* Bar */}
      <div
        ref={barRef}
        className={clsx(
          "relative h-10 rounded-lg overflow-hidden",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-col-resize"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Keep-before region */}
        <div
          className="absolute inset-y-0 left-0 bg-emerald-900/70"
          style={{ width: `${startPct}%` }}
        />

        {/* Remove region */}
        <div
          className="absolute inset-y-0 bg-red-700/80 flex items-center justify-center overflow-hidden"
          style={{ left: `${startPct}%`, width: `${removePct}%` }}
        >
          {removePct > 4 && (
            <span className="text-[11px] font-semibold text-red-200 tracking-wider uppercase truncate px-1">
              remove
            </span>
          )}
        </div>

        {/* Keep-after region */}
        <div
          className="absolute inset-y-0 right-0 bg-emerald-900/70"
          style={{ left: `${endPct}%` }}
        />

        {/* Start handle */}
        <div
          className="absolute inset-y-0 w-1 bg-red-400 cursor-col-resize z-10"
          style={{ left: `calc(${startPct}% - 2px)` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-red-400 border-2 border-surface-900" />
        </div>

        {/* End handle */}
        <div
          className="absolute inset-y-0 w-1 bg-red-400 cursor-col-resize z-10"
          style={{ left: `calc(${endPct}% - 2px)` }}
        >
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-red-400 border-2 border-surface-900" />
        </div>
      </div>

      {/* Time labels below bar */}
      <div className="relative h-5 mt-1 text-[11px] text-slate-500">
        <span className="absolute left-0">0:00.0</span>
        <span
          className="absolute -translate-x-1/2 text-red-400"
          style={{ left: `${startPct}%` }}
        >
          {fmtTime(start)}
        </span>
        <span
          className="absolute -translate-x-1/2 text-red-400"
          style={{ left: `${endPct}%` }}
        >
          {fmtTime(end)}
        </span>
        <span className="absolute right-0">{fmtTime(total)}</span>
      </div>
    </div>
  );
}

// ── Status overlay ────────────────────────────────────────────────────────────

function ProcessingOverlay({
  job,
  onClose,
  onRetry,
}: {
  job: TrimJob;
  onClose: () => void;
  onRetry: () => void;
}) {
  if (job.status === "completed") {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <CheckCircle2 className="w-14 h-14 text-emerald-400" />
        <div className="text-center">
          <p className="text-lg font-semibold text-white">Segment removed</p>
          <p className="text-sm text-slate-400 mt-1">
            {job.remove_duration.toFixed(1)}s removed •{" "}
            {job.elapsed_seconds != null
              ? `took ${job.elapsed_seconds.toFixed(0)}s`
              : "complete"}
          </p>
          {job.backup_path && (
            <p className="text-xs text-slate-600 mt-2 font-mono truncate max-w-xs">
              Backup: {job.backup_path}
            </p>
          )}
        </div>
        <button onClick={onClose} className="btn-primary mt-2">
          Done
        </button>
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <XCircle className="w-14 h-14 text-red-400" />
        <div className="text-center">
          <p className="text-lg font-semibold text-white">Trim failed</p>
          <p className="text-sm text-red-300 mt-1">{job.error_message ?? "Unknown error"}</p>
          <p className="text-xs text-slate-500 mt-2">
            The original file was not modified.
          </p>
        </div>
        <div className="flex gap-3 mt-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={onRetry} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // pending / running
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <Loader2 className="w-12 h-12 text-brand-400 animate-spin" />
      <div className="text-center">
        <p className="text-base font-medium text-white">
          {job.status === "pending" ? "Queued…" : "Removing segment…"}
        </p>
        <p className="text-sm text-slate-400 mt-1">
          {job.status === "running" && job.elapsed_seconds != null
            ? `${job.elapsed_seconds.toFixed(0)}s elapsed`
            : "Creating backup, then cutting with FFmpeg"}
        </p>
        <p className="text-xs text-slate-600 mt-2">
          This may take a few minutes for large files.
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  media: MediaFile;
  issue: Issue;
  onClose: () => void;
}

export default function TrimEditor({ media, issue, onClose }: Props) {
  const qc = useQueryClient();
  const total = media.duration_seconds ?? 1;

  const [start, setStart] = useState(issue.start_seconds);
  const [end, setEnd] = useState(issue.end_seconds);
  const [jobId, setJobId] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const removeDuration = end - start;
  const isProcessing = jobId !== null;

  // ── Poll trim job status ──────────────────────────────────────────────────
  const { data: trimJob } = useQuery({
    queryKey: ["trim-job", media.id, jobId],
    queryFn: () => api.getTrimJob(media.id, jobId!),
    enabled: isProcessing,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "completed" || s === "failed" ? false : 1500;
    },
  });

  // Invalidate media cache when done
  useEffect(() => {
    if (trimJob?.status === "completed") {
      qc.invalidateQueries({ queryKey: ["media", media.id] });
      qc.invalidateQueries({ queryKey: ["media-list"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    }
  }, [trimJob?.status, media.id, qc]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const submitMut = useMutation({
    mutationFn: () =>
      api.startTrim(media.id, {
        remove_start: start,
        remove_end: end,
        issue_id: issue.id,
      }),
    onSuccess: (job) => {
      setJobId(job.id);
    },
  });

  const handleConfirm = () => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    submitMut.mutate();
  };

  const handleRetry = () => {
    setJobId(null);
    setConfirmed(false);
    submitMut.reset();
  };

  // ── Input helpers ─────────────────────────────────────────────────────────
  const setStartSafe = (v: number) => setStart(clamp(v, 0, end - 0.5));
  const setEndSafe = (v: number) => setEnd(clamp(v, start + 0.5, total));

  const handleTimelineChange = (s: number, e: number) => {
    setStart(s);
    setEnd(e);
    if (confirmed) setConfirmed(false); // reset confirmation if they adjust
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const isValid = start >= 0 && end <= total + 0.1 && removeDuration >= 0.5;

  // ── Title ─────────────────────────────────────────────────────────────────
  const mediaTitle = media.series_title
    ? `${media.series_title} S${String(media.season_number ?? 0).padStart(2, "0")}E${String(media.episode_number ?? 0).padStart(2, "0")}`
    : media.title;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !isProcessing && onClose()}
    >
      <div className="bg-surface-800 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <Scissors size={18} className="text-brand-400" />
            <div>
              <h2 className="text-base font-semibold text-white">Trim Bumper</h2>
              <p className="text-xs text-slate-400">{mediaTitle}</p>
            </div>
          </div>
          {!isProcessing && (
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X size={20} />
            </button>
          )}
        </div>

        <div className="px-6 py-5">
          {/* Processing state */}
          {isProcessing && trimJob ? (
            <ProcessingOverlay job={trimJob} onClose={onClose} onRetry={handleRetry} />
          ) : isProcessing && !trimJob ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-10 h-10 text-brand-400 animate-spin" />
              <p className="text-sm text-slate-400">Starting trim job…</p>
            </div>
          ) : (
            <>
              {/* Detection info */}
              <div className="mb-5 p-3 bg-surface-900 rounded-lg border border-slate-700">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Detected
                </p>
                <p className="text-sm text-slate-300">
                  {issue.description ?? "Bumper"}
                  <span className="text-slate-500 ml-2">
                    {fmtTime(issue.start_seconds)} → {fmtTime(issue.end_seconds)}
                    {" "}({issue.duration.toFixed(1)}s · {Math.round(issue.confidence * 100)}% confidence)
                  </span>
                </p>
              </div>

              {/* Timeline */}
              <div className="mb-6">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">
                  Drag handles to adjust trim region
                </p>
                <Timeline
                  total={total}
                  start={start}
                  end={end}
                  onChange={handleTimelineChange}
                  disabled={false}
                />
              </div>

              {/* Time inputs */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="label">Remove from</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={end - 0.5}
                      step={0.1}
                      value={start}
                      onChange={(e) => setStartSafe(parseFloat(e.target.value) || 0)}
                      className="input pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      sec
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{fmtTime(start)}</p>
                </div>

                <div>
                  <label className="label">Remove until</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={start + 0.5}
                      max={total}
                      step={0.1}
                      value={end}
                      onChange={(e) => setEndSafe(parseFloat(e.target.value) || 0)}
                      className="input pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      sec
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">{fmtTime(end)}</p>
                </div>

                <div>
                  <label className="label">Removing</label>
                  <div
                    className={clsx(
                      "px-3 py-2 rounded-lg text-sm font-medium border",
                      isValid
                        ? "bg-red-900/30 text-red-300 border-red-800"
                        : "bg-slate-800 text-slate-500 border-slate-700"
                    )}
                  >
                    {removeDuration.toFixed(1)}s
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    {issue.position === "end" ? "from end" : "from start"}
                  </p>
                </div>
              </div>

              {/* Warning */}
              <div className="flex gap-2.5 p-3.5 bg-amber-950/40 border border-amber-900/50 rounded-lg mb-5">
                <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <strong>Destructive operation.</strong> This permanently modifies the file.
                  A backup will be saved as{" "}
                  <span className="font-mono text-xs">
                    {media.path.split("/").pop()}.bak
                  </span>
                </div>
              </div>

              {/* Confirm step */}
              {confirmed && (
                <div className="flex gap-2 p-3 bg-red-950/40 border border-red-900/50 rounded-lg mb-4 items-center">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <p className="text-sm text-red-300">
                    Click <strong>Remove Segment</strong> again to confirm.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button onClick={onClose} className="btn-secondary">
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!isValid || submitMut.isPending}
                  className={clsx(
                    "btn-danger disabled:opacity-50",
                    confirmed && "ring-2 ring-red-400 ring-offset-2 ring-offset-surface-800"
                  )}
                >
                  {submitMut.isPending ? (
                    <><Loader2 size={14} className="animate-spin" /> Starting…</>
                  ) : confirmed ? (
                    <><Scissors size={14} /> Confirm Remove</>
                  ) : (
                    <><Scissors size={14} /> Remove Segment</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
